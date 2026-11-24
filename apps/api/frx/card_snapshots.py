"""Lossless, bounded full-state snapshots; old plain snapshots stay readable."""

import base64
import hashlib
import json
import zlib

from fastapi import HTTPException

LIMIT = 32 * 1024 * 1024
CODEC = "frx-json-zlib-v1"


def pack_snapshot(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if len(raw) < 12000:
        return value
    return {
        "codec": CODEC,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "data": base64.b64encode(zlib.compress(raw)).decode(),
    }


def unpack_snapshot(value):
    if not isinstance(value, dict) or value.get("codec") != CODEC:
        return value
    try:
        compressed = base64.b64decode(value["data"], validate=True)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, LIMIT + 1)
        if len(raw) > LIMIT or not decoder.eof or decoder.unused_data:
            raise ValueError
        if hashlib.sha256(raw).hexdigest() != value["sha256"]:
            raise ValueError
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except (KeyError, TypeError, ValueError, zlib.error):
        raise HTTPException(422, "完整状态快照损坏或超过解压上限") from None


def holds(value, needle):
    """Whether a packed snapshot's JSON holds `needle` (bytes), read without parsing it; a value
    that does not unpack whole or does not match its sha256 is said to hold it, so whoever asks
    unpacks it and meets the error."""
    try:
        decoder = zlib.decompressobj()
        raw = decoder.decompress(base64.b64decode(value["data"], validate=True), LIMIT + 1)
        if len(raw) > LIMIT or not decoder.eof or decoder.unused_data:
            return True
        if hashlib.sha256(raw).hexdigest() != value["sha256"]:
            return True
    except (KeyError, TypeError, ValueError, zlib.error):
        return True
    return needle in raw


REFERENCE = "frx-ref-v1"


def reference_snapshot(logs, packed, field="frxStateSnapshot"):
    """Point at the latest earlier round when it holds the very same packed snapshot.

    A turn's before-state is usually the state the previous turn ended with; storing a
    second copy of it made every turn about 35 KB larger.
    """
    if not isinstance(packed, dict) or packed.get("codec") != CODEC:
        return packed
    for log in reversed(logs):
        held = log.get(field)
        # one kept beside the save (KEPT) is the very same snapshot, by its digest
        if isinstance(held, dict) and held.get("codec") in {CODEC, KEPT}:
            if held.get("sha256") == packed["sha256"]:
                return {
                    "codec": REFERENCE,
                    "log": log.get("id"),
                    "field": field,
                    "sha256": packed["sha256"],
                }
            break
    return packed


# The server's own snapshots of a round (the state at its end and at its start, for 撤回, 回到某回合
# and the history): the engine never reads them, so an engine call is sent the save with a marker
# the size of a word in their place, and a save it returns gets them back where the markers are.
# On a long save they are nine tenths of its bytes, which every call serialized and the engine
# parsed (batch 8: CPU per decision grew with the history). The marker keeps the field where it was
# among the round's keys, and the engine moves or copies it as it would the snapshot: a save comes
# back key order and all, as the old page's writes are compared (tests/test_play_actions.py).
SERVER_FIELDS = ("frxStateSnapshot", "frxBeforeSnapshot")
HELD = "frx-held-v1"
# The tables of a round as the old page kept them (a JSON string, a third of a long save's bytes)
# go the same way, a string marker in their place, but where the engine reads them: the first
# round's (core/death.cjs starts a save over from it) and the rounds near the end and near the
# round an after-turn job is for (core/archive.cjs: when and where a turn it keeps a memory of
# ended, that turn and up to six before it).
TABLES = "stateSnapshot"
NEAR = 40


def engine_payload(payload):
    """The payload as the engine is sent it, and the snapshots held back from its save (by the
    round's place in its logs), or None when there were none. The payload itself is not changed."""
    archive = payload.get("archive") if isinstance(payload, dict) else None
    data = archive.get("data") if isinstance(archive, dict) else None
    logs = data.get("logs") if isinstance(data, dict) else None
    if not isinstance(logs, list):
        return payload, None
    scope = payload.get("scope") if isinstance(payload.get("scope"), dict) else {}
    job = {payload.get("logId"), scope.get("log_id")} - {None}
    kept = {0, *range(len(logs) - NEAR, len(logs))}
    for at, log in enumerate(logs):
        if isinstance(log, dict) and log.get("id") in job:
            kept.update(range(at - NEAR, at + 1))
    held, lean = {}, []
    for at, log in enumerate(logs):
        if not isinstance(log, dict):
            lean.append(log)
            continue
        fields = [field for field in SERVER_FIELDS if field in log]
        if at not in kept and isinstance(log.get(TABLES), str) and len(log[TABLES]) > len(HELD) * 4:
            fields.append(TABLES)
        if not fields:
            lean.append(log)
            continue
        held[at] = {field: log[field] for field in fields}
        lean.append({key: (f"{HELD}:{at}" if key == TABLES else {"codec": HELD, "at": at})
                     if key in fields else value for key, value in log.items()})
    if not held:
        return payload, None
    return {**payload, "archive": {**archive, "data": {**data, "logs": lean}}}, held


def held_at(marker, field):
    """The round a marker stands for, or None when the value is no marker."""
    if field == TABLES:
        if isinstance(marker, str) and marker.startswith(HELD + ":"):
            at = marker[len(HELD) + 1:]
            return int(at) if at.isdigit() else -1
        return None
    if isinstance(marker, dict) and marker.get("codec") == HELD:
        return marker.get("at") if isinstance(marker.get("at"), int) else -1
    return None


def engine_result(result, held):
    """A result of the engine with the held-back snapshots back on the save it returns, each in
    place of its marker; a marker that holds nothing goes (it never does)."""
    archive = result.get("archive") if held and isinstance(result, dict) else None
    data = archive.get("data") if isinstance(archive, dict) else None
    for log in (data.get("logs") if isinstance(data, dict) else None) or []:
        if not isinstance(log, dict):
            continue
        for field in (*SERVER_FIELDS, TABLES):
            at = held_at(log.get(field), field)
            if at is None:
                continue
            value = held.get(at, {}).get(field)
            if value is None:
                del log[field]
            else:
                log[field] = value
    return result


# Lean engine projections use a stub for snapshots stored in the snapshots domain table.
# Full reads resolve log_snapshot_refs within the same transaction (撤回, 回到某回合, history,
# backups). `bytes` lets a projected save still account for the omitted payload size.
KEPT = "frx-kept-v1"


def kept(packed):
    """The stub a round keeps for a packed snapshot kept beside the save."""
    return {"codec": KEPT, "sha256": packed["sha256"], "bytes": len(packed.get("data") or "")}


# A long life save's older rounds keep their tables (TABLES, the old page's JSON string, a third of
# its bytes) beside it the same way, as TEXT rows. What a turn reads of every round is the names
# its people table held (play_blocks.met_names, the entrances), all of them together: the stub
# holds the names met first in that round (`met`, none an earlier round held), so every name is in
# the stub of the round it first came in, or in a round's tables still in its round. The first
# round's and the last NEAR rounds' stay where they are: a turn reads the latest turns' time and
# place, and the engine the first round's and the latest ones' (engine_payload).
TEXT = "frx-text-v1"
TABLES_FROM = 2048


def text_digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def kept_tables(text, digest, met):
    """The stub a round keeps for its tables kept beside the save, with the names met first in
    that round."""
    return {"codec": KEPT, "sha256": digest,
            "bytes": len(json.dumps(text, ensure_ascii=False).encode()), "met": sorted(met)}


def keeps_tables(logs, at):
    """Whether the round at `at` of these logs keeps its tables beside the save."""
    return 0 < at < len(logs) - NEAR


def is_kept(value):
    return isinstance(value, dict) and value.get("codec") == KEPT and bool(value.get("sha256"))


def kept_bytes(value):
    """The bytes of the snapshots a save keeps beside it (its stubs' data), for its size."""
    data = value.get("data") if isinstance(value, dict) else None
    logs = data.get("logs") if isinstance(data, dict) else None
    total = 0
    for log in logs or []:
        for field in (*SERVER_FIELDS, TABLES):
            held = log.get(field) if isinstance(log, dict) else None
            if is_kept(held):
                total += int(held.get("bytes") or 0)
    return total


def resolve_snapshot(logs, value):
    """The snapshot itself, following a reference; None when the referenced round is gone.

    The referenced round is never edited after a later turn commits; a backup restore may
    re-pack it with rewritten media paths, which changes its hash but not the state.
    """
    if isinstance(value, dict) and value.get("codec") == REFERENCE:
        log = next((item for item in logs if item.get("id") == value.get("log")), None)
        held = log.get(value.get("field")) if log else None
        if not isinstance(held, dict) or not held:
            return None
        return unpack_snapshot(held)
    return unpack_snapshot(value)
