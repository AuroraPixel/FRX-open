"""The write side of the new interface's API for saves and settings, under /api/play: creating,
deleting, exporting and importing saves, full backups, panel actions, rebuilding a save's
memory, the shared settings and the model connections.

Thin by design: every route takes the user from frx.auth.current_user, works through that
user's own store and hands the work to the modules below it. `{id}` is the save's archiveId;
another user's id answers like one that does not exist (404). The turn routes live in
play_api.py, the read routes in play_read_api.py.
"""

import asyncio

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import Field

from . import play_models as M
from . import play_save_files as files
from . import usage
from .auth import User, admin, current_user, login, model_quota
from .gateway import ModelFailure, ModelUpdate
from .life import availability, life_of
from .life_turns import NOT_LIFE, gate_sheet, preview_verb
from .play_actions import act
from .play_creation import create_save, creation_options, draw
from .play_errors import PlayError, refused
from .play_saves import find_save
from .play_settings import (
    available_models,
    check_model,
    director_runs_here,
    profile_problem,
    read_settings,
    write_settings,
)
from .turn_runtime import LifeRefusal, embed
from .workspace import Workspace, open_workspace

# Memories embedded per call when a save's memory is rebuilt.
REBUILD_BATCH = 16


class ProfileChoice(M.Contract):
    model: str = Field(max_length=200)


async def embed_memories_again(runtime, records, user_id, scope):
    """Embed every memory of this save again with the embedding profile's model (the old page's
    重建本档向量): the save's own memories, by their archive_id, each written back over the
    version it was read at. Returns how many were written."""
    with records.sessions() as session:
        records.validate_scope(session, scope)
        candidates = session.scalars(records.memories_of([scope["archive_id"]])).all()
        listed = [records.envelope(row) for row in candidates if row.value is not None]
    rows = [
        row for row in listed
        if row["value"].get("scope") == "archive"
        and row["value"].get("archiveId") == scope["archive_id"]
    ]
    # The embeddings of a rebuild are the user's.
    usage.enter(runtime.meter, user_id, "rebuild")
    done = 0
    for offset in range(0, len(rows), REBUILD_BATCH):
        batch = rows[offset : offset + REBUILD_BATCH]
        result = await embed(
            runtime.profiles,
            [row["value"].get("content", "")[:4500] or row["value"].get("title", "记忆")
             for row in batch],
        )
        vectors = sorted(result["data"], key=lambda item: item["index"])
        for old, vector in zip(batch, vectors, strict=True):
            value = {**old["value"], "vector": vector["embedding"],
                     "embeddingModel": result["model"]}
            await asyncio.to_thread(
                records.write, "vectors", old["key"], value, old["version"], scope
            )
            done += 1
    return done


def play_save_router(store, settings, runtime, jobs=None):
    # Signed-in users; the model connections are the whole server's and only an administrator
    # changes them or asks the model service what it offers. `jobs` is the turns' work after
    # each turn (play_jobs.AfterTurn): the versions only it wrote do not stale a panel action
    # or a deletion.
    router = APIRouter(prefix="/api/play", dependencies=[Depends(login)])
    profiles = runtime.profiles

    def workspace(user: User = Depends(current_user)) -> Workspace:
        return open_workspace(user, store.sessions)

    # ------------------------------------------------------------ creating a save

    @router.get("/creation")
    def creation(ws: Workspace = Depends(workspace)):
        return creation_options(ws.records, availability(profiles.load("default").model)).wire()

    @router.post("/creation/draw")
    async def creation_draw(request: M.DrawRequest, ws: Workspace = Depends(workspace)):
        return (await draw(ws.records, request)).wire()

    @router.post("/saves", status_code=201)
    async def new_save(creation: M.CreationInput, ws: Workspace = Depends(workspace)):
        play = availability(profiles.load("default").model)
        return (await create_save(ws.records, creation, play)).wire()

    # ------------------------------------------------------------ a save's life outside play

    @router.delete("/saves/{archive_id}", status_code=204)
    async def delete_save(archive_id: str, version: int, ws: Workspace = Depends(workspace)):
        def follows(name, seen, stored):
            return jobs is not None and jobs.follows(ws.user.id, name, seen, stored)

        await asyncio.to_thread(files.delete_save, ws.records, archive_id, version, follows)
        return Response(status_code=204)

    @router.get("/saves/{archive_id}/export")
    async def export_save(archive_id: str, ws: Workspace = Depends(workspace)):
        return await asyncio.to_thread(files.export_save, ws.records, archive_id)

    @router.post("/saves/import/preview")
    async def preview_import(request: Request, ws: Workspace = Depends(workspace)):
        raw = await files.save_file_body(request)
        return await asyncio.to_thread(files.preview_save_file, raw)

    @router.post("/saves/import", status_code=201)
    async def import_save(
        request: Request,
        ws: Workspace = Depends(workspace),
    ):
        if "source" in request.query_params:
            raise refused("当前存档格式不支持选择旧状态来源")
        raw = await files.save_file_body(request)
        summary = await asyncio.to_thread(files.import_save_file, ws.records, raw)
        return summary.wire()

    @router.get("/backup")
    async def download_backup(save: str | None = None, ws: Workspace = Depends(workspace)):
        return await asyncio.to_thread(files.download_backup, ws.records, save)

    @router.post("/backup/preview")
    async def preview_backup(request: Request, ws: Workspace = Depends(workspace)):
        raw = await files.backup_body(request)
        return await asyncio.to_thread(files.inspect_backup, ws.records, raw)

    @router.post("/backup/restore")
    async def restore_backup(
        request: Request,
        restore_settings: bool = Query(False, alias="restoreSettings"),
        revision: str = Header("", alias="x-frx-backup-revision"),
        ws: Workspace = Depends(workspace),
    ):
        raw = await files.backup_body(request)
        return await asyncio.to_thread(files.restore, ws.records, raw, revision, restore_settings)

    # ------------------------------------------------------------ playing with a save's things

    @router.post("/saves/{archive_id}/actions")
    async def panel_action(
        archive_id: str, action: M.PanelAction, ws: Workspace = Depends(workspace)
    ):
        def follows(name, version, stored):
            return jobs is not None and jobs.follows(ws.user.id, name, version, stored)

        return (await act(ws.records, archive_id, action, follows)).wire()

    # Declared after /saves/import/preview, which the path would otherwise take for a save's.
    @router.post("/saves/{archive_id}/preview")
    async def preview(archive_id: str, body: M.PreviewRequest,
                      ws: Workspace = Depends(workspace)):
        """What a standing verb would do if done now (gameplay plan item 12): the engine works it
        out with the verb's own code and writes nothing."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        if life_of(save.value) is None:
            raise refused(NOT_LIFE)
        try:
            found = await preview_verb(save.value, body.verb.wire())
        except LifeRefusal as refusal:
            raise refused(str(refusal)) from None
        except ModelFailure as failure:
            raise PlayError(500, "engine_failed", str(failure)) from None
        return M.VerbPreview.model_validate(found).wire()

    @router.get("/saves/{archive_id}/gate")
    async def gate(archive_id: str, aids: str | None = Query(None),
                   ws: Workspace = Depends(workspace)):
        """The next gate's preparation sheet (gameplay plan item 22), from the engine's gate op:
        `aids` (bag ids, comma separated, one a pill) prices those pills, and given empty (`?aids=`)
        no pills; without it the sheet counts the bag's, as many as count."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        if life_of(save.value) is None:
            raise refused(NOT_LIFE)
        given = None if aids is None else [
            aid.strip() for aid in aids.split(",") if aid.strip()][:10]
        try:
            sheet = await gate_sheet(save.value, given)
        except LifeRefusal as refusal:
            raise refused(str(refusal)) from None
        except ModelFailure as failure:
            raise PlayError(500, "engine_failed", str(failure)) from None
        return M.GateSheet.model_validate(sheet).wire()

    @router.post("/saves/{archive_id}/memory/rebuild", dependencies=[Depends(model_quota)])
    async def rebuild_memory(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        scope = {
            "archive": save.name,
            "archive_id": save.archive_id,
            "log_id": None,
            "epoch": str(save.data.get("frxTimelineEpoch") or ""),
        }
        try:
            written = await embed_memories_again(runtime, ws.records, ws.user.id, scope)
        except HTTPException as exc:
            message = exc.detail if isinstance(exc.detail, str) else "记忆没能重建，请稍后重试"
            if exc.status_code == 502:
                raise PlayError(502, "model_failed", message) from None
            if exc.status_code == 409:
                raise PlayError(409, "version_conflict", message) from None
            raise PlayError(500, "engine_failed", message) from None
        return {"jobs": written}

    # ------------------------------------------------------------ settings and connections

    # Plot evolution reads as the director applies it, which depends on whether it runs here.
    @router.get("/settings")
    async def get_settings(ws: Workspace = Depends(workspace)):
        def read():
            return read_settings(ws.records, director_runs_here(profiles))

        return (await asyncio.to_thread(read)).wire()

    @router.put("/settings")
    async def put_settings(wanted: M.PlaySettings, ws: Workspace = Depends(workspace)):
        def write():
            return write_settings(ws.records, wanted, director_runs_here(profiles))

        return (await asyncio.to_thread(write)).wire()

    @router.get("/connection")
    def get_connection(user: User = Depends(current_user)):
        # A player sees whether a model is configured and its name, not the address.
        view = settings.public()
        return view if user.role == "admin" else {k: view[k] for k in ("model", "configured")}

    @router.put("/connection", dependencies=[Depends(admin)])
    def put_connection(update: ModelUpdate):
        try:
            return settings.save(update)
        except ValueError as exc:
            raise PlayError(409, "version_conflict", str(exc)) from None

    @router.get("/profiles")
    def list_profiles():
        return profiles.public()

    @router.put("/profiles/{name}", dependencies=[Depends(admin)])
    def choose_profile(name: str, choice: ProfileChoice):
        try:
            return profiles.select(name, choice.model)
        except HTTPException as exc:
            raise profile_problem(exc) from None

    @router.get("/profiles/{name}/models", dependencies=[Depends(admin)])
    async def profile_models(name: str):
        return await available_models(profiles, name)

    @router.post("/profiles/{name}/check", dependencies=[Depends(admin)])
    async def check_profile_model(name: str, choice: ProfileChoice):
        # one tiny call with the model the administrator picked: does it answer at all
        return await check_model(profiles, name, choice.model)

    return router
