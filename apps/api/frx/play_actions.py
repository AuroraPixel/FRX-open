"""Panel actions (plan item 34): putting gear on, taking it off, tidying the bag, marking a
character as bonded or not, and feeding a spirit beast; in the cultivation life the length of a
scene's beats, the sect's actions (item 46) and choosing the heir after a death of old age
(inherit, item 49: the engine's op legacy, with play_legacy's biography and portraits).

The rules are the old page's own: apps/engine/panel.cjs runs its equipItem, unequipItem,
_updateEquipmentSlot and sortInventory, its 标记为羁绊 / 取消羁绊 handler or its
handlePersistentFeed on the stored save and returns the save the page would put back. It is
written through CardStore.write with the version the player saw and the scope the page's own save
carries, so the server treats it exactly as the old page's write (the round's packed snapshot is
refreshed, the server's plot state is kept). A new action is an entry of panel.cjs's ACTIONS and,
when it changes something the state view does not show, of EXTRA_CHANGES here. Recorded samples
of the old page doing the same are in tests/fixtures/parity/actions and, for feeding,
tests/fixtures/parity/feed.

Feeding draws twice (how much the aptitude moves, and a perfect absorption): with the seed
「<archiveId>:feed:<version>」, as character creation draws with 「<seed>:<kind>:<round>」, so a
feed sent again on the same version draws the same. A beast whose aptitude broke through puts the
page's hidden beast_evolve line in the action queue: the result carries it as a chip.

A panel action never runs beside a turn: while a turn is generating or waits to be settled the
action is refused, as the old page's write would have been (or would have broken the turn).

In the cultivation life gear goes on and off, and the belt is set, by the life's own rules
(apps/engine/life/gear.cjs: tiers, the main method, the active slots): the engine's op, its
receipts settled on the save as a turn's are (the whole-turn settle with no story), no log
written. A save of the novel never reaches it, and the belt is the life's alone.
"""

import asyncio
import copy
import logging
import time
from uuid import uuid4

from fastapi import HTTPException

from . import card_turns, play_legacy
from . import play_models as M
from .card_director import engine_progress, plot_payload
from .card_store import CardRequest
from .gateway import ModelFailure
from .life import life_of
from .life_prompt import LENGTHS, length_of
from .life_turns import LifeRefusal, life_op, settled_archive
from .play_art import check_recipe, plain_name
from .play_errors import PlayError, refused
from .play_prompt import run_script, settings_of
from .play_saves import art_of, find_save, places_of
from .play_state import Save, state_view
from .request_policy import request_blocks_archive
from .turn_runtime import settle_card

logger = logging.getLogger(__name__)

# The interface's names for the four kinds of equipment cells.
KIND_LABEL = {"weapon": "兵器", "armor": "防具", "technique": "功法", "treasure": "法宝"}
# Turn requests that hold a save (card_store.begin_request): a reply waiting to be saved, or one
# being generated or repaired that has not gone stale.
LIVE = ("generating", "ready", "repairing")


def version_conflict():
    return PlayError(409, "version_conflict", "存档已在别处改动，请重新读取后再试")


def check_no_turn(records, save):
    """Refuse while a turn holds the save: its reply waits to be settled, or it is running."""
    logs = save.data.get("logs") if isinstance(save.data.get("logs"), list) else []
    last_reply = next(
        (log for log in reversed(logs) if isinstance(log, dict) and log.get("type") == "ai"), None
    )
    if last_reply and last_reply.get("frxPending"):
        raise PlayError(409, "pending_settlement", "上一回合还在等待结算，请先重试结算或撤回")
    check_running_turn(records, save)


def check_running_turn(records, save):
    """Refuse while a turn is being generated or repaired (until it goes stale, as begin_request
    counts it) or its whole reply waits to be saved."""
    with records.sessions() as session:
        rows = session.scalars(
            records.requests_of(save.name).where(CardRequest.status.in_(LIVE))
        ).all()
        for row in rows:
            if request_blocks_archive(row):
                raise PlayError(409, "turn_in_progress", "这个存档正在进行回合，请等回合结束再操作")


def page_scope(save):
    """The scope the old page's save carries (FRX.captureScope): the save, its id, its last log
    and its timeline epoch."""
    logs = save.data.get("logs") if isinstance(save.data.get("logs"), list) else []
    last = logs[-1] if logs and isinstance(logs[-1], dict) else {}
    return {
        "archive": save.name,
        "archive_id": save.data.get("archiveId"),
        "log_id": last.get("id"),
        "epoch": save.data.get("frxTimelineEpoch", ""),
    }


async def full_state(records, save):
    """The state view as GET /saves/{id}/state answers it, cultivation progress included."""
    art = await asyncio.to_thread(art_of, records, save)
    looks = await asyncio.to_thread(places_of, records, save)
    plot = save.plot()
    progress = await engine_progress(save.value, plot_payload(plot) if plot else None)
    return state_view(save, art, progress, looks)


def _cell(item):
    return (item.id, item.name) if item else None


def _amount(attribute):
    return str(attribute.total) if attribute.max is None else f"{attribute.total}/{attribute.max}"


def changes_between(before, after, action):
    """What the action changed, for the interface's notice: the equipment cells, the bag's order
    (tidying) and every attribute total that moved."""
    changes = []
    for kind, label in KIND_LABEL.items():
        cells = zip(getattr(before.equipment, kind), getattr(after.equipment, kind), strict=True)
        for index, (old, new) in enumerate(cells):
            if _cell(old) != _cell(new):
                changes.append(
                    M.Change(
                        path=f"equipment.{kind}.{index}",
                        label=label,
                        before=old.name if old else None,
                        after=new.name if new else None,
                    )
                )
    if action == "tidy" and [i.id for i in before.bag] != [i.id for i in after.bag]:
        changes.append(M.Change(path="bag", label="储物袋", after="已整理"))
    old = {attribute.key: attribute for attribute in before.player.attributes}
    for attribute in after.player.attributes:
        was = old.get(attribute.key)
        if was and _amount(was) != _amount(attribute):
            changes.append(
                M.Change(
                    path=f"player.attributes.{attribute.key}",
                    label=attribute.label,
                    before=_amount(was),
                    after=_amount(attribute),
                )
            )
    return changes


def bond_changes(before, after, action):
    """The character marked as bonded or no longer: a person the state view may not list (one
    who left the scene stays listed among the people while bonded)."""
    char_id = action.char_id or ""
    data = after.sheet.characters.get(char_id) or before.sheet.characters.get(char_id) or {}
    was = bool((before.sheet.characters.get(char_id) or {}).get("isBonded") is True)
    now = bool((after.sheet.characters.get(char_id) or {}).get("isBonded") is True)
    if was == now:
        return []
    name = plain_name(data.get("name")) or char_id
    return [
        M.Change(
            path=f"people.{char_id}.bonded",
            label=name,
            before="羁绊" if was else None,
            after="羁绊" if now else None,
        )
    ]


# What an action changed beyond the equipment, the bag and the player's totals (a feed's own
# changes, which read the state views, are added in act).
# The cultivation life's length tiers as the player names them (content/life/prompt.json).
LENGTH_NAMES = {tier: entry["name"] for tier, entry in LENGTHS["tiers"].items()}


def with_length(save, length):
    """The save with its beats' length set (frxPlay.length): a save of the cultivation life only;
    the panel engine never sees this action."""
    play = life_of(save.value)
    if play is None:
        raise refused("这个存档不是修仙人生，没有篇幅可选")
    if length not in LENGTH_NAMES:
        raise refused("要选一档篇幅：简、中或详")
    archive = copy.deepcopy(save.value)
    archive["data"]["state"]["frxPlay"] = {**play, "length": length}
    return archive


def length_changes(before, after, action):
    old = LENGTH_NAMES.get(length_of(life_of(before.value)), "")
    new = LENGTH_NAMES.get(length_of(life_of(after.value)), "")
    return [] if old == new else [M.Change(path="play.length", label="篇幅", before=old, after=new)]


def belt_changes(before, after, action):
    """The belt (the life's, frxPlay.belt) before and after, by the names in the bag."""

    def worn(save):
        bag = ((save.value["data"]["state"].get("currentState") or {}).get("1") or {})
        ids = (life_of(save.value) or {}).get("belt") or []
        return "、".join(plain_name((bag.get(item) or {}).get("1")) or item for item in ids) or "空"

    old, new = worn(before), worn(after)
    return [M.Change(path="play.belt", label="腰带", before=old, after=new)] if old != new else []


# The sect's panel actions (gameplay plan item 46), each one action of the engine's op sect, for
# a save of the cultivation life only (the engine refuses any other as not_life).
SECT_ACTIONS = {"sect_join": "join", "sect_exchange": "exchange", "sect_promote": "promote",
                "sect_enter": "enter"}
NOT_LIFE = "这个存档不是修仙人生，没有宗门"
NO_LEGACY = "这个存档不是修仙人生，没有传承"


async def life_action(save, op, args, not_life=NOT_LIFE):
    """One op of the engine's life mode on the stored save, as a panel action: the engine settles
    it on the save and keeps the tables and the frxPlay it leaves (life mode `keep`), which are
    the save to write. Refused with the engine's words."""
    payload = {"mode": "life", "op": op, "archive": save.value, "args": args,
               "seed": f"{save.archive_id}:{op}:{save.version}", "keep": True}
    try:
        result = await card_turns.run_engine(payload)
    except ModelFailure:
        raise PlayError(500, "engine_failed", "引擎结算没有完成，请稍后重试") from None
    if result.get("error") == "not_life":
        raise refused(not_life)
    if result.get("error"):
        raise refused(str(result.get("reason") or "这件事现在做不了"))
    if result.get("errors") or not isinstance(result.get("kept"), dict):
        raise PlayError(500, "engine_failed", "引擎结算没有完成，请稍后重试")
    archive = copy.deepcopy(save.value)
    archive["data"]["state"]["currentState"] = result["kept"]["currentState"]
    archive["data"]["state"]["frxPlay"] = result["kept"]["frxPlay"]
    return {"archive": archive, "receipts": result.get("receipts") or []}


def sect_args(action):
    name = SECT_ACTIONS[action.action]
    if name == "join":
        return {"action": name, "sect": action.sect or "", "by": action.by or "fair"}
    if name == "exchange":
        return {"action": name, "id": action.offer_id or ""}
    if name == "enter":
        return {"action": name, "contest": action.contest or ""}
    return {"action": name}


def sect_changes(before, after, action):
    """What a sect action changed (the saves before and after): the sect joined, the status, the
    contribution, the contest signed up for (the bag's new things show in the bag)."""
    def sect_of(save):
        sect = (life_of(save.value) or {}).get("sect")
        return sect if isinstance(sect, dict) else {}
    old, new = sect_of(before), sect_of(after)
    changes = []
    if old.get("name") != new.get("name"):
        changes.append(M.Change(path="play.sect", label="宗门", before=old.get("name"),
                                after=new.get("name")))
    for key, label in (("status", "身份"), ("contribution", "贡献")):
        if old and new and old.get(key) != new.get(key):
            changes.append(M.Change(path=f"play.sect.{key}", label=label,
                                    before=str(old.get(key)), after=str(new.get(key))))
    was = (old.get("entered") or {}).get("contest")
    now = (new.get("entered") or {}).get("contest")
    if was != now:
        changes.append(M.Change(path="play.sect.entered", label="报名", before=was, after=now))
    return changes


async def inherit(records, save, action):
    """The heir goes on (item 49): the engine's op legacy (choose) with a new heir's root (the
    one drawn after the dying turn, else drawn now on the save's seed), then the predecessor's
    biography and the relations kept in the archive to write (play_legacy)."""
    if action.portrait is not None and (problem := check_recipe(action.portrait.wire())):
        raise refused(problem)
    legacy = (life_of(save.value) or {}).get("legacy")
    root = None
    if action.heir == "new" and isinstance(legacy, dict) and legacy.get("state") == "choosing":
        root = legacy.get("root") or await play_legacy.draw_root(
            records, save.archive_id, legacy.get("died"))
    result = await life_action(save, "legacy", {
        "action": "choose", "heir": action.heir or "", "name": action.name or "",
        "gender": action.gender or "", "words": action.words or "", "root": root or ""},
        not_life=NO_LEGACY)
    play_legacy.keep_biography(result["archive"], result["receipts"])
    return result


def legacy_changes(before, after, action):
    """Who went on after whom (the rest shows in the state)."""
    life = life_of(after.value) or {}
    ended = (life.get("lives") or [{}])[-1]
    heir = ended.get("heir") if isinstance(ended.get("heir"), dict) else {}
    return [M.Change(path="play.legacy", label="传承", before=ended.get("name"),
                     after=heir.get("name"))]


EXTRA_CHANGES = {"bond": bond_changes, "unbond": bond_changes, "length": length_changes,
                 "belt": belt_changes, "inherit": legacy_changes,
                 **{name: sect_changes for name in SECT_ACTIONS}}

# The panel actions the cultivation life does by its own rules: the engine's op of each (gear.cjs,
# beasts.cjs); the beasts' own four are the life's alone.
LIFE_OPS = {"equip": "equip", "unequip": "unequip", "belt": "belt", "feed": "feed",
            "out": "beast", "in": "beast", "hatch": "beast", "promote": "beast"}
BEAST_ACTIONS = {"out", "in", "hatch", "promote"}


def feed_seed(archive_id, version):
    """The seed of a feed's draws: the save and the version it is fed on."""
    return f"{archive_id}:feed:{version}"


def _aptitude(beast):
    aptitude = beast.aptitude
    return f"{aptitude.tier} {aptitude.current} / {aptitude.max}" if aptitude else None


def feed_changes(before, after, action):
    """What a feed changed: the beast's aptitude and affection, and the food's count."""
    old = next((b for b in before.beasts if b.id == action.beast_id), None)
    new = next((b for b in after.beasts if b.id == action.beast_id), None)
    changes = []
    if old and new:
        path = f"beasts.{new.id}"
        for key, label, was, now in (
            ("aptitude", "资质", _aptitude(old), _aptitude(new)),
            ("affection", "好感", old.affection, new.affection),
        ):
            if was != now:
                changes.append(M.Change(path=f"{path}.{key}", label=label,
                                        before=None if was is None else str(was),
                                        after=None if now is None else str(now)))
    food = next((item for item in before.bag if item.id == action.item_id), None)
    left = next((item for item in after.bag if item.id == action.item_id), None)
    if food and (left is None or left.quantity != food.quantity):
        changes.append(M.Change(path=f"bag.{food.id}", label=food.name, before=str(food.quantity),
                                after=str(left.quantity) if left else None))
    return changes


def evolution_chips(result, state, action):
    """The page's beast_evolve line, left in its action queue by a feed, as a chip: labelled with
    the beast and its new grade, the line itself the note the next turn sends."""
    beast = next((b for b in state.beasts if b.id == action.beast_id), None)
    return [
        M.QueueItem(
            kind="other",
            text=f"蜕 · {beast.name} → {beast.aptitude.tier}" if beast and beast.aptitude
            else "蜕 · 灵兽",
            note=entry["text"],
            silent=True,
        )
        for entry in result.get("queue") or []
        if entry.get("type") == "beast_evolve"
    ]


async def run_panel(records, save, action):
    """What the old page does for the action: the save it puts back and what else it left (a
    feed's log and action queue); refused as the page refuses."""
    settings = await asyncio.to_thread(lambda: settings_of(records.list("settings")))
    wanted = action.wire()
    if action.action == "feed":
        wanted["seed"] = feed_seed(save.archive_id, save.version)
    payload = {
        "archive": save.value,
        "settings": settings,
        "action": wanted,
        "seed": uuid4().hex,
        "now": int(time.time() * 1000),
    }
    try:
        result = await run_script("panel.cjs", payload)
    except ModelFailure:
        raise PlayError(500, "engine_failed", "整理行囊时出了错，请稍后重试") from None
    if result.get("archive") is None:
        said = next((s["text"] for s in result.get("said") or [] if s.get("text")), None)
        raise refused(said or "这件东西现在动不了")
    return result


async def run_life(save, action):
    """The cultivation life's gear, belt and spirit beasts: the engine's op on the save
    (gear.cjs, beasts.cjs), its receipts settled on it as a turn's are; refused as the engine
    refuses (a piece two tiers up, a belt of more than five things or of things a belt cannot
    hold, a beast fed too often this month, a promotion without what it takes)."""
    op = LIFE_OPS[action.action]
    if op == "belt":
        if action.items is None:
            raise PlayError(422, "invalid_input", "腰带要给一组东西（items）")
        args = {"items": list(action.items)}
    elif op == "beast" or op == "feed":
        needs = {"feed": ("beast_id", "item_id"), "out": ("beast_id",), "in": (),
                 "hatch": ("item_id",), "promote": ("beast_id", "item_id")}[action.action]
        missing = [name for name in needs if not getattr(action, name)]
        if missing:
            raise PlayError(422, "invalid_input",
                            "要给" + "、".join({"beast_id": "一只灵兽（beastId）",
                                                "item_id": "一件东西（itemId）"}[name]
                                               for name in missing))
        args = {**({"action": action.action} if op == "beast" else {}),
                **({"beastId": action.beast_id} if action.beast_id else {}),
                **({"itemId": action.item_id} if action.item_id else {})}
    else:
        if not action.item_id:
            raise PlayError(422, "invalid_input", "要给一件东西（itemId）")
        args = {"itemId": action.item_id}
    seed = f"{save.archive_id}:{op}:{save.version}"
    try:
        done = await life_op(save.value, seed, {}, [], op, args)
        settled = await settle_card(save.value, "", seed, {},
                                    pilot={"receipts": done.get("receipts") or [], "story": ""})
    except LifeRefusal as refusal:
        raise refused(str(refusal)) from None
    except ModelFailure:
        raise PlayError(500, "engine_failed", "整理行囊时出了错，请稍后重试") from None
    if settled.get("errors"):
        raise PlayError(500, "engine_failed", "整理行囊时出了错，请稍后重试")
    return {"archive": settled_archive(save.value, settled)}


async def act(records, archive_id, action: M.PanelAction, follows=None):
    """Do one panel action on the user's save; the new state view and what changed.

    `follows(name, version, stored)` says whether only the work after a turn (play_jobs) has
    written the save since the version the player saw: that version is still current, as it is
    for a turn. Before, the daily paper written a few seconds after a turn made the next 整理 or
    装备 「存档已在别处改动」 (实玩二, the panels' end-to-end run)."""
    save = await asyncio.to_thread(find_save, records, archive_id)
    if action.version != save.version and not (
        follows and follows(save.name, action.version, save.version)
    ):
        raise version_conflict()
    await asyncio.to_thread(check_no_turn, records, save)
    if life_of(save.value) is not None:
        # the life's attributes count its active gear, which the engine's progress reads
        before = await full_state(records, save)
    else:
        before = state_view(save, await asyncio.to_thread(art_of, records, save),
                            looks=await asyncio.to_thread(places_of, records, save))
    if action.action == "length":
        result = {"archive": with_length(save, action.length)}
    elif life_of(save.value) is not None and action.action in LIFE_OPS:
        result = await run_life(save, action)
    elif action.action == "belt":
        raise refused("腰带只有修仙人生的存档有")
    elif action.action in BEAST_ACTIONS:
        raise refused("灵兽出战、孵蛋和进阶只有修仙人生的存档有")
    elif action.action in SECT_ACTIONS:
        result = await life_action(save, "sect", sect_args(action))
    elif action.action == "inherit":
        result = await inherit(records, save, action)
    else:
        result = await run_panel(records, save, action)
    try:
        written = await asyncio.to_thread(
            records.write, "archives", save.name, result["archive"], save.version,
            page_scope(save),
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise version_conflict() from None
        if exc.status_code == 413:
            # The save would pass the player's storage limit (frx.storage): it says which.
            raise PlayError(413, "input_too_large", exc.detail) from None
        raise PlayError(500, "engine_failed", "存档没能写入，请重新读取后再试") from None
    after = Save(save.name, written["version"], written["value"])
    if action.action == "inherit":
        try:
            await asyncio.to_thread(play_legacy.move_portraits, records, save.archive_id,
                                    result["receipts"],
                                    action.portrait.wire() if action.portrait else None)
        except Exception as error:  # the heir is written; a portrait is made when next read
            logger.warning("legacy_portraits_failed error=%s", type(error).__name__)
    state = await full_state(records, after)
    changes = changes_between(before, state, action.action)
    extra = EXTRA_CHANGES.get(action.action)
    if extra:
        changes += extra(save, after, action)
    if action.action == "feed":
        changes += feed_changes(before, state, action)
        return M.PanelResult(state=state, changes=changes,
                             queue=evolution_chips(result, state, action) or None)
    return M.PanelResult(state=state, changes=changes)
