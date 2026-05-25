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
from playwright.async_api import Request as PlayReq
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

Evt = dict
Send = Callable[[Evt], None]

SCAN_TIMEOUT_MS = int(os.getenv("SCAN_TIMEOUT_MS", "15000"))
SAMPLE_LIMIT = 5
WAIT_IDLE_MS = 3500
WAIT_IDLE_TIMEOUT_MS = 1000
USER_AGENT = "TraceShadow/0.1 educational scanner"
GOOD_RES = {"script", "image", "stylesheet", "document", "xhr", "fetch", "font", "media"}
KNOWN = {
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
    url = read_url(await request.json())

    try:
        return await scan(url)
    except AppError as e:
        return err_json(str(e), e.code, e.status)
    except Exception as e:
        return err_json(bad(e), "scan_failed", 500)


@app.post("/api/analyze-stream")
async def analyze_stream(request: Request):
    url = read_url(await request.json())
    q: asyncio.Queue[Evt | None] = asyncio.Queue()

    def send(evt: Evt):
        q.put_nowait(evt)

    async def work():
        try:
            await scan(url, send)
        except AppError as e:
            send({"type": "error", "error": str(e), "code": e.code})
        except Exception as e:
            send({"type": "error", "error": bad(e), "code": "scan_failed"})
        finally:
            await q.put(None)

    async def stream():
        task = asyncio.create_task(work())
        try:
            while True:
                evt = await q.get()
                if evt is None:
                    break
                yield json.dumps(evt) + "\n"
        finally:
            await task

    return StreamingResponse(stream(), media_type="application/x-ndjson")


def read_url(body):
    if isinstance(body, dict):
        return body.get("url") or ""
    return ""


def err_json(msg: str, code: str, status: int):
    return JSONResponse(status_code=status, content={"error": msg, "code": code})


async def scan(in_url: str, send: Send | None = None):
    st = time.time()
    emit(send, {"type": "status", "message": "Validating URL..."})
    url = norm_url(in_url)
    root_dom = base_dom(url)
    reqs = []
    warns = []
    doms = {}
    tp_cnt = 0

    emit(send, {"type": "status", "message": "Opening page..."})

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )

        try:
            ctx = await browser.new_context(
                ignore_https_errors=True,
                user_agent=USER_AGENT,
            )
            await ctx.route("**/*", route_req)

            page = await ctx.new_page()
            page.set_default_timeout(SCAN_TIMEOUT_MS)

            cdp = await ctx.new_cdp_session(page)
            await cdp.send("Network.enable")

            init_q: dict[str, deque] = defaultdict(deque)

            def on_will_send(evt: dict):
                req = evt.get("request") or {}
                url = req.get("url") or ""
                if not url:
                    return
                init_q[url].append(evt.get("initiator") or {})

            cdp.on("Network.requestWillBeSent", on_will_send)

            emit(send, {"type": "status", "message": "Collecting network requests..."})

            def on_req(req: PlayReq):
                nonlocal tp_cnt
                item = get_req(req, init_q, root_dom)
                if not item:
                    return

                reqs.append(item)
                if base_dom(item["url"]) == root_dom:
                    return

                tp_cnt += 1
                dom = add_dom(doms, item)
                emit(send, {
                    "type": "domain",
                    "domain": dom,
                    "totalRequests": len(reqs),
                    "thirdPartyRequestCount": tp_cnt,
                    "uniqueThirdPartyDomains": len(doms),
                })

            page.on("request", on_req)

            timed_out, res = await open_page(page, url, reqs)
            if res is None and not timed_out:
                add_warn(
                    warns,
                    "The page opened, but Playwright did not receive a normal document response.",
                    send,
                )

            await wait_idle(page, timed_out, warns, send)

            emit(send, {"type": "status", "message": "Summarizing hidden domains..."})
            out = make_result(in_url, page.url, reqs, warns, int((time.time() - st) * 1000))
            emit(send, {"type": "status", "message": "Building graph..."})
            emit(send, {"type": "result", "result": out})
            return out
        finally:
            await browser.close()


async def route_req(route):
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


async def open_page(page, url: str, reqs: list[dict]):
    timed_out = False
    res = None
    try:
        res = await page.goto(url, wait_until="domcontentloaded", timeout=SCAN_TIMEOUT_MS)
    except PlaywrightTimeoutError:
        if not reqs:
            raise
        timed_out = True
    return timed_out, res


async def wait_idle(page, timed_out: bool, warns: list[str], send: Send | None):
    ms = WAIT_IDLE_TIMEOUT_MS if timed_out else WAIT_IDLE_MS
    try:
        await page.wait_for_load_state("networkidle", timeout=ms)
    except Exception:
        add_warn(warns, "Some requests were still loading after the scan window closed.", send)


def get_req(req: PlayReq, init_q: dict[str, deque], root_dom: str):
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
    chain = redirect_chain(req)
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


def redirect_chain(req: PlayReq):
    out = []
    cur = None
    try:
        cur = req.redirected_from
    except Exception:
        cur = None

    while cur is not None:
        out.append(cur.url)
        try:
            cur = cur.redirected_from
        except Exception:
            cur = None

    out.reverse()
    return out


def init_url_of(init: dict):
    if not init:
        return ""

    kind = init.get("type", "")
    if kind == "script":
        url = stack_url(init.get("stack"))
        if url:
            return url

    return init.get("url") or ""


def stack_url(stack):
    if not stack:
        return ""
    for fr in stack.get("callFrames") or []:
        url = fr.get("url")
        if url:
            return url
    return stack_url(stack.get("parent"))


def src_of(init_url: str, init_type: str, frame_url: str, root_dom: str, chain: list[str]):
    if chain:
        prev = chain[-1]
        dom = base_dom(prev)
        if dom:
            return prev, dom

    if init_type in {"script", "parser"} and init_url:
        dom = base_dom(init_url)
        if dom:
            return init_url, dom

    if init_url:
        dom = base_dom(init_url)
        if dom:
            return init_url, dom

    if frame_url and frame_url != "about:blank":
        dom = base_dom(frame_url)
        if dom:
            return frame_url, dom

    return "", root_dom


def make_result(in_url: str, final_url: str, raw: list[dict], warns: list[str], scan_time_ms: int):
    first_dom = base_dom(final_url)
    reqs = []
    third = []

    for req in raw:
        cur = dict(req)
        cur["thirdParty"] = base_dom(req["url"]) != first_dom
        reqs.append(cur)
        if cur["thirdParty"]:
            third.append(cur)

    doms = group_doms(third)
    score = score_of(len(reqs), len(doms))

    if not doms:
        warns.append("No third-party domains were detected during this scan window.")

    nodes, edges = build_graph(reqs, doms, first_dom)

    return {
        "inputUrl": in_url,
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


def build_graph(reqs: list[dict], doms: list[dict], first_dom: str):
    edge_map: dict[tuple[str, str, str], dict] = {}
    extra = set()

    for req in reqs:
        tgt = req.get("domain") or base_dom(req["url"])
        src = req.get("sourceDomain") or first_dom
        if not src or not tgt or src == tgt:
            continue

        kind = "direct"
        if src != first_dom or req.get("viaRedirect"):
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
            extra.add(src)
        if tgt != first_dom:
            extra.add(tgt)

    known = {dom["domain"] for dom in doms}
    nodes = [{"id": first_dom, "label": first_dom, "type": "firstParty"}]

    for dom in doms:
        nodes.append({
            "id": dom["domain"],
            "label": short(dom["domain"]),
            "type": "thirdParty",
        })

    for dom in sorted(extra):
        if dom == first_dom or dom in known:
            continue
        nodes.append({
            "id": dom,
            "label": short(dom),
            "type": "thirdParty",
        })

    ids = {node["id"] for node in nodes}
    edges = []
    for edge in sorted(edge_map.values(), key=lambda x: x["requestCount"], reverse=True):
        if edge["source"] in ids and edge["target"] in ids:
            edges.append(edge)

    return nodes, edges


def add_dom(mp: dict[str, dict], req: dict):
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


def group_doms(reqs: list[dict]):
    mp = {}
    for req in reqs:
        add_dom(mp, req)
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

    msg = "This page has limited third-party activity in this scan."
    if unique_domains > 0:
        msg = f"This page loads {unique_domains} third-party domains across {total_requests} requests."

    return {"value": value, "label": label, "explanation": msg}


def dom_msg(domain: str):
    return f"{short(domain)} is a third-party domain that loaded resources while the page was opening."


def short(domain: str):
    return KNOWN.get(domain, domain.removeprefix("www."))


def norm_url(in_url: str):
    s = in_url.strip()
    if not s:
        raise AppError("Enter a URL to scan.")
    if s.startswith("file:"):
        raise AppError("file:// URLs are not allowed.")

    if "://" not in s:
        s = f"https://{s}"

    p = urlparse(s)
    if p.scheme not in {"http", "https"} or not p.netloc:
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
    if kind in GOOD_RES:
        return kind
    return "other"


def is_http_url(url: str):
    return url.startswith("http://") or url.startswith("https://")


def add_warn(warns: list[str], msg: str, send: Send | None):
    warns.append(msg)
    emit(send, {"type": "warning", "message": msg})


def emit(send: Send | None, evt: Evt):
    if send:
        send(evt)


def bad(err: Exception):
    return f"Scan failed: {err}. Some sites block automated browsers or take too long to respond."


class AppError(Exception):
    def __init__(self, msg: str, status: int = 400, code: str = "bad_request"):
        super().__init__(msg)
        self.status = status
        self.code = code
