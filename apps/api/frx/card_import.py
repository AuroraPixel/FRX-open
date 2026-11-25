"""The current save-file contract, with explicit archive, log and snapshot domains.

Only frx-save/v1 is accepted. The engine's document is an internal projection, not an upload
format; original-card files and previous backups are deliberately not converted.
"""

import copy
import hashlib
import json

from fastapi import HTTPException

from .card_snapshots import CODEC, is_kept, unpack_snapshot
from .save_schema import SNAPSHOT_FIELDS as STORED_SNAPSHOT_FIELDS

FORMAT = "frx-save"
VERSION = 1
LIMIT = 64 * 1024 * 1024
SNAPSHOT_FIELDS = frozenset(STORED_SNAPSHOT_FIELDS)
DOCUMENT_FIELDS = {"archive", "state", "logs", "snapshots", "snapshotRefs"}
SAVE_FIELDS = DOCUMENT_FIELDS | {
    "format", "version", "memories", "art", "places", "requests", "media",
}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def write_payload(payload, target, limit, too_large):
    """Write bounded UTF-8 JSON and return the size and digest of the bytes written."""
    hashed = hashlib.sha256()
    buffer = bytearray()
    encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"))
    for part in encoder.iterencode(payload):
        buffer.extend(part.encode())
        if target.tell() + len(buffer) > limit:
            raise HTTPException(413, too_large)
        if len(buffer) >= 256 * 1024:
            hashed.update(buffer)
            target.write(buffer)
            buffer.clear()
    hashed.update(buffer)
    target.write(buffer)
    return {"sha256": hashed.hexdigest(), "bytes": target.tell()}



def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def invalid(message="存档格式无效；仅支持当前版本的 FRX 存档"):
    return HTTPException(422, message)


def document_of(value):
    """Split the engine projection into the file's explicit domains."""
    data = value["data"]
    logs, snapshots, references = [], {}, []
    for index, source in enumerate(data.get("logs", [])):
        log = copy.deepcopy(source)
        for field in SNAPSHOT_FIELDS:
            if field not in log:
                continue
            held = log.pop(field)
            if is_kept(held):
                raise invalid("完整状态快照缺失，导出未生成")
            if isinstance(held, dict) and held.get("codec") == CODEC:
                unpack_snapshot(held)  # Reject corrupt compressed snapshots before exporting.
            identity = digest(held)
            snapshots.setdefault(identity, held)
            references.append({"log": index, "field": field, "snapshot": identity})
        logs.append(log)
    return {
        "archive": {
            "id": data["archiveId"], "name": value["name"],
            "attributes": {key: copy.deepcopy(item) for key, item in value.items()
                           if key not in {"name", "data"}},
            "metadata": {key: copy.deepcopy(item) for key, item in data.items()
                         if key not in {"archiveId", "state", "logs"}},
        },
        "state": copy.deepcopy(data["state"]), "logs": logs,
        "snapshots": snapshots, "snapshotRefs": references,
    }


def archive_of(document):
    """Validate and assemble one current document; unresolved references never escape."""
    try:
        if not DOCUMENT_FIELDS.issubset(document):
            raise ValueError
        archive = document["archive"]
        if set(archive) != {"id", "name", "attributes", "metadata"}:
            raise ValueError
        if not isinstance(archive["id"], str) or not 0 < len(archive["id"]) <= 300:
            raise ValueError
        if not isinstance(archive["name"], str) or not 0 < len(archive["name"]) <= 300:
            raise ValueError
        if not isinstance(archive["attributes"], dict) or not isinstance(archive["metadata"], dict):
            raise ValueError
        if {"name", "data", "user_id"} & archive["attributes"].keys():
            raise ValueError
        if {"archiveId", "state", "logs", "user_id"} & archive["metadata"].keys():
            raise ValueError
        state, logs = document["state"], document["logs"]
        if not isinstance(state, dict) or not isinstance(state.get("currentState"), dict):
            raise ValueError
        if not isinstance(logs, list) or len(logs) > 100000:
            raise ValueError
        if any(not isinstance(log, dict) or SNAPSHOT_FIELDS & log.keys() for log in logs):
            raise ValueError
        snapshots, references = document["snapshots"], document["snapshotRefs"]
        if not isinstance(snapshots, dict) or not isinstance(references, list):
            raise ValueError
        for identity, held in snapshots.items():
            if identity != digest(held) or is_kept(held):
                raise ValueError
            if isinstance(held, dict) and held.get("codec") == CODEC:
                unpack_snapshot(held)
        used, slots = set(), set()
        logs = copy.deepcopy(logs)
        for ref in references:
            if set(ref) != {"log", "field", "snapshot"}:
                raise ValueError
            index, field, identity = ref["log"], ref["field"], ref["snapshot"]
            if (type(index) is not int or not 0 <= index < len(logs)
                    or field not in SNAPSHOT_FIELDS or identity not in snapshots
                    or (index, field) in slots):
                raise ValueError
            slots.add((index, field))
            used.add(identity)
            logs[index][field] = copy.deepcopy(snapshots[identity])
        if used != snapshots.keys():
            raise ValueError
        return {
            **copy.deepcopy(archive["attributes"]), "name": archive["name"],
            "data": {**copy.deepcopy(archive["metadata"]), "archiveId": archive["id"],
                     "state": copy.deepcopy(state), "logs": logs},
        }
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, AttributeError):
        raise invalid("存档领域数据或快照引用无效，没有写入存档") from None


def read_save(raw):
    if len(raw) > LIMIT:
        raise HTTPException(413, "存档文件超过64MB")
    try:
        package = json.loads(raw)
        if (not isinstance(package, dict) or set(package) != SAVE_FIELDS
                or package["format"] != FORMAT or package["version"] != VERSION):
            raise ValueError
        archive_of(package)
        return package
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError):
        raise invalid() from None


def preview_save(raw):
    package = read_save(raw)
    from .card_backup import read_media, validate_package

    validate_package(package)
    read_media(package)
    archive = archive_of(package)
    state = archive["data"]["state"]["currentState"]
    return {
        "name": archive["name"], "logs": len(package["logs"]),
        "characters": len(state.get("0", {})), "items": len(state.get("1", {})),
        "digest": hashlib.sha256(raw).hexdigest(),
        "includes": ["当前状态", "剧情日志与快照", "记忆", "人物形象", "地点", "回合记录"],
        "excludes": ["用户账号", "全局设置", "模型密钥"],
    }
