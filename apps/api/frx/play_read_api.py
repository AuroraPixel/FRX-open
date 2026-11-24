"""The read side of the new interface's API, under /api/play: the save list, a save's state,
map, people, world events and daily papers, the calendar and the life record of a save in the
cultivation life, and the player's choice of a portrait.

Thin by design: every route takes the user from frx.auth.current_user, works through that
user's own store and hands the work to play_saves, play_state and play_world. `{id}` is the
save's archiveId; another user's id answers like one that does not exist (404). The turn routes
live in play_api.py.
"""

import asyncio
import json
import re

from fastapi import APIRouter, Depends, Query

from . import card_turns, play_legacy
from . import play_models as M
from .auth import User, current_user, login
from .card_director import engine_progress, plot_payload
from .domain import ROOT
from .life import life_of
from .play_art import ArtStore, check_recipe
from .play_creation import opening_request_id
from .play_errors import PlayError, not_found, refused
from .play_saves import art_of, find_save, list_saves, places_of
from .play_state import calendar_entry, state_view
from .play_world import (
    events_view,
    map_view,
    named_detail,
    news_view,
    people_view,
    person_detail,
)
from .workspace import Workspace, open_workspace

NO_CALENDAR = "这个存档玩的是小说，没有修仙人生的日历"
NOT_LIFE = "这个存档玩的是小说，没有修仙人生的告示和店铺"
NO_BOOK = "这个存档玩的是小说，没有修仙人生的卷和回"
CHRONICLE = json.loads((ROOT / "content/life/chronicle.json").read_text(encoding="utf-8"))


def play_date(key):
    """A frxPlay day ("0001-03-05") as the contract's PlayDate, or None."""
    found = re.fullmatch(r"(\d{1,6})-(\d{1,2})-(\d{1,2})", str(key or ""))
    if not found:
        return None
    year, month, day = (int(part) for part in found.groups())
    if not (1 <= month <= 12 and 1 <= day <= 30):
        return None
    return {"text": CHRONICLE["months"][month - 1] + CHRONICLE["days"][day - 1], "year": year,
            "month": month, "day": day}


def book_view(play, turns):
    """The book's volumes and their 回 (plan item 38): the closed volumes of frxPlay.book with
    their pages' words, the one under way last; each 回 from the marks of the history's turns (its
    scene's name and its 回目, the turn it opened in), under the volume that turn ended in; each
    volume's first turn (a turn before the book was kept is the first volume's)."""
    book = play.get("book") if isinstance(play.get("book"), dict) else {}
    chapters = {}
    firsts = {}
    for turn in turns:
        firsts.setdefault(turn.get("volume") if isinstance(turn.get("volume"), int) else 1,
                          turn["no"])
        for block in turn.get("blocks") or []:
            number = block.get("chapter") if block.get("type") == "mark" else None
            if not isinstance(number, int):
                continue
            entry = chapters.setdefault(number, {"no": number, "turn": turn["no"],
                                                 "volume": turn.get("volume")})
            if block.get("title"):
                entry["title"] = block["title"]
            if block.get("kind") == "close" and block.get("couplet"):
                entry["couplet"] = block["couplet"]
    volumes = []
    for closed in book.get("volumes") or []:
        if not isinstance(closed, dict) or not isinstance(closed.get("no"), int):
            continue
        cause = closed.get("cause") if isinstance(closed.get("cause"), dict) else {}
        volumes.append({"no": closed["no"], "cause": cause.get("kind"), "name": cause.get("name"),
                        "since": play_date(closed.get("from")),
                        "until": play_date(closed.get("to")),
                        "text": closed.get("text") or None, "chapters": []})
    now = book.get("volume") if isinstance(book.get("volume"), int) else 1
    volumes.append({"no": now, "since": play_date(book.get("from")), "chapters": []})
    by_no = {volume["no"]: volume for volume in volumes}
    for volume in volumes:
        volume["turn"] = firsts.get(volume["no"])
    for number in sorted(chapters):
        entry = chapters[number]
        home = by_no.get(entry.pop("volume"), volumes[0])
        home["chapters"].append(entry)
    return {"volume": now, "chapter": book.get("chapter") if isinstance(book.get("chapter"), int)
            else 0, "volumes": [{key: value for key, value in volume.items() if value is not None}
                                for volume in volumes]}
NO_LIFE_RECORD = "这个存档玩的是小说，没有一生的年谱"


def play_read_router(store):
    router = APIRouter(prefix="/api/play", dependencies=[Depends(login)])

    def workspace(user: User = Depends(current_user)) -> Workspace:
        return open_workspace(user, store.sessions)

    def read(records, archive_id):
        # the state view and the people never read the round snapshots a life save keeps
        save = find_save(records, archive_id, lean=True)
        return save, art_of(records, save)

    @router.get("/saves")
    async def saves(ws: Workspace = Depends(workspace)):
        return [summary.wire() for summary in await asyncio.to_thread(list_saves, ws.records)]

    @router.get("/saves/{archive_id}/state")
    async def state(archive_id: str, ws: Workspace = Depends(workspace)):
        save, art = await asyncio.to_thread(read, ws.records, archive_id)
        looks = await asyncio.to_thread(places_of, ws.records, save)
        plot = save.plot()
        progress = await engine_progress(save.value, plot_payload(plot) if plot else None)
        view = state_view(save, art, progress, looks)
        view.opening_request_id = await asyncio.to_thread(opening_request_id, ws.records, save)
        return view.wire()

    @router.get("/saves/{archive_id}/map")
    async def world_map(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await asyncio.to_thread(find_save, ws.records, archive_id, True)
        return map_view(save).wire()

    @router.get("/saves/{archive_id}/people")
    async def people(archive_id: str, ws: Workspace = Depends(workspace)):
        save, art = await asyncio.to_thread(read, ws.records, archive_id)
        return people_view(save, art).wire()

    @router.get("/saves/{archive_id}/people/{char_id}")
    async def person(
        archive_id: str,
        char_id: str,
        name: str | None = Query(None, max_length=200),
        ws: Workspace = Depends(workspace),
    ):
        def look():
            # Someone who has left (a turn's speaker who left in that turn) stays readable,
            # with a portrait of their own.
            save = find_save(ws.records, archive_id)
            gone = None if char_id in save.everyone() else save.departed(char_id)
            return save, art_of(ws.records, save, {char_id: gone} if gone else None)

        save, art = await asyncio.to_thread(look)
        # An old turn names its people as they were: with the name, the id's earlier bearer.
        if name:
            detail = named_detail(save, art, char_id, name)
        else:
            detail = person_detail(save, art, char_id)
        if detail is None:
            raise not_found("这个存档里没有这个人物")
        return detail.wire()

    @router.put("/saves/{archive_id}/people/{char_id}/portrait")
    async def portrait(
        archive_id: str, char_id: str, recipe: M.Recipe, ws: Workspace = Depends(workspace)
    ):
        chosen = recipe.wire()
        problem = check_recipe(chosen)
        if problem:
            raise refused(problem)

        def choose():
            save, _ = read(ws.records, archive_id)
            if char_id not in save.everyone():
                raise not_found("这个存档里没有这个人物")

            def keep(value):
                value.setdefault("portraits", {})[char_id] = {"recipe": chosen, "custom": True}
                return True

            ArtStore(ws.records, save.archive_id).update(keep)

        await asyncio.to_thread(choose)
        return chosen

    @router.get("/saves/{archive_id}/calendar")
    async def calendar(archive_id: str, ws: Workspace = Depends(workspace)):
        """The next three years of the calendar of a save in the cultivation life (plan item
        14): the region's recurring events, the player's own and the director's, nearest
        first, each with the days left (the engine's calendar op)."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        if life_of(save) is None:
            raise refused(NO_CALENDAR)
        payload = {"mode": "life", "op": "calendar", "archive": save.value}
        result = await card_turns.run_engine(payload)
        if result.get("error") == "not_life":
            raise refused(NO_CALENDAR)
        entries = result.get("calendar")
        if result.get("error") or result.get("errors") or not isinstance(entries, list):
            raise PlayError(500, "engine_failed", "日历没有算出来，请稍后再试")
        return M.CalendarView(
            entries=[calendar_entry(entry) for entry in entries if isinstance(entry, dict)]
        ).wire()

    async def life_view(archive_id, ws, op, answer):
        """An engine op of the life play that reads a save: refused for a save of the novel."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        if life_of(save) is None:
            raise refused(NOT_LIFE)
        result = await card_turns.run_engine({"mode": "life", "op": op, "archive": save.value})
        if result.get("error") == "not_life":
            raise refused(NOT_LIFE)
        if result.get("error") or result.get("errors") or not isinstance(result.get(op), dict):
            raise PlayError(500, "engine_failed", "没有算出来，请稍后再试")
        return answer.model_validate(result[op]).wire()

    @router.get("/saves/{archive_id}/book")
    async def book(archive_id: str, ws: Workspace = Depends(workspace)):
        """The book's volumes and their 回 (plan item 38), for the history's navigation by volume
        and chapter. Read only."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        play = life_of(save)
        if play is None:
            raise refused(NO_BOOK)

        def read():
            from .play_blocks import history
            from .play_turns import turn_requests

            return history(save.name, save.value, turn_requests(ws.records, save.name),
                           places_of(ws.records, save, keep=False))

        turns = await asyncio.to_thread(read)
        return M.BookView.model_validate(book_view(play, turns)).wire()

    @router.get("/saves/{archive_id}/notices")
    async def notices(archive_id: str, ws: Workspace = Depends(workspace)):
        """The notices up at the player's place this half-year (plan item 35; the engine's
        notices op)."""
        return await life_view(archive_id, ws, "notices", M.NoticeBoard)

    @router.get("/saves/{archive_id}/shop")
    async def shop(archive_id: str, ws: Workspace = Depends(workspace)):
        """What the shops at the player's place sell and take, at what price (plan item 35;
        the engine's shop op)."""
        return await life_view(archive_id, ws, "shop", M.ShopView)

    @router.get("/saves/{archive_id}/life")
    async def life_record(
        archive_id: str,
        index: int | None = Query(None, ge=0, le=999),
        ws: Workspace = Depends(workspace),
    ):
        """A whole life as data (plan item 49, the chronicle page): the latest that ended, the
        dying protagonist's while the heir is to be chosen, the life under way when none has
        ended; ?index= an earlier one that ended (0 the first). With the volumes of the book it
        saw and their 回 (the book's own view)."""
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        play = life_of(save)
        if play is None:
            raise refused(NO_LIFE_RECORD)

        def read():
            from .play_blocks import history
            from .play_turns import turn_requests

            return history(save.name, save.value, turn_requests(ws.records, save.name),
                           places_of(ws.records, save, keep=False))

        # the volumes of the book and their 回, as GET …/book gives them (item 38)
        book = book_view(play, await asyncio.to_thread(read))
        try:
            return play_legacy.life_view(save, index, book).wire()
        except IndexError:
            raise not_found("没有这一世") from None

    @router.get("/saves/{archive_id}/events")
    async def events(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        return events_view(save).wire()

    @router.get("/saves/{archive_id}/news")
    async def news(archive_id: str, ws: Workspace = Depends(workspace)):
        save = await asyncio.to_thread(find_save, ws.records, archive_id)
        return news_view(save).wire()

    return router
