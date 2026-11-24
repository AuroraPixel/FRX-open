"""The cultivation life (修仙人生), the second way to play a save (docs/gameplay-design.md;
docs/gameplay-plan.md, 「开关」).

A save is in it when data.state.frxPlay has version 1. Every other save plays the novel exactly as
before and never reaches the life's code: life_of is the one place that tells the two apart, and
nothing else reads the key. A new save chooses at creation (CreationInput.play); the server puts
new_life() into it before keeping it. The engine's own check is apps/engine/life/index.cjs lifeOf,
the same rule.
"""

import copy
import json
import re

from . import play_models as M
from .card_turns import tool_capable
from .domain import ROOT

VERSION = 1
FIRST_MONTH = "0001-01"

# The births' starting status (content/life/births.json, plan item 47).
BIRTHS_FILE = json.loads((ROOT / "content/life/births.json").read_text(encoding="utf-8"))
BIRTHS = BIRTHS_FILE["births"]
BODY = BIRTHS_FILE["body"]
BASELINES = json.loads((ROOT / "content/combat.json").read_text(encoding="utf-8"))["baselines"]
SECTS = json.loads((ROOT / "content/life/sects.json").read_text(encoding="utf-8"))["sects"]
MONTH_DAYS = 30

UNCONFIGURED = "还没有配置主回合的模型，开不了修仙人生"
UNADMITTED = "眼下的模型没有通过工具准入，开不了修仙人生"


def life_of(save):
    """The save's frxPlay when it plays the cultivation life, else None. `save` is a save's
    value ({"data": …}) or anything holding one as `.value` (play_state.Save)."""
    value = getattr(save, "value", save)
    data = value.get("data") if isinstance(value, dict) else None
    state = data.get("state") if isinstance(data, dict) else None
    play = state.get("frxPlay") if isinstance(state, dict) else None
    return play if isinstance(play, dict) and play.get("version") == VERSION else None


def new_life(month=FIRST_MONTH, birth=None, difficulty=None):
    """A new save's frxPlay (the gameplay plan's 「存档里多存什么」): nothing under way yet, the
    month settlement at the save's first month. Later work adds its own keys. A save made at
    creation (`birth` given) starts with its opening scene to play (`opening`, item 25) and the
    director due once that scene closes (`directorDue`, the month), and with what its birth gives
    (`birth`, and start_of: a sect, a clue, a clock, a perk, a home, a relation to come; item 47);
    `difficulty` is the creation's, for the rules' knobs (content/life/world.json)."""
    made = {
        "version": VERSION,
        "length": "standard",
        "scene": None,
        "cards": None,
        "fight": None,
        "clocks": [],
        "calendar": [],
        "pending": [],
        "month": month,
        "gates": {},
        "foundation": {},
        "perks": [],
        "offer": None,
        "seen": [],
        "counters": {"scene": 0, "fight": 0, "clock": 0},
    }
    if birth is not None:
        made["opening"] = {"birth": str(birth)}
        made["directorDue"] = month
        made["birth"] = str(birth)
        started(made, month, start_of(birth))
    if difficulty is not None:
        made["difficulty"] = str(difficulty)
    return made


def start_of(birth):
    """What a birth gives at the start (content/life/births.json start), {} for 无 or unknown."""
    entry = BIRTHS.get(str(birth)) if birth is not None else None
    start = entry.get("start") if isinstance(entry, dict) else None
    return copy.deepcopy(start) if isinstance(start, dict) else {}


def _day(month, days=0):
    """A day of the game's calendar written as frxPlay writes it, `days` after the month's first."""
    year, number = (int(part) for part in month.split("-"))
    index = (year - 1) * 12 + number - 1
    total = index * MONTH_DAYS + days
    year, rest = divmod(total, 12 * MONTH_DAYS)
    number, day = divmod(rest, MONTH_DAYS)
    return f"{year + 1:04d}-{number + 1:02d}-{day + 1:02d}"


def started(made, month, start):
    """Puts a birth's start into a new frxPlay (the engine's own shapes: sect.cjs, clocks.cjs,
    ask.cjs's clues, the pending events, perks)."""
    day = _day(month)
    counters = made["counters"]
    if start.get("sect"):
        sect = start["sect"]
        made["sect"] = {"name": sect["name"], "status": sect["status"], "contribution": 0,
                        "earned": 0, "joined": day, "duty": {"since": day, "done": 0},
                        "bought": {}, "herbs": 0,
                        **({"assigned": sect["duty"]} if sect.get("duty") else {})}
    if start.get("clue"):
        counters["clue"] = 1
        made["clues"] = [{"id": "L1", "key": "birth:clue", "kind": "birth", "text": start["clue"],
                          "date": day}]
    if start.get("relation"):
        counters["pending"] = 1
        due = _day(month, MONTH_DAYS)
        made["pending"] = [{"id": "P1", "trigger": {"kind": "date", "value": due},
                            "seed": start["relation"], "from": "birth", "since": day}]
    if start.get("clock"):
        spec = start["clock"]
        counters["clock"] = 1
        made["clocks"] = [{"id": "K1", "name": spec["name"],
                           "scope": {"kind": spec.get("scope", "self"), "value": ""},
                           "size": spec["size"], "value": spec["value"], "rises": spec["rises"],
                           "falls": spec["falls"], "full": spec["full"], "since": day,
                           "counted": day, "count": {"days": 0, "away": 0}, "filled": None,
                           "from": "engine"}]
    if start.get("perk"):
        made["perks"] = [start["perk"]]
    if start.get("home"):
        # the home's map place (births.json: 落灯海岛主's island), without which home.cjs reads
        # the player as having none
        made["home"] = {"name": start["home"]["name"], "aura": start["home"]["aura"],
                        "place": start["home"].get("place")}


def sect_place(birth):
    """The map place of the sect a birth starts in (births.json start.sect, sects.json place), or
    None: a birth with no sect, or a sect with no place of its own (引灯司)."""
    sect = (start_of(birth).get("sect") or {}).get("name")
    entry = SECTS.get(sect) if sect else None
    return (entry or {}).get("place") or None


def at_sect(state, birth):
    """A life save whose birth starts in a sect begins at that sect (plan item 50's fixes): the
    time row's place becomes the sect's map place, written as creation writes a place
    (主/次|(名) |x,y). The 出生地 stays the hometown where creation's text names it (its first
    message). Whether it moved: not for a birth with no sect place, or one the map lacks."""
    place = sect_place(birth)
    world = state.get("worldMap") or {}
    poi = next((each for each in world.get("points_of_interest") or []
                if each.get("name") == place), None) if place else None
    rows = (state.get("currentState") or {}).get("4") or []
    row = next((each for each in rows
                if isinstance(each, dict) and each.get("id") == "TIME_LOCATION_ROW"), None)
    if not poi or not row or "/" not in str(row.get("0") or ""):
        return False
    subs = {each.get("name") for each in world.get("sub_regions") or []}
    region = poi["main_region"] + (f"/{poi['sub_region']}" if poi.get("sub_region") in subs else "")
    when = str(row["0"]).split("/", 1)[0]
    row["0"] = f"{when}/{region}|({poi['name']}) |{round(poi['x'])},{round(poi['y'])}"
    return True


def with_body(state):
    """A new life save's player has a mortal's body under what creation gave (births.json body,
    plan item 50's fixes): each stat of the realm's baseline (content/combat.json) but 血量, which
    creation sets, at `at` of its range, added to the panel creation wrote (its points). Whether
    the panel changed (not for a player row or a panel creation did not write)."""
    player = ((state.get("currentState") or {}).get("0") or {}).get("B1")
    try:
        panel = json.loads(player["11"]) if isinstance(player, dict) else None
    except (TypeError, ValueError):
        panel = None
    if not isinstance(panel, dict):
        return False
    for stat, (low, high) in BASELINES[BODY["realm"]].items():
        value = int(low + BODY["at"] * (high - low) + 0.5)
        if stat == "血量" or not value:
            continue
        entry = panel.get(stat) if isinstance(panel.get(stat), dict) else {}
        panel[stat] = {"current": int(entry.get("current") or 0) + value,
                       "max": int(entry.get("max") or 0) + value}
    player["11"] = json.dumps(panel, ensure_ascii=False, separators=(",", ":"))
    return True


def birth_stones(birth):
    """The spirit stones a birth brings (a 世家's purse), added to the player's at creation."""
    return int(start_of(birth).get("stones") or 0)


def month_of(time_text):
    """The month a time row is in, as frxPlay.month writes it ("0001-03"); the first month when
    the row has no readable date."""
    found = re.search(r"(\d+)\s*年\s*(\d+)\s*月", str(time_text or ""))
    if not found or int(found[1]) < 1 or not 1 <= int(found[2]) <= 12:
        return FIRST_MONTH
    return f"{int(found[1]):04d}-{int(found[2]):02d}"


def availability(model):
    """Whether a save of the cultivation life can be made now: the main turn's model must have
    passed tool admission (the life's scenes need the engine's turn and its tools)."""
    if not model:
        return M.PlayAvailability(available=False, reason=UNCONFIGURED)
    if not tool_capable(model):
        return M.PlayAvailability(available=False, reason=UNADMITTED)
    return M.PlayAvailability(available=True)
