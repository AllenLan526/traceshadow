import asyncio
import ipaddress
import json
import os
import socket
import time
from typing import Callable
from urllib.parse import urlparse, urlunparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from playwright.async_api import Request as PlaywrightRequest
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

Cat = str
ResType = str
ScanEvent = dict
SendEvent = Callable[[ScanEvent], None]

SCAN_TIMEOUT_MS = int(os.getenv("SCAN_TIMEOUT_MS", "15000"))
SAMPLE_LIMIT = 5

app = FastAPI(title="TraceShadow API")

origins = [item.strip() for item in os.getenv("CORS_ORIGIN", "").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return PlainTextResponse("TraceShadow API is running. Try /api/health, /api/demo, or POST /api/analyze.")


@app.get("/api/health")
async def health():
    return {"ok": True, "name": "TraceShadow"}


@app.get("/api/demo")
async def demo():
    return demo_result()


@app.post("/api/analyze")
async def analyze(request: Request):
    body = await request.json()
    url = body.get("url") if isinstance(body, dict) else ""

    try:
        return await run_scan(url)
    except AppError as err:
        return JSONResponse(
            status_code=err.status,
            content={"error": str(err), "code": err.code, "demoAvailable": True},
        )
    except Exception as err:
        return JSONResponse(
            status_code=500,
            content={
                "error": f"Scan failed: {err}. Some sites block automated browsers; try demo mode if needed.",
                "code": "scan_failed",
                "demoAvailable": True,
            },
        )


@app.post("/api/analyze-stream")
async def analyze_stream(request: Request):
    body = await request.json()
    url = body.get("url") if isinstance(body, dict) else ""
    queue: asyncio.Queue[ScanEvent | None] = asyncio.Queue()

    def send(event: ScanEvent):
        queue.put_nowait(event)

    async def worker():
        try:
            await run_scan(url, send)
        except AppError as err:
            send({"type": "error", "error": str(err), "code": err.code})
        except Exception as err:
            send({
                "type": "error",
                "error": f"Scan failed: {err}. Some sites block automated browsers; try demo mode if needed.",
                "code": "scan_failed",
            })
        finally:
            await queue.put(None)

    async def stream():
        task = asyncio.create_task(worker())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event) + "\n"
        finally:
            await task

    return StreamingResponse(stream(), media_type="application/x-ndjson")


async def run_scan(input_url: str, send: SendEvent | None = None):
    start = time.time()
    emit(send, {"type": "status", "message": "Validating URL..."})
    target_url = normalize_url(input_url)
    reqs = []
    warnings = []
    live_domains = {}
    live_third_party_count = 0
    starting_domain = site_domain(target_url)

    emit(send, {"type": "status", "message": "Opening page..."})

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])

        try:
            context = await browser.new_context(
                ignore_https_errors=True,
                user_agent="TraceShadow/0.1 educational scanner",
            )

            async def check_route(route):
                url = route.request.url
                if not is_http_url(url):
                    await route.abort()
                    return

                try:
                    host = urlparse(url).hostname or ""
                    if is_blocked_host(host):
                        await route.abort()
                        return
                except Exception:
                    await route.abort()
                    return

                await route.continue_()

            await context.route("**/*", check_route)
            page = await context.new_page()
            page.set_default_timeout(SCAN_TIMEOUT_MS)

            emit(send, {"type": "status", "message": "Collecting network requests..."})

            def on_request(req: PlaywrightRequest):
                nonlocal live_third_party_count
                info = read_req(req)
                if not info:
                    return

                reqs.append(info)

                if site_domain(info["url"]) != starting_domain:
                    live_third_party_count += 1
                    domain = upsert_domain(live_domains, info)
                    emit(send, {
                        "type": "domain",
                        "domain": domain,
                        "totalRequests": len(reqs),
                        "thirdPartyRequestCount": live_third_party_count,
                        "uniqueThirdPartyDomains": len(live_domains),
                    })

            page.on("request", on_request)

            timed_out = False
            response = None
            try:
                response = await page.goto(target_url, wait_until="domcontentloaded", timeout=SCAN_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                if not reqs:
                    raise
                timed_out = True
                add_warning(warnings, "The page did not finish loading during the scan window, so TraceShadow is showing a partial scan from the requests it captured.", send)

            if response is None and not timed_out:
                add_warning(warnings, "The page opened, but Playwright did not receive a normal document response.", send)

            try:
                await page.wait_for_load_state("networkidle", timeout=1000 if timed_out else 3500)
            except Exception:
                add_warning(warnings, "Some requests were still loading after the scan window closed.", send)

            emit(send, {"type": "status", "message": "Classifying hidden domains..."})
            result = build_result(input_url, page.url, reqs, warnings, int((time.time() - start) * 1000))
            emit(send, {"type": "status", "message": "Building graph..."})
            emit(send, {"type": "result", "result": result})
            return result
        finally:
            await browser.close()


def read_req(req: PlaywrightRequest):
    url = req.url
    if not is_http_url(url):
        return None

    host = urlparse(url).hostname
    if not host:
        return None

    return {
        "url": url,
        "domain": host.lower(),
        "resourceType": map_resource(req.resource_type),
        "thirdParty": False,
    }


def build_result(input_url: str, final_url: str, all_reqs: list[dict], warnings: list[str], scan_time_ms: int):
    first_party_domain = site_domain(final_url)
    reqs = []

    for req in all_reqs:
        next_req = dict(req)
        next_req["thirdParty"] = site_domain(req["url"]) != first_party_domain
        reqs.append(next_req)

    third_party = [req for req in reqs if req["thirdParty"]]
    domains = group_domains(third_party)
    categories = count_cats(domains)
    score = calc_score(len(reqs), len(domains), categories)

    if not domains:
        warnings.append("No third-party domains were detected during this scan window.")

    nodes = [{"id": first_party_domain, "label": first_party_domain, "type": "firstParty"}]
    for domain in domains:
        nodes.append({
            "id": domain["domain"],
            "label": short_label(domain["domain"]),
            "type": "thirdParty",
            "category": domain["category"],
        })

    edges = []
    for domain in domains:
        edges.append({
            "id": f"{first_party_domain}-{domain['domain']}",
            "source": first_party_domain,
            "target": domain["domain"],
            "requestCount": domain["requestCount"],
        })

    return {
        "inputUrl": input_url,
        "finalUrl": final_url,
        "firstPartyDomain": first_party_domain,
        "scanTimeMs": scan_time_ms,
        "totalRequests": len(reqs),
        "thirdPartyRequestCount": len(third_party),
        "uniqueThirdPartyDomains": len(domains),
        "categories": categories,
        "score": score,
        "domains": domains,
        "graph": {"nodes": nodes, "edges": edges},
        "warnings": warnings,
    }


def upsert_domain(domain_map: dict[str, dict], req: dict):
    current = domain_map.get(req["domain"])
    if current:
        current["requestCount"] += 1
        if req["resourceType"] not in current["resourceTypes"]:
            current["resourceTypes"].append(req["resourceType"])
        if len(current["sampleUrls"]) < SAMPLE_LIMIT and req["url"] not in current["sampleUrls"]:
            current["sampleUrls"].append(req["url"])
        return current

    category = classify_domain(req["domain"])
    next_domain = {
        "domain": req["domain"],
        "category": category,
        "requestCount": 1,
        "resourceTypes": [req["resourceType"]],
        "sampleUrls": [req["url"]],
        "explanation": explain_cat(category),
    }
    domain_map[req["domain"]] = next_domain
    return next_domain


def group_domains(reqs: list[dict]):
    domain_map = {}
    for req in reqs:
        upsert_domain(domain_map, req)
    return sorted(domain_map.values(), key=lambda item: item["requestCount"], reverse=True)


def count_cats(domains: list[dict]):
    counts = {"analytics": 0, "ads": 0, "cdn": 0, "social": 0, "tagManager": 0, "unknown": 0}
    for domain in domains:
        counts[domain["category"]] += 1
    return counts


def calc_score(total_requests: int, unique_domains: int, categories: dict):
    value = 0
    value += min(unique_domains * 5, 40)
    if categories["analytics"] > 0:
        value += 8
    if categories["ads"] > 0:
        value += 12
    if categories["social"] > 0:
        value += 8
    if categories["tagManager"] > 0:
        value += 5
    if total_requests > 30:
        value += 10
    if unique_domains > 10:
        value += 10

    value = min(value, 100)

    label = "Low exposure"
    if value > 75:
        label = "Very high exposure"
    elif value > 50:
        label = "High exposure"
    elif value > 25:
        label = "Moderate exposure"

    parts = []
    if unique_domains > 0:
        parts.append(f"{unique_domains} third-party domains")
    if categories["analytics"] > 0:
        parts.append("analytics tools")
    if categories["ads"] > 0:
        parts.append("advertising domains")
    if categories["social"] > 0:
        parts.append("social widgets")
    if categories["tagManager"] > 0:
        parts.append("tag managers")

    explanation = "This page has limited third-party activity in this scan."
    if parts:
        explanation = f"This page loads {', '.join(parts)}. This score is an educational approximation, not a professional privacy audit."

    return {"value": value, "label": label, "explanation": explanation}


RULES = {
    "tagManager": ["googletagmanager.com", "tagmanager"],
    "analytics": ["google-analytics.com", "plausible.io", "segment.com", "amplitude.com", "mixpanel.com", "hotjar.com", "examplemetrics.test"],
    "ads": ["doubleclick.net", "googlesyndication.com", "adservice.google.com", "adsystem.com", "taboola.com", "outbrain.com", "adnetwork.test"],
    "cdn": ["cloudflare.com", "cloudfront.net", "akamai", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fastcdn.test", "cdn.newsexample.test"],
    "social": ["facebook.net", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "linkedin.com", "sharewidget.test"],
}


def classify_domain(domain: str):
    name = domain.lower()
    for category, rules in RULES.items():
        for rule in rules:
            if rule in name:
                return category
    return "unknown"


def explain_cat(cat: Cat):
    if cat == "analytics":
        return "Analytics services measure visits, page views, clicks, and other user behavior."
    if cat == "ads":
        return "Advertising domains can load ad slots, bidding scripts, targeting pixels, or conversion trackers."
    if cat == "cdn":
        return "CDNs serve shared files such as scripts, images, fonts, and styles from external infrastructure."
    if cat == "social":
        return "Social widgets can load share buttons, embeds, login tools, or tracking pixels from social platforms."
    if cat == "tagManager":
        return "Tag managers can load and control other marketing, analytics, and tracking scripts from one place."
    return "This third-party domain did not match the simple local rules, so TraceShadow marks it as unknown."


def short_label(domain: str):
    known = {
        "www.google-analytics.com": "Google Analytics",
        "google-analytics.com": "Google Analytics",
        "www.googletagmanager.com": "Google Tag Manager",
        "googletagmanager.com": "Google Tag Manager",
        "connect.facebook.net": "Facebook",
        "cdn.newsexample.test": "News CDN",
        "analytics.examplemetrics.test": "Example Metrics",
        "ads.adnetwork.test": "Ad Network",
        "social.sharewidget.test": "Share Widget",
        "fonts.fastcdn.test": "Fast Fonts",
    }
    return known.get(domain, domain.removeprefix("www."))


def normalize_url(input_url: str):
    raw = input_url.strip()
    if not raw:
        raise AppError("Enter a URL to scan.")
    if raw.startswith("file:"):
        raise AppError("file:// URLs are not allowed.")

    with_proto = raw if "://" in raw else f"https://{raw}"
    parsed = urlparse(with_proto)

    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AppError("That does not look like a valid URL.")
    if parsed.username or parsed.password:
        raise AppError("URLs with usernames or passwords are not allowed.")
    if not parsed.hostname:
        raise AppError("That does not look like a valid URL.")

    assert_host_allowed(parsed.hostname)
    if not is_ip(parsed.hostname):
        assert_dns_allowed(parsed.hostname)

    return urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.params, parsed.query, ""))


def assert_dns_allowed(hostname: str):
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise AppError("Could not resolve that host.")

    for info in infos:
        address = info[4][0]
        if is_private_ip(address):
            raise AppError("This host resolves to a private network address, so it was blocked.")


def assert_host_allowed(hostname: str):
    host = clean_host(hostname)
    if host == "localhost" or host.endswith(".localhost"):
        raise AppError("Localhost URLs are blocked for safety.")
    if is_ip(host) and is_private_ip(host):
        raise AppError("Private network addresses are blocked for safety.")


def is_blocked_host(hostname: str):
    try:
        assert_host_allowed(hostname)
        return False
    except AppError:
        return True


def is_private_ip(value: str):
    try:
        ip = ipaddress.ip_address(clean_host(value))
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast


def is_ip(value: str):
    try:
        ipaddress.ip_address(clean_host(value))
        return True
    except ValueError:
        return False


def clean_host(hostname: str):
    return hostname.lower().strip("[]").rstrip(".")


def site_domain(url: str):
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return ""

    host = host.lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    return ".".join(parts[-2:])


def map_resource(kind: str):
    if kind in {"script", "image", "stylesheet", "document", "xhr", "fetch", "font", "media"}:
        return kind
    return "other"


def is_http_url(url: str):
    return url.startswith("http://") or url.startswith("https://")


def add_warning(warnings: list[str], message: str, send: SendEvent | None):
    warnings.append(message)
    emit(send, {"type": "warning", "message": message})


def emit(send: SendEvent | None, event: ScanEvent):
    if send:
        send(event)


def demo_result():
    first_party_domain = "news-example.test"
    domains = [
        demo_domain("cdn.newsexample.test", "cdn", 14, ["script", "stylesheet", "image"], [
            "https://cdn.newsexample.test/app-shell.js",
            "https://cdn.newsexample.test/styles/home.css",
            "https://cdn.newsexample.test/images/hero.webp",
        ]),
        demo_domain("analytics.examplemetrics.test", "analytics", 6, ["script", "xhr"], [
            "https://analytics.examplemetrics.test/track.js",
            "https://analytics.examplemetrics.test/collect?page=front",
        ]),
        demo_domain("ads.adnetwork.test", "ads", 8, ["script", "image", "xhr"], [
            "https://ads.adnetwork.test/bid.js",
            "https://ads.adnetwork.test/pixel.gif",
        ]),
        demo_domain("social.sharewidget.test", "social", 4, ["script", "image"], [
            "https://social.sharewidget.test/widget.js",
            "https://social.sharewidget.test/icons/x.svg",
        ]),
        demo_domain("fonts.fastcdn.test", "cdn", 3, ["font", "stylesheet"], [
            "https://fonts.fastcdn.test/inter.css",
            "https://fonts.fastcdn.test/inter-var.woff2",
        ]),
    ]

    categories = {"analytics": 1, "ads": 1, "cdn": 2, "social": 1, "tagManager": 0, "unknown": 0}

    return {
        "inputUrl": "https://news-example.test",
        "finalUrl": "https://news-example.test/",
        "firstPartyDomain": first_party_domain,
        "scanTimeMs": 1380,
        "totalRequests": 43,
        "thirdPartyRequestCount": 35,
        "uniqueThirdPartyDomains": len(domains),
        "categories": categories,
        "score": calc_score(43, len(domains), categories),
        "domains": domains,
        "graph": {
            "nodes": [{"id": first_party_domain, "label": first_party_domain, "type": "firstParty"}] + [
                {"id": item["domain"], "label": short_label(item["domain"]), "type": "thirdParty", "category": item["category"]}
                for item in domains
            ],
            "edges": [
                {
                    "id": f"{first_party_domain}-{item['domain']}",
                    "source": first_party_domain,
                    "target": item["domain"],
                    "requestCount": item["requestCount"],
                }
                for item in domains
            ],
        },
        "warnings": ["Demo scan uses fictional domains for a reliable presentation workflow."],
    }


def demo_domain(domain: str, category: Cat, request_count: int, resource_types: list[ResType], sample_urls: list[str]):
    return {
        "domain": domain,
        "category": category,
        "requestCount": request_count,
        "resourceTypes": resource_types,
        "sampleUrls": sample_urls,
        "explanation": explain_cat(category),
    }


class AppError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.status = status
        self.code = code
