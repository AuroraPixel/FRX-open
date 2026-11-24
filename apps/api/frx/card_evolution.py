"""Atomic, scoped background results; preserve full NPC history on failed runs."""

import copy
import json
import re
from uuid import uuid4

from fastapi import HTTPException

from .card_snapshots import pack_snapshot
from .card_store import CardRequest
from .storage import now


def summaries_from_reply(raw, biographies, targets):
    without_commands = re.sub(r"<upstore>[\s\S]*?</upstore>", "", raw, flags=re.I)
    fenced = re.findall(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", without_commands, re.I)
    array = re.search(r"(\[[\s\S]*\])", without_commands)
    try:
        if not fenced and not array:
            raise ValueError
        entries = (
            [entry for block in fenced for entry in json.loads(block)]
            if fenced
            else json.loads(array[1])
        )
        if not isinstance(entries, list) or len(entries) > 100:
            raise ValueError
        by_id = {b["key"]: b for b in biographies if b.get("key") in targets}
        result = []
        for entry in entries:
            title = entry.get("title", entry.get("name"))
            key = entry.get("id")
            if key not in by_id:
                matches = [i for i, b in by_id.items() if b.get("title") == title]
                if len(matches) != 1:
                    raise ValueError
                key = matches[0]
            text = entry.get("new_entry", entry.get("story"))
            if not isinstance(text, str) or not text.strip() or len(text) > 15000:
                raise ValueError
            result.append({"id": key, "text": text})
        return result
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(422, "人物履历格式或目标身份无效，原传记已保留") from None


def save_evolution(records, scope, expected_bios, result, raw, origin_state):
    if result.get("errors"):
        raise HTTPException(422, "演化指令无效，原传记已保留：" + str(result["errors"][0])[:300])
    with records.sessions.begin() as session:
        records.lock(session)
        records.validate_scope(session, scope)
        row = records.record(session, "archives", scope["archive"], lock=True)
        value = copy.deepcopy(row.value)
        state = value["data"]["state"]
        if state.get("worldBookEntries", []) != expected_bios or any(
            state["currentState"].get(k) != origin_state.get(k) for k in ("0", "4")
        ):
            raise HTTPException(409, "演化期间人物或时间已变化，结果未覆盖当前状态")
        ensure_current_round(records, session, scope, value)
        by_id = {b.get("key", b.get("title")): b for b in state.get("worldBookEntries", [])}
        for bio in result["biographies"]:
            by_id[bio["key"]] = bio
        state["worldBookEntries"] = list(by_id.values())
        if result.get("npcAvatars"):
            state["npcAvatars"] = {**state.get("npcAvatars", {}), **result["npcAvatars"]}
        runs = state.setdefault("evolutionRuns", [])
        runs.append(
            {
                "id": str(uuid4()),
                "timestamp": now(),
                "logId": scope.get("log_id"),
                "gameTime": (state["currentState"].get("4") or [{}])[0].get("0", ""),
                "raw": raw,
                "beforeBiographies": copy.deepcopy(expected_bios),
                "sourceBiographies": copy.deepcopy(result.get("sourceBiographies", expected_bios)),
                "updatedIds": [b["key"] for b in result["biographies"]],
            }
        )
        state["evolutionRuns"] = runs[-20:]
        update_round_snapshot(records, session, value, scope)
        row.value = value
        row.version += 1
        # the save as it always came back: its rounds whole (a copy: the row is flushed as is)
        envelope = records.envelope(row)
        records.materialize(session, envelope["value"])
        return envelope


def ensure_current_round(records, session, scope, value):
    logs = value["data"].get("logs", [])
    if scope.get("log_id") and (not logs or logs[-1].get("id") != scope["log_id"]):
        raise HTTPException(409, "已经进入下一回合，旧演化结果未应用")
    active = session.scalars(
        records.requests_of(scope["archive"]).where(
            CardRequest.status.in_(["generating", "ready", "repairing"])
        )
    ).first()
    if active:
        raise HTTPException(409, "已有回合正在生成，请在回合结束后演化")


def update_round_snapshot(records, session, value, scope):
    logs = value["data"].get("logs", [])
    log = next((entry for entry in logs if entry.get("id") == scope.get("log_id")), None)
    if log and log.get("type") == "ai":
        state = value["data"]["state"]
        log["biographySnapshot"] = copy.deepcopy(state.get("worldBookEntries", []))
        log["stateSnapshot"] = json.dumps(state["currentState"], ensure_ascii=False)
        log["frxStateSnapshot"] = pack_snapshot(
            {
                "state": copy.deepcopy(state),
                "playerAvatar": records.setting_value(
                    session, records.avatar_key(scope["archive"])
                ),
            }
        )
