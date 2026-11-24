"""A user's saves as the new interface addresses them: by the stable archiveId, with the
play_art record (portrait recipes, list summary) kept next to each save."""

import copy

from sqlalchemy import select

from .card_store import CardRequest
from .play_art import ArtStore, fill_portraits
from .play_errors import PlayError, not_found
from .play_places import PlaceBook
from .play_state import Save, place_reading, save_summary, summary_fields
from .request_policy import request_blocks_archive
from .save_schema import Archive, ArchiveArt, archive_value

# Request rows that mean a turn is running or waits to be settled (card_store.begin_request).
LIVE = ("generating", "ready", "repairing", "pending")


def find_save(records, archive_id, lean=False):
    """The user's save with this archiveId; not_found for anyone else's or none. A life save comes
    with its kept round snapshots back in its rounds unless `lean` (the reads that never look at
    them: the state view, the map, the people)."""
    with records.sessions() as session:
        records.read_lock(session)
        row = session.scalar(
            records.records_of("archives").where(Archive.archive_id == archive_id)
        )
        if row is None or row.deleted:
            raise not_found()
        return Save(row.key, row.version, archive_value(row, lean=lean))


def art_of(records, save, also=None):
    """The save's play_art record with a recipe for everyone in it (and for `also`, people who
    have left: id → character) and a current summary; written only when something was missing
    or out of date. The save itself is not touched."""

    def complete(value):
        changed = fill_portraits(value, save.archive_id, {**save.everyone(), **(also or {})})
        summary = summary_fields(save)
        if value.get("summary") != summary:
            value["summary"] = summary
            changed = True
        return changed

    store = ArtStore(records, save.archive_id)
    value = store.load()
    if complete(copy.deepcopy(value)):
        value = store.update(complete)
    return value


def places_of(records, save, keep=True):
    """The looks the save's places keep (key → look, play_places.PlaceBook). With `keep`, the
    place the player is at keeps the rules' look first when it has none yet (a save played
    before looks were kept, its opening, an imported save), so it looks the same from then on;
    a turn's arrival is settled by the turn itself (TurnDesk.settle_place), which may ask the
    model. The save itself is not touched."""
    book = PlaceBook(records)
    looks = book.looks(save.archive_id)
    if keep:
        reading = place_reading(save)
        if reading.key not in looks:
            looks[reading.key] = book.keep(save.archive_id, reading.key, reading.rules.look,
                                           "rules")
    return looks


def busy_saves(records, session):
    """Names of saves with a live lease or a result still waiting for settlement."""
    requests = session.scalars(
        records.requests_of().where(CardRequest.status.in_(LIVE))
    )
    return {row.archive for row in requests
            if row.status == "pending" or request_blocks_archive(row)}


def list_saves(records):
    """Every save as a light summary, the most recently played first. Saves whose summary is
    current are not read at all; the rest are read once and their summary stored."""
    with records.sessions() as session:
        records.read_lock(session)
        rows = session.execute(
            select(Archive.key, Archive.version, Archive.archive_id).where(
                Archive.user_id == records.user_id, Archive.deleted.is_(False)
            )
        ).all()
        arts = {row.key: row.value for row in session.scalars(
            select(ArchiveArt).where(ArchiveArt.user_id == records.user_id)
        )}
        busy = busy_saves(records, session)
    summaries, seen = [], set()
    for name, version, archive_id in rows:
        if not archive_id or archive_id in seen:
            continue
        seen.add(archive_id)
        value = arts.get(archive_id) if isinstance(arts.get(archive_id), dict) else {}
        summary = value.get("summary") or {}
        current = summary.get("version") == version and summary.get("name") == name
        if not current or "B1" not in (value.get("portraits") or {}):
            try:
                value = art_of(records, find_save(records, archive_id))
            except PlayError:  # deleted since the list was read
                continue
        summaries.append(save_summary(archive_id, value, name in busy))
    return sorted(summaries, key=lambda s: s.last_played_at, reverse=True)
