"""The account routes of the new interface, under /api/play/account (docs/play-contracts.md).

    GET  /api/play/account/options   public   AccountOptions: the mode and how to register
    POST /api/play/account/login     public   LoginRequest -> Account, sets the session cookie
    POST /api/play/account/register  public   RegisterRequest -> Account (201), signed in
    GET  /api/play/account           login    Account: the user, 24-hour usage and limits
    GET  /api/play/account/usage     login    UsageReport: usage by purpose, what is stored
    POST /api/play/account/password  login    PasswordChange -> 204; other sessions end
    POST /api/play/account/logout    login    204; the session ends, the cookie is cleared

The session cookie is written by main.py from request.state.frx_cookie. In local mode there is
nobody to sign in: options says "local", the account is the local player's, and login,
register, password and logout answer 403 forbidden.
"""

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response

from . import play_models as M
from .auth import User, current_user, login, public
from .play_errors import PlayError
from .usage import NO_LIMITS, WINDOW, limits_view


def iso(seconds):
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def account_router(accounts, meter):
    router = APIRouter(prefix="/api/play/account")

    def mode():
        return "accounts" if accounts.on else "local"

    def address(request):
        return request.client.host if request.client else None

    def account_of(user):
        """The Account view of a user: name and role as stored, the last 24 hours, limits."""
        row = accounts.user_row(user.id)
        email = accounts.email.email_of(user.id)
        limits = user.limits or NO_LIMITS
        total, _ = meter.totals(user.id)
        problem = meter.quota_problem(user.id, limits) if accounts.on else None
        return M.Account(
            mode=mode(),
            user=M.AccountUser(
                id=user.id,
                username=row.username if row else user.username,
                role=row.role if row else user.role,
                email=email,
                has_password=bool(row.password_hash) if email and row else None,
            ),
            usage=M.UsageTotals(**total),
            limits=M.AccountLimits(**limits_view(limits)),
            retry_at=iso(meter.clock() + problem[1]) if problem else None,
        ).wire()

    @router.get("/options", dependencies=[Depends(public)])
    def options():
        registration = accounts.registration if accounts.on else "closed"
        return M.AccountOptions(
            mode=mode(), registration=registration,
            email_login=True if accounts.email.available else None,
            email_registration=registration != "closed" if accounts.email.available else None,
        ).wire()

    @router.post("/email/code", dependencies=[Depends(public)])
    async def email_code(body: M.EmailCodeRequest, request: Request):
        sent = await asyncio.to_thread(accounts.email.send, body.email, address(request))
        return M.EmailCodeSent.model_validate(sent).wire()

    @router.post("/email/login", dependencies=[Depends(public)])
    async def email_login(body: M.EmailLoginRequest, request: Request):
        user, token = await asyncio.to_thread(
            accounts.email.login, body.email, body.code, address(request)
        )
        request.state.frx_cookie = ("set", token)
        return await asyncio.to_thread(account_of, user)

    @router.post("/login", dependencies=[Depends(public)])
    async def sign_in(body: M.LoginRequest, request: Request):
        user, token = await asyncio.to_thread(
            accounts.login, body.username, body.password, address(request)
        )
        request.state.frx_cookie = ("set", token)
        return await asyncio.to_thread(account_of, user)

    @router.post("/register", status_code=201, dependencies=[Depends(public)])
    async def register(body: M.RegisterRequest, request: Request):
        user, token = await asyncio.to_thread(
            accounts.register, body.username, body.password, body.invite, address(request)
        )
        request.state.frx_cookie = ("set", token)
        return await asyncio.to_thread(account_of, user)

    @router.get("", dependencies=[Depends(login)])
    def me(user: User = Depends(current_user)):
        return account_of(user)

    @router.get("/usage", dependencies=[Depends(login)])
    def usage(user: User = Depends(current_user)):
        until = meter.clock()
        total, by_purpose = meter.totals(user.id, until - WINDOW)
        return M.UsageReport(
            since=iso(until - WINDOW),
            until=iso(until),
            total=M.UsageTotals(**total),
            by_purpose=[M.PurposeUsage(**line) for line in by_purpose],
            stored=M.StoredView(**meter.stored(user.id)),
            limits=M.AccountLimits(**limits_view(user.limits or NO_LIMITS)),
        ).wire()

    @router.post("/password", status_code=204, dependencies=[Depends(login)])
    async def change_password(body: M.PasswordChange, user: User = Depends(current_user)):
        await asyncio.to_thread(
            accounts.change_password, user, body.old_password, body.new_password
        )
        return Response(status_code=204)

    @router.post("/logout", status_code=204, dependencies=[Depends(login)])
    def sign_out(request: Request, user: User = Depends(current_user)):
        if not accounts.on or not user.session:
            raise PlayError(403, "forbidden", "本机模式没有账号，不需要退出")
        accounts.close_session(user.session)
        request.state.frx_cookie = ("clear",)
        return Response(status_code=204)

    return router
