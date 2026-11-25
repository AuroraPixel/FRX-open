"""Current domain save files and backups. Original-card uploads are not supported."""

import base64
import io
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from .card_backup import LIMIT as BACKUP_LIMIT
from .card_backup import (
    export_backup,
    media_refs,
    package_of,
    preview_backup,
    read_media,
    restore_backup,
    restore_packages,
    validate_package,
)
from .card_import import LIMIT as SAVE_FILE_LIMIT
from .card_import import preview_save, read_save, write_payload
from .play_actions import version_conflict
from .play_errors import PlayError, not_found, refused
from .play_saves import art_of, find_save
from .play_state import save_summary
from .save_schema import Archive


def refusal(exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    if exc.status_code == 409:
        return PlayError(409, "version_conflict", detail)
    if exc.status_code == 413:
        return PlayError(413, "input_too_large", detail)
    if exc.status_code == 404:
        return not_found(detail)
    return refused(detail)


def archive_row(records, session, archive_id):
    row = session.scalar(select(Archive).where(
        Archive.user_id == records.user_id, Archive.archive_id == archive_id))
    if row is None or row.deleted:
        raise HTTPException(404, "存档不存在")
    return row


def delete_save(records, archive_id, version, follows=None):
    """Delete the archive and its dependent domains in one transaction."""
    try:
        with records.sessions.begin() as session:
            records.lock(session)
            row = archive_row(records, session, archive_id)
            if version != row.version and not (
                follows and follows(row.key, version, row.version)
            ):
                raise version_conflict()
            records.delete_archive_children(session, row)
            # The archive's domain setter removes its state/logs/snapshot references.
            row.value = None
            row.version += 1
    except HTTPException as exc:
        raise refusal(exc) from None


def attachment(data, filename, media_type):
    return Response(
        data, media_type=media_type,
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename)},
    )


def export_save(records, archive_id):
    try:
        with records.sessions.begin() as session:
            records.read_lock(session)
            row = archive_row(records, session, archive_id)
            package = package_of(records, session, row)
            for filename in sorted(set(media_refs(package))):
                data = records.media.resolve(filename).read_bytes()
                if records.media.filename(data) != filename:
                    raise HTTPException(422, "本地媒体摘要不一致，导出未生成")
                package["media"][filename] = base64.b64encode(data).decode()
            body = io.BytesIO()
            message = "存档文件超过64MB，请在该存档菜单下载存档备份（ZIP）"
            write_payload(package, body, SAVE_FILE_LIMIT, message)
            name = row.key
        return attachment(body.getvalue(), name + ".json", "application/json")
    except HTTPException as exc:
        raise refusal(exc) from None


def preview_save_file(raw):
    try:
        return preview_save(raw)
    except HTTPException as exc:
        raise refusal(exc) from None


def import_save_file(records, raw):
    try:
        package = read_save(raw)
        validate_package(package)
        media = read_media(package)
        with records.sessions.begin() as session:
            records.lock(session)
            for data in media.values():
                records.media.store(data, session)
            written, _, _, _ = restore_packages(records, session, [package], label="导入")
            archive_id = written[0]["data"]["archiveId"]
    except HTTPException as exc:
        raise refusal(exc) from None
    save = find_save(records, archive_id)
    return save_summary(save.archive_id, art_of(records, save), False)


def download_backup(records, archive_id=None):
    try:
        data = export_backup(records, archive_id=archive_id)
    except HTTPException as exc:
        raise refusal(exc) from None
    filename = "frx-save-backup.zip" if archive_id else "frx-backup.zip"
    return attachment(data, filename, "application/zip")


def inspect_backup(records, raw):
    try:
        return preview_backup(records, raw)
    except HTTPException as exc:
        raise refusal(exc) from None


def restore(records, raw, revision, restore_settings):
    try:
        return restore_backup(records, raw, revision, restore_settings)
    except HTTPException as exc:
        raise refusal(exc) from None


async def bounded_body(request, limit):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise PlayError(413, "input_too_large", "上传的文件太大")
        body.extend(chunk)
    return bytes(body)


async def backup_body(request):
    return await bounded_body(request, BACKUP_LIMIT)


async def save_file_body(request):
    return await bounded_body(request, SAVE_FILE_LIMIT)
