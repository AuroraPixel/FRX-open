"""Restore a complete turn boundary with scoped memory cleanup: taking back the last turn (undo)
and going back to a turn's snapshot.

An undo still notes what it removed on the request of the last turn it took back (context.undo,
frxUndoRequestId on the save); only the old page's redo read it, and backups carry it as they
always have.
"""

import copy
import json
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException

from .card_snapshots import resolve_snapshot, unpack_snapshot
from .card_store import CardRequest, state_digest
from .request_policy import request_blocks_archive

COMPRESSED = "最新回合已被深度总结压缩，请先展开对应总结，再撤回回合"


def epoch(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 10**11 else value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


class CardTimeline:
    def __init__(self, records):
        self.records = records

    def row(self, session, name, version):
        self.records.lock(session)
        row = self.records.record(session, "archives", name, lock=True)
        if not row or not row.value:
            raise HTTPException(404, "存档不存在")
        # the round snapshots a life save keeps beside it are read here (撤回, 回到某回合): the
        # row's value as it always was, in a copy, and kept beside it again when written
        row.full = self.records.materialize(session, copy.deepcopy(row.value))
        if row.version != version:
            raise HTTPException(409, "存档已变化，请重新读取后回溯")
        inflight = session.scalars(
            self.records.requests_of(name).where(CardRequest.status.in_(["generating", "ready"]))
        ).all()
        if any(request_blocks_archive(request) for request in inflight):
            raise HTTPException(409, "回合正在生成或结算，请先等待完成或停止")
        return row

    @staticmethod
    def log_snapshot(value, index):
        log = value["data"]["logs"][index]
        if isinstance(log.get("frxStateSnapshot"), dict):
            return copy.deepcopy(unpack_snapshot(log["frxStateSnapshot"]))
        try:
            tables = log["stateSnapshot"]
            tables = json.loads(tables) if isinstance(tables, str) else tables
            if not isinstance(tables, dict):
                raise ValueError
            tables = tables.get("currentState", tables)
        except (KeyError, ValueError, TypeError):
            raise HTTPException(422, "所选快照格式无效") from None
        state = copy.deepcopy(value["data"]["state"])
        state["currentState"] = tables
        if "worldMapSnapshot" in log:
            state["worldMap"] = copy.deepcopy(log["worldMapSnapshot"])
        biographies = {}
        for previous in value["data"]["logs"][: index + 1]:
            for entry in previous.get("biographySnapshot") or []:
                key = entry.get("key") or entry.get("title") or entry.get("id")
                if entry.get("_deleted"):
                    biographies.pop(key, None)
                elif key:
                    biographies[key] = copy.deepcopy(entry)
        state["worldBookEntries"] = list(biographies.values())
        papers = [
            entry["dailyPaperHtml"]
            for entry in value["data"]["logs"][: index + 1]
            if entry.get("dailyPaperHtml")
        ]
        state["latestDailyPaper"] = papers[-1] if papers else None
        state["activeTheaterHTML"] = papers[-1] if papers else None
        return {"state": state}

    def restore(self, session, row, snapshot, count):
        value = copy.deepcopy(row.full)
        logs = value["data"]["logs"]
        removed = logs[count:]
        avatar_key = self.records.avatar_key(row.key)
        after_avatar = self.records.setting_value(session, avatar_key)
        ids = {log.get("frxRequestId") for log in removed} - {None}
        requests = (
            session.scalars(
                self.records.requests_of().where(CardRequest.id.in_(ids)).with_for_update()
            ).all()
            if ids
            else []
        )
        statuses = [{"request_id": r.id, "status": r.status} for r in requests]
        by_id = {r.id: r for r in requests}
        carrier = next(
            (by_id[entry["frxRequestId"]] for entry in reversed(removed)
             if entry.get("frxRequestId") in by_id),
            None,
        )
        undo = {
            "removedLogs": copy.deepcopy(removed),
            "stateAfter": copy.deepcopy(value["data"]["state"]),
            "playerAvatarAfter": after_avatar,
            "prefixIds": [entry.get("id") for entry in logs[:count]],
            "requestStatuses": statuses,
            "vectors": [],
        }
        for request in requests:
            if request.archive != row.key:
                raise HTTPException(409, "回合记录的存档归属不一致")
            request.status = "undone"
            request.lease_until = None
        cutoff = next(
            (
                epoch(log.get("timestamp"))
                for log in removed
                if epoch(log.get("timestamp")) is not None
            ),
            None,
        )
        archive_ids = {
            value["data"].get("archiveId"),
            value["data"]["state"].get("archiveId"),
            row.key,
        } - {None}
        if cutoff is not None:
            # This user's memories bound to this save, read by the archive_id column.
            for vector in session.scalars(
                self.records.memories_of(archive_ids).with_for_update()
            ):
                item = vector.value
                if (
                    not item
                    or item.get("scope") == "global"
                    or item.get("archiveId") not in archive_ids
                ):
                    continue
                stamp = epoch(item.get("timestamp"))
                retired = epoch(item.get("outdatedTimestamp"))
                future = stamp is not None and stamp >= cutoff
                if future or (retired is not None and retired >= cutoff):
                    restored = None if future else {
                        key: val for key, val in item.items() if key != "outdatedTimestamp"
                    }
                    undo["vectors"].append(
                        {
                            "key": vector.key,
                            "value": copy.deepcopy(item),
                            "version": vector.version + 1,
                            "postimage": copy.deepcopy(restored),
                        }
                    )
                    vector.value = restored
                    vector.version += 1
        value["data"]["state"] = copy.deepcopy(snapshot["state"])
        value["data"]["logs"] = logs[:count]
        value["data"]["frxTimelineEpoch"] = str(uuid4())
        if "playerAvatar" in snapshot:
            self.records.save_setting(session, avatar_key, snapshot["playerAvatar"])
        if carrier:
            undo["stateHash"] = state_digest(value["data"]["state"])
            carrier.context = {**(carrier.context or {}), "undo": undo}
            value["data"]["frxUndoRequestId"] = carrier.id
        else:
            value["data"].pop("frxUndoRequestId", None)
        row.value = value
        row.version += 1
        envelope = self.records.envelope(row)
        self.records.materialize(session, envelope["value"])
        return envelope

    def restore_snapshot(self, name, version, log_id):
        with self.records.sessions.begin() as session:
            row = self.row(session, name, version)
            index = next(
                (i for i, entry in enumerate(row.full["data"]["logs"])
                 if entry.get("id") == log_id),
                None,
            )
            if index is None:
                raise HTTPException(404, "快照不存在")
            return self.restore(session, row, self.log_snapshot(row.full, index), index + 1)

    def restore_turn(self, session, row, snapshot, count):
        # A memory backup can sit after this turn while referring to an older,
        # still-present summary. Keep that backup with its summary on undo.
        logs = row.full["data"]["logs"]
        deep_ids = {log.get("id") for log in logs[:count] if log.get("isDeepSummary")}
        carried = []
        for log in logs[count:]:
            if not log.get("isUndoSnapshot"):
                continue
            before_ids = {item.get("id") for item in log.get("snapshotOfLogs", [])}
            if log.get("summaryLogId") in deep_ids or deep_ids - before_ids:
                carried.append(log)
        if carried:
            value = copy.deepcopy(row.full)
            ids = {log["id"] for log in carried}
            later = [log for log in logs[count:] if log.get("id") not in ids]
            value["data"]["logs"] = [*logs[:count], *carried, *later]
            row.full = value
            count += len(carried)
        return self.restore(session, row, snapshot, count)

    def undo(self, name, version):
        with self.records.sessions.begin() as session:
            row = self.row(session, name, version)
            logs = row.full["data"]["logs"]
            index = next(
                (i for i in range(len(logs) - 1, -1, -1) if logs[i].get("type") == "ai"
                 and not logs[i].get("isGhost") and not logs[i].get("isDeepSummary")), None
            )
            if index is None:
                if any(item.get("isDeepSummary") for item in logs):
                    raise HTTPException(409, COMPRESSED)
                raise HTTPException(409, "没有可撤回的AI回合")
            log = logs[index]
            latest = session.scalars(self.records.requests_of(name).where(
                CardRequest.status.in_(["committed", "pending", "repairing"])
            ).order_by(CardRequest.created_at.desc())).first()
            if latest:
                latest_index = next(
                    (i for i, item in enumerate(logs) if item.get("frxRequestId") == latest.id),
                    None,
                )
                if latest_index is None:
                    raise HTTPException(409, COMPRESSED)
                if latest_index != index:
                    raise HTTPException(409, "最新回合的日志顺序已变化，请使用人生快照回溯")
            attempt = (
                self.records.attempt(session, log.get("frxRequestId"))
                if log.get("frxRequestId")
                else None
            )
            context = attempt.context if attempt else None
            if context and "state" in context:
                prefix = context.get("historyIds", [])
                if [entry.get("id") for entry in logs[: len(prefix)]] != prefix:
                    # Compression/expansion changes old IDs without changing this
                    # turn's frozen pre-state. Undo only its adjacent user/AI pair.
                    if (not index or logs[index - 1].get("type") != "user"
                            or (context.get("userLogId")
                                and logs[index - 1].get("id") != context["userLogId"])
                            or any(item.get("type") in {"user", "ai"} for item in logs[index + 1:])
                            or (latest and latest.created_at > attempt.created_at)):
                        raise HTTPException(
                            409, "回合边界不完整，请先展开对应总结或使用人生快照回溯"
                        )
                    count = index - 1
                else:
                    count = len(prefix)
                return self.restore_turn(
                    session,
                    row,
                    {"state": context["state"], "playerAvatar": context.get("playerAvatar")},
                    count,
                )
            before = (
                resolve_snapshot(logs, log.get("frxBeforeSnapshot"))
                if log.get("frxBeforeSnapshot") else None
            )
            if before is not None:
                count = index - 1 if index and logs[index - 1].get("type") == "user" else index
                return self.restore_turn(session, row, before, count)
            previous = next(
                (i for i in range(index - 1, -1, -1) if logs[i].get("stateSnapshot")), None
            )
            if previous is None:
                raise HTTPException(409, "旧档没有更早快照，无法安全撤回")
            return self.restore(session, row, self.log_snapshot(row.full, previous), previous + 1)
