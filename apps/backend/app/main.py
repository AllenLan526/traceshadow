import asyncio
import ipaddress
import json
import os
import socket
import time
from collections import defaultdict, deque
from typing import Callable
from urllib.parse import urlparse, urlunparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from playwright.async_api import Request as PlaywrightRequest
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

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

            cdp = await context.new_cdp_session(page)
            await cdp.send("Network.enable")

            init_q: dict[str, deque] = defaultdict(deque)

            def on_cdp_will_send(evt: dict):
                rd = evt.get("request") or {}
                u = rd.get("url") or ""
                if not u:
                    return
                init_q[u].append(evt.get("initiator") or {})

            cdp.on("Network.requestWillBeSent", on_cdp_will_send)

            emit(send, {"type": "status", "message": "Collecting network requests..."})

            def on_request(req: PlaywrightRequest):
                nonlocal tp_cnt
                x = get_req(req, init_q, root_dom)
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

            if res is None and not timed_out:
                warn(warns, "The page opened, but Playwright did not receive a normal document response.", send)

            try:
                await page.wait_for_load_state("networkidle", timeout=1000 if timed_out else 3500)
            except Exception:
                warn(warns, "Some requests were still loading after the scan window closed.", send)

            emit(send, {"type": "status", "message": "Summarizing hidden domains..."})
            out = make(input_url, page.url, reqs, warns, int((time.time() - st) * 1000))
            emit(send, {"type": "status", "message": "Building graph..."})
            emit(send, {"type": "result", "result": out})
            return out
        finally:
            await browser.close()


def get_req(req: PlaywrightRequest, init_q: dict[str, deque], root_dom: str):
    url = req.url
    if not is_http_url(url):
        return None

    host = urlparse(url).hostname
    if not host:
        return None

    domain = base_dom(url) or host.lower()

    frame_url = ""
    try:
        if req.frame:
            frame_url = req.frame.url or ""
    except Exception:
        frame_url = ""

    init = {}
    q = init_q.get(url)
    if q:
        init = q.popleft()
    init_type = init.get("type", "") if init else ""
    init_url = init_url_of(init)

    chain = []
    cur = None
    try:
        cur = req.redirected_from
    except Exception:
        cur = None
    while cur is not None:
        chain.append(cur.url)
        try:
            cur = cur.redirected_from
        except Exception:
            cur = None
    chain.reverse()

    src_url, src_dom = src_of(init_url, init_type, frame_url, root_dom, chain)

    return {
        "url": url,
        "domain": domain,
        "hostname": host.lower(),
        "resourceType": map_res(req.resource_type),
        "thirdParty": False,
        "frameUrl": frame_url,
        "frameDomain": base_dom(frame_url),
        "initiatorType": init_type,
        "initiatorUrl": init_url,
        "initiatorDomain": base_dom(init_url),
        "sourceUrl": src_url,
        "sourceDomain": src_dom,
        "redirectChain": chain,
        "viaRedirect": bool(chain),
    }


def init_url_of(init: dict) -> str:
    if not init:
        return ""
    t = init.get("type", "")
    if t == "script":
        u = stack_url(init.get("stack"))
        if u:
            return u
        return init.get("url") or ""
    if t == "parser":
        return init.get("url") or ""
    return init.get("url") or ""


def stack_url(stack) -> str:
    if not stack:
        return ""
    for fr in stack.get("callFrames") or []:
        u = fr.get("url")
        if u:
            return u
    return stack_url(stack.get("parent"))


def src_of(init_url: str, init_type: str, frame_url: str, root_dom: str, chain: list[str]):
    if chain:
        prev = chain[-1]
        d = base_dom(prev)
        if d:
            return prev, d
    if init_type == "script" and init_url:
        d = base_dom(init_url)
        if d:
            return init_url, d
    if init_type == "parser" and init_url:
        d = base_dom(init_url)
        if d:
            return init_url, d
    if init_url:
        d = base_dom(init_url)
        if d:
            return init_url, d
    if frame_url and frame_url != "about:blank":
        d = base_dom(frame_url)
        if d:
            return frame_url, d
    return "", root_dom


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
    score = score_of(len(reqs), len(doms))

    if not doms:
        warns.append("No third-party domains were detected during this scan window.")

    edge_map: dict[tuple[str, str, str], dict] = {}
    extra_doms: set[str] = set()

    for req in reqs:
        tgt = req.get("domain") or base_dom(req["url"])
        src = req.get("sourceDomain") or first_dom
        if not src or not tgt or src == tgt:
            continue
        kind = "direct" if src == first_dom else "indirect"
        if req.get("viaRedirect"):
            kind = "indirect"
        key = (src, tgt, kind)
        cur = edge_map.get(key)
        if cur:
            cur["requestCount"] += 1
        else:
            edge_map[key] = {
                "id": f"{src}->{tgt}:{kind}",
                "source": src,
                "target": tgt,
                "kind": kind,
                "requestCount": 1,
            }
        if src != first_dom:
            extra_doms.add(src)
        if tgt != first_dom:
            extra_doms.add(tgt)

    known = {d["domain"] for d in doms}
    nodes = [{"id": first_dom, "label": first_dom, "type": "firstParty"}]
    for dom in doms:
        nodes.append({
            "id": dom["domain"],
            "label": short(dom["domain"]),
            "type": "thirdParty",
        })
    for extra in sorted(extra_doms):
        if extra in known or extra == first_dom:
            continue
        nodes.append({
            "id": extra,
            "label": short(extra),
            "type": "thirdParty",
        })

    node_ids = {n["id"] for n in nodes}
    edges = []
    for e in sorted(edge_map.values(), key=lambda e: e["requestCount"], reverse=True):
        if e["source"] in node_ids and e["target"] in node_ids:
            edges.append(e)

    return {
        "inputUrl": input_url,
        "finalUrl": final_url,
        "firstPartyDomain": first_dom,
        "scanTimeMs": scan_time_ms,
        "totalRequests": len(reqs),
        "thirdPartyRequestCount": len(third),
        "uniqueThirdPartyDomains": len(doms),
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

    cur = {
        "domain": req["domain"],
        "requestCount": 1,
        "resourceTypes": [req["resourceType"]],
        "sampleUrls": [req["url"]],
        "explanation": dom_msg(req["domain"]),
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


def score_of(total_requests: int, unique_domains: int):
    value = 0
    value += min(unique_domains * 5, 40)
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

    explanation = "This page has limited third-party activity in this scan."
    if unique_domains > 0:
        explanation = f"This page loads {unique_domains} third-party domains across {total_requests} requests."

    return {"value": value, "label": label, "explanation": explanation}

def dom_msg(domain: str):
    return f"{short(domain)} is a third-party domain that loaded resources while the page was opening."


def short(domain: str):
    known = {
        "google-analytics.com": "Google Analytics",
        "googletagmanager.com": "Google Tag Manager",
        "doubleclick.net": "DoubleClick",
        "googlesyndication.com": "Google Ads",
        "facebook.net": "Facebook",
        "facebook.com": "Facebook",
        "youtube.com": "YouTube",
        "twitter.com": "Twitter / X",
        "x.com": "Twitter / X",
        "tiktok.com": "TikTok",
        "linkedin.com": "LinkedIn",
        "cloudflare.com": "Cloudflare",
        "cloudfront.net": "CloudFront",
        "jsdelivr.net": "jsDelivr",
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
