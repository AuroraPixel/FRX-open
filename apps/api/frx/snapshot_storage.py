"""Internal lossless chunk storage for the snapshot domain. Exports use regular snapshots."""

import base64
import hashlib
import json
import re
import zlib

from fastapi import HTTPException

from .card_snapshots import CODEC, LIMIT

MANIFEST = "frx-snapshot-chunks-v1"
PART = "frx-snapshot-part-v1"
MINIMUM = 4096
MAXIMUM = 24576
BOUNDARIES = re.compile(rb'[}\]]')
FIELDS = {"frxStateSnapshot", "frxBeforeSnapshot", "stateSnapshot", "biographySnapshot",
          "worldMapSnapshot", "snapshotOfLogs"}


def damaged():
    return HTTPException(422, "存档快照片段缺失或损坏")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def part_digest(raw):
    return digest(b"frx-snapshot-part\x00" + raw)


def inflate(data, limit):
    decoder = zlib.decompressobj()
    raw = decoder.decompress(base64.b64decode(data, validate=True), limit + 1)
    if len(raw) > limit or not decoder.eof or decoder.unused_data:
        raise ValueError
    return raw


def compressed(raw):
    return base64.b64encode(zlib.compress(raw)).decode("ascii")


def chunks(raw):
    """Choose repeatable boundaries from nearby bytes so inserting a field stays local."""
    start = 0
    for match in BOUNDARIES.finditer(raw):
        end = match.end()
        while end - start > MAXIMUM:
            yield raw[start:start + MAXIMUM]
            start += MAXIMUM
        if end - start >= MINIMUM and zlib.crc32(raw[end - 48:end]) % 16 == 0:
            yield raw[start:end]
            start = end
    while len(raw) - start > MAXIMUM:
        yield raw[start:start + MAXIMUM]
        start += MAXIMUM
    if start < len(raw):
        yield raw[start:]


def stored_payload(field, payload, raw):
    """Return a manifest and its distinct parts, or the original payload for a small snapshot."""
    if isinstance(payload, dict) and payload.get("codec") in {MANIFEST, PART}:
        raise damaged()
    if field not in FIELDS or len(raw) < MINIMUM * 2:
        return payload, {}
    header = None
    if isinstance(payload, dict) and payload.get("codec") == CODEC:
        try:
            unpacked = inflate(payload["data"], LIMIT)
            if digest(unpacked) != payload["sha256"]:
                raise ValueError
        except (KeyError, TypeError, ValueError, zlib.error):
            raise damaged() from None
        # Only replace the server's usual encoding. Preserve exact imported compressed streams.
        if compressed(unpacked) == payload["data"]:
            raw = unpacked
            header = {key: value for key, value in payload.items() if key != "data"}
    if len(raw) > LIMIT:
        return payload, {}
    ids, parts = [], {}
    for chunk in chunks(raw):
        key = part_digest(chunk)
        ids.append(key)
        if key not in parts:
            parts[key] = {"codec": PART, "data": compressed(chunk)}
    return {"codec": MANIFEST, "size": len(raw), "sha256": digest(raw), "parts": ids,
            "header": header}, parts


def parts_of(payload):
    if isinstance(payload, dict) and payload.get("codec") == MANIFEST:
        parts = payload.get("parts")
        if not isinstance(parts, list) or not parts or any(
            not isinstance(key, str) or len(key) != 64 for key in parts
        ):
            raise damaged()
        return parts
    return ()


def restored(payload, gather, decoded):
    ids = parts_of(payload)
    if not ids:
        return payload
    try:
        for key in ids:
            if key in decoded:
                continue
            piece = gather[key]
            if piece.get("codec") != PART:
                raise ValueError
            raw = inflate(piece["data"], MAXIMUM)
            if part_digest(raw) != key:
                raise ValueError
            decoded[key] = raw
        total = sum(len(decoded[key]) for key in ids)
        if payload["size"] != total or total > LIMIT:
            raise ValueError
        raw = b"".join(decoded[key] for key in ids)
        if digest(raw) != payload["sha256"]:
            raise ValueError
        header = payload["header"]
        return {**header, "data": compressed(raw)} if header is not None else json.loads(raw)
    except (KeyError, AttributeError, TypeError, ValueError, zlib.error):
        raise damaged() from None
