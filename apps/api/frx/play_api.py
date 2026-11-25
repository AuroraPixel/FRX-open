"""The turn routes of the new interface's API, under /api/play (docs/play-contracts.md, 接口).

Thin by design: each route takes the user from frx.auth.current_user, finds the save by its
archiveId in that user's own store and hands the work to play_turns' desk. A turn answers with
its event stream; a client that lost it asks for the turn in progress and reads the events
again from the last one it had. Errors are play_errors' bodies; once a stream has begun they
come as its last event instead. The read routes live in play_read_api.py.
"""

import asyncio
import json

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from . import play_models as M
from .auth import User, current_user, login, model_quota
from .life import life_of
from .life_turns import calls_model
from .play_errors import PlayError, invalid_input, not_found
from .play_saves import find_save
from .play_turns import TurnDesk
from .workspace import Workspace, open_workspace


def event_stream(run, after=0):
    async def frames():
        async for event in run.follow(after):
            yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"

    return StreamingResponse(
        frames(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


def play_router(store, runtime):
    router = APIRouter(prefix="/api/play", dependencies=[Depends(login)])
    desk = TurnDesk(runtime)
    router.desk = desk

    def workspace(user: User = Depends(current_user)) -> Workspace:
        return open_workspace(user, store.sessions)

    async def save_of(ws, archive_id, lean=False):
        return await asyncio.to_thread(find_save, ws.records, archive_id, lean)

    def asks_model(body):
        """Whether the turn calls the model: every turn but a verb, a move or a realm step of the
        cultivation life, which the engine settles alone (life_turns.calls_model says which verbs
        do; a step whose 秘 opens a scene asks it within the turn, as a verb broken off does)."""
        if body.move is not None or body.step is not None:
            return False
        return body.verb is None or calls_model(body.verb.wire())

    def over(limit):
        """The model quota's answer for words that turn out not to be a standing verb."""

        async def check():
            raise limit

        return check

    def free_words(body):
        """Words alone: in a save of the cultivation life they may mean a standing verb
        (修炼, 调息: the desk decides), which needs no model and so no model quota."""
        return bool(body.input.strip()) and not (body.option or body.queue) and (
            body.verb is None and body.act is None and body.move is None and body.step is None)

    @router.post("/saves/{archive_id}/turns")
    async def play(
        archive_id: str, body: M.TurnRequest, request: Request,
        ws: Workspace = Depends(workspace),
    ):
        if not (body.input.strip() or body.option or body.queue or body.verb or body.act
                or body.move or body.step):
            raise invalid_input("请写下行动、选一个选项、排好行动签，或者发一个指令")
        # The model quota, before anything else: a turn the engine settles alone does not use it.
        # Words alone over it may still be a life save's 修炼 or 调息 (no model): the desk says.
        limit = None
        if asks_model(body):
            try:
                await model_quota(request, ws.user)
            except PlayError as error:
                if not free_words(body):
                    raise
                limit = error
        try:
            # a turn never reads the round snapshots a life save keeps beside it (the desk reads
            # the save whole where a turn's history is told again)
            save = await save_of(ws, archive_id, lean=True)
        except PlayError:
            if limit is not None:
                raise limit from None
            raise
        if limit is not None and life_of(save.value) is None:
            raise limit
        request_id = str(body.request_id)
        # The same request sent again is the same turn, never a second one.
        run = desk.run(ws.user.id, request_id)
        if run is None or run.archive_id != save.archive_id:
            run = await asyncio.to_thread(desk.known, ws, save, request_id)
        if run is None:
            # As sent: the queue's items keep the contract's names (itemId, charId, placeId).
            run = await desk.start(ws, save, request_id, body.wire(),
                                   quota=over(limit) if limit is not None else None)
        return event_stream(run)

    @router.get("/saves/{archive_id}/turns")
    async def turns(
        archive_id: str, before: int | None = None, limit: int = 10,
        ws: Workspace = Depends(workspace),
    ):
        save = await save_of(ws, archive_id)
        page = await asyncio.to_thread(desk.page, ws, save, before, max(0, min(limit, 50)))
        return M.TurnPage.model_validate(page).wire()

    @router.get("/saves/{archive_id}/turns/pending")
    async def pending(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await save_of(ws, archive_id, lean=True)
        turn = await asyncio.to_thread(desk.pending, ws, save)
        if turn is None:
            # Nothing under way is the usual answer, not an error (a 404 is logged as one by
            # browsers on every opening of a save).
            return Response(status_code=204)
        return M.Turn.model_validate(turn).wire()

    @router.get("/saves/{archive_id}/turns/{turn_id}/events")
    async def events(
        archive_id: str, turn_id: str, after: int = 0, ws: Workspace = Depends(workspace)
    ):
        save = await save_of(ws, archive_id)
        run = desk.run(ws.user.id, turn_id)
        if run is None or run.archive_id != save.archive_id:
            raise not_found("这一回合的事件已经不在了，请重新读取")
        return event_stream(run, after)

    @router.post("/saves/{archive_id}/turns/{turn_id}/retry")
    async def retry(
        archive_id: str, turn_id: str, body: M.VersionRequest, request: Request,
        ws: Workspace = Depends(workspace),
    ):
        save = await save_of(ws, archive_id)
        attempt = await asyncio.to_thread(ws.records.request, turn_id)
        if attempt["archive"] != save.name:
            raise not_found("没有这一回合")
        # Recovering an already settled result does not call the model or spend its quota.
        if attempt["status"] != "ready":
            await model_quota(request, ws.user)
        return event_stream(await desk.retry(ws, save, turn_id, body.version))

    @router.post("/saves/{archive_id}/turns/{turn_id}/cancel")
    async def cancel(archive_id: str, turn_id: str, ws: Workspace = Depends(workspace)):
        save = await save_of(ws, archive_id)
        return await desk.cancel(ws, save, turn_id)

    @router.post("/saves/{archive_id}/undo")
    async def undo(archive_id: str, body: M.UndoRequest, ws: Workspace = Depends(workspace)):
        save = await save_of(ws, archive_id)
        result = await desk.undo(ws, save, body.version, body.to_turn, body.pending_turn_id)
        return M.UndoResult.model_validate(result).wire()

    return router
