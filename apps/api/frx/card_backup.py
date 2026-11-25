"""Current domain backups. Restore creates copies owned by the calling user.

frx-backup/v2 has archive packages, user settings and shared memories; it has no generic
collection/key/value records and never imports accounts or converts previous file formats.
"""

import base64
import copy
import hashlib
import io
import json
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import HTTPException

from .card_import import (
    FORMAT as SAVE_FORMAT,
)
from .card_import import (
    SAVE_FIELDS,
    archive_of,
    document_of,
    encoded,
    invalid,
    write_payload,
)
from .card_media import ADDRESS, CardMedia
from .card_settings import browser_setting, without_credentials
from .card_snapshots import CODEC, pack_snapshot, unpack_snapshot
from .card_store import CardRequest, state_digest
from .play_places import PlaceBook, check_rows
from .save_schema import Archive
from .storage import now

FORMAT = "frx-backup"
VERSION = 2
LIMIT = 256 * 1024 * 1024
PLAY_ART = "play_art"
PLACE_LOOKS = "place_looks"
AVATAR = "CULTIVATION_CUSTOM_AVATAR_V1_"
KNOWLEDGE = "CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2"
MEDIA_REF = re.compile(re.escape(ADDRESS) + r"([0-9a-f]{64}\.(?:png|jpg|gif|webp))")
REQUEST_FIELDS = [name for name in CardRequest.__table__.columns.keys() if name != "user_id"]
TERMINAL = {"pending", "committed", "failed", "cancelled", "expired", "undone"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def media_refs(value):
    if isinstance(value, dict):
        if value.get("codec") == CODEC:
            yield from media_refs(unpack_snapshot(value))
        else:
            for item in value.values():
                yield from media_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from media_refs(item)
    elif isinstance(value, str):
        yield from MEDIA_REF.findall(value)


def settings_revision(rows):
    return state_digest({row.key: row.version for row in rows})


def merge_archive_preferences(current, incoming, restored_ids, replace):
    """A restored archive keeps its own recall preferences even when user settings stay put."""
    if not isinstance(current, dict) or not isinstance(incoming, dict):
        raise invalid("记忆设置格式无效")
    kept = copy.deepcopy(incoming if replace else current)
    buckets = {}
    for source in (current, incoming):
        entries = source.get("archiveFolderSettings", [])
        if not isinstance(entries, list):
            raise invalid("存档记忆设置格式无效")
        for entry in entries:
            if (not isinstance(entry, dict) or not isinstance(entry.get("archiveId"), str)
                    or not isinstance(entry.get("folders", {}), dict)):
                raise invalid("存档记忆设置格式无效")
            if source is current or entry["archiveId"] in restored_ids:
                buckets[entry["archiveId"]] = copy.deepcopy(entry)
    if buckets:
        kept["archiveFolderSettings"] = list(buckets.values())
    return kept


def _rows(records, session, kind):
    return list(session.scalars(records.records_of(kind)))


def package_of(records, session, row):
    """Read every domain of one save in the caller's consistent, locked transaction."""
    from .request_policy import request_blocks_archive

    value = records.materialize(session, copy.deepcopy(row.value))
    if value is None:
        raise HTTPException(404, "存档不存在")
    identity = value["data"]["archiveId"]
    requests = []
    for request in session.scalars(records.requests_of(value["name"])):
        if request_blocks_archive(request):
            raise HTTPException(409, "请先完成或停止当前回合，再导出存档")
        held = {name: copy.deepcopy(getattr(request, name)) for name in REQUEST_FIELDS}
        if held["status"] == "generating":
            held["status"] = "expired"
        elif held["status"] == "repairing":
            held["status"] = "pending"
        held["lease_until"] = None
        requests.append(held)
    art = records.record(session, "play_art", identity)
    art_value = copy.deepcopy(art.value) if art is not None and art.value else {}
    art_value.pop("archiveId", None)
    memories = [copy.deepcopy(memory.value) for memory in session.scalars(
        records.memories_of([identity])) if memory.value is not None]
    package = {
        "format": SAVE_FORMAT, "version": 1, **document_of(value),
        "memories": memories, "art": art_value,
        "places": PlaceBook(records).rows_of({identity}, session), "requests": requests,
        "media": {},
    }
    validate_package(package)
    return package


def validate_memories(values, archive_id=None):
    if not isinstance(values, list) or len(values) > 100000:
        raise invalid()
    seen = set()
    for value in values:
        if not isinstance(value, dict) or "user_id" in value:
            raise invalid()
        key = value.get("id")
        if type(key) not in (str, int) or not 0 < len(str(key)) <= 300 or str(key) in seen:
            raise invalid("记忆标识无效或重复")
        seen.add(str(key))
        if archive_id is not None:
            if value.get("archiveId") != archive_id or value.get("scope") == "global":
                raise invalid("记忆不属于文件中的存档")
        elif value.get("archiveId") is not None:
            raise invalid("共享记忆不能绑定文件之外的存档")


def validate_package(package):
    try:
        if (set(package) != SAVE_FIELDS or package["format"] != SAVE_FORMAT
                or package["version"] != 1):
            raise ValueError
        value = archive_of(package)
        if not isinstance(package["media"], dict):
            raise ValueError
        identity = value["data"]["archiveId"]
        validate_memories(package["memories"], identity)
        if not check_rows(package["places"], {identity}):
            raise ValueError
        art = package["art"]
        if not isinstance(art, dict) or {"user_id", "archiveId"} & art.keys():
            raise ValueError
        from .play_art import check_recipe

        for field in ("portraits", "portraitsByName"):
            entries = art.get(field, {})
            if not isinstance(entries, dict):
                raise ValueError
            for key, entry in entries.items():
                if (not isinstance(key, str) or len(key) > 300 or not isinstance(entry, dict)
                        or not isinstance(entry.get("recipe"), dict)
                        or check_recipe(entry["recipe"]) is not None):
                    raise ValueError
        requests = package["requests"]
        if not isinstance(requests, list) or len(requests) > 100000:
            raise ValueError
        seen = set()
        for request in requests:
            if not isinstance(request, dict) or set(request) != set(REQUEST_FIELDS):
                raise ValueError
            UUID(request["id"])
            if request["id"] in seen or request["archive"] != value["name"]:
                raise ValueError
            seen.add(request["id"])
            if (request["status"] not in TERMINAL or request["lease_until"] is not None
                    or not isinstance(request["response"], str)
                    or not isinstance(request["seed"], str) or len(request["seed"]) > 64
                    or not isinstance(request["fingerprint"], str)
                    or len(request["fingerprint"]) > 64):
                raise ValueError
            if any(request[key] is not None and not isinstance(request[key], dict)
                   for key in ("context", "settlement")):
                raise ValueError
            datetime.fromisoformat(request["created_at"])
        for log in value["data"]["logs"]:
            if log.get("frxRequestId") and log["frxRequestId"] not in seen:
                raise ValueError
        return value
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, AttributeError):
        raise invalid("存档的关联数据无效，没有写入存档") from None


def read_media(package):
    """A standalone save contains every image it references; backups use checked ZIP entries."""
    try:
        found = {}
        for filename, coded in package["media"].items():
            if not re.fullmatch(r"[0-9a-f]{64}\.(png|jpg|gif|webp)", filename):
                raise ValueError
            data = base64.b64decode(coded, validate=True)
            if CardMedia.filename(data) != filename:
                raise ValueError
            found[filename] = data
        if set(found) != set(media_refs({k: v for k, v in package.items() if k != "media"})):
            raise ValueError
        return found
    except (ValueError, TypeError, KeyError):
        raise invalid("存档图片缺失或摘要无效，没有写入存档") from None


def export_backup(records, archive_name=None, *, archive_id=None):
    scoped = archive_name is not None or archive_id is not None
    too_large = ("此存档的完整备份超过256MB" if scoped
                 else "完整备份超过256MB，请在存档菜单逐个下载存档备份")
    with tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024) as body:
        with records.sessions.begin() as session:
            records.read_lock(session)
            query = records.records_of("archives").where(Archive.deleted.is_(False))
            if archive_name is not None:
                query = query.where(Archive.name == archive_name)
            if archive_id is not None:
                query = query.where(Archive.archive_id == archive_id)
            archives = [package_of(records, session, row) for row in session.scalars(query)]
            if not archives:
                raise HTTPException(404, "没有可备份的存档")
            names = {archive["archive"]["name"] for archive in archives}
            settings = [without_credentials(browser_setting(copy.deepcopy(row.value)))
                        for row in _rows(records, session, "settings") if row.value is not None
                        and (not row.key.startswith(AVATAR) or row.key[len(AVATAR):] in names)]
            shared = [copy.deepcopy(row.value) for row in session.scalars(
                records.memories_of([], include_shared=True)) if row.value is not None]
            payload = {"format": FORMAT, "version": VERSION, "createdAt": now(),
                       "archives": archives, "settings": settings, "sharedMemories": shared}
            entries = {"payload.json": write_payload(payload, body, LIMIT, too_large)}
            files = {}
            size = entries["payload.json"]["bytes"]
            for filename in sorted(set(media_refs(payload))):
                path = records.media.resolve(filename)
                if size + path.stat().st_size > LIMIT:
                    raise HTTPException(413, too_large)
                data = path.read_bytes()
                if records.media.filename(data) != filename:
                    raise invalid("本地媒体摘要不一致，备份未生成")
                name = "media/" + filename
                files[name] = data
                entries[name] = {"sha256": digest(data), "bytes": len(data)}
                size += len(data)
        del payload, archives, settings, shared
        manifest = encoded({"format": FORMAT, "version": VERSION, "files": entries})
        if size + len(manifest) > LIMIT:
            raise HTTPException(413, too_large)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
            package.writestr("manifest.json", manifest)
            with package.open("payload.json", "w") as zipped:
                body.seek(0)
                shutil.copyfileobj(body, zipped, 256 * 1024)
            for name, data in files.items():
                package.writestr(name, data)
        if output.tell() > LIMIT:
            raise HTTPException(413, too_large)
        return output.getvalue()


def read_backup(records, raw):
    if len(raw) > LIMIT:
        raise HTTPException(413, "完整备份超过256MB")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            entries = package.infolist()
            names = [entry.filename for entry in entries]
            if (len(entries) > 10000 or len(set(names)) != len(names)
                    or any(entry.flag_bits & 1 or entry.is_dir() for entry in entries)):
                raise ValueError
            if sum(entry.file_size for entry in entries) > LIMIT:
                raise HTTPException(413, "解压后的备份超过256MB")
            if any(name not in {"manifest.json", "payload.json"} and not re.fullmatch(
                    r"media/[0-9a-f]{64}\.(png|jpg|gif|webp)", name) for name in names):
                raise ValueError
            if package.getinfo("manifest.json").file_size > 2_000_000:
                raise ValueError
            manifest = json.loads(package.read("manifest.json"))
            if manifest.get("format") != FORMAT or manifest.get("version") != VERSION:
                raise ValueError
            if set(manifest["files"]) != set(names) - {"manifest.json"}:
                raise ValueError
            files = {}
            for name, expected in manifest["files"].items():
                data = package.read(name)
                if len(data) != expected["bytes"] or digest(data) != expected["sha256"]:
                    raise ValueError
                if name.startswith("media/") and records.media.filename(data) != name[6:]:
                    raise ValueError
                files[name] = data
            payload = json.loads(files.pop("payload.json"))
            if (set(payload) != {"format", "version", "createdAt", "archives", "settings",
                                 "sharedMemories"}
                    or payload["format"] != FORMAT or payload["version"] != VERSION
                    or not isinstance(payload["archives"], list) or not payload["archives"]):
                raise ValueError
            identities, archive_names, request_ids, memory_ids = set(), set(), set(), set()
            for saved in payload["archives"]:
                value = validate_package(saved)
                if saved["media"]:
                    raise ValueError
                identity, name = value["data"]["archiveId"], value["name"]
                if identity in identities or name in archive_names:
                    raise ValueError
                identities.add(identity)
                archive_names.add(name)
                incoming_requests = {row["id"] for row in saved["requests"]}
                incoming_memories = {str(row["id"]) for row in saved["memories"]}
                if request_ids & incoming_requests or memory_ids & incoming_memories:
                    raise ValueError
                request_ids |= incoming_requests
                memory_ids |= incoming_memories
            settings = payload["settings"]
            if (not isinstance(settings, list) or any(not isinstance(item, dict)
                    or set(item) != {"key", "value"} or not isinstance(item["key"], str)
                    or not 0 < len(item["key"]) <= 300 for item in settings)
                    or len({item["key"] for item in settings}) != len(settings)):
                raise ValueError
            validate_memories(payload["sharedMemories"])
            if memory_ids & {str(row["id"]) for row in payload["sharedMemories"]}:
                raise ValueError
            if set(media_refs(payload)) != {name[6:] for name in files}:
                raise ValueError
            return payload, files
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, zipfile.BadZipFile,
            RuntimeError, EOFError):
        raise invalid("备份格式或文件摘要无效；仅支持当前版本的 FRX 完整备份") from None


def preview_backup(records, raw):
    payload, media = read_backup(records, raw)
    with records.sessions() as session:
        settings = _rows(records, session, "settings")
        existing = {row.key for row in settings if row.value is not None}
        return {
            "digest": digest(raw),
            "archive_names": [saved["archive"]["name"] for saved in payload["archives"]],
            "counts": {"archives": len(payload["archives"]),
                       "settings": len(payload["settings"]),
                       "memories": len(payload["sharedMemories"])
                       + sum(len(saved["memories"]) for saved in payload["archives"])},
            "media": len(media),
            "settings_conflicts": sum(item["key"] in existing for item in payload["settings"]),
            "settings_revision": settings_revision(settings),
        }


def rewrite_ids(value, archives, names, requests, field=""):
    if isinstance(value, dict):
        if value.get("codec") == CODEC:
            return pack_snapshot(rewrite_ids(unpack_snapshot(value), archives, names, requests))
        return {key: rewrite_ids(item, archives, names, requests, key)
                for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite_ids(item, archives, names, requests, field) for item in value]
    if isinstance(value, str):
        if field == "archiveId":
            return archives.get(value, value)
        if field in {"archive", "boundArchive"}:
            return names.get(value, value)
        if field in {"frxRequestId", "frxUndoRequestId", "request_id"}:
            return requests.get(value, value)
        if field == "key" and value.startswith(AVATAR):
            return AVATAR + names.get(value[len(AVATAR):], value[len(AVATAR):])
        if value.lstrip().startswith(("{", "[")):
            try:
                parsed = json.loads(value)
                changed = rewrite_ids(parsed, archives, names, requests)
                return json.dumps(changed, ensure_ascii=False) if changed != parsed else value
            except ValueError:
                pass
    return value


def restore_packages(records, session, packages, label="恢复"):
    """Insert current packages in one transaction. All ownership comes from `records`."""
    archives = [validate_package(package) for package in packages]
    names, identities, requests = {}, {}, {}
    for value, package in zip(archives, packages, strict=True):
        original = value["name"]
        name = original
        if records.record(session, "archives", name) is not None:
            name = original[:270] + f" · {label} " + uuid4().hex[:8]
        names[original] = name
        identities[value["data"]["archiveId"]] = str(uuid4())
        requests.update({request["id"]: str(uuid4()) for request in package["requests"]})
    all_memories = {}
    written = []
    for value, package in zip(archives, packages, strict=True):
        original = value["name"]
        value = rewrite_ids(value, identities, names, requests)
        value["name"] = names[original]
        value = records.media.normalize(value, session)
        row = records.new_record("archives", value["name"], value)
        session.add(row)
        session.flush()  # Child domains have an actual owner FK, never a loose external id.
        written.append(value)
        for memory in package["memories"]:
            changed = rewrite_ids(copy.deepcopy(memory), identities, names, requests)
            key = str(uuid4())
            all_memories[str(memory["id"])] = key
            changed["id"] = key
            if "uuid" in changed:
                changed["uuid"] = key
            session.add(records.new_record("vectors", key, changed))
        if package["art"]:
            art = rewrite_ids(copy.deepcopy(package["art"]), identities, names, requests)
            art["archiveId"] = value["data"]["archiveId"]
            session.add(records.new_record(PLAY_ART, art["archiveId"], art))
        PlaceBook(records).add_rows(
            rewrite_ids(copy.deepcopy(package["places"]), identities, names, requests), session)
    for value, package in zip(written, packages, strict=True):
        for request in package["requests"]:
            held = rewrite_ids(copy.deepcopy(request), identities, names, requests)
            held["id"] = requests[request["id"]]
            held["archive"] = value["name"]
            held["lease_until"] = None
            context = held.get("context") or {}
            if value["data"].get("frxUndoRequestId") == held["id"] and context.get("undo"):
                undo = context["undo"]
                undo["stateHash"] = state_digest(value["data"]["state"])
                for memory in undo.get("vectors", []):
                    old_key = str(memory["key"])
                    key = all_memories.get(old_key)
                    if key is None:
                        key = str(uuid4())
                        all_memories[old_key] = key
                        session.add(records.new_record("vectors", key, None))
                    memory["key"], memory["version"] = key, 1
                    for field in ("value", "postimage"):
                        if isinstance(memory.get(field), dict):
                            memory[field]["id"] = key
                            if "uuid" in memory[field]:
                                memory[field]["uuid"] = key
            if held["status"] == "pending":
                held["settlement"] = {**(held.get("settlement") or {}),
                                      "beforeStateHash": state_digest(value["data"]["state"])}
            session.add(CardRequest(user_id=records.user_id, **held))
    return written, identities, names, requests


def restore_backup(records, raw, revision, restore_settings=False):
    payload, media = read_backup(records, raw)
    with records.sessions.begin() as session:
        records.lock(session)
        settings = _rows(records, session, "settings")
        if restore_settings and settings_revision(settings) != revision:
            raise HTTPException(409, "预览后全局设置已变化，请重新预览备份")
        for data in media.values():
            records.media.store(data, session)
        written, identities, names, requests = restore_packages(
            records, session, payload["archives"])
        count = 0
        for setting in payload["settings"]:
            incoming = rewrite_ids(copy.deepcopy(setting), identities, names, requests)
            if incoming["key"] in {"CULTIVATION_ACTIVE_ARCHIVE_V1", "CULTIVATION_DEFAULT_MAP_V1"}:
                incoming["value"] = names.get(incoming["value"], incoming["value"])
            incoming = without_credentials(browser_setting(incoming))
            row = records.record(session, "settings", incoming["key"], lock=True)
            if row is not None and row.value is not None and incoming["key"] == KNOWLEDGE:
                incoming["value"] = merge_archive_preferences(
                    row.value.get("value", {}), incoming["value"], set(identities.values()),
                    restore_settings,
                )
                row.value = incoming
                row.version += 1
                count += 1
                continue
            if row is not None and row.value is not None and not restore_settings:
                continue
            if row is None:
                session.add(records.new_record("settings", incoming["key"], incoming))
            else:
                row.value = incoming
                row.version += 1
            count += 1
        shared = {encoded({key: value for key, value in row.value.items()
                           if key not in {"id", "uuid"}})
                  for row in session.scalars(records.memories_of([], include_shared=True))
                  if row.value is not None}
        for memory in payload["sharedMemories"]:
            signature = encoded({key: value for key, value in memory.items()
                                 if key not in {"id", "uuid"}})
            if signature in shared:
                continue
            changed = copy.deepcopy(memory)
            key = str(uuid4())
            changed["id"] = key
            if "uuid" in changed:
                changed["uuid"] = key
            session.add(records.new_record("vectors", key, changed))
            shared.add(signature)
        return {"archives": [value["name"] for value in written], "media": len(media),
                "settings": count, "vectors": sum(len(p["memories"]) for p in payload["archives"]),
                PLAY_ART: sum(bool(p["art"]) for p in payload["archives"]),
                PLACE_LOOKS: sum(len(p["places"]) for p in payload["archives"]),
                "digest": digest(raw)}
