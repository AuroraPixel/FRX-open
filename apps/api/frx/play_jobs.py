"""The old page's work after a committed turn, done by the server in the background.

After each committed turn the old page archives the turn's memory, updates its summaries,
writes the daily paper and runs world evolution, each only when its settings switch it on. The
server queues the same jobs for the save, one after another, and runs the page's own functions
for them (apps/engine/after.cjs): the job decides from the saved settings and preferences whether
and how often to run, with the page's defaults. The page's network calls are answered here (the
model profiles, embeddings, the memory and evolution commits) and what the job changed in the
save, the settings and the preferences is written back.

A job that fails is tried once more; its error then goes on the turn's request row and the next
turn is never held up. Plot evolution stays with the director (after_commit).

The next turn does not wait for this work (实玩二: 15–20 s, over a minute when the memory caught
up). The jobs run alongside it and write the save only while no turn of it is under way: a turn
commits from the state it reserved, and a write landing meanwhile refuses its reply (第五十七回),
so a job's write waits for the turn to end and then lands on the save as it is then, field by
field (apply_changes). The memory archive writes no field of the save at all. Only world
evolution cannot wait its turn: its commit refuses a save that moved on to the next turn, so a
turn sent while an evolution is due waits for it, and says so (`blocking`).

A job runs for minutes on what it read when it started; the player may meanwhile change a setting
it also writes (the daily paper's switch lives in the same preference record as the paper's round
counter). What a job writes back is only what it changed, applied to the record as it is now, and
never the player's own switches (play_settings.PLAYER_KEYS): the page fills a record's missing
keys with its defaults and writes the whole record, so a switch it never touched would come back
as its default.
"""

import asyncio
import copy
import json
import logging
import re
from urllib.parse import urlsplit

from fastapi import HTTPException

from . import play_prompt, usage
from .card_profiles import PROFILES
from .card_settings import HOST
from .card_store import TURN_UNDER_WAY
from .card_vectors import commit_vectors, prune_vectors
from .gateway import ModelFailure
from .play_settings import PLAYER_KEYS
from .play_turns import in_flight
from .turn_runtime import commit_evolution

logger = logging.getLogger(__name__)

JOBS = ("archive", "summary", "paper", "evolution")
NAMES = {"archive": "记忆归档", "summary": "总结更新", "paper": "日报", "evolution": "世界演化"}
# The page gives one turn's archiving three minutes before the next turn's may start.
JOB_SECONDS = 180
# Each pass answers the requests the page is waiting on, so a job takes as many passes as its
# longest chain of requests one after another. Archiving embeds and commits each memory in turn
# (two passes for each) after the archiver's call, for the turn and for up to three earlier
# turns it missed: with five memories a turn that is 4 × 11 passes. The page's bound is its
# three minutes, and so is the job's; the passes only stop a job that never settles.
PASSES = 80
ATTEMPTS = 2
MISSING = object()
# A job's write waits this long at most for a turn under way to end, asking every HOLD_POLL.
HOLD_SECONDS = 600
HOLD_POLL = 0.5
EVOLUTION_SETTING = "CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1"


def evolution_due(config, logs, log_id):
    """Whether the world evolution after the turn of `log_id` will run: after.cjs's own test
    (frxEvolutionJob), switched on and a whole number of `frequency` rounds."""
    if not isinstance(config, dict) or not config.get("enabled"):
        return False
    replies = [log.get("id") for log in logs
               if log.get("type") == "ai" and not log.get("isUndoSnapshot")]
    if log_id not in replies:
        return False
    try:
        frequency = int(config.get("frequency") or 1)
    except (TypeError, ValueError):
        return True  # read as the page reads it or not, waiting is the safe side
    return frequency == 0 or (replies.index(log_id) + 1) % abs(frequency) == 0


def preference_key(key):
    """The page keys host.js mirrors from the browser's storage into the settings."""
    return key in {"CULTIVATION_THEME", "CULTIVATION_THEATER_TABS_V2"} or (
        key.startswith("theater_") and not re.search(r"apiKey|apiEndpoint|apiModel", key, re.I)
    )


def page_changes(before, after):
    """What a job changed in the save: fields of the data, of the state and of each log, as
    {"data"|"state": {key: value}, "logs": {id: {key: value}}}, MISSING for a removed field."""

    def fields(old, new):
        return {
            key: new.get(key, MISSING)
            for key in set(old) | set(new)
            if old.get(key, MISSING) != new.get(key, MISSING)
        }

    old, new = before["data"], after["data"]
    logs = {log.get("id"): log for log in old.get("logs", [])}
    return {
        "data": {k: v for k, v in fields(old, new).items() if k not in {"logs", "state"}},
        "state": fields(old.get("state") or {}, new.get("state") or {}),
        "logs": {
            log.get("id"): changed
            for log in new.get("logs", [])
            if log.get("id") in logs and (changed := fields(logs[log.get("id")], log))
        },
    }


class Moved(Exception):
    """The save moved under a field the job changed: the job's result is stale."""


def apply_changes(value, before, changes, *, keep_tables):
    """Put a job's changes on the save as it is now. A field is changed only where it still holds
    what the job started from (another write landing first makes the job stale); the tables are
    left alone when `keep_tables` (a turn is under way, or a later turn changed them)."""
    data, old = value["data"], before["data"]

    def put(target, source, key, new):
        if target.get(key, MISSING) != source.get(key, MISSING):
            raise Moved(key)
        if new is MISSING:
            target.pop(key, None)
        else:
            target[key] = copy.deepcopy(new)

    for key, new in changes["data"].items():
        put(data, old, key, new)
    for key, new in changes["state"].items():
        if key == "currentState" and keep_tables:
            continue
        put(data["state"], old["state"], key, new)
    logs = {log.get("id"): log for log in data.get("logs", [])}
    old_logs = {log.get("id"): log for log in old.get("logs", [])}
    for log_id, fields in changes["logs"].items():
        if log_id not in logs:
            raise Moved(log_id)
        for key, new in fields.items():
            put(logs[log_id], old_logs[log_id], key, new)


class AfterTurn:
    """The jobs after committed turns: one queue per save, run in the background.

    `lineage` remembers, per save, the versions the jobs wrote: a turn sent with the version of
    its last `done` is still current when only jobs wrote since (see follows)."""

    def __init__(self, runtime):
        self.runtime = runtime
        self.tails = {}
        self.lineage = {}
        self.tasks = set()
        # per save, the turns whose jobs are queued or running: [(task, log_id)]
        self.queued = {}

    def enqueue(self, ws, name, request_id, log_id):
        """Queue the jobs of a committed turn behind the save's earlier ones."""
        key = (ws.user.id, name)
        previous = self.tails.get(key)
        task = asyncio.get_running_loop().create_task(
            self.run(previous, ws, name, request_id, log_id)
        )
        self.tails[key] = task
        self.tasks.add(task)
        self.queued.setdefault(key, []).append((task, log_id))

        def finished(done):
            self.tasks.discard(done)
            if self.tails.get(key) is done:
                del self.tails[key]
            left = [entry for entry in self.queued.get(key, []) if entry[0] is not done]
            if left:
                self.queued[key] = left
            else:
                self.queued.pop(key, None)

        task.add_done_callback(finished)
        return task

    async def blocking(self, ws, name):
        """What of the work queued for this save a new turn must wait for, in words for the
        player: a world evolution that will run (its commit refuses a save that moved on to the
        next turn); nothing else, since the other jobs write when the turn is over."""
        waiting = [log_id for task, log_id in self.queued.get((ws.user.id, name), [])
                   if not task.done()]
        if not waiting:
            return []
        config = await asyncio.to_thread(ws.records.get, "settings", EVOLUTION_SETTING)
        config = (config.get("value") or {}).get("value") if isinstance(config, dict) else None
        if not isinstance(config, dict) or not config.get("enabled"):
            return []
        saved = await asyncio.to_thread(ws.records.get, "archives", name, lean=True)
        logs = ((saved.get("value") or {}).get("data") or {}).get("logs") or []
        return [NAMES["evolution"]] if any(evolution_due(config, logs, log_id)
                                         for log_id in waiting) else []

    async def settled(self, user_id, name):
        """Wait for the jobs queued so far for this save. Waiting never cancels the jobs."""
        task = self.tails.get((user_id, name))
        if task is not None and not task.done():
            await asyncio.wait({task})

    async def drain(self):
        """Wait until every queued job has finished (tests and the driver)."""
        while self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)

    def follows(self, user_id, name, version, stored):
        """Whether the stored version descends from `version` through job writes only."""
        lineage = self.lineage.get((user_id, name), {})
        while stored != version and stored in lineage:
            stored = lineage[stored]
        return stored == version

    def remember_write(self, user_id, name, version):
        self.lineage.setdefault((user_id, name), {})[version] = version - 1

    async def run(self, previous, ws, name, request_id, log_id):
        if previous is not None:
            await asyncio.gather(previous, return_exceptions=True)
        for mode in JOBS:
            await self.run_job(ws, name, mode, request_id, log_id)

    async def run_job(self, ws, name, mode, request_id, log_id):
        error = None
        meter = getattr(self.runtime, "meter", None)
        for _ in range(ATTEMPTS):
            try:
                # The job's model calls are the player's, one usage event each.
                with usage.scope(meter, ws.user.id, "after:" + mode, request_id):
                    async with asyncio.timeout(JOB_SECONDS):
                        done = await self.attempt(ws, name, mode, log_id)
                # Keeping the result may wait for a turn under way: not the job's own time.
                if done is not None:
                    await self.keep(ws, name, *done)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                error = exc
        message = describe(error)
        logger.warning("after_turn_failed job=%s error=%s", mode, type(error).__name__)
        try:
            await asyncio.to_thread(ws.records.record_after_turn, request_id, mode, message)
        except HTTPException:
            pass

    # ------------------------------------------------------------ one job

    async def attempt(self, ws, name, mode, log_id):
        """Run one job on the save as it is now; returns what keep() writes, or None when the
        turn is gone."""
        records = ws.records
        saved = await asyncio.to_thread(records.get, "archives", name, lean=True)
        value = saved["value"]
        logs = (value or {}).get("data", {}).get("logs", [])
        if not any(log.get("id") == log_id for log in logs):
            return None  # The turn was undone or the save replaced: nothing is left to do.
        data = value["data"]
        settings = play_prompt.settings_of(await asyncio.to_thread(records.list, "settings"))
        archive_id = data.get("archiveId")
        memories = await asyncio.to_thread(records.archive_memories, archive_id, True)
        scope = {"archive": name, "archive_id": archive_id, "log_id": log_id,
                 "epoch": data.get("frxTimelineEpoch", "")}
        job = {
            **play_prompt.turn_input(
                value, settings, {}, seed=f"{log_id}:{mode}",
                vectors=play_prompt.visible_vectors(memories, archive_id),
            ),
            "mode": mode, "logId": log_id, "scope": scope,
            "models": {name: self.runtime.profiles.load(name).model for name in PROFILES},
        }
        answer = self.answerer(records)
        answers = {}
        for _ in range(PASSES):
            result = await play_prompt.run_script(
                "after.cjs", {**job, "answers": answers}, timeout=60, step="回合之后的工作"
            )
            if result.get("done"):
                break
            for need in result["needs"]:
                answers[need["key"]] = await answer(need)
        else:
            raise ModelFailure("回合之后的工作没有完成")
        return scope, value, result, settings

    def answerer(self, records):
        """The page's requests of a job: the model calls, and the commits of memories and of
        world evolution, which write as the page's requests would."""
        base = play_prompt.answerer(self.runtime.profiles)

        async def answer(need):
            path = urlsplit(need["url"]).path
            body = need.get("body")
            body = json.loads(body) if isinstance(body, str) else body
            try:
                if path == HOST + "/vectors/commit":
                    result = await asyncio.to_thread(
                        commit_vectors, records, body["scope"], str(body["batch_id"]),
                        body["additions"], body.get("retirements") or [], body["timestamp"],
                    )
                elif path == HOST + "/vectors/prune":
                    result = await asyncio.to_thread(
                        prune_vectors, records, body["scope"], body["records"]
                    )
                elif path == HOST + "/evolution/commit":
                    result = await commit_evolution(records, body)
                    self.remember_write(records.user_id, body["scope"]["archive"], result["version"])
                else:
                    return await base(need)
            except HTTPException as exc:
                return {"status": exc.status_code, "body": {"detail": exc.detail}}
            except ModelFailure as exc:
                return {"status": 502, "body": {"detail": str(exc)}}
            return {"status": 200, "body": result}

        return answer

    async def keep(self, ws, name, scope, before, result, settings):
        """Write what the job changed: the save (field by field), and the settings and preferences
        (key by key) over what they hold now; `settings` are the ones the job started from."""
        records = ws.records
        if result.get("archive"):
            # A commit the job made through the server (world evolution) is already saved; only
            # what the page changed after it is left to write.
            before = result.get("received") or before
            changes = page_changes(before, result["archive"])
            if any(changes.values()):
                written = await self.write_when_quiet(ws, name, scope, before, changes)
                self.remember_write(ws.user.id, name, written["version"])
        # A setting the job wrote more than once ends as its last write.
        writes = {write["key"]: write["value"] for write in result.get("writes") or []}
        for key, value in writes.items():
            await asyncio.to_thread(merge_setting, records, key, settings.get(key), value)
        # The page mirrors only some of its browser storage to the server: those keys are the
        # job's to change, the rest of the record stays as it is.
        preferences = settings.get(play_prompt.PREFERENCES_KEY) or {}
        mirrored = {k: v for k, v in (result.get("preferences") or {}).items() if preference_key(k)}
        if mirrored != {k: v for k, v in preferences.items() if preference_key(k)}:
            await asyncio.to_thread(
                merge_setting, records, play_prompt.PREFERENCES_KEY, preferences,
                {k: v for k, v in preferences.items() if not preference_key(k)} | mirrored,
            )

    async def write_when_quiet(self, ws, name, scope, before, changes):
        """Write a job's changes to the save once no turn of it is under way (the store refuses
        the write while one is, TURN_UNDER_WAY), on the save as it is then."""
        deadline = asyncio.get_running_loop().time() + HOLD_SECONDS
        while True:
            try:
                return await asyncio.to_thread(self.write_save, ws, name, scope, before, changes)
            except HTTPException as exc:
                if exc.detail != TURN_UNDER_WAY or asyncio.get_running_loop().time() > deadline:
                    raise
            await asyncio.sleep(HOLD_POLL)

    def write_save(self, ws, name, scope, before, changes):
        records = ws.records
        for attempt in range(3):
            saved = records.get("archives", name, lean=True)
            value = copy.deepcopy(saved["value"])
            if not value:
                raise HTTPException(404, "存档不存在")
            # The tables are the turns' own: a turn under way or starting (its player's line is
            # the last log, its reservation compares the tables) or a later turn changed them.
            logs = value["data"].get("logs") or []
            keep_tables = bool(in_flight(records, name)) or (
                bool(logs) and logs[-1].get("type") == "user"
            ) or (
                value["data"]["state"].get("currentState")
                != before["data"]["state"].get("currentState")
            )
            try:
                apply_changes(value, before, changes, keep_tables=keep_tables)
            except Moved:
                raise HTTPException(409, "回合之后的结果所依据的存档已变化，未写入") from None
            try:
                return records.write("archives", name, value, saved["version"],
                                     {**scope, "quiet": True}, lean=True)
            except HTTPException as exc:
                moved = exc.status_code == 409 and "其他操作中变化" in str(exc.detail)
                if not moved or attempt == 2:
                    raise
        raise HTTPException(409, "存档已在其他操作中变化")


def merged(current, started, written, owned=frozenset()):
    """A setting the job read as `started` and would leave as `written`, with only the keys the
    job changed applied to `current`, the setting as it is now; `owned` keys are the player's and
    stay as they are. A value that is not a record is the job's own whole."""
    if not isinstance(written, dict):
        return written
    started = started if isinstance(started, dict) else {}
    result = copy.deepcopy(current) if isinstance(current, dict) else {}
    for key in set(started) | set(written):
        if key in owned or started.get(key, MISSING) == written.get(key, MISSING):
            continue
        if key in written:
            result[key] = copy.deepcopy(written[key])
        else:
            result.pop(key, None)
    return result


def merge_setting(records, key, started, written):
    for attempt in range(3):
        saved = records.get("settings", key)
        envelope = saved["value"]
        current = envelope.get("value") if isinstance(envelope, dict) else None
        value = merged(current, started, written, PLAYER_KEYS.get(key, frozenset()))
        if envelope is not None and value == current:
            return saved
        try:
            return records.write("settings", key, {"key": key, "value": value}, saved["version"])
        except HTTPException as exc:
            if exc.status_code != 409 or attempt == 2:
                raise


def describe(error):
    if isinstance(error, HTTPException):
        detail = error.detail
        return detail if isinstance(detail, str) else str(detail.get("message", detail))
    if isinstance(error, (ModelFailure, TimeoutError)):
        return str(error) or "回合之后的工作超时"
    return "回合之后的工作出错：" + type(error).__name__
