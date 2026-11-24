"""User-scoped persistence over archives, logs, snapshots, memories and settings."""

import copy
import hashlib
import json
import time
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import (
    JSON,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    select,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .card_settings import browser_setting
from .card_snapshots import pack_snapshot
from .card_turns import PILOT_SETTING, pilot_flag, reply_story
from .request_policy import (
    GENERATION_LEASE_SECONDS,
    REPAIR_LEASE_SECONDS,
    lease_expired,
    request_blocks_archive,
)
from .save_schema import (
    Memory,
    get_record,
    materialize_value,
    model_for,
    new_record,
    records_query,
)
from .storage import Base, bind_user, now

# Each service operation name is bound to a distinct domain table.
COLLECTIONS = {"archives": "name", "settings": "key", "vectors": "id"}
SERVER_COLLECTIONS = {"play_art": "archiveId"}
# The refusal of a write by the work after a turn while a turn of the save is under way.
TURN_UNDER_WAY = "回合正在进行，后台工作的结果等它结束后再写入"


def state_digest(state):
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def card_story(reply):
    """The story of a model's reply, as both interfaces commit it (card_turns.reply_story): the
    first <content> block with words in it wherever it stands, else the words outside the
    hidden blocks."""
    return reply_story(reply)


class CardRequest(Base):
    __tablename__ = "card_requests"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(24))
    response: Mapped[str] = mapped_column(Text, default="")
    seed: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64), default="", server_default="")
    settlement: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    lease_until: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (
        Index("ix_card_requests_archive", "user_id", "archive", "status"),
        ForeignKeyConstraint(
            ["user_id", "archive"], ["archives.user_id", "archives.name"], ondelete="CASCADE"
        ),
    )


class CardStore:
    """One user's records, turn requests and import sources.

    Every key includes the user, so there is no way to build one without a user and no query
    here runs without the user's condition. Rows are reached through the methods below, never by
    a hand-built primary key: a key missing the user fails loudly instead of reading another
    player's data. Its sessions are bound to the user (frx.storage.bind_user): PostgreSQL's
    row-level security shows each transaction only this user's rows, and `limits` (multi-user
    mode) holds the user's saves to their number and size.
    """

    @staticmethod
    def new_seed():
        # Per-turn dice and identifiers; tests replace this to pin a roll.
        return uuid4().hex

    def __init__(self, user_id, sessions, media=None, limits=None):
        from .card_media import CardMedia

        if not isinstance(user_id, str) or not user_id:
            raise ValueError("CardStore needs the id of the user whose data it holds")
        self.user_id = user_id
        self.limits = limits
        self.sessions = bind_user(sessions, user_id, limits)
        self.media = media or CardMedia(user_id, sessions)

    # ------------------------------------------------------------ rows of this user only

    def lock(self, session):
        """Serialize one user's mutations, including absent rows and whole restores."""
        held = session.info.get("frx_store_lock")
        if held == "write":
            return
        if held:
            raise RuntimeError("A read transaction cannot be upgraded to a write transaction")
        if session.bind.dialect.name == "postgresql":
            session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:name))"),
                {"name": "frx-domain-write:" + self.user_id},
            )
        elif session.bind.dialect.name == "sqlite":
            session.execute(text("BEGIN IMMEDIATE"))
        session.info["frx_store_lock"] = "write"

    def read_lock(self, session):
        """Read archives, logs and referenced snapshots from one coherent transaction.

        PostgreSQL shares the user's write barrier. SQLite needs an explicit BEGIN because
        its legacy driver otherwise does not start a transaction for SELECT statements.
        """
        if session.info.get("frx_store_lock"):
            return
        if session.bind.dialect.name == "postgresql":
            session.execute(
                text("SELECT pg_advisory_xact_lock_shared(hashtext(:name))"),
                {"name": "frx-domain-write:" + self.user_id},
            )
        elif session.bind.dialect.name == "sqlite":
            session.execute(text("BEGIN"))
        session.info["frx_store_lock"] = "read"

    def record(self, session, collection, key, lock=False, lean=False):
        if lock:
            self.lock(session)
        else:
            self.read_lock(session)
        return get_record(session, self.user_id, collection, key, lock=lock, lean=lean)

    def new_record(self, collection, key, value, version=1):
        return new_record(self.user_id, collection, key, value, version)

    def records_of(self, collection):
        return records_query(self.user_id, collection)

    def memories_of(self, archive_ids, include_shared=False):
        ids = sorted({i for i in archive_ids if isinstance(i, str) and i})
        bound = Memory.archive_id.in_(ids)
        if include_shared:
            bound = bound | Memory.archive_id.is_(None)
        return self.records_of("vectors").where(bound).order_by(Memory.key)

    def archive_memories(self, archive_id, include_shared=False):
        """This save's memory values (deleted rows left out), read by archive_id; with
        include_shared, the memories bound to no save as well."""
        if not archive_id and not include_shared:
            return []
        with self.sessions() as session:
            rows = session.scalars(self.memories_of([archive_id], include_shared)).all()
            return [copy.deepcopy(row.value) for row in rows if row.value is not None]

    def attempt(self, session, request_id, lock=False):
        if lock:
            # Requests and archive writes share one lock order, including lease transitions.
            # A quiet writer or a complete export must not miss a repair being claimed.
            self.lock(session)
        return session.get(CardRequest, (self.user_id, request_id), with_for_update=lock)

    def requests_of(self, archive=None):
        query = select(CardRequest).where(CardRequest.user_id == self.user_id)
        if archive is not None:
            query = query.where(CardRequest.archive == archive)
        return query

    @staticmethod
    def check_collection(collection):
        if collection not in COLLECTIONS:
            raise HTTPException(404, "数据表不存在")

    @staticmethod
    def envelope(row, copied=True):
        """A row as the caller gets it: its value a copy, or (`copied` false) the row's own, for a
        read whose session ends with it (the value was loaded for it alone; a long save's copy
        was a turn's CPU several times over, batch 8)."""
        value = copy.deepcopy(row.value) if copied else row.value
        if row.collection == "settings" and value is not None:
            value = browser_setting(value)
        return dict(key=row.key, version=row.version, value=value)

    def list(self, collection):
        self.check_collection(collection)
        with self.sessions() as session:
            self.read_lock(session)
            model = model_for(collection)
            rows = session.scalars(self.records_of(collection).order_by(model.key)).all()
            envelopes = [self.envelope(row, False) for row in rows if row.value is not None]
            if collection == "archives":
                for envelope in envelopes:
                    self.materialize(session, envelope["value"])
            return envelopes

    def get(self, collection, key, lean=False):
        """A record's envelope. A save comes with its kept round snapshots back in its rounds,
        as it always was, unless `lean` (the turn's own reads, the state view: they never read
        them, and on a long save they were nine tenths of the bytes)."""
        self.check_collection(collection)
        with self.sessions() as session:
            row = self.record(session, collection, key, lean=lean)
            if not row:
                return dict(key=key, version=0, value=None)
            envelope = self.envelope(row, False)
            if collection == "archives" and not lean:
                self.materialize(session, envelope["value"])
            return envelope

    def materialize(self, session, value):
        self.read_lock(session)
        return materialize_value(session, self.user_id, value)

    @staticmethod
    def avatar_key(archive):
        return "CULTIVATION_CUSTOM_AVATAR_V1_" + archive

    def setting_value(self, session, key):
        row = self.record(session, "settings", key)
        return copy.deepcopy(row.value.get("value")) if row and row.value else None

    def save_setting(self, session, key, value):
        row = self.record(session, "settings", key, lock=True)
        content = {"key": key, "value": copy.deepcopy(value)}
        if row:
            row.value = content
            row.version += 1
        else:
            session.add(self.new_record("settings", key, content))

    def apply_settlement(self, session, row, value, attempt, result):
        if attempt.archive != row.key:
            raise HTTPException(409, "回合属于另一存档")
        before = result.get("beforeStateHash")
        if before and state_digest(row.value["data"]["state"]) != before:
            raise HTTPException(409, "生成期间存档已变化，原始回复已保留，请重新读档")
        final = value["data"]["logs"][-1]
        context = attempt.context or {}
        prefix = context.get("historyIds")
        if (
            prefix is not None
            and [entry.get("id") for entry in row.value["data"].get("logs", [])[: len(prefix)]]
            != prefix
        ):
            raise HTTPException(409, "回合历史已回溯，迟到结果未写入")
        state_before = copy.deepcopy(row.value["data"]["state"])
        avatar_key = self.avatar_key(row.key)
        avatar_before = context.get("playerAvatar", self.setting_value(session, avatar_key))
        final["frxBeforeSnapshot"] = pack_snapshot(
            {"state": copy.deepcopy(state_before), "playerAvatar": avatar_before}
        )
        state = copy.deepcopy(state_before)
        if result.get("errors"):
            final["frxPending"] = True
            if result.get("itemUseError"):
                final["frxItemUseError"] = result["itemUseError"]
            final["biographySnapshot"] = copy.deepcopy(state.get("worldBookEntries", []))
        else:
            final.pop("frxItemUseError", None)
            attempt.settlement = {
                **result,
                "clientMatches": value["data"]["state"].get("currentState") == result["state"],
            }
            state["currentState"] = copy.deepcopy(result["state"])
            if "dailyItemUses" in result:
                state["dailyItemUses"] = copy.deepcopy(result["dailyItemUses"])
            # Breakthrough cooldowns, fortune dates and chapter rewards: kept like daily uses, so
            # the round snapshot and undo carry them too.
            if "frxProgress" in result:
                state["frxProgress"] = copy.deepcopy(result["frxProgress"])
            # The cultivation-life play's frxPlay (time, scenes, clocks, calendar), the same way.
            if "frxPlay" in result:
                state["frxPlay"] = copy.deepcopy(result["frxPlay"])
            state["worldMap"] = copy.deepcopy(result["worldMap"])
            if "npcAvatars" in result:
                state["npcAvatars"] = copy.deepcopy(result["npcAvatars"])
            biographies = result.get("biographySnapshot")
            if biographies is not None:
                state["worldBookEntries"] = copy.deepcopy(biographies)
                final["biographySnapshot"] = copy.deepcopy(biographies)
            for patch in result.get("biographyPatches", []):
                target = next(
                    (log for log in value["data"]["logs"] if log.get("id") == patch.get("id")), None
                )
                if target is not None:
                    target["biographySnapshot"] = copy.deepcopy(patch["value"])
            for setting in result.get("settingsWrites", []):
                if setting.get("key") != avatar_key:
                    raise HTTPException(422, "回合试图写入其他存档的设置")
                self.save_setting(
                    session, avatar_key, self.media.normalize(setting["value"], session)
                )
            final["smallSummary"] = result.get("smallSummary") or ""
            final["largeSummary"] = result.get("largeSummary") or ""
            final["frxPending"] = False
            replacement = result.get("storyReplacement")
            if replacement:
                final["content"] = replacement["content"]
                final["unoptimizedContent"] = replacement["content"]
                final["branchContent"] = replacement.get("branchContent", "")
        value["data"]["state"] = state
        final["stateSnapshot"] = json.dumps(state["currentState"], ensure_ascii=False)
        # The packed round snapshot below already holds the world map.
        final.pop("worldMapSnapshot", None)
        final["frxStateSnapshot"] = pack_snapshot(
            {
                "state": copy.deepcopy(state),
                "playerAvatar": self.setting_value(session, avatar_key),
            }
        )
        attempt.status = "pending" if result.get("errors") else "committed"

    @staticmethod
    def keep_director(value, stored):
        """The server owns data.frxDirector (plot evolution, written in the background without
        a version change): a save of an existing archive keeps the stored copy, never the
        page's. A new record (save-as, import, restore) keeps what it brings."""
        data = value.get("data")
        if not isinstance(data, dict):
            return
        held = stored.get("data")
        held = held.get("frxDirector") if isinstance(held, dict) else None
        if held is None:
            data.pop("frxDirector", None)
        else:
            data["frxDirector"] = copy.deepcopy(held)

    def validate_scope(self, session, scope, collection=None, key=None, value=None):
        if not scope:
            return
        bound = self.record(session, "archives", scope["archive"])
        data = bound.value.get("data", {}) if bound and bound.value else {}
        log = next((entry for entry in data.get("logs", [])
                    if entry.get("id") == scope.get("log_id")), None)
        if (
            not data
            or data.get("archiveId") != scope.get("archive_id")
            or data.get("frxTimelineEpoch", "") != scope.get("epoch", "")
            or (scope.get("log_id") and log is None)
        ):
            raise HTTPException(409, "任务所属回合已回溯或存档已变化，迟到结果未写入")
        if collection == "archives" and key != scope["archive"]:
            raise HTTPException(409, "后台任务不能写入另一存档")
        if (
            collection == "vectors"
            and value
            and value.get("scope") == "archive"
            and value.get("archiveId") != scope["archive_id"]
        ):
            raise HTTPException(409, "后台记忆与存档归属不一致")

    def delete_archive_children(self, session, archive):
        """Remove a deleted archive's domains while retaining its versioned tombstone.

        The caller holds the user's write barrier. Both the API and internal archive writes
        use this path, so a pending request or a memory cannot outlive its deleted save.
        """
        from sqlalchemy import delete

        from .play_places import PlaceBook

        if self.turn_under_way(session, archive.key):
            raise HTTPException(409, "请先完成或停止当前回合，再删除存档")
        session.execute(delete(Memory).where(
            Memory.user_id == self.user_id, Memory.archive_id == archive.archive_id))
        session.execute(delete(CardRequest).where(
            CardRequest.user_id == self.user_id, CardRequest.archive == archive.key))
        art = self.record(session, "play_art", archive.archive_id, lock=True)
        if art is not None:
            session.delete(art)
        PlaceBook(self).forget(archive.archive_id, session)
        for key in (self.avatar_key(archive.key), "CULTIVATION_ACTIVE_ARCHIVE_V1"):
            setting = self.record(session, "settings", key, lock=True)
            if setting is not None and (key != "CULTIVATION_ACTIVE_ARCHIVE_V1"
                    or (setting.value or {}).get("value") == archive.key):
                setting.value = None
                setting.version += 1

    def write(self, collection, key, value, version, scope=None, lean=False):
        """Write at `version`; domain rows hold history and snapshots separately.

        The returned engine projection includes full snapshots unless `lean` is requested.
        """
        self.check_collection(collection)
        authoritative = False
        # The user write barrier also serializes absent-row creates and complete restores.
        with self.sessions.begin() as session:
            self.lock(session)
            self.validate_scope(session, scope, collection, key, value)
            row = self.record(session, collection, key, lock=True, lean=lean)
            if (row.version if row else 0) != version:
                raise HTTPException(409, "存档已在其他操作中变化，请重新读取后继续")
            if collection == "archives" and value is None and row is not None:
                self.delete_archive_children(session, row)
            if value is not None:
                # (normalize builds the value anew: the caller's is never changed)
                value = self.media.normalize(value, session)
                if collection == "settings":
                    value = browser_setting(value)
                if collection == "archives":
                    value.setdefault("frxSchemaVersion", 1)
                    # A round with a packed snapshot needs no separate copy of the world map.
                    for log in value.get("data", {}).get("logs", []):
                        if isinstance(log.get("frxStateSnapshot"), dict):
                            log.pop("worldMapSnapshot", None)
                    if row is not None and isinstance(row.value, dict):
                        self.keep_director(value, row.value)
                if str(value.get(COLLECTIONS[collection])) != key:
                    raise HTTPException(422, "记录标识与地址不一致")
                if collection == "archives":
                    logs = value.get("data", {}).get("logs", [])
                    final = logs[-1] if logs else {}
                    request_id = final.get("frxRequestId")
                    attempt = self.attempt(session, request_id) if request_id else None
                    if attempt and (row is None or attempt.archive != key):
                        # A copied save carries the original's request IDs: they belong there.
                        attempt = None
                    result = attempt.settlement if attempt else None
                    if attempt and attempt.status == "committed":
                        previous = [
                            entry
                            for entry in row.value["data"].get("logs", [])
                            if entry.get("frxRequestId") == request_id
                        ]
                        if previous and (
                            final.get("id") != previous[0].get("id")
                            or sum(entry.get("frxRequestId") == request_id for entry in logs) > 1
                        ):
                            raise HTTPException(409, "此回合已保存，重复回复未再次应用")
                    if result and attempt.status == "ready" and final.get("stateSnapshot"):
                        authoritative = True
                        self.apply_settlement(session, row, value, attempt, result)
                    elif attempt and attempt.status in {"cancelled", "expired", "undone"}:
                        raise HTTPException(409, "本回合已停止或回溯，迟到结果未写入")
                    elif (
                        attempt
                        and attempt.status in {"pending", "repairing"}
                        and final.get("stateSnapshot")
                    ):
                        old_log = next(
                            (
                                entry
                                for entry in row.value["data"]["logs"]
                                if entry.get("frxRequestId") == request_id
                            ),
                            None,
                        )
                        if value["data"]["state"] != row.value["data"]["state"]:
                            raise HTTPException(409, "请先重试结算或撤回待结算回合")
                        if old_log:
                            value["data"]["logs"][-1] = copy.deepcopy(old_log)
            if row:
                if collection == "archives" and value and scope:
                    logs = value.get("data", {}).get("logs", [])
                    final = logs[-1] if logs else {}
                    origin_ids = {final.get("id")}
                    if len(logs) > 1 and logs[-2].get("type") == "user":
                        origin_ids.add(logs[-2].get("id"))
                    if final.get("type") == "ai" and scope.get("log_id") in origin_ids:
                        final["frxStateSnapshot"] = pack_snapshot(
                            {
                                "state": copy.deepcopy(value["data"]["state"]),
                                "playerAvatar": self.setting_value(session, self.avatar_key(key)),
                            }
                        )
                row.version += 1
                row.value = value
            else:
                row = self.new_record(collection, key, value)
                session.add(row)
            if collection == "archives" and scope and scope.get("quiet"):
                # Work after a turn writes only while no turn of the save is under way: a turn
                # commits from the state it reserved, and a write landing meanwhile would refuse
                # its reply. Asked after the row is written, so the reservation cannot slip in
                # between (SQLite: this connection now holds the write lock; PostgreSQL: lock()).
                session.flush()
                if self.turn_under_way(session, key):
                    raise HTTPException(409, TURN_UNDER_WAY)
            # the value written is this write's own (normalize made it): a copy only where the
            # rounds are put back, for the row is flushed as it stands
            materialized = collection == "archives" and not lean
            envelope = self.envelope(row, materialized)
            if materialized:
                self.materialize(session, envelope["value"])
            return {**envelope, "authoritative": authoritative}

    def turn_under_way(self, session, archive):
        """Whether the save has a live reservation or a result awaiting commit."""
        rows = session.scalars(
            self.requests_of(archive).where(
                CardRequest.status.in_(["generating", "ready", "repairing"])
            )
        ).all()
        return any(request_blocks_archive(row) for row in rows)

    def begin_request(self, request_id, archive, payload, seed=None, pilot_default=False):
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        with self.sessions.begin() as session:
            self.lock(session)
            if session.bind.dialect.name == "postgresql":
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:name))"),
                    {"name": "card-generation:" + self.user_id + ":" + archive},
                )
            row = self.attempt(session, request_id)
            if row:
                if row.archive != archive or row.fingerprint != fingerprint:
                    raise HTTPException(409, "请求编号已用于另一行动或存档")
                return dict(status=row.status, response=row.response, seed=row.seed)
            saved = self.record(session, "archives", archive)
            if not saved or not saved.value:
                raise HTTPException(404, "存档不存在")
            logs = saved.value.get("data", {}).get("logs", []) if saved and saved.value else []
            # Actions refused while a turn waits are saved unanswered after it, so look past them.
            last_reply = next((log for log in reversed(logs) if log.get("type") == "ai"), None)
            if last_reply and last_reply.get("frxPending"):
                raise HTTPException(409, "上一回合仍待结算，请先重试结算或撤回")
            inflight = session.scalars(
                self.requests_of(archive).where(
                    CardRequest.status.in_(["generating", "ready", "repairing"])
                )
            ).all()
            for attempt in inflight:
                if attempt.status == "ready":
                    raise HTTPException(409, "已有完整回复等待恢复，请重新读取存档")
                if request_blocks_archive(attempt):
                    raise HTTPException(409, "此存档已有回合正在生成，请等待或停止后继续")
                if attempt.status == "repairing":
                    raise HTTPException(409, "上一回合仍待结算，请先重试结算或撤回")
                attempt.status = "expired"
            context = None
            if saved and saved.value:
                state = saved.value["data"]["state"]
                if "snapshot" in payload and payload["snapshot"] != state["currentState"]:
                    raise HTTPException(409, "当前页面状态已过期，请重新读档后行动")
                history = logs[:-1] if logs and logs[-1].get("type") == "user" else logs
                turn_action = payload.get("turn_action")
                if turn_action is None:
                    user_input = payload.get("user_input", "")
                    # Older card pages embed the current action after the assembled prompt.
                    marker = "{{setvar::玩家输入::"
                    if marker in user_input:
                        user_input = user_input.rsplit(marker, 1)[1].removesuffix("}}")
                    turn_action = {"text": user_input, "items": []}
                knowledge = (
                    self.setting_value(session, "CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2") or {}
                )
                context = {
                    "state": copy.deepcopy(state),
                    "turnAction": turn_action,
                    "pilot": pilot_flag(
                        self.setting_value(session, PILOT_SETTING),
                        saved.value,
                        archive,
                        default=pilot_default,
                    ),
                    "playerAvatar": self.setting_value(session, self.avatar_key(archive)),
                    "historyIds": [log.get("id") for log in history],
                    "userLogId": logs[-1].get("id")
                    if logs and logs[-1].get("type") == "user"
                    else None,
                    "knowledge": {
                        "knowledgeBaseEnabled": bool(knowledge.get("knowledgeBaseEnabled")),
                        "attachBiographyToSnapshot": knowledge.get(
                            "attachBiographyToSnapshot", True
                        ),
                        "worldBookSearchDepth": knowledge.get("worldBookSearchDepth", 5),
                    },
                }
                if payload.get("play_request") is not None:
                    # The new interface's request (words, option, action chips), so a retry
                    # after the turn's run is gone still sends the same.
                    context["playRequest"] = copy.deepcopy(payload["play_request"])
            seed = seed or self.new_seed()
            session.add(
                CardRequest(
                    user_id=self.user_id,
                    id=request_id,
                    archive=archive,
                    status="generating",
                    response="",
                    seed=seed,
                    fingerprint=fingerprint,
                    context=context,
                    lease_until=time.time() + GENERATION_LEASE_SECONDS,
                )
            )
            return dict(status="new", response="", seed=seed, context=copy.deepcopy(context))

    def set_route(self, request_id, path, plan):
        """Fix the settlement path at turn start; retries keep the same path."""
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if not row or row.status != "generating":
                raise HTTPException(409, "此回合已停止，请读取最新存档")
            row.context = {**(row.context or {}), "path": path, "pilotPlan": copy.deepcopy(plan)}

    def keep_commit_context(self, request_id, context):
        """Persist the log's presentation before the result becomes ready for commit."""
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if not row or row.status != "generating":
                raise HTTPException(409, "此回合已停止，请读取最新存档")
            row.context = {**(row.context or {}), "commit": copy.deepcopy(context)}

    def fail_request(self, request_id):
        """A turn that ended in an error without settling its request (the store itself failed,
        say) is failed, so the save is no longer shown in progress and the turn can be tried
        again. True when it changed anything."""
        with self.sessions.begin() as session:
            self.lock(session)
            row = self.attempt(session, request_id, lock=True)
            if row and row.status == "generating":
                row.status = "failed"
                row.lease_until = None
                return True
            return False

    def cancel_request(self, request_id):
        with self.sessions.begin() as session:
            self.lock(session)
            row = self.attempt(session, request_id, lock=True)
            if row and row.status in {"generating", "ready", "repairing"}:
                row.status = "pending" if row.status == "repairing" else "cancelled"
                row.lease_until = None
                return True
            return False

    def keep_block_ids(self, request_id, blocks):
        """The ids the new interface's finished turn gave its blocks, each with the block's type
        ([[id, type], …]), so the turn read back from the history has the same ones
        (play_blocks.history). False when the request is not there."""
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if row is None:
                return False
            row.context = {**(row.context or {}),
                           "blockIds": [[block["id"], block["type"]] for block in blocks]}
            return True

    def request(self, request_id):
        with self.sessions() as session:
            row = self.attempt(session, request_id)
            if not row:
                raise HTTPException(404, "回合请求不存在")
            return {
                "id": row.id,
                "archive": row.archive,
                "status": row.status,
                "response": row.response,
                "seed": row.seed,
                "settlement": copy.deepcopy(row.settlement),
                "context": copy.deepcopy(row.context),
                "lease_until": row.lease_until,
                "created_at": row.created_at,
            }

    def claim_retry(self, request_id):
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            expired = row and row.status == "repairing" and lease_expired(row)
            if not row or (row.status != "pending" and not expired):
                raise HTTPException(409, "结算已开始或此回合不再待结算")
            row.status = "repairing"
            row.lease_until = time.time() + REPAIR_LEASE_SECONDS
            return row.lease_until

    def release_retry(self, request_id, lease):
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if row and row.status == "repairing" and row.lease_until == lease:
                row.status = "pending"
                row.lease_until = None

    def record_repair(self, request_id, lease, response, errors):
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if (not row or row.status != "repairing" or row.lease_until != lease
                    or lease_expired(row)):
                raise HTTPException(409, "回合已回溯，修复结果未应用")
            row.settlement = {
                **(row.settlement or {}),
                "lastRepairResponse": response[:50000],
                "lastRepairErrors": copy.deepcopy(errors),
            }

    def commit_retry(self, request_id, version, result, lease, response=None):
        with self.sessions.begin() as session:
            self.lock(session)
            attempt = self.attempt(session, request_id, lock=True)
            if (not attempt or attempt.status != "repairing" or attempt.lease_until != lease
                    or lease_expired(attempt)):
                raise HTTPException(409, "结算请求已变化，迟到结果未写入")
            row = self.record(session, "archives", attempt.archive, lock=True)
            if not row or not row.value or row.version != version:
                raise HTTPException(409, "修复期间存档已变化，请重新读取")
            value = copy.deepcopy(row.value)
            final = value["data"]["logs"][-1]
            if final.get("frxRequestId") != request_id or not final.get("frxPending"):
                raise HTTPException(409, "此回合已不再等待结算")
            self.apply_settlement(session, row, value, attempt, result)
            row.value = value
            row.version += 1
            attempt.lease_until = None
            if response is not None:
                attempt.response = response
            envelope = self.envelope(row)
            self.materialize(session, envelope["value"])
            return {**envelope, "authoritative": True}

    def finish_variables(self, request_id, result):
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if (
                not row
                or row.status != "ready"
                or not (row.settlement or {}).get("awaitingVariables")
            ):
                raise HTTPException(409, "本回合已结算或回溯，迟到变量未写入")
            row.settlement = copy.deepcopy(result)

    def record_after_turn(self, request_id, job, message):
        """Keep the error of a job after the turn (memory archiving, summaries, the daily paper,
        world evolution) with the turn's request; the turn itself stays as it was."""
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if not row:
                raise HTTPException(404, "回合请求不存在")
            settlement = row.settlement or {}
            kept = [e for e in settlement.get("afterTurnErrors", []) if e.get("job") != job]
            row.settlement = {
                **settlement,
                "afterTurnErrors": [*kept, {"job": job, "message": message, "at": now()}],
            }

    def finish_request(self, request_id, response, status, settlement=None):
        with self.sessions.begin() as session:
            row = self.attempt(session, request_id, lock=True)
            if not row or row.status != "generating" or lease_expired(row):
                return False
            row.response = response
            row.status = status
            row.settlement = settlement
            row.lease_until = None
            return True
