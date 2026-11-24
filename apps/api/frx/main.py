"""The server: the game's API under /api/play and the new interface at /play.

Two ways to run it (frx.auth): local mode (FRX_AUTH=off, the default), where every request is
the built-in local player and the server answers only loopback names; and multi-user mode
(FRX_AUTH=on), with accounts, sessions, usage limits and row-level security in PostgreSQL.

Deployment settings, all from the environment:

- FRX_ALLOWED_HOSTS: host names the server answers besides the loopback ones. In local mode a
  name that is not this machine's own (a LAN address or .local name) also needs FRX_LAN=1, which
  `make run-lan` sets: anyone on the network can then play and use the configured model.
- FRX_TRUSTED_PROXIES: the reverse proxies (addresses or networks, comma separated) whose
  X-Forwarded-Proto and X-Forwarded-For are believed, so that the same-origin check and the
  cookie's Secure flag see the browser's HTTPS and the login throttle the browser's address.
- FRX_MIGRATION_URL: the schema owner's connection, used to upgrade the schema at start when
  FRX_DATABASE_URL is a role that may not change it (the multi-user deployment).
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth import Accounts, check_mode, public, set_cookie
from .auth_api import account_router
from .domain import ROOT
from .gateway import ModelFailure, ModelSettings
from .play_api import play_router
from .play_director_api import play_director_router
from .play_errors import (
    PlayError,
    error_body,
    from_http,
    play_error_response,
    request_problem,
)
from .play_read_api import play_read_router
from .play_save_api import play_save_router
from .storage import Store
from .turn_runtime import TurnRuntime
from .usage import default_limits, server_turns

logger = logging.getLogger(__name__)

# Names that reach only this machine; testserver is the test client's.
LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]", "testserver"}


def lan_names(hosts):
    return [host for host in hosts if host not in LOOPBACK and not host.endswith(".localhost")]


def check_hosts(mode, hosts):
    """Local mode serves other devices only when that is asked for twice: the names in
    FRX_ALLOWED_HOSTS and FRX_LAN=1. Without login, anyone who reaches an added name plays."""
    outside = lan_names(hosts)
    if mode == "on" or not outside:
        return
    if os.getenv("FRX_LAN", "").strip() != "1":
        raise RuntimeError(
            "本机模式下 FRX_ALLOWED_HOSTS 里有非本机的主机名（" + "、".join(outside) + "）。"
            "本机模式没有登录，局域网内谁都能玩、都能用配置的模型；确实要这样，请同时设置 "
            "FRX_LAN=1（make run-lan 会设置），否则请用多用户模式 FRX_AUTH=on"
        )
    logger.warning(
        "局域网模式：%s 上的任何人都能打开游戏、改动存档并使用配置的模型（没有登录）",
        "、".join(outside),
    )


def announce(accounts, store):
    """What a multi-user server says when it starts."""
    limits = default_limits()
    logger.warning(
        "多用户模式：注册方式 %s；每人最近 24 小时费用上限 %s 美元、主回合 %s 个；"
        "同时进行的主回合每人 %s 个、全站 %s 个",
        accounts.registration, limits.cost, limits.turns, limits.concurrent, server_turns(),
    )
    logger.warning(
        "费用上限依赖模型服务在用量里报的 cost 字段；不报费用时只有回合数上限有效"
    )
    if not os.getenv("FRX_TRUSTED_PROXIES"):
        logger.warning(
            "没有设置 FRX_TRUSTED_PROXIES：在反向代理后面时，服务端看不到浏览器用的是 HTTPS，"
            "Cookie 不带 Secure，登录限速只看到代理的地址"
        )
    problem = store.guard_problem()
    if problem:
        logger.warning(
            "%s；玩家的数据只靠应用代码隔离。部署时请用低权限角色连接（compose.multiuser.yaml）",
            problem,
        )


def under_play(request):
    path = request.url.path
    return path == "/api/play" or path.startswith("/api/play/")


def add_play_error_handlers(app):
    """Whatever else goes wrong under /api/play answers in the contracts' shape too
    (play_errors): a body or query the contract does not allow, an HTTPException of the modules
    beneath the routes or Starlette's for a route that is not there, a model call that failed,
    and anything unexpected. Elsewhere FastAPI's and Starlette's own answers stay."""

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        if not under_play(request):
            return await request_validation_exception_handler(request, exc)
        return await play_error_response(request, request_problem(exc.errors()))

    @app.exception_handler(StarletteHTTPException)
    async def http_problem(request: Request, exc: StarletteHTTPException):
        if not under_play(request):
            return await http_exception_handler(request, exc)
        return await play_error_response(request, from_http(exc))

    @app.exception_handler(ModelFailure)
    async def model_failure_response(request: Request, exc: ModelFailure):
        # ModelFailure contains only the gateway's controlled, redacted message.
        # Auxiliary model calls need the same useful feedback as the main turn.
        message = str(exc) or "模型服务出了错，请稍后重试"
        return JSONResponse(error_body("model_failed", message), status_code=502)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        # Starlette's outermost handler: it answers, then raises again for the server's log.
        if not under_play(request):
            return PlainTextResponse("Internal Server Error", status_code=500)
        return JSONResponse(error_body("engine_failed", "服务端出了错，请稍后重试"),
                            status_code=500)


class PlayGzip:
    """gzip for the paths under /play only; everything else passes through untouched."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=1024, compresslevel=6)

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if path == "/play" or path.startswith("/play/"):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


def create_app(
    store: Store | None = None,
    settings: ModelSettings | None = None,
    play_dir: Path | None = None,
):
    store = store or Store(
        os.getenv("FRX_DATABASE_URL", "postgresql+psycopg://frx:frx-local@127.0.0.1:55432/frx")
    )
    settings = settings or ModelSettings()
    accounts = Accounts(store.sessions)
    configured = os.getenv("FRX_ALLOWED_HOSTS", "").split(",")
    extra_hosts = [host.strip().lower() for host in configured if host.strip()]

    @asynccontextmanager
    async def lifespan(app):
        check_mode()
        check_hosts(accounts.mode, extra_hosts)
        # The schema is brought to the latest version on start; the old tables stay in place.
        store.initialize(os.getenv("FRX_MIGRATION_URL") or None)
        if accounts.on:
            announce(accounts, store)
        yield
        store.engine.dispose()

    # The API's description is the local tool's: a multi-user server does not publish it.
    hidden = {"docs_url": None, "redoc_url": None, "openapi_url": None} if accounts.on else {}
    app = FastAPI(title="FRX 本地行纪", lifespan=lifespan, **hidden)
    # Every turn runs through one runtime: the turns in flight, one director, one usage meter.
    runtime = TurnRuntime.create(store.sessions, settings, mode=accounts.mode)
    app.state.accounts = accounts
    app.state.meter = runtime.meter
    app.include_router(account_router(accounts, runtime.meter))
    app.include_router(play_read_router(store))
    turns = play_router(store, runtime)
    app.include_router(turns)
    # The new interface's turns in flight and the work after them (tests and tools wait on it).
    app.state.desk = turns.desk
    app.include_router(play_save_router(store, settings, runtime, jobs=turns.desk.jobs))
    app.include_router(play_director_router(store, runtime, jobs=turns.desk.jobs))
    app.add_exception_handler(PlayError, play_error_response)
    add_play_error_handlers(app)

    # Loopback names only, unless FRX_ALLOWED_HOSTS adds the names other devices use to reach
    # this server (check_hosts decides whether that may be done without login).
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "testserver", *extra_hosts],
    )

    def refused(request, message):
        if request.url.path.startswith("/api/play/"):
            return JSONResponse(error_body("forbidden", message), status_code=403)
        return JSONResponse({"detail": message}, status_code=403)

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD"}:
            # Cross-site forms cannot set this header; no CORS permission is granted. Signing
            # in and registering are held to the same rule.
            if request.headers.get("x-frx-client") != "local":
                return refused(request, "请从游戏界面发起操作")
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
                return refused(request, "仅允许同源操作")
        response = await call_next(request)
        # What the request decided about its session cookie (frx.auth, frx.auth_api).
        cookie = getattr(request.state, "frx_cookie", None)
        if cookie:
            set_cookie(response, cookie, secure=request.url.scheme == "https",
                       lifetime=accounts.lifetime)
        path = request.url.path
        # Built scripts and styles carry a content hash in their names, and so do the font slices
        # (tools/fonts/subset.py): a page shows a hundred of those, so a visit after the first
        # asks for none of them again. fonts.css, which names them, is checked every time. A
        # composed scene asks for its kit's pictures with their digest (?v=, kit.json), so a
        # phone keeps those too.
        hashed_font = path.startswith("/play/assets/fonts/") and path.endswith(".woff2")
        kit_picture = path.startswith("/play/assets/") and "v" in request.query_params
        if path.startswith("/play/static/") or (
            (hashed_font or kit_picture) and response.status_code == 200
        ):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.startswith("/play"):
            response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        # The new interface composes portraits on canvases and hands them on as blobs.
        images = "'self' data: blob:" if path.startswith("/play") else "'self' data:"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            f"img-src {images}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # The new interface's files go out gzipped (its fonts.css alone is 135 KB and holds back
    # the first paint): text, scripts, styles and JSON. Pictures, fonts and audio are compressed
    # already, and an event stream is never compressed (GZipMiddleware leaves
    # text/event-stream alone; the turn streams are under /api besides).
    app.add_middleware(PlayGzip)

    # Outermost: the forwarded protocol and address of a trusted reverse proxy.
    proxies = [item.strip() for item in os.getenv("FRX_TRUSTED_PROXIES", "").split(",")]
    if any(proxies):
        from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

        app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=[p for p in proxies if p])

    @app.get("/api/health", dependencies=[Depends(public)])
    def health():
        store.ping()
        return {"ok": True, "schema_version": 1}

    @app.get("/", include_in_schema=False, dependencies=[Depends(public)])
    def home():
        return RedirectResponse("/play/")

    # The new interface: the build at /play/ (scripts and styles under /play/static/) and the
    # runtime art, which is not bundled, at /play/assets/. Project sources are never served.
    # Both are public: the login page is part of the build, and neither holds player data.
    play_dir = play_dir or ROOT / "apps/play-web"

    @app.get("/play", include_in_schema=False, dependencies=[Depends(public)])
    def play_redirect():
        return RedirectResponse("/play/")

    # Browsers, bookmarks and readers ask for /favicon.ico on their own: the game's tab icon, the
    # same one the new interface's page names (assets/app/, with the manifest and the home-screen
    # icons).
    favicon = play_dir / "assets/app/favicon.ico"

    @app.get("/favicon.ico", include_in_schema=False, dependencies=[Depends(public)])
    def favicon_ico():
        if not favicon.is_file():
            return JSONResponse({"detail": "没有图标"}, status_code=404)
        return FileResponse(favicon, media_type="image/x-icon")

    if (play_dir / "assets").is_dir():
        app.mount("/play/assets", StaticFiles(directory=play_dir / "assets"), name="play-assets")
    if (play_dir / "dist").is_dir():
        app.mount("/play", StaticFiles(directory=play_dir / "dist", html=True), name="play")
    else:

        @app.get("/play/", include_in_schema=False, dependencies=[Depends(public)])
        def play_not_built():
            return JSONResponse({"detail": "新界面尚未构建，请先运行 make build"}, status_code=503)

    return app


app = create_app()
