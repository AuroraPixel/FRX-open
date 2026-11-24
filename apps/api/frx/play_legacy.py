"""坐化与传承 on the server (gameplay plan item 49): what the engine (apps/engine/life/legacy.cjs)
leaves to it.

- The dying turn (play_death.after_turn finds the death of old age in the committed save of the
  cultivation life; play_turns finishes the turn): the death's own blocks go out first, with a
  notice to choose the heir; then a new heir's spirit root is drawn as creation draws one
  (creation.cjs mode draw, kind root) on the save's own seed, 「<archiveId>:heir:<the day of the
  death>」, so a draw made again gives the same root, and the old acquaintances' eulogies are
  asked for, one model call of at most MODEL_SECONDS (the mourners the engine picked, at most
  three). Both go into frxPlay.legacy (`root`, `eulogies`: [] when the call failed, the player
  was at a usage limit or nobody is left to speak) in one more write of the save, and each
  eulogy goes out as a speech block, before done.
- The inherit panel action's other half (play_actions): the predecessor's row kept as a
  biography (worldBookEntries, the shape the card gives one), the biographies' relations to B1
  pointed at the predecessor and those to the heir at B1, the heir's own biography gone, and the
  portraits moved (the predecessor keeps his face; a tie's heir brings theirs to B1, a new one has
  the recipe given or one made when the save is next read).
- GET /saves/{id}/life (life_view): a whole life as data for the chronicle page.
"""

import asyncio
import copy
import json
import logging
import re
import time
from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException

from . import play_models as M
from . import usage
from .gateway import Gateway, ModelFailure
from .life import life_of
from .play_art import ArtStore
from .play_prompt import run_script, settings_of
from .play_sheet import parse_nested_json, parse_remarks, stored_item_ids

logger = logging.getLogger(__name__)

ATTEMPTS = 3
PURPOSE = "eulogy"
MODEL_SECONDS = 30
MODEL_TOKENS = 1200
# The request's own words: the test double answers it by them.
EULOGY_ASK = "为一位坐化的修士写几句故人的评说"
SYSTEM = ("你替修仙世界里的故人说话：一位修士寿元耗尽坐化了，认识他的几个人各说一句评说。"
          "只写他们说出口的话，口吻合各人的身份，与逝者是什么关系就说什么话。")
NOTICE = "{name}寿元耗尽，坐化了。在「传承」里选一位道侣、弟子接着走下去，或者另立一个后人。"
RELATION = re.compile(r"(^|[;；])(\s*)([BCG][\w-]*)(\s*[:：])")


@dataclass
class Passing:
    """A death of old age after a turn, as the turn reads play_death's Death: nothing written yet
    (`written` None: the save stands as the turn committed it), a notice for the turn, and
    `mourn`, what the turn awaits once the death's own blocks are out: the root and the
    eulogies, written into the save ({"blocks", "version"}, or None)."""

    text: str
    mourn: object = None
    written: dict | None = None

    def block(self):
        return {"type": "notice", "level": "info", "text": self.text}


# ---------------------------------------------------------------- after the dying turn


async def draw_root(records, archive_id, died):
    """A new heir's spirit root: creation's root draw on the save's seed; None when it fails."""
    settings = await asyncio.to_thread(lambda: settings_of(records.list("settings")))
    try:
        result = await run_script(
            "creation.cjs",
            {"mode": "draw", "kind": "root", "seed": f"{archive_id}:heir:{died}", "round": 1,
             "settings": settings, "now": int(time.time() * 1000)},
            step="后人的灵根",
        )
    except ModelFailure:
        return None
    root = result.get("root")
    return root.strip() if isinstance(root, str) and root.strip() else None


def eulogy_messages(value, legacy, mourners):
    """The one request for the eulogies: the dead, the gates passed and the last lines of the
    life's record, and each mourner by id, name and tie."""
    play = life_of(value) or {}
    gates = "、".join(str(gate.get("to")) for gate in play.get("passed") or []
                     if isinstance(gate, dict) and gate.get("to"))
    record = [entry for entry in play.get("record") or [] if isinstance(entry, dict)][-12:]
    lines = [
        f"{EULOGY_ASK}。",
        f"【逝者】{legacy.get('name') or '他'}，{legacy.get('realm') or '修士'}，享年"
        f"{legacy.get('age')}，于{legacy.get('place') or '洞府'}坐化。",
    ]
    if gates:
        lines.append(f"【过关】{gates}")
    lines += [f"【年谱】{entry.get('text')}" for entry in record if entry.get("text")]
    for mourner in mourners:
        tie = "，".join(part for part in (mourner.get("kind"), mourner.get("identity")) if part)
        lines.append(f"【故人】{mourner['id']} {mourner.get('name') or mourner['id']}"
                     f"（{tie or '旧识'}）")
    lines += ["每位故人说一句话，不超过四十个字，彼此不要重复。",
              '只回一个 JSON 数组，例如 [{"id": "C3", "text": "……"}]，不要别的字。']
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "\n".join(lines)}]


def parse_eulogies(content, mourners):
    """The eulogies of a reply: one per mourner it names, at most 80 characters; [] when the
    reply is no JSON array."""
    text = str(content or "")
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        items = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return []
    by_id = {mourner["id"]: mourner for mourner in mourners}
    said = []
    for item in items if isinstance(items, list) else []:
        who = by_id.get(str(item.get("id") or "")) if isinstance(item, dict) else None
        words = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()[:80] if who else ""
        if not words or any(each["id"] == who["id"] for each in said):
            continue
        said.append({"id": who["id"], "name": who.get("name") or who["id"],
                     "kind": who.get("kind") or "", "text": words})
    return said


async def eulogize(turn, value, legacy):
    """The mourners' words: one model call under the turn's user and request, [] when there is
    no model, nobody to speak, the user is at a limit or the call fails."""
    mourners = [mourner for mourner in legacy.get("mourners") or []
                if isinstance(mourner, dict) and mourner.get("id")]
    runtime = getattr(turn, "runtime", None)
    if not mourners or runtime is None:
        return []
    config = runtime.profiles.load("default")
    if not config.model:
        return []
    user = getattr(getattr(turn, "ws", None), "user", None)
    meter = getattr(runtime, "meter", None)
    if meter is not None and user is not None:
        if await asyncio.to_thread(meter.quota_problem, user.id, user.limits):
            return []
    from .card_turns import admission

    options = {"temperature": 0.8, "max_tokens": MODEL_TOKENS}
    if admission(config.model).get("lowEffort"):
        options["reasoning_effort"] = "low"
    try:
        response = await asyncio.wait_for(
            Gateway.complete(config, eulogy_messages(value, legacy, mourners), stream=False,
                             timeout=MODEL_SECONDS, **options),
            MODEL_SECONDS,
        )
    except (ModelFailure, TimeoutError):
        return []
    except Exception as error:  # no eulogies: the death stands as it is
        logger.warning("eulogy_failed error=%s", type(error).__name__)
        return []
    if user is not None and meter is not None:
        with usage.scope(meter, user.id, PURPOSE, getattr(turn, "request_id", None)):
            await usage.note("default", getattr(response, "usage", None))
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError):
        return []
    return parse_eulogies(content, mourners)


def fresh_death(value):
    """frxPlay.legacy of a protagonist who died of old age and has no eulogies yet, else None."""
    legacy = (life_of(value) or {}).get("legacy")
    if isinstance(legacy, dict) and legacy.get("state") == "choosing" and "eulogies" not in legacy:
        return legacy
    return None


def passing(turn, records, name, committed):
    """After a committed turn of the cultivation life: the Passing when its protagonist died of
    old age in it, else None. Nothing is asked or written until the turn awaits its mourn."""
    legacy = fresh_death(committed["value"])
    if legacy is None:
        return None

    async def mourn():
        return await mourned(turn, records, name, committed)

    return Passing(text=NOTICE.format(name=legacy.get("name") or "你"), mourn=mourn)


def eulogy_blocks(eulogies):
    """Each eulogy as the speech of the one who says it (their id, name and tie to the dead)."""
    def speaker(entry):
        return {"name": entry["name"], **({"charId": entry["id"]} if entry.get("id") else {}),
                **({"role": entry["kind"]} if entry.get("kind") else {})}

    return [{"type": "speech", "speaker": speaker(entry), "lines": [entry["text"]]}
            for entry in eulogies]


async def mourned(turn, records, name, committed):
    """The root drawn and the eulogies asked for, written into the save: {"blocks": the eulogies'
    speech blocks, "version": the save's new version}, or None when the save moved on meanwhile
    (another turn, an undo) or could not be written."""
    value = committed["value"]
    legacy = fresh_death(value)
    if legacy is None:
        return None
    archive_id = str((value.get("data") or {}).get("archiveId") or "")
    log_id = value["data"]["logs"][-1].get("id")
    root = legacy.get("root") or await draw_root(records, archive_id, legacy.get("died"))
    eulogies = await eulogize(turn, value, legacy)
    for _ in range(ATTEMPTS):
        kept = copy.deepcopy(committed["value"])
        written_legacy = life_of(kept)["legacy"]
        written_legacy["eulogies"] = eulogies
        if root:
            written_legacy["root"] = root
        try:
            written = await asyncio.to_thread(
                records.write, "archives", name, kept, committed["version"])
        except HTTPException as error:
            if error.status_code != 409:
                logger.warning("eulogy_write_failed status=%s", error.status_code)
                return None
            # Something else wrote first: write again on the save as it is now, if it still is
            # this turn's death.
            committed = await asyncio.to_thread(records.get, "archives", name)
            now = committed["value"] or {}
            logs = (now.get("data") or {}).get("logs") or []
            if not any(log.get("id") == log_id for log in logs) or fresh_death(now) is None:
                return None
            continue
        return {"blocks": eulogy_blocks(eulogies), "version": written["version"]}
    return None


# ---------------------------------------------------------------- the inherit action


def inherit_receipt(receipts):
    return next((receipt for receipt in receipts or [] if receipt.get("kind") == "legacy"
                 and (receipt.get("legacy") or {}).get("action") == "inherit"), None)


def repointed(entry, relations):
    """A biography whose row's relations (column 13) name ids of `relations` (B1 → the
    predecessor, the heir → B1), pointed at the new ones; the entry itself when nothing moves."""
    try:
        row = json.loads(entry.get("content") or "")
    except (TypeError, json.JSONDecodeError):
        return entry
    if not isinstance(row, dict) or not isinstance(row.get("13"), str):
        return entry
    text = RELATION.sub(lambda found: found.group(1) + found.group(2)
                        + relations.get(found.group(3), found.group(3)) + found.group(4), row["13"])
    if text == row["13"]:
        return entry
    return {**entry, "content": json.dumps({**row, "13": text}, ensure_ascii=False, indent=2)}


def keep_biography(archive, receipts):
    """The inheritance's biographies in the archive to write: the predecessor's row as a new
    biography, the others' relations pointed anew, the heir's own biography gone."""
    receipt = inherit_receipt(receipts)
    if receipt is None:
        return
    state = archive["data"]["state"]
    biography = receipt.get("biography") or {}
    relations = receipt.get("relations") or {}
    took = receipt.get("took")
    kept = []
    for entry in state.get("worldBookEntries") or []:
        if isinstance(entry, dict) and took and entry.get("key") == took:
            continue
        kept.append(repointed(entry, relations) if isinstance(entry, dict) else entry)
    key, row = str(biography.get("key") or ""), biography.get("row")
    if key and isinstance(row, dict):
        title = str(biography.get("title") or key)
        kept.append({"id": str(uuid4()), "key": key, "title": title, "type": "人物",
                     "content": json.dumps(row, ensure_ascii=False, indent=2), "enabled": True,
                     "triggerMode": "green", "keywords": [title], "depth": 5})
    state["worldBookEntries"] = kept


def move_portraits(records, archive_id, receipts, recipe=None):
    """The predecessor keeps his portrait under his new id; a tie's heir brings theirs to B1, a
    new heir has `recipe` (or none: one is made when the save is next read)."""
    receipt = inherit_receipt(receipts)
    if receipt is None:
        return
    dead_id = str((receipt.get("biography") or {}).get("key") or "")
    took = receipt.get("took")

    def move(value):
        portraits = value.setdefault("portraits", {})
        before = copy.deepcopy(portraits)
        old = portraits.pop("B1", None)
        if old and dead_id:
            portraits[dead_id] = old
        if took and took in portraits:
            portraits["B1"] = portraits.pop(took)
        elif recipe:
            portraits["B1"] = {"recipe": recipe, "custom": True}
        return portraits != before

    ArtStore(records, archive_id).update(move)


# ---------------------------------------------------------------- GET /saves/{id}/life


def years_of(record, end_year, end_age):
    """A life's record year by year, with the age in each (it went up at every new year)."""
    years = {}
    for entry in record or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("year"), int):
            continue
        years.setdefault(entry["year"], []).append(
            M.LifeLine(date=str(entry.get("date") or ""), kind=entry.get("kind") or None,
                       text=str(entry.get("text") or "")))
    return [M.LifeYear(year=year, age=end_age - (end_year - year)
                       if isinstance(end_age, int) and isinstance(end_year, int) else None,
                       lines=lines) for year, lines in sorted(years.items())]


def gates_of(passed):
    return [M.LifeGate(date=str(gate.get("date") or ""), age=gate.get("age"),
                       gate=gate.get("gate") or None, name=gate.get("name") or None,
                       to=str(gate.get("to") or ""), foundation=gate.get("foundation") or None)
            for gate in passed or [] if isinstance(gate, dict) and gate.get("to")]


def day_of_key(key):
    """「0012-03-04」 → (12, 3, 4), for comparing days; None when it is not one."""
    found = re.match(r"^(\d+)-(\d+)-(\d+)$", str(key or ""))
    return tuple(int(part) for part in found.groups()) if found else None


def day_of_date(date):
    """A PlayDate ({ year, month, day }) → (year, month, day); None without one."""
    if not isinstance(date, dict):
        return None
    parts = [date.get(key) for key in ("year", "month", "day")]
    return tuple(parts) if all(isinstance(part, int) for part in parts) else None


def volumes_of(book, start, end):
    """The volumes of the book (item 38: GET …/book's, each with its 回; the one under way last)
    that this life saw: those whose days reach into its span (date keys, None for an open end:
    the first life began with the book, the life under way goes on)."""
    low, high = day_of_key(start), day_of_key(end)
    seen = []
    for volume in (book or {}).get("volumes") or []:
        since, until = day_of_date(volume.get("since")), day_of_date(volume.get("until"))
        if low and until and until < low or high and since and since > high:
            continue
        seen.append(M.BookVolume.model_validate(volume))
    return seen


def eulogies_of(said):
    return [M.LegacyEulogy.model_validate(entry) for entry in said or []
            if isinstance(entry, dict) and entry.get("name") and entry.get("text")]


def year_of(key):
    found = re.match(r"^(\d+)-", str(key or ""))
    return int(found.group(1)) if found else None


def left_now(save, play):
    """What the protagonist would leave: the home, the vault, the bag and the purse as they are."""
    state = save.data.get("state") or {}
    tables = state.get("currentState") or {}
    player = (tables.get("0") or {}).get("B1") or {}
    remarks = parse_remarks(player.get("9"))
    vault = parse_nested_json(remarks.get("warehouse", "[]"), [])
    items = tables.get("1") if isinstance(tables.get("1"), dict) else {}
    stored = stored_item_ids(tables)

    def named(item):
        if not isinstance(item, dict):
            return ""
        row = items.get(item.get("id") or item.get("0")) or {}
        return str(item.get("name") or item.get("1") or row.get("1") or "").split("|")[0]

    stones = str(player.get("26") or "").strip()
    home = play.get("home") if isinstance(play.get("home"), dict) else {}
    return M.LifeLeft(home=home.get("name") or None,
                      vault=[name for name in map(named, vault if isinstance(vault, list) else [])
                             if name],
                      bag=[str(row.get("1") or "").split("|")[0] for key, row in items.items()
                           if isinstance(row, dict) and key not in stored and row.get("1")],
                      stones=int(stones) if stones.isdigit() else 0)


def ended_view(play, lives, index, book=None):
    life = lives[index]
    end_year, age = year_of(life.get("died")), life.get("age")
    left = life.get("left") if isinstance(life.get("left"), dict) else {}
    heir = life.get("heir") if isinstance(life.get("heir"), dict) else {}
    return M.LifeView(
        name=str(life.get("name") or ""), gender=life.get("gender") or None,
        realm=life.get("realm") or None, age=age, lifespan=life.get("lifespan"),
        died=life.get("died") or None, place=life.get("place") or None, alive=False,
        index=index, lives=len(lives), years=years_of(life.get("record"), end_year, age),
        gates=gates_of(life.get("passed")),
        volumes=volumes_of(book, lives[index - 1].get("died") if index else None, life.get("died")),
        left=M.LifeLeft(home=left.get("home") or None, vault=list(left.get("vault") or []),
                        bag=list(left.get("bag") or []), stones=int(left.get("stones") or 0),
                        words=life.get("words") or None, heir=heir.get("name") or None,
                        heir_kind=heir.get("kind") or None),
        eulogies=eulogies_of(life.get("eulogies")))


def life_view(save, index=None, book=None):
    """The life record (M.LifeView): an ended life by `index`, by default the dying
    protagonist's while the heir is to be chosen, else the latest that ended, else the life under
    way, with the volumes of `book` (GET …/book's view) it saw. None when the save is not one of
    the cultivation life; IndexError for no such life."""
    play = life_of(save.value)
    if play is None:
        return None
    lives = [life for life in play.get("lives") or [] if isinstance(life, dict)]
    if index is not None:
        if not 0 <= index < len(lives):
            raise IndexError(index)
        return ended_view(play, lives, index, book)
    legacy = play.get("legacy") if isinstance(play.get("legacy"), dict) else None
    if not (legacy and legacy.get("state") == "choosing") and lives:
        return ended_view(play, lives, len(lives) - 1, book)
    player = save.player
    if legacy and legacy.get("state") == "choosing":
        end_year, age = year_of(legacy.get("died")), legacy.get("age")
        name, gender, realm = legacy.get("name"), legacy.get("gender"), legacy.get("realm")
        lifespan, died, place = legacy.get("lifespan"), legacy.get("died"), legacy.get("place")
        said, left = legacy.get("eulogies"), left_now(save, play)
    else:
        found = re.search(r"(\d+)\s*年", str(save.sheet.location_text or ""))
        end_year = int(found.group(1)) if found else None
        age = int(player["age"]) if str(player.get("age") or "").isdigit() else None
        lifespan = int(player["shouyuan"]) if str(player.get("shouyuan") or "").isdigit() else None
        name, gender, realm = player.get("name"), player.get("gender"), player.get("realm")
        died = place = left = None
        said = []
    return M.LifeView(
        name=str(name or "").split("|")[0] or "你", gender=str(gender or "") or None,
        realm=str(realm or "") or None, age=age if isinstance(age, int) else None,
        lifespan=lifespan if isinstance(lifespan, int) else None,
        died=died or None, place=place or None, alive=died is None, index=None,
        lives=len(lives), years=years_of(play.get("record"), end_year, age),
        gates=gates_of(play.get("passed")),
        volumes=volumes_of(book, lives[-1].get("died") if lives else None, None), left=left,
        eulogies=eulogies_of(said))
