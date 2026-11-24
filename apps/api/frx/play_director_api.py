"""Plot evolution for one save, under /api/play/saves/{id}/director (plan item 43; the old page's
剧情演化 panel, host.js renderDirectorPanel, and its 我的指示).

- GET  …/director           the status: whether the server runs plot evolution, the settings it
                            follows, whether a run is going, the last run, this save's main plot
                            switch and the player's own guidance (我的指示).
- POST …/director/run       立即推演: a run now (the old page's 立即推演).
- POST …/director/plot      {enabled}: this save's main plot on or off (关闭、开启本存档主线).
- PUT  …/director/guidance  {version, text}: 我的指示, written where the old page's 保存我的指示
                            keeps it (currentState.state.latestPlotGuidance). The next turn's
                            prompt carries it (「## 玩家的指示」), and so does every plot
                            evolution run.

Thin by design: the save is the user's own (find_save: another user's id answers 404), and the
work is card_director's Director, the one that runs after every turn. Writing the guidance
changes the save, so it takes the version the player saw and waits for no turn, like a panel
action: a version only the work after a turn moved on from (`jobs`, play_jobs.AfterTurn) is
still current. The plot switch and the runs keep to the save's frxDirector, which the server
owns and writes without a new version.
"""

import asyncio
import copy

from fastapi import APIRouter, Depends, HTTPException

from . import play_models as M
from .auth import User, current_user, login
from .card_director import _current
from .play_actions import check_no_turn, full_state, page_scope, version_conflict
from .play_errors import PlayError, from_http, not_found
from .play_saves import find_save
from .play_state import Save
from .workspace import Workspace, open_workspace

GUIDANCE_CHANGED = "这个存档在别处被改过，重新载入后再写"
NOT_OWNED = "剧情演化的模型还没有通过工具准入，推演不了"


def guidance_of(value):
    state = _current((value or {}).get("data") or {}).get("state")
    guidance = state.get("latestPlotGuidance") if isinstance(state, dict) else None
    return guidance if isinstance(guidance, str) else ""


def director_view(status, value):
    """Director.status as the contract's view."""
    last = status.get("lastAttempt") or None
    return M.DirectorView(
        server_owned=bool(status["serverOwned"]),
        enabled=bool(status["enabled"]),
        frequency=int(status["frequency"]),
        running=bool(status["running"]),
        turns_since=int(status.get("turnsSince") or 0),
        plot_disabled=bool(status["plotDisabled"]),
        guidance=guidance_of(value),
        last=M.DirectorAttempt(
            status=last["status"], at=last.get("at") or None, error=last.get("error") or None
        ) if last and last.get("status") in {"ok", "failed", "skipped"} else None,
    )


def with_guidance(value, text):
    """The save with 我的指示 set as the old page's button sets it."""
    value = copy.deepcopy(value)
    tables = value["data"]["state"]["currentState"]
    if not isinstance(tables.get("state"), dict):
        tables["state"] = {}
    tables["state"]["latestPlotGuidance"] = text
    return value


def play_director_router(store, runtime, jobs=None):
    router = APIRouter(prefix="/api/play", dependencies=[Depends(login)])
    director = runtime.director

    def workspace(user: User = Depends(current_user)) -> Workspace:
        return open_workspace(user, store.sessions)

    async def view(ws, save):
        status = await asyncio.to_thread(director.status, ws.user.id, save.name, save.value)
        if status is None:
            raise not_found()
        return director_view(status, save.value)

    async def save_of(ws, archive_id):
        return await asyncio.to_thread(find_save, ws.records, archive_id)

    @router.get("/saves/{archive_id}/director")
    async def status(archive_id: str, ws: Workspace = Depends(workspace)):
        return (await view(ws, await save_of(ws, archive_id))).wire()

    @router.post("/saves/{archive_id}/director/run", status_code=202)
    async def run_now(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await save_of(ws, archive_id)
        if not director.server_owned():
            raise PlayError(400, "model_not_configured", NOT_OWNED)
        if not director.start(ws.user.id, save.name, "manual"):
            raise PlayError(409, "turn_in_progress", "正在推演，等这一次推完")
        return (await view(ws, save)).wire()

    @router.post("/saves/{archive_id}/director/plot")
    async def plot(archive_id: str, wanted: M.PlotSwitch, ws: Workspace = Depends(workspace)):
        save = await save_of(ws, archive_id)
        changed = await asyncio.to_thread(
            director.set_plot_disabled, ws.user.id, save.name, save.archive_id, not wanted.enabled
        )
        if changed is None:
            raise not_found()
        save = await save_of(ws, archive_id)
        return M.DirectorChange(
            director=await view(ws, save), state=await full_state(ws.records, save)
        ).wire()

    @router.put("/saves/{archive_id}/director/guidance")
    async def guidance(
        archive_id: str, wanted: M.GuidanceRequest, ws: Workspace = Depends(workspace)
    ):
        save = await save_of(ws, archive_id)
        # the daily paper written a few seconds after a turn does not stale the page's version
        if wanted.version != save.version and not (
            jobs is not None and jobs.follows(ws.user.id, save.name, wanted.version, save.version)
        ):
            raise version_conflict()
        await asyncio.to_thread(check_no_turn, ws.records, save)
        try:
            written = await asyncio.to_thread(
                ws.records.write, "archives", save.name, with_guidance(save.value, wanted.text),
                save.version, page_scope(save),
            )
        except HTTPException as error:
            if error.status_code == 409:
                raise PlayError(409, "version_conflict", GUIDANCE_CHANGED) from None
            # The player's storage limit (frx.storage) and the like.
            raise from_http(error) from None
        after = Save(save.name, written["version"], written["value"])
        return M.DirectorChange(
            director=await view(ws, after), state=await full_state(ws.records, after)
        ).wire()

    return router

