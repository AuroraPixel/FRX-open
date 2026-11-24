"""Commit an archive's replacement memory only after all embeddings are ready."""

import copy
import json
import math
import re
from uuid import UUID

from fastapi import HTTPException

from .card_store import state_digest
from .save_schema import Memory


def parse_rerank_order(content, count):
    try:
        clean = re.sub(r"<(thinking|think)>[\s\S]*?</\1>", "", content, flags=re.I).strip()
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.I).strip()
        order = json.loads(clean)["order"]
        if (not isinstance(order, list) or any(type(index) is not int for index in order)
                or sorted(order) != list(range(count))):
            raise ValueError
        return order
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "重排模型返回的文档索引无效") from None


def owned(value, scope):
    return (
        isinstance(value, dict)
        and value.get("scope") == "archive"
        and value.get("archiveId") == scope.get("archive_id")
        and bool(scope.get("archive_id"))
    )


def vector_entry(value, scope, batch_id, digest):
    if not owned(value, scope):
        raise HTTPException(409, "归档记忆与原存档归属不一致")
    try:
        identity = UUID(value["uuid"])
        vector = value["vector"]
        if (
            not isinstance(vector, list)
            or not 1 <= len(vector) <= 32768
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in vector)
            or not isinstance(value.get("content"), str)
            or not value["content"].strip()
            or value.get("outdatedTimestamp")
            or value.get("frxTimelineHidden")
        ):
            raise ValueError
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
        raise HTTPException(422, "归档向量或条目格式不完整，原记忆已保留") from None
    # Keep the original UI's numeric IDs; the chunk UUID makes retries deterministic.
    return {**copy.deepcopy(value), "id": identity.int >> 75,
            "frxBatchId": batch_id, "frxBatchDigest": digest}


def commit_vectors(records, scope, batch_id, additions, retirements, timestamp):
    digest = state_digest(dict(scope=scope, additions=additions, retirements=retirements,
                               timestamp=timestamp))
    values = [vector_entry(value, scope, batch_id, digest) for value in additions]
    keys = [str(v["id"]) for v in values]
    old_keys = [str(v.get("id")) for v in retirements]
    if (not values or len(set(keys)) != len(keys) or len(set(old_keys)) != len(old_keys)
            or set(keys).intersection(old_keys) or len({len(v["vector"]) for v in values}) != 1):
        raise HTTPException(422, "归档批次包含重复或不完整的记忆，原记忆已保留")
    with records.sessions.begin() as session:
        records.lock(session)
        records.validate_scope(session, scope)
        previous = session.scalars(records.records_of("vectors").where(
            Memory.batch_id == batch_id,
        )).all()
        if previous:
            by_key = {row.key: row for row in previous}
            if set(by_key) != set(keys) or any(
                by_key[key].value != value for key, value in zip(keys, values, strict=True)
            ):
                raise HTTPException(409, "归档批次已变化，重复请求未覆盖当前记忆")
            return {"records": [records.envelope(by_key[key]) for key in keys], "replayed": True}
        old_rows = []
        for key, expected in zip(old_keys, retirements, strict=True):
            row = records.record(session, "vectors", key, lock=True)
            if (not owned(expected, scope) or not row or row.value != expected
                    or expected.get("outdatedTimestamp") or expected.get("frxTimelineHidden")):
                raise HTTPException(409, "合并期间原记忆已变化，旧记忆与新结果均未覆盖")
            old_rows.append(row)
        new_rows = []
        for key, value in zip(keys, values, strict=True):
            if records.record(session, "vectors", key):
                raise HTTPException(409, "记忆标识冲突，原记忆已保留")
            row = records.new_record("vectors", key, value)
            session.add(row)
            new_rows.append(row)
        for row in old_rows:
            row.value = {**row.value, "outdatedTimestamp": timestamp}
            row.version += 1
        return {"records": [records.envelope(row) for row in new_rows], "replayed": False}


def prune_vectors(records, scope, expected_records):
    keys = [str(v.get("id")) for v in expected_records]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "清理批次包含重复记忆")
    with records.sessions.begin() as session:
        records.lock(session)
        records.validate_scope(session, scope)
        rows = []
        for key, expected in zip(keys, expected_records, strict=True):
            row = records.record(session, "vectors", key, lock=True)
            if (not owned(expected, scope) or not expected.get("outdatedTimestamp")
                    or not row or row.value != expected):
                raise HTTPException(409, "待清理记忆已变化或属于其他存档，本批清理未应用")
            rows.append(row)
        for row in rows:
            row.value = None
            row.version += 1
        return {"removed": len(rows)}
