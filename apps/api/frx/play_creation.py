"""Character creation on the server (plan item 35).

The options are the old page's CREATION_CONFIG, generated into content/creation.json with the
limits and costs its steps keep in code, plus the player's own custom traits, races, births and
world factors from the settings the old page keeps them in.

A new save is built by the old page's own creation functions (apps/engine/creation.cjs): the
seven steps with the player's choices, then handleStartGame and the selectAndLoadArchive it ends
in. The draws (trait options, spirit root) are the page's own functions run with Math.random
seeded by the creation's seed and the round, so the interface shows a draw first (POST
/creation/draw) and the server draws the same again when the save is made, instead of trusting
the claimed result. Recorded samples of the old page's creation are in
tests/fixtures/parity/creation.
"""

import asyncio
import copy
import json
import time
from functools import cache
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException

from . import play_art as art
from . import play_models as M
from .domain import ROOT
from .gateway import ModelFailure
from .life import at_sect, birth_stones, life_of, month_of, new_life, with_body
from .play_art import ArtStore, check_recipe
from .play_errors import PlayError, from_http, refused
from .play_prompt import run_script, settings_of
from .play_saves import art_of, find_save
from .play_state import save_summary, text_of
from .play_world import DEFAULT_MAP, poi_view

CONTENT = ROOT / "content/creation.json"
# The settings the old page keeps the player's own creation options in.
CUSTOM = {
    "traits": "CULTIVATION_CUSTOM_TRAITS_V1",
    "races": "CULTIVATION_CUSTOM_RACES_V1",
    "births": "CULTIVATION_CUSTOM_BIRTHS_V1",
    "worldFactors": "CULTIVATION_CUSTOM_WORLD_FACTORS_V1",
}
ACTIVE_ARCHIVE_KEY = "CULTIVATION_ACTIVE_ARCHIVE_V1"
DEFAULT_MAP_KEY = "CULTIVATION_DEFAULT_MAP_V1"


@cache
def content():
    return json.loads(CONTENT.read_text(encoding="utf-8"))


@cache
def default_map():
    return json.loads(DEFAULT_MAP.read_text(encoding="utf-8")) if DEFAULT_MAP.is_file() else {}


def birth_world_map(records, settings):
    """The map a new save is born on, as the old page's loadDefaultMapSetting picks it: the
    save the player made the default map, else the card's own."""
    chosen = settings.get(DEFAULT_MAP_KEY)
    if isinstance(chosen, str) and chosen and chosen != "default-initial-map":
        archive = records.get("archives", chosen)["value"]
        data = archive.get("data") if isinstance(archive, dict) else None
        state = data.get("state") if isinstance(data, dict) else None
        world_map = state.get("worldMap") if isinstance(state, dict) else None
        if isinstance(world_map, dict) and world_map:
            return world_map
    return default_map()


def outline_of(shape):
    points = shape.get("points") if isinstance(shape, dict) else None
    if not isinstance(points, list):
        return None
    out = [
        [float(p[0]), float(p[1])]
        for p in points
        if isinstance(p, list | tuple)
        and len(p) >= 2
        and all(isinstance(v, int | float) for v in p[:2])
    ]
    return out or None


def birth_map(world_map):
    """The regions a birthplace can be picked in: those with places, each with its outline and
    its areas (with or without places of their own, so the map draws them)."""
    regions = {}

    def region_of(name, shape=None):
        entry = regions.setdefault(name, {"shape": None, "areas": {}})
        entry["shape"] = entry["shape"] or shape
        return entry

    def area_of(region, name, shape=None):
        entry = region["areas"].setdefault(name, {"shape": None, "pois": []})
        entry["shape"] = entry["shape"] or shape
        return entry

    for shape in world_map.get("main_regions") or []:
        if isinstance(shape, dict) and isinstance(shape.get("name"), str) and shape["name"]:
            region_of(shape["name"], shape)
    for shape in world_map.get("sub_regions") or []:
        if isinstance(shape, dict) and isinstance(shape.get("name"), str) and shape["name"]:
            area_of(region_of(str(shape.get("main_region") or "")), shape["name"], shape)
    for poi in art.pois_of(world_map):
        region = str(poi.get("main_region") or "")
        area = str(poi.get("sub_region") or "") or region
        area_of(region_of(region), area)["pois"].append(poi_view(poi, None))
    return M.BirthMap(
        width=float(world_map.get("width") or 4000),
        height=float(world_map.get("height") or 4000),
        regions=[
            M.BirthRegion(
                id=name,
                name=name,
                text=text_of((entry["shape"] or {}).get("description")) or None,
                outline=outline_of(entry["shape"]),
                areas=[
                    M.BirthArea(id=area, name=area, outline=outline_of(a["shape"]), pois=a["pois"])
                    for area, a in entry["areas"].items()
                ],
            )
            for name, entry in regions.items()
            if name and any(a["pois"] for a in entry["areas"].values())
        ],
    )


def creation_options(records, play=None):
    """Everything the creation steps offer: the page's config, the limits and costs, the
    player's own custom options (as lists, the way the old page keeps them), the map a new
    save is born on and `play`, whether a save of the cultivation life can be made now
    (life.availability)."""
    settings = settings_of(records.list("settings"))
    custom = {}
    for name, key in CUSTOM.items():
        value = settings.get(key)
        custom[name] = copy.deepcopy(value) if isinstance(value, list) else []
    return M.CreationOptions(
        config=M.CreationConfig.model_validate(content()["config"]),
        rules=M.CreationRules.model_validate(content()["rules"]),
        custom=M.CustomOptions.model_validate(custom),
        map=birth_map(birth_world_map(records, settings)),
        play=play,
    )


async def run_creation(payload, failure):
    try:
        return await run_script("creation.cjs", payload)
    except ModelFailure:
        raise PlayError(500, "engine_failed", failure) from None


async def draw(records, request: M.DrawRequest):
    settings = await asyncio.to_thread(lambda: settings_of(records.list("settings")))
    result = await run_creation(
        {
            "mode": "draw",
            "kind": request.kind,
            "seed": request.seed,
            "round": request.round,
            "settings": settings,
            "now": int(time.time() * 1000),
        },
        "抽取没有完成，请稍后重试",
    )
    rules = content()["rules"]
    cost = rules["traitDraw" if request.kind == "traits" else "rootDraw"]["cost"]
    shown = {"traits": result["traits"]} if request.kind == "traits" else {"root": result["root"]}
    return M.DrawAnswer.model_validate(
        {"kind": request.kind, "round": request.round, "cost": cost, **shown}
    )


def creation_inputs(records, name):
    """The settings the page reads while creating and the save holding the default map, if the
    player made another save's map the default; None when the name is taken."""
    if records.get("archives", name)["value"] is not None:
        return None
    settings = settings_of(records.list("settings"))
    chosen = settings.get(DEFAULT_MAP_KEY)
    map_archive = None
    if isinstance(chosen, str) and chosen and chosen != "default-initial-map":
        map_archive = records.get("archives", chosen)["value"]
    return settings, map_archive


def keep_new_save(records, archive, recipe):
    """Store the page's new save, make it the old page's current save and keep the player's
    portrait; False when a save of the name appeared meanwhile."""
    try:
        records.write("archives", archive["name"], archive, 0)
    except HTTPException as exc:
        if exc.status_code == 409:
            return False
        # The player's storage limit (frx.storage): how many saves, how large.
        raise from_http(exc) from None
    with records.sessions.begin() as session:
        records.lock(session)
        records.save_setting(session, ACTIVE_ARCHIVE_KEY, archive["name"])

    def keep(value):
        value.setdefault("portraits", {})["B1"] = {"recipe": recipe, "custom": True}
        return True

    ArtStore(records, archive["data"]["archiveId"]).update(keep)
    return True


def opening_request_id(records, save):
    """Offer the opening only before the first attempted turn; reading never starts a model.

    A stable request ID lets two tabs or a reloaded page use the normal turn deduplication.
    Failed, cancelled and undone requests stay in the ledger and are never auto-started again.
    """
    life = life_of(save.value)
    if not life or not life.get("opening") or life.get("scene") or save.turns():
        return None
    if any(log.get("type") in {"user", "ai"} for log in save.data.get("logs", [])
           if isinstance(log, dict)):
        return None
    with records.sessions() as session:
        if session.scalar(records.requests_of(save.name).exists().select()):
            return None
    return str(uuid5(NAMESPACE_URL, "frx:opening:" + save.archive_id))


async def create_save(records, creation: M.CreationInput, play=None):
    """Create a cultivation life from the engine's character and the life's initial rules.
    `play` (life.availability) must admit the current model before any save is created."""
    if not (play and play.available):
        raise refused(play.reason if play and play.reason else "开不了修仙人生")
    recipe = creation.portrait.wire()
    problem = check_recipe(recipe)
    if problem:
        raise refused(problem)
    found = await asyncio.to_thread(creation_inputs, records, creation.name)
    if found is None:
        raise PlayError(409, "version_conflict", "已有同名的存档，请换个名字")
    settings, map_archive = found
    result = await run_creation(
        {
            "mode": "create",
            # the old page's own creation: it never hears of the way the save is played
            "creation": {k: v for k, v in creation.wire().items() if k != "play"},
            "settings": settings,
            "mapArchive": map_archive,
            "seed": uuid4().hex,
            "now": int(time.time() * 1000),
        },
        "建档没有完成，请稍后重试",
    )
    if not result.get("archive"):
        raise refused(result.get("refused") or "这些选择建不出存档")
    archive = result["archive"]
    state = archive["data"]["state"]
    rows = (state.get("currentState") or {}).get("4") or []
    row = next((r for r in rows if isinstance(r, dict) and r.get("id") == "TIME_LOCATION_ROW"),
               rows[0] if rows and isinstance(rows[0], dict) else {})
    state["frxPlay"] = new_life(month_of(row.get("0")), birth=creation.birth,
                                difficulty=creation.difficulty)
    # A birth in a sect begins at the sect; the 出生地 stays its hometown, and the player
    # has a mortal's body under creation's points (item 50's fixes).
    at_sect(state, creation.birth)
    with_body(state)
    # A 世家 birth's purse (content/life/births.json, plan item 47).
    stones = birth_stones(creation.birth)
    player = (state.get("currentState") or {}).get("0", {}).get("B1")
    if stones and isinstance(player, dict):
        player["26"] = str(int(str(player.get("26") or "0").strip() or 0) + stones)
    if not await asyncio.to_thread(keep_new_save, records, archive, recipe):
        raise PlayError(409, "version_conflict", "已有同名的存档，请换个名字")

    def summary():
        save = find_save(records, archive["data"]["archiveId"])
        return save_summary(save.archive_id, art_of(records, save), False)

    return await asyncio.to_thread(summary)
