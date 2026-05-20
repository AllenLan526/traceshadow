import asyncio
import ipaddress
import json
import os
import socket
import time
from typing import Callable
from urllib.parse import urlparse, urlunparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from playwright.async_api import Request as PlaywrightRequest
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

Cat = str
Evt = dict
Send = Callable[[Evt], None]

SCAN_TIMEOUT_MS = int(os.getenv("SCAN_TIMEOUT_MS", "15000"))
SAMPLE_LIMIT = 5

app = FastAPI(title="TraceShadow API")

cors = [s.strip() for s in os.getenv("CORS_ORIGIN", "").split(",") if s.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return PlainTextResponse("TraceShadow API is running. Try /api/health or POST /api/analyze.")


@app.get("/api/health")
async def health():
    return {"ok": True, "name": "TraceShadow"}


@app.post("/api/analyze")
async def analyze(request: Request):
    body = await request.json()
    url = body.get("url") if isinstance(body, dict) else ""

    try:
        return await scan(url)
    except AppError as err:
        return JSONResponse(
            status_code=err.status,
            content={"error": str(err), "code": err.code},
        )
    except Exception as err:
        return JSONResponse(
            status_code=500,
            content={
                "error": bad(err),
                "code": "scan_failed",
            },
        )


@app.post("/api/analyze-stream")
async def analyze_stream(request: Request):
    body = await request.json()
    url = body.get("url") if isinstance(body, dict) else ""
    q: asyncio.Queue[Evt | None] = asyncio.Queue()

    def send(evt: Evt):
        q.put_nowait(evt)

    async def worker():
        try:
            await scan(url, send)
        except AppError as err:
            send({"type": "error", "error": str(err), "code": err.code})
        except Exception as err:
            send({
                "type": "error",
                "error": bad(err),
                "code": "scan_failed",
            })
        finally:
            await q.put(None)

    async def stream():
        task = asyncio.create_task(worker())
        try:
            while True:
                evt = await q.get()
                if evt is None:
                    break
                yield json.dumps(evt) + "\n"
        finally:
            await task

    return StreamingResponse(stream(), media_type="application/x-ndjson")


async def scan(input_url: str, send: Send | None = None):
    st = time.time()
    emit(send, {"type": "status", "message": "Validating URL..."})
    url = norm_url(input_url)
    reqs = []
    warns = []
    doms = {}
    tp_cnt = 0
    root_dom = base_dom(url)

    emit(send, {"type": "status", "message": "Opening page..."})

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])

        try:
            context = await browser.new_context(
                ignore_https_errors=True,
                user_agent="TraceShadow/0.1 educational scanner",
            )

            async def check_route(route):
                req_url = route.request.url
                if not is_http_url(req_url):
                    await route.abort()
                    return

                try:
                    host = urlparse(req_url).hostname or ""
                    if blocked_host(host):
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
                nonlocal tp_cnt
                x = get_req(req)
                if not x:
                    return

                reqs.append(x)

                if base_dom(x["url"]) != root_dom:
                    tp_cnt += 1
                    dom = add(doms, x)
                    emit(send, {
                        "type": "domain",
                        "domain": dom,
                        "totalRequests": len(reqs),
                        "thirdPartyRequestCount": tp_cnt,
                        "uniqueThirdPartyDomains": len(doms),
                    })

            page.on("request", on_request)

            timed_out = False
            res = None
            try:
                res = await page.goto(url, wait_until="domcontentloaded", timeout=SCAN_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                if not reqs:
                    raise
                timed_out = True
                warn(warns, "The page did not finish loading during the scan window, so TraceShadow is showing a partial scan from the requests it captured.", send)

            if res is None and not timed_out:
                warn(warns, "The page opened, but Playwright did not receive a normal document response.", send)

            try:
                await page.wait_for_load_state("networkidle", timeout=1000 if timed_out else 3500)
            except Exception:
                warn(warns, "Some requests were still loading after the scan window closed.", send)

            emit(send, {"type": "status", "message": "Classifying hidden domains..."})
            out = make(input_url, page.url, reqs, warns, int((time.time() - st) * 1000))
            emit(send, {"type": "status", "message": "Building graph..."})
            emit(send, {"type": "result", "result": out})
            return out
        finally:
            await browser.close()


def get_req(req: PlaywrightRequest):
    url = req.url
    if not is_http_url(url):
        return None

    host = urlparse(url).hostname
    if not host:
        return None

    return {
        "url": url,
        "domain": host.lower(),
        "resourceType": map_res(req.resource_type),
        "thirdParty": False,
    }


def make(input_url: str, final_url: str, raw: list[dict], warns: list[str], scan_time_ms: int):
    first_dom = base_dom(final_url)
    reqs = []

    for req in raw:
        cur = dict(req)
        cur["thirdParty"] = base_dom(req["url"]) != first_dom
        reqs.append(cur)

    third = []
    for req in reqs:
        if req["thirdParty"]:
            third.append(req)
    doms = group(third)
    cats = count(doms)
    score = score_of(len(reqs), len(doms), cats)

    if not doms:
        warns.append("No third-party domains were detected during this scan window.")

    nodes = [{"id": first_dom, "label": first_dom, "type": "firstParty"}]
    for dom in doms:
        nodes.append({
            "id": dom["domain"],
            "label": short(dom["domain"]),
            "type": "thirdParty",
            "category": dom["category"],
        })

    edges = []
    for dom in doms:
        edges.append({
            "id": f"{first_dom}-{dom['domain']}",
            "source": first_dom,
            "target": dom["domain"],
            "requestCount": dom["requestCount"],
        })

    return {
        "inputUrl": input_url,
        "finalUrl": final_url,
        "firstPartyDomain": first_dom,
        "scanTimeMs": scan_time_ms,
        "totalRequests": len(reqs),
        "thirdPartyRequestCount": len(third),
        "uniqueThirdPartyDomains": len(doms),
        "categories": cats,
        "score": score,
        "domains": doms,
        "graph": {"nodes": nodes, "edges": edges},
        "warnings": warns,
    }


def add(mp: dict[str, dict], req: dict):
    cur = mp.get(req["domain"])
    if cur:
        cur["requestCount"] += 1
        if req["resourceType"] not in cur["resourceTypes"]:
            cur["resourceTypes"].append(req["resourceType"])
        if len(cur["sampleUrls"]) < SAMPLE_LIMIT and req["url"] not in cur["sampleUrls"]:
            cur["sampleUrls"].append(req["url"])
        return cur

    cat = get_cat(req["domain"])
    cur = {
        "domain": req["domain"],
        "category": cat,
        "requestCount": 1,
        "resourceTypes": [req["resourceType"]],
        "sampleUrls": [req["url"]],
        "explanation": cat_msg(cat),
    }
    mp[req["domain"]] = cur
    return cur


def group(reqs: list[dict]):
    mp = {}
    for req in reqs:
        add(mp, req)
    out = list(mp.values())
    out.sort(key=lambda x: x["requestCount"], reverse=True)
    return out


def count(doms: list[dict]):
    cnt = {"analytics": 0, "ads": 0, "cdn": 0, "social": 0, "tagManager": 0, "unknown": 0}
    for dom in doms:
        cnt[dom["category"]] += 1
    return cnt


def score_of(total_requests: int, unique_domains: int, categories: dict):
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


RS = {
    "tagManager": ["googletagmanager.com", "tagmanager"],
    "analytics": ["google-analytics.com", "plausible.io", "segment.com", "amplitude.com", "mixpanel.com", "hotjar.com"],
    "ads": ["doubleclick.net", "googlesyndication.com", "adservice.google.com", "adsystem.com", "taboola.com", "outbrain.com"],
    "cdn": ["cloudflare.com", "cloudfront.net", "akamai", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"],
    "social": ["facebook.net", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "linkedin.com"],
}


def get_cat(domain: str):
    s = domain.lower()
    for cat, rules in RS.items():
        for rule in rules:
            if rule in s:
                return cat
    return "unknown"


def cat_msg(cat: Cat):
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


def short(domain: str):
    known = {
        "www.google-analytics.com": "Google Analytics",
        "google-analytics.com": "Google Analytics",
        "www.googletagmanager.com": "Google Tag Manager",
        "googletagmanager.com": "Google Tag Manager",
        "connect.facebook.net": "Facebook",
    }
    return known.get(domain, domain.removeprefix("www."))


def norm_url(input_url: str):
    s = input_url.strip()
    if not s:
        raise AppError("Enter a URL to scan.")
    if s.startswith("file:"):
        raise AppError("file:// URLs are not allowed.")

    if "://" not in s:
        s = f"https://{s}"
    p = urlparse(s)

    if p.scheme not in ("http", "https") or not p.netloc:
        raise AppError("That does not look like a valid URL.")
    if p.username or p.password:
        raise AppError("URLs with usernames or passwords are not allowed.")
    if not p.hostname:
        raise AppError("That does not look like a valid URL.")

    chk_host(p.hostname)
    if not is_ip(p.hostname):
        chk_dns(p.hostname)

    return urlunparse((p.scheme, p.netloc, p.path or "/", p.params, p.query, ""))


def chk_dns(host: str):
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise AppError("Could not resolve that host.")

    for info in infos:
        ip = info[4][0]
        if priv_ip(ip):
            raise AppError("This host resolves to a private network address, so it was blocked.")


def chk_host(hostname: str):
    host = clean(hostname)
    if host == "localhost" or host.endswith(".localhost"):
        raise AppError("Localhost URLs are blocked for safety.")
    if is_ip(host) and priv_ip(host):
        raise AppError("Private network addresses are blocked for safety.")


def blocked_host(hostname: str):
    try:
        chk_host(hostname)
        return False
    except AppError:
        return True


def priv_ip(value: str):
    try:
        ip = ipaddress.ip_address(clean(value))
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast


def is_ip(value: str):
    try:
        ipaddress.ip_address(clean(value))
        return True
    except ValueError:
        return False


def clean(hostname: str):
    return hostname.lower().strip("[]").rstrip(".")


def base_dom(url: str):
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return ""

    host = host.lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    return ".".join(parts[-2:])


def map_res(kind: str):
    if kind in {"script", "image", "stylesheet", "document", "xhr", "fetch", "font", "media"}:
        return kind
    return "other"


def is_http_url(url: str):
    return url.startswith("http://") or url.startswith("https://")


def warn(warns: list[str], msg: str, send: Send | None):
    warns.append(msg)
    emit(send, {"type": "warning", "message": msg})


def emit(send: Send | None, event: Evt):
    if send:
        send(event)


def bad(err: Exception):
    return f"Scan failed: {err}. Some sites block automated browsers or take too long to respond."


class AppError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.status = status
        self.code = code
