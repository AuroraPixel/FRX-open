"""A turn of the new interface, played and committed on the server.

The old page built the prompt, saved the player's log, asked the server for the reply, then
uploaded the whole save so the server could apply its own settlement. Here the server does all
of it: the prompt as the page built it (play_prompt: assembly and memory recall), the player's
log, the reply and its settlement (turn_runtime), and the AI log as the page wrote it
(apps/engine/after.cjs), committed through CardStore.write so apply_settlement settles the turn
exactly as it did for the page's upload.

TurnPlay runs one turn and reports what happens as it goes to a listener; the event stream of
the new interface is built from those reports (TurnRun, play_api).
"""

import asyncio
import copy
import json
import logging
import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from . import play_death, play_places, play_prompt, usage
from .card_director import engine_progress, plot_payload
from .card_store import CardRequest
from .card_timeline import CardTimeline
from .card_turns import StoryFilter, tidy_reply, tool_capable
from .gateway import ModelFailure
from .life import life_of
from .life_turns import (
    ENCOUNTER_ON,
    FIGHT_ON,
    NOT_LIFE,
    OPENING_ON,
    annals_of,
    close_reported,
    elaborate_stream,
    engine_report,
    fight_end_of,
    free_verb,
    gate_of,
    interruption_of,
    life_op,
    life_pilot_stream,
    life_stream,
    move_words,
    protected_action,
    realm_args,
    run_verb,
    scene_opened,
    step_words,
    verb_words,
)
from .play_blocks import (
    OPTION_LETTER,
    PENDING,
    Cast,
    StoryStream,
    action_block,
    actions_block,
    branch_options,
    chronicle_block,
    chronicle_entries,
    history,
    is_turn,
    options_block,
    perks_on_offer,
    plain,
    receipt_blocks,
    story_of,
    told_after,
    turn_blocks,
)
from .play_errors import STATUS, PlayError, conflict_code
from .play_saves import art_of, find_save, places_of
from .play_state import SCENE_ON, Save, change_basis, place_reading, state_view
from .request_policy import GENERATION_SECONDS, request_blocks_archive
from .turn_runtime import (
    STORE_BUSY,
    CardGenerate,
    LifeRefusal,
    pilot_stream,
    plan_turn,
    repair_turn,
    reserved_archive,
    settle_variables,
    upstore_stream,
)

logger = logging.getLogger(__name__)

COMMIT_ATTEMPTS = 3
# Recognized by the life engine's clock.seedOf. It travels with the reserved request seed.
REROLL_PREFIX = "reroll:"


class TurnError(PlayError):
    """A turn that cannot start or go on, with the contract's error code and the words the
    player sees (docs/play-contracts.md, ErrorCode). Raised under a route it is the response,
    with the status the contract gives the code."""

    def __init__(self, code, message, status=None, retryable=False, headers=None):
        super().__init__(status or STATUS[code], code, message, headers)
        self.retryable = retryable

    def retry_timing(self):
        delay = (self.headers or {}).get("Retry-After")
        return {"retryAfter": int(delay)} if delay and delay.isdigit() else {}


CODES = {400: "model_not_configured", 404: "not_found", 413: "input_too_large"}


def turn_error(exc):
    """The contract's error for a failure of the shared pipeline."""
    if isinstance(exc, TurnError):
        return exc
    if isinstance(exc, PlayError):
        return TurnError(exc.code, exc.message, exc.status, exc.status == 429, exc.headers)
    if isinstance(exc, LifeRefusal):
        return TurnError("refused", str(exc))
    if isinstance(exc, HTTPException):
        message = exc.detail if isinstance(exc.detail, str) else exc.detail.get("message", "")
        if exc.status_code == 409:
            return TurnError(conflict_code(message), message)
        if exc.status_code == 502:
            return TurnError("model_failed", message, retryable=True)
        return TurnError(CODES.get(exc.status_code, "engine_failed"), message)
    if isinstance(exc, ModelFailure):
        return TurnError("model_failed", str(exc), retryable=True)
    return TurnError("engine_failed", "回合未能完成，请稍后重试", retryable=True)


def iso_now():
    """The time as the page writes it (Date.prototype.toISOString)."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def frame(chunk):
    """One server-sent event of the shared pipeline as JSON, or "done" for its end mark."""
    raw = chunk.removeprefix("data: ").strip()
    return "done" if raw == "[DONE]" else json.loads(raw)


# ---------------------------------------------------------------- the save and its turns


def settled_turns(logs):
    """The replies of the turns settled so far, in order: what the state view counts."""
    return [log for log in logs if is_turn(log) and not log.get("frxPending")]


def turn_count(logs):
    return len(settled_turns(logs))


def in_flight(records, name):
    """Turn requests of this save still generating, waiting or being repaired."""
    with records.sessions() as session:
        rows = session.scalars(
            records.requests_of(name).where(
                CardRequest.status.in_(["generating", "ready", "repairing"])
            )
        ).all()
        return [row.id for row in rows if request_blocks_archive(row)]


def check_can_play(records, name, value):
    """What stops a new turn before anything is written: a turn waiting for its settlement or
    one still in progress (begin_request checks the same again when it reserves the turn)."""
    logs = value["data"].get("logs", [])
    last_reply = next((log for log in reversed(logs) if log.get("type") == "ai"), None)
    if last_reply and last_reply.get("frxPending"):
        raise TurnError("pending_settlement", "上一回合仍待结算，请先重试结算或撤回")
    if in_flight(records, name):
        raise TurnError("turn_in_progress", "此存档已有回合正在生成，请等待或停止后继续")


# ---------------------------------------------------------------- the action queue

BAG = "1"
PEOPLE = "0"


def plain_name(row):
    return re.sub(r"<[^>]*>", "", str((row or {}).get("1", ""))).split("|")[0].strip()


def queue_actions(state, queue):
    """The new interface's action queue as the old page's addAction calls ({type, data,
    context, silent}); assemble.cjs runs addAction itself, so the words in the prompt are the
    page's own. Raises TurnError for an item, person or place the save does not have."""
    tables = state.get("currentState") or {}
    bag, people = tables.get(BAG) or {}, tables.get(PEOPLE) or {}

    def item(entry):
        row = bag.get(entry.get("itemId") or "")
        if not row:
            raise TurnError("invalid_input", "储物袋中没有这件物品")
        return {"id": entry["itemId"], "name": plain_name(row)}

    def giftable(entry):
        # The old page's gift picker leaves important items out (app.js 38877).
        found = item(entry)
        if str(bag[entry["itemId"]].get("2", "")).strip() == "重要物品":
            raise TurnError("invalid_input", f"「{found['name']}」是重要物品，不能赠送", 422)
        return found

    def person(entry):
        row = people.get(entry.get("charId") or "")
        if not row:
            raise TurnError("invalid_input", "找不到这个人物")
        return {"charName": plain_name(row)}

    actions = []
    for entry in queue:
        silent = bool(entry.get("silent"))
        kind = entry["kind"]
        if kind == "use":
            actions += [{"type": "use", "data": {"id": entry.get("itemId")}, "silent": silent}] * (
                entry.get("quantity") or 1
            )
        elif kind == "discard":
            actions.append({"type": "discard", "data": item(entry), "silent": silent})
        elif kind == "gift":
            actions.append(
                {"type": "gift", "data": giftable(entry), "context": person(entry),
                 "silent": silent}
            )
        elif kind == "say":
            actions.append({"type": "communicate", "data": entry["text"],
                            "context": person(entry), "silent": silent})
        elif kind == "travel":
            actions.append({"type": "travel", "data": travel_target(state, entry.get("placeId")),
                            "silent": silent})
        elif entry.get("note"):
            # A line the server queued for the page (a spirit beast's evolution after feeding):
            # it goes in as the page's addAction left it, hidden from the player's log.
            actions.append({"type": "beast_evolve", "text": entry["note"], "silent": True})
        else:
            # Words of the player's own: the page's sect-task entries add their text unchanged.
            actions.append(
                {"type": "publish_sect_task", "data": {"fullText": entry["text"]}, "silent": silent}
            )
    return actions


def travel_target(state, place_id):
    """The old map's travel entry for a place: its region path and the distance from the
    player's position, as the map panel computes them for a point of interest."""
    from .play_world import find_poi, map_of_state

    world = map_of_state(state)
    poi = find_poi(world, place_id)
    if poi is None:
        raise TurnError("invalid_input", "地图上没有这个地点")
    def region(kind, name):
        return next((r for r in world.get(kind) or [] if r.get("name") == name), None)

    main = region("main_regions", poi.get("main_region"))
    sub = region("sub_regions", poi.get("sub_region"))
    location = "未知之地"
    if main:
        location = f"{main['name']}/{sub['name']}" if sub else main["name"]
        location += f"|({poi['name']}) "
    location = f"{location}|{round(poi['x'])},{round(poi['y'])}"
    rows = (state.get("currentState") or {}).get("4") or []
    row = next((r for r in rows if isinstance(r, dict) and r.get("id") == "TIME_LOCATION_ROW"),
               rows[0] if rows and isinstance(rows[0], dict) else {})
    here = re.search(r"(-?\d+),(-?\d+)", str(row.get("0", "")))
    distance = 0
    if here:
        dx, dy = int(here[1]) - poi["x"], int(here[2]) - poi["y"]
        distance = round((dx * dx + dy * dy) ** 0.5 * 10)
    return {"location": location, "distance": distance}


def take_out(value, actions):
    """What the old page takes out of the bag the moment the player queues it, before the turn
    is sent (and saves): a discarded item's whole stack (app.js 33675), one of a gifted item
    (app.js 38892–38899). The queue itself only tells the story. True when anything moved."""
    bag = value["data"]["state"]["currentState"].get(BAG) or {}
    moved = False
    for action in actions:
        key = action["data"]["id"] if action["type"] in {"discard", "gift"} else None
        row = bag.get(key) if key else None
        if row is None:
            continue
        moved = True
        if action["type"] == "discard":
            del bag[key]
            continue
        count = parse_count(row.get("5"))
        if count > 1:
            row["5"] = str(count - 1)
        else:
            del bag[key]
    return moved


def parse_count(value):
    """An item count as the page's parseInt reads it (NaN, here 0, for none)."""
    found = re.match(r"\s*[+-]?\d+", str(value if value is not None else ""))
    return int(found[0]) if found else 0


def flush_state(state, flush):
    """What the page's flush (_internalSaveCurrentState) writes before every turn: its tables,
    bonded characters and world map (the default map for a save that had none)."""
    state["currentState"] = flush["currentState"]
    state["bondedCharacters"] = flush["bondedCharacters"]
    state.setdefault("rpgMaps", {})
    state["worldMap"] = flush["worldMap"]
    state.setdefault("npcAvatars", {})


def option_text(value, index):
    """The words of option `index` (from 1) of the latest reply, as the page's button sends
    them."""
    logs = value["data"].get("logs", [])
    last = next((log for log in reversed(logs) if is_turn(log)), None)
    options = branch_options((last or {}).get("branchContent", ""))
    if not 1 <= index <= len(options):
        raise TurnError("invalid_input", "没有这个选项")
    return options[index - 1]


# What a turn request carries besides its version, kept with the turn's request row for a retry: the
# words, the option and the chips, or one of the cultivation life's verb, card or move.
REQUEST_KEYS = ("input", "option", "queue", "verb", "act", "move", "step")
LIFE_KEYS = ("verb", "act", "move", "step")


def life_request(request):
    """Whether a turn request is one of the cultivation life's own (a verb, a card, a move)."""
    return any(request.get(key) is not None for key in LIFE_KEYS)


def picked_card(play, index):
    """The action card `index` (from 1) of the beat before (frxPlay.cards), the player may take
    now; TurnError refused when there is none or the player does not qualify for it."""
    cards = play.get("cards") if isinstance(play.get("cards"), list) else []
    card = cards[index - 1] if isinstance(index, int) and 1 <= index <= len(cards) else None
    if not isinstance(card, dict):
        raise TurnError("refused", f"没有第{index}张行动卡")
    trade = card.get("trade") or {}
    legacy_price = (trade.get("direction") == "buy" and trade.get("price") is not None
                    and not trade.get("fee") and not trade.get("good") and "quotedPrice" not in card)
    # Older cards could be locked by the placeholder price. The engine reprices these on use.
    if card.get("locked") and not legacy_price:
        raise TurnError("refused", str(card.get("reason") or "不够格"))
    return card


def requested_action(value, text, option=None, queue=(), carried=None):
    """A turn request of the new interface as the old page's action: the typed words, or the
    words of the option picked, and the action queue as addAction calls. `carried`: the calls
    an earlier attempt at the same request made of its queue (a retry), used as they are; what
    they took out of the bag stays out."""
    action = {"option": option_text(value, option)} if option else {"text": text}
    if carried is not None:
        return action, copy.deepcopy(carried)
    return action, queue_actions(value["data"]["state"], list(queue))


# ---------------------------------------------------------------- one turn


class TurnPlay:
    """One turn from the player's action to its commit.

    `listener(kind, value)` hears the turn as it happens: "begun" (the request is reserved;
    value: the save's version after the player's log), "receipts" (receipts the engine settled,
    in order), "text" (the reply as it streams), "reset" (the story so far is discarded),
    "replied" (the whole reply, before it is committed) and "committed" (the committed save).
    """

    def __init__(self, ws, runtime, name, request_id, action, actions, *, listener=None,
                 jobs=None, request=None, taken=False, life=None, move=None, step=None,
                 seed=None):
        self.ws = ws
        self.records = ws.records
        self.runtime = runtime
        self.name = name
        self.request_id = request_id
        self.seed = seed
        self.action = action
        self.actions = actions
        self.listener = listener or (lambda kind, value: None)
        self.jobs = jobs
        # The new interface's request (input, option, queue), kept with the turn's request row
        # for a retry; `taken`: what the queue takes out of the bag was taken by an earlier
        # attempt at the same request.
        self.request = request
        self.taken = taken
        self.reply = ""
        self.receipts = []
        self.reservation = None
        self.archive_before = None
        self.settings = {}
        # the player's line this turn wrote into the save before asking the model
        self.line = None
        self.death = None
        # The cultivation life's verb this turn plays (life_turns), settled by the engine alone,
        # and the annals lines it wrote; `passage`: the verb is 写一段, a passage the model writes
        # out of an annals line, which changes nothing.
        self.life = life
        self.chronicle = []
        self.passage = bool(life) and life.get("kind") == "elaborate"
        # the stretch of days the engine broke off, when it did: the turn goes on into the model
        self.interrupted = None
        # A move in a fight (item 20), settled by the engine alone; `fought`: the fight the move
        # ended, when it did: the turn goes on into the model for the battle report; `reported`:
        # a routine fight's end, whose report the engine wrote (batch 9): no model, the scene
        # closes, and the turn is told and kept as a battle report all the same.
        self.move = move
        self.fought = None
        self.reported = None
        # A step in a secret realm (item 32), settled by the engine alone; a 秘 it reaches opens a
        # scene, and the turn goes on into the model for its first beat (`entered`).
        self.step = step
        self.entered = None
        # an attempt at a gate (item 22): the turn goes on into the model for the big scene
        self.gated = None
        self.pilot = None
        self.recovery = None

    @property
    def engine_turn(self):
        """A verb's, a move's or a realm step's turn: the engine settles what the player did."""
        return self.life is not None or self.move is not None or self.step is not None

    @property
    def tells_story(self):
        """Whether the reply is a story to read: every turn the model writes (写一段, a verb
        broken off by a scene, a fight's battle report too), not an engine turn's alone."""
        if self.recovery is not None:
            return self.recovery["tellsStory"]
        return (not self.engine_turn or self.passage or self.interrupted is not None
                or self.fought is not None or self.reported is not None or self.gated is not None
                or self.entered is not None)

    @property
    def moves_on(self):
        """Whether the turn moves the story on as a model's beat does: the director and the work
        after the turn follow it (not a verb's or a move's turn alone, nor 写一段)."""
        if self.recovery is not None:
            return self.recovery["movesOn"]
        return (not self.engine_turn or self.interrupted is not None or self.fought is not None
                or self.gated is not None or self.entered is not None)

    @property
    def notes(self):
        """The first-time notes this turn shows (life_turns.mark_play), kept on its reply log."""
        if self.recovery is not None:
            return list(self.recovery.get("notes") or [])
        settlement = getattr(self.pilot, "settlement", None) or {}
        return list(settlement.get("firstNotes") or [])

    def reply_kind(self):
        """What the reply log is besides a story: a verb's annals lines (frxChronicle), the same
        with the scene that broke into them, a passage written out of one (写一段), a move's
        round, or the move that ended a fight with its battle report."""
        if self.recovery is not None:
            return dict(self.recovery["replyKind"])
        if not self.engine_turn:
            # a beat a pending event opened keeps the event's annals line
            return {"frxChronicle": chronicle_entries(self.chronicle)} if self.chronicle else {}
        if self.passage:
            return {"frxKind": "passage"}
        if self.move is not None:
            ended = self.fought is not None or self.reported is not None
            return {"frxKind": "fought" if ended else "fight"}
        kind = ("interrupted" if self.interrupted is not None or self.entered is not None
                else "breakthrough" if self.gated is not None else "chronicle")
        return {"frxKind": kind, "frxChronicle": chronicle_entries(self.chronicle)}

    async def run(self):
        """Play the turn; returns the committed envelope. Raises TurnError."""
        try:
            async with asyncio.timeout(GENERATION_SECONDS):
                stream = await self.prepare()
                await self.keep_commit_context()
                await self.generate(stream)
            self.listener("replied", self.reply)
            return await self.commit()
        except TurnError:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise turn_error(exc) from None

    async def keep_commit_context(self):
        await asyncio.to_thread(self.records.keep_commit_context, self.request_id, {
            "settings": self.settings,
            "replyKind": self.reply_kind(),
            "chronicle": self.chronicle,
            "tellsStory": self.tells_story,
            "movesOn": self.moves_on,
        })

    # ------------------------------------------------------------ before the model

    async def prepare(self):
        if self.engine_turn:
            return await self.prepare_life()
        records, runtime = self.records, self.runtime
        config = runtime.profiles.load("default")
        if not config.model:
            raise TurnError("model_not_configured", "请先在模型连接中配置模型", 400)
        # the turn never reads the round snapshots a life save keeps beside it (lean)
        saved = await asyncio.to_thread(records.get, "archives", self.name, lean=True)
        value = saved["value"]
        if not value or not isinstance(value.get("data"), dict):
            raise TurnError("not_found", "存档不存在", 404)
        check_can_play(records, self.name, value)
        if not self.taken:
            # The old page takes discarded and gifted items out of the bag when the player
            # queues them, and saves: the turn's prompt already sees the bag without them.
            saved = await asyncio.to_thread(
                self.write_over, saved, lambda value: take_out(value, self.actions)
            )
            value = saved["value"]
        # A save of the cultivation life: every turn the model writes is a beat of a scene, on the
        # card the player took or the words they wrote (life_turns.before_story).
        life = None
        if life_of(value) is not None:
            act = (self.request or {}).get("act")
            life = {"act": act} if act else {"text": self.action.get("text", "")}
        turn = await asyncio.to_thread(
            play_prompt.read_turn_input,
            records,
            self.name,
            {**self.action, "queue": self.actions},
            seed=self.request_id,
            director_on_server=runtime.director.server_owned(),
        )
        self.settings = turn["settings"]
        body = await play_prompt.build(turn, play_prompt.answerer(runtime.profiles))
        # The page saves the player's log, then its own state as it sends the turn.
        tables = copy.deepcopy(value["data"]["state"].get("currentState"))

        def send(value):
            if body.get("user_log"):
                value["data"]["logs"].append(body["user_log"])
            # A job of the turn before that changed the tables meanwhile keeps its tables.
            if value["data"]["state"].get("currentState") == tables:
                flush_state(value["data"]["state"], body["flush"])

        written = await asyncio.to_thread(self.write_over, saved, send)
        if written is not saved:
            self.line = body.get("user_log")
        saved = written
        value = copy.deepcopy(saved["value"])
        payload = CardGenerate(
            request_id=self.request_id,
            archive=self.name,
            player_name=body["player_name"],
            user_input=body["user_input"],
            turn_action=body["turn_action"],
            # The save as it stands is the state the turn starts from.
            snapshot=value["data"]["state"]["currentState"],
            # The card's variable thinking switched on (its saved setting, as host.js sends
            # it): the story's turn has no state block, a second call writes it. A save of the
            # cultivation life always writes its state block in the turn itself.
            independent_variables=bool(body.get("independent_variables")) and life is None,
            variables=body["variables"],
        )
        kept = {"play_request": {**self.request, "actions": self.actions}} if (
            self.request is not None) else {}
        reservation = await asyncio.to_thread(
            records.begin_request,
            self.request_id,
            self.name,
            {**payload.model_dump(mode="json", exclude_none=True), **kept},
            self.seed,
            pilot_default=tool_capable(config.model),
        )
        if reservation["status"] != "new":
            raise TurnError("turn_in_progress", "此回合已经开始", 409)
        self.reservation = reservation
        self.archive_before = reserved_archive(value, reservation)
        self.listener("begun", saved["version"])
        pilot, messages = await plan_turn(
            runtime, records, self.request_id, payload, reservation, self.archive_before, config,
            dialogue=True, life=life,
        )
        running = (self.ws.user.id, self.request_id)
        if pilot is not None and life is not None:
            # a pending event that went off opened the scene: its annals line goes first
            self.chronicle = list(pilot.get("annals") or [])
            self.pilot, stream = life_pilot_stream(
                runtime, records, running, self.request_id, reservation, self.archive_before,
                pilot, messages, config, chronicle=self.chronicle, verb=False,
            )
            return stream
        if pilot is not None:
            self.pilot, stream = pilot_stream(
                runtime, records, running, self.request_id, reservation, self.archive_before,
                pilot, messages, config,
            )
            return stream
        self.pilot = None
        return upstore_stream(
            runtime, records, running, self.request_id, payload, reservation,
            self.archive_before, messages, config,
        )

    async def prepare_life(self):
        """A verb or a move of the cultivation life: no prompt is built and no model asked. The
        player's log is the verb or the move in words (frxKind "verb", "move"); the request is
        reserved as any turn's, so the commit, a retry and undo are the same; the engine settles
        it here and life_stream records it. A stretch of days the engine broke off and the move
        that ended a fight go on into the model (prepare_beat)."""
        records = self.records
        saved = await asyncio.to_thread(records.get, "archives", self.name, lean=True)
        value = saved["value"]
        if not value or not isinstance(value.get("data"), dict):
            raise TurnError("not_found", "存档不存在", 404)
        if life_of(value) is None:
            raise TurnError("refused", NOT_LIFE)
        check_can_play(records, self.name, value)
        words = (move_words(self.move, value) if self.move is not None
                 else step_words(self.step, value) if self.step is not None
                 else verb_words(self.life))
        if self.life is not None and self.life.get("kind") == "calm":
            # 守拙 names the clock it turns back: 「守拙　仇家寻上门」
            clock = next((each for each in life_of(value).get("clocks") or []
                          if isinstance(each, dict) and each.get("id") == self.life.get("clock")),
                         None)
            words = "　".join(part for part in (words, (clock or {}).get("name")) if part)
        if self.passage:
            # 写一段 names the day of the line it writes out: 「写一段　正月初四」
            lines = annals_of(value, self.life.get("turnId")) or [{}]
            words = "　".join(part for part in (words, lines[0].get("date")) if part)
        line = {"id": str(uuid4()), "timestamp": iso_now(), "type": "user", "content": words,
                "frxKind": "move" if self.move is not None
                else "step" if self.step is not None else "verb"}
        written = await asyncio.to_thread(
            self.write_over, saved, lambda value: value["data"]["logs"].append(line))
        if written is not saved:
            self.line = line
        saved = written
        value = copy.deepcopy(saved["value"])
        player = ((value["data"]["state"].get("currentState") or {}).get("0") or {}).get("B1")
        payload = CardGenerate(
            request_id=self.request_id,
            archive=self.name,
            player_name=str((player or {}).get("1") or "道友").split("|")[0][:100] or "道友",
            user_input=words,
            turn_action={"text": words, "items": []},
            snapshot=value["data"]["state"]["currentState"],
        )
        kept = {"play_request": dict(self.request)} if self.request is not None else {}
        reservation = await asyncio.to_thread(
            records.begin_request,
            self.request_id,
            self.name,
            {**payload.model_dump(mode="json", exclude_none=True), **kept},
            self.seed,
        )
        if reservation["status"] != "new":
            raise TurnError("turn_in_progress", "此回合已经开始", 409)
        self.reservation = reservation
        self.archive_before = reserved_archive(value, reservation)
        self.listener("begun", saved["version"])
        running = (self.ws.user.id, self.request_id)
        if self.passage:
            self.pilot, stream = elaborate_stream(
                self.runtime, records, running, self.request_id, reservation, self.archive_before,
                self.life, self.runtime.profiles.load("default"),
            )
            return stream
        # The engine settles the verb or the move now; a stretch it broke off and the move that
        # ended a fight go on into the model.
        knowledge = (reservation.get("context") or {}).get("knowledge")
        try:
            if self.step is not None:
                # a step in a secret realm: the engine's realm op (enter, node, leave)
                result = await life_op(self.archive_before, reservation["seed"], knowledge, [],
                                       "realm", realm_args(self.step, self.archive_before))
                settled = (result.get("receipts") or [], result.get("chronicle") or [])
            elif self.move is not None or self.life.get("kind") == "calm":
                # a move in a fight, or 守拙's op on a clock: the engine's own ops, not verbs
                op, args = (("move", self.move) if self.move is not None
                            else ("calm", {"clock": self.life.get("clock")}))
                result = await life_op(self.archive_before, reservation["seed"], knowledge, [],
                                       op, args)
                settled = (result.get("receipts") or [], result.get("chronicle") or [])
            else:
                settled = await run_verb(self.archive_before, reservation["seed"], self.life,
                                         knowledge)
        except ModelFailure as failure:
            raise TurnError("engine_failed", str(failure), retryable=True) from None
        if self.step is not None:
            opened = scene_opened(settled[0])
            if opened is not None:
                # a 秘 opened a scene (origin realm): its first beat in the same turn
                self.entered = opened
                return await self.prepare_beat(settled, words, entered=opened)
            self.pilot, stream = life_stream(
                self.runtime, records, running, self.request_id, reservation,
                self.archive_before, self.step, settled=settled,
            )
            return stream
        if self.move is not None:
            ended = fight_end_of(settled[0])
            told = engine_report(ended)
            if ended is not None and told is None:
                try:
                    self.fought = ended
                    return await self.prepare_beat(settled, words, fought=ended)
                except TurnError as error:
                    if error.code not in {"model_not_configured", "quota_exceeded"}:
                        raise
                    self.fought = None
                    told = "\n\n".join(plain(receipt["summary"]) for receipt in settled[0]
                                       if receipt.get("kind") == "fight" and receipt.get("summary"))
            if told is not None:
                # a routine fight (batch 9): the engine's report is the story, and the scene it
                # was fought in closes; the model is not asked
                self.reported = ended
                try:
                    closed = await close_reported(self.archive_before, reservation["seed"],
                                                  knowledge, settled[0])
                except ModelFailure as failure:
                    raise TurnError("engine_failed", str(failure), retryable=True) from None
                settled = (settled[0] + closed, settled[1])
            else:
                told = "\n".join(plain(receipt.get("summary") or "") for receipt in settled[0]
                                  if receipt.get("summary"))
            self.pilot, stream = life_stream(
                self.runtime, records, running, self.request_id, reservation,
                self.archive_before, self.move, settled=settled, story=told,
            )
            return stream
        interruption = interruption_of(settled[0])
        if interruption is not None:
            self.interrupted = interruption
            return await self.prepare_beat(settled, words, interrupted=interruption)
        gated = gate_of(settled[0])
        if gated is not None:
            # a major realm's gate, won or lost: the big scene in the same turn (item 22)
            self.gated = gated
            return await self.prepare_beat(settled, words, gated=gated)
        self.pilot, stream = life_stream(
            self.runtime, records, running, self.request_id, reservation, self.archive_before,
            self.life, settled=settled,
        )
        return stream

    async def prepare_beat(self, settled, words, interrupted=None, fought=None, gated=None,
                           entered=None):
        """The model's beat after what the engine settled in the same turn: the first beat of the
        scene a stretch of days broke into (item 16), from its cause, the battle report of the
        fight a move ended (item 20), with the next cards, or the big scene of an attempt at a
        gate (item 22). The engine's receipts are the
        turn's first; the whole turn is settled at its end, so a model that fails leaves the
        save as it was. It needs a model and counts against the model quota, as 写一段 does."""
        receipts, chronicle = settled
        runtime, records = self.runtime, self.records
        meter = getattr(runtime, "meter", None)
        if meter is not None and getattr(meter, "mode", None) == "on":
            try:
                await asyncio.to_thread(meter.check, self.ws.user)
            except PlayError as error:
                raise turn_error(error) from None
        config = runtime.profiles.load("default")
        if not config.model:
            raise TurnError("model_not_configured", "请先在模型连接中配置模型", 400)
        turn = await asyncio.to_thread(
            play_prompt.read_turn_input, records, self.name, {"text": words, "queue": []},
            seed=self.request_id, director_on_server=runtime.director.server_owned(),
        )
        # The prompt reads the history before the player's line, as for any turn.
        logs = turn["archive"]["data"]["logs"]
        if logs and logs[-1].get("frxKind") in {"verb", "move", "step"}:
            logs.pop()
        self.settings = turn["settings"]
        body = await play_prompt.build(turn, play_prompt.answerer(runtime.profiles))
        payload = CardGenerate(
            request_id=self.request_id,
            archive=self.name,
            player_name=body["player_name"],
            user_input=body["user_input"],
            turn_action=body["turn_action"],
            snapshot=self.archive_before["data"]["state"]["currentState"],
            variables=body["variables"],
        )
        if interrupted is not None:
            life = {"interrupted": interrupted, "verb": self.life, "receipts": receipts}
        elif entered is not None:
            life = {"entered": entered, "receipts": receipts}
        elif gated is not None:
            life = {"gated": gated, "receipts": receipts}
        else:
            life = {"fought": fought, "receipts": receipts}
        pilot, messages = await plan_turn(
            runtime, records, self.request_id, payload, self.reservation, self.archive_before,
            config, dialogue=True, life=life,
        )
        self.pilot, stream = life_pilot_stream(
            runtime, records, (self.ws.user.id, self.request_id), self.request_id,
            self.reservation, self.archive_before, pilot, messages, config, chronicle=chronicle,
        )
        return stream

    def write_over(self, saved, change):
        """Write the save as `change` (which edits a save's value in place) leaves it, over the
        save as it stands: the jobs after the turn before may still be writing it (a daily paper
        lands in the last reply), and a write of theirs landing first is read again, as the
        commit does (实玩二, 第三十四回: the turn sent while the paper was written failed with
        「存档已在别处改过」). Returns `saved` itself when nothing changed."""
        for attempt in range(COMMIT_ATTEMPTS):
            value = copy.deepcopy(saved["value"])
            change(value)
            if value == saved["value"]:
                return saved
            try:
                return self.records.write("archives", self.name, value, saved["version"],
                                          lean=True)
            except HTTPException as exc:
                moved = exc.status_code == 409 and "其他操作中变化" in str(exc.detail)
                if not moved or attempt == COMMIT_ATTEMPTS - 1:
                    raise
            saved = self.records.get("archives", self.name, lean=True)
            if not saved.get("value") or not isinstance(saved["value"].get("data"), dict):
                raise TurnError("not_found", "存档不存在", 404)
        return saved

    def withdraw(self):
        """A turn that ends without its reply (the model failed, the player stopped it) takes back
        the player's line it wrote before asking the model. Left in the save, the line is in the
        next turn's story with no reply after it, once more for every retry (实玩二, 第二十一回:
        four copies of one action after three failures and a retry). Only the save's last log, and
        only while it is this turn's line: a reply that landed is never touched."""
        line = self.line
        if not line:
            return None
        if self.reservation:
            attempt = self.records.request(self.request_id)
            if attempt["status"] in {"ready", "committed"}:
                # A durable result still needs this player's line when it is recovered.
                return None
        saved = self.records.get("archives", self.name, lean=True)
        logs = ((saved.get("value") or {}).get("data") or {}).get("logs") or []
        if not logs or not isinstance(logs[-1], dict) or logs[-1].get("id") != line.get("id"):
            return None
        value = copy.deepcopy(saved["value"])
        value["data"]["logs"].pop()
        self.line = None
        return self.records.write("archives", self.name, value, saved["version"], lean=True)

    # ------------------------------------------------------------ the model and the engine

    def settled_receipts(self):
        if self.pilot is None:
            return []
        # Quiet refusals settle nothing and are no receipt for the player.
        return [receipt for receipt in self.pilot.receipts
                if not receipt.get("readOnly") and not receipt.get("quiet")]

    async def generate(self, stream):
        """Read the shared pipeline's events: the reply as the page would read it (deltas, reset
        by a tool round, replaced by the engine's final reply) and the receipts as they settle."""
        reported = 0
        finished = False
        async for chunk in stream:
            data = frame(chunk)
            if data == "done":
                finished = True
                continue
            if "error" in data:
                # A verb's turn names what failed (life_turns): the engine refused it, or failed.
                code = data["error"].get("code") or "model_failed"
                raise TurnError(code, data["error"].get("message", ""),
                                retryable=code != "refused")
            info = data.get("frx") or {}
            if "chronicle" in info:
                self.chronicle = list(info["chronicle"] or [])
                await self.keep_commit_context()
                self.listener("chronicle", self.chronicle)
            if "actions" in info:
                self.listener("actions", info["actions"])
            if "cards" in info:
                receipts = self.settled_receipts()
                self.listener("receipts", receipts[reported:])
                reported = len(receipts)
            if info.get("reset"):
                self.reply = ""
                self.listener("reset", None)
            if "final" in info:
                self.reply = str(info["final"] or "")
            delta = ((data.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
            if delta:
                self.reply += delta
                self.listener("text", delta)
        if not finished:
            raise TurnError("model_failed", "模型连接中断，回复未结算", 502, retryable=True)
        if self.pilot is None:
            # The model's own reply: the log and the blocks read the story where card_story
            # finds it, past an empty <content></content> (an engine turn's final reply is the
            # server's own, built around that story).
            self.reply = tidy_reply(self.reply)
            attempt = await asyncio.to_thread(self.records.request, self.request_id)
            if (attempt.get("settlement") or {}).get("awaitingVariables") and (
                await settle_variables(self.runtime, self.records, self.request_id,
                                       self.archive_before)
            ):
                attempt = await asyncio.to_thread(self.records.request, self.request_id)
            # Its settlement's only receipts are for gear its commands moved.
            receipts = list((attempt.get("settlement") or {}).get("receipts") or [])
        else:
            receipts = self.settled_receipts()
        if len(receipts) > reported:
            self.listener("receipts", receipts[reported:])
        self.receipts = receipts

    # ------------------------------------------------------------ the commit

    async def reply_log(self):
        """The AI log the page saves for this reply, before the settlement is applied."""
        built = await play_prompt.run_script(
            "after.cjs",
            {
                "mode": "log",
                "reply": self.reply,
                "settings": self.settings,
                "preferences": self.settings.get(play_prompt.PREFERENCES_KEY) or {},
                "seed": self.reservation["seed"],
            },
            step="回合日志",
        )
        if not built.get("log"):
            raise TurnError("model_failed", "模型返回了空回复", 502, retryable=True)
        return built["log"]

    async def commit(self):
        # A cancelled await cannot stop a database write in its worker thread. Wait for the
        # whole commit (including a death's reset) before the caller checks its durable status.
        task = asyncio.create_task(self._commit())
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def _commit(self):
        """Write the AI log through CardStore.write: the request is ready and the log carries a
        state snapshot, so apply_settlement commits the server's settlement, as it does for the
        page's upload of the whole save. Another write landing first is read again, as the
        page's saveToLog does; apply_settlement still refuses a save whose state or history
        moved since the turn began."""
        log = await self.reply_log()
        for attempt in range(COMMIT_ATTEMPTS):
            saved = await asyncio.to_thread(self.records.get, "archives", self.name, lean=True)
            value = copy.deepcopy(saved["value"])
            if not value:
                raise TurnError("not_found", "存档不存在", 404)
            entry = {
                "id": str(uuid4()),
                "timestamp": iso_now(),
                "content": log["content"],
                "unoptimizedContent": log["unoptimizedContent"],
                "frxRequestId": self.request_id,
                "stateSnapshot": json.dumps(
                    value["data"]["state"]["currentState"], ensure_ascii=False
                ),
                **{k: v for k, v in log.items() if k not in {"content", "unoptimizedContent"}},
                # A verb's reply is its annals lines: the history shows them as such.
                **self.reply_kind(),
                **({"frxNotes": self.notes} if self.notes else {}),
            }
            value["data"]["logs"].append(entry)
            try:
                result = await asyncio.to_thread(
                    self.records.write, "archives", self.name, value, saved["version"], lean=True
                )
            except HTTPException as exc:
                if exc.status_code == 409 and "其他操作中变化" in str(exc.detail) and (
                    attempt < COMMIT_ATTEMPTS - 1
                ):
                    continue
                raise turn_error(exc) from None
            except OperationalError:
                # SQLite's write lock held past its wait by other writers: try again.
                if attempt < COMMIT_ATTEMPTS - 1:
                    continue
                raise TurnError("engine_failed", STORE_BUSY, retryable=True) from None
            if not result["value"]["data"]["logs"][-1].get("frxPending"):
                # An extreme-mode protagonist who died starts the save over (play_death); the
                # turn's work after it would find its turn gone, so none is queued.
                self.death = await play_death.after_turn(self.records, self.name, result,
                                                         turn=self)
                if not (self.death and self.death.written) and self.moves_on:
                    # Plot evolution looks at every committed turn, as after the page's upload,
                    # and the page's own work after the turn is queued for the save. A verb's
                    # turn has neither, its annals wait for the scene after it, unless a scene
                    # broke into it.
                    self.runtime.director.after_commit(self.ws.user.id, self.name)
                    if self.jobs is not None:
                        self.jobs.enqueue(self.ws, self.name, self.request_id, entry["id"])
            self.listener("committed", result)
            return result
        raise TurnError("version_conflict", "存档已在其他操作中变化，请重新读取后继续")


# ---------------------------------------------------------------- the event stream of a turn

# A finished turn's events stay this long for a client that lost the stream.
KEEP_SECONDS = 60


class TurnRun:
    """A turn of the new interface on the server and every event it has sent, numbered from 1,
    kept so a client that lost the stream can pick it up again (docs/play-contracts.md, 事件流).
    The run also keeps the blocks its events describe, for GET …/turns/pending."""

    def __init__(self, user_id, save, request_id, no, request, *, seed=None):
        self.user_id = user_id
        self.archive_id = save.archive_id
        self.name = save.name
        self.request_id = request_id
        self.no = no
        self.request = request
        self.seed = seed
        self.events = []
        self.blocks = {}
        self.status = "streaming"
        self.finished = False
        self.at = iso_now()
        self.task = None
        self.counter = 0
        self.changed = asyncio.Event()

    def next_id(self):
        self.counter += 1
        return f"b{self.counter}"

    def emit(self, event, **fields):
        self.events.append({"seq": len(self.events) + 1, "event": event, **fields})
        if event in {"block", "open"}:
            self.blocks[fields["block"]["id"]] = fields["block"]
        elif event == "text":
            block = self.blocks[fields["blockId"]]
            self.blocks[fields["blockId"]] = {**block, "text": block["text"] + fields["delta"]}
        elif event == "close" and fields.get("replace"):
            self.blocks[fields["blockId"]] = fields["replace"]
        elif event == "reset":
            self.blocks = {k: v for k, v in self.blocks.items() if k in fields["keep"]}
        self.wake()

    def finish(self, status):
        self.status = status
        self.finished = True
        self.wake()

    def wake(self):
        self.changed.set()
        self.changed = asyncio.Event()

    async def follow(self, after=0):
        """The events after `after`, then each new one as it comes, until the turn is over."""
        index = max(0, after)
        while True:
            waiting = self.changed
            while index < len(self.events):
                yield self.events[index]
                index += 1
            if self.finished:
                return
            await waiting.wait()

    def turn(self):
        """The turn as far as it has come."""
        return {"id": self.request_id, "no": self.no, "status": self.status,
                "blocks": list(self.blocks.values()), "at": self.at}


def same_block(one, other):
    return {k: v for k, v in one.items() if k != "id"} == {k: v for k, v in other.items()
                                                          if k != "id"}


def told(block):
    """A story block as the stream could tell it: without what only the people after the turn
    give it (a newcomer's id on his words, his name marked in a paragraph)."""
    if block["type"] == "speech":
        return ("speech", block["speaker"]["name"], tuple(block["lines"]))
    if block["type"] == "narration":
        marks = tuple((m["start"], m["end"], m["kind"]) for m in block.get("marks", [])
                      if m["kind"] != "name")
        return ("narration", block["text"], marks)
    return None


def adopt_ids(final, streamed, next_id):
    """The finished turn's blocks under the ids they streamed with, in order; the rest get new
    ids, so a block keeps one id for the whole turn. A paragraph streamed before a newcomer was
    in the people table keeps its id when the finished turn names him."""
    pool, adopted = list(streamed), []
    for block in final:
        match = next((index for index, sent in enumerate(pool) if same_block(sent, block)), None)
        if match is None and told(block):
            match = next((index for index, sent in enumerate(pool)
                          if told(sent) == told(block)), None)
        if match is None and block["type"] == "mark":
            # A scene's opening mark went out under the place's name; the model has named the
            # scene since (play_blocks.turn_blocks): the same mark, under its new name.
            match = next((index for index, sent in enumerate(pool) if sent["type"] == "mark"
                          and sent.get("kind") == block.get("kind")), None)
        adopted.append({**block, "id": pool.pop(match)["id"] if match is not None
                        else next_id()})
    return adopted


def changes_between(before, after):
    """What a turn changed that the status bar and the bag show (docs/play-contracts.md,
    Change): gauges, realm, stones, place, time and item counts."""
    def gauge(view, name):
        value = view["player"][name]
        return f"{value['current']}/{value['max']}"

    rows = [
        ("player.hp", "气血", gauge(before, "hp"), gauge(after, "hp")),
        ("player.mp", "法力", gauge(before, "mp"), gauge(after, "mp")),
        ("player.xp", "修为", gauge(before, "xp"), gauge(after, "xp")),
        ("player.realm", "境界", before["player"]["realm"], after["player"]["realm"]),
        ("player.stones", "灵石", str(before["player"]["stones"]),
         str(after["player"]["stones"])),
        ("place", "地点", before["place"]["text"], after["place"]["text"]),
        ("time", "时间", before["time"]["text"], after["time"]["text"]),
    ]
    items_before = {item["id"]: item for item in before.get("bag", [])}
    items_after = {item["id"]: item for item in after.get("bag", [])}
    for key in sorted(set(items_before) | set(items_after)):
        old, new = items_before.get(key), items_after.get(key)
        rows.append((f"bag.{key}", (new or old)["name"], str(old["quantity"]) if old else None,
                     str(new["quantity"]) if new else None))
    return [
        {"path": path, "label": label, **({"from": old} if old is not None else {}),
         **({"to": new} if new is not None else {})}
        for path, label, old, new in rows
        if old != new
    ]


# ---------------------------------------------------------------- the desk


def turn_requests(records, name, request_ids=None):
    """The save's turn requests by id, with what the history reads from them: the settlement,
    and for a turn the new interface sent, the words, option and chips it was sent with and the
    ids its finished turn gave its blocks."""
    query = records.requests_of(name)
    if request_ids is not None:
        if not request_ids:
            return {}
        query = query.where(CardRequest.id.in_(request_ids))
    with records.sessions() as session:
        rows = session.scalars(query).all()
        found = {}
        for row in rows:
            entry = {"id": row.id, "status": row.status,
                     "settlement": copy.deepcopy(row.settlement)}
            context = row.context if isinstance(row.context, dict) else {}
            played = context.get("playRequest")
            if isinstance(played, dict):
                entry["played"] = {key: copy.deepcopy(played[key])
                                   for key in ("input", "option", "queue", "act") if key in played}
            if isinstance(context.get("blockIds"), list):
                entry["blockIds"] = copy.deepcopy(context["blockIds"])
            found[row.id] = entry
        return found


def branches_of(reply):
    found = re.search(r"<branches>[\s\S]*?</branches>", reply or "", re.I)
    return found[0] if found else ""


class TurnDesk:
    """The new interface's turns on this server: the runs in flight and those just finished,
    one turn at a time per save, and the queue of work after each committed turn."""

    def __init__(self, runtime):
        from .play_jobs import AfterTurn  # play_jobs reads in_flight from here

        self.runtime = runtime
        self.jobs = AfterTurn(runtime)
        self.runs = {}
        self.locks = {}

    def lock(self, user_id, name):
        return self.locks.setdefault((user_id, name), asyncio.Lock())

    def run(self, user_id, request_id):
        return self.runs.get((user_id, request_id))

    def running(self, user_id, archive_id):
        return next((run for run in self.runs.values() if run.user_id == user_id
                     and run.archive_id == archive_id and not run.finished), None)

    def check_version(self, user_id, save, version):
        """The version the player last saw must still be the save's, or one only the work after
        a turn has moved on from."""
        if version != save.version and not self.jobs.follows(
            user_id, save.name, version, save.version
        ):
            raise TurnError("version_conflict", "存档已在别处变化，请重新读取后再行动")

    def register(self, user_id, run, task):
        self.runs[(user_id, run.request_id)] = run
        run.task = task

        def forget():
            # A retry uses the same request ID; the earlier run's timer must not remove it.
            if self.runs.get((user_id, run.request_id)) is run:
                self.runs.pop((user_id, run.request_id), None)

        def finished(_):
            asyncio.get_running_loop().call_later(
                KEEP_SECONDS, forget
            )

        task.add_done_callback(finished)
        return run

    # ------------------------------------------------------------ starting a turn

    async def start(self, ws, save, request_id, request, carried=None, quota=None, *, seed=None):
        """Begin a turn and return its run; what stops it before anything is written raises.
        `carried`: the action queue's calls from an earlier attempt at the same request (a
        retry), whose items are already out of the bag. `quota`: the model quota's check for
        words alone, made here once they are known not to be a standing verb."""
        async with self.lock(ws.user.id, save.name):
            self.check_version(ws.user.id, save, request["version"])
            if self.running(ws.user.id, save.archive_id):
                raise TurnError("turn_in_progress", "上一回合还在进行，请等它结束或停止")
            play = life_of(save.value)
            if life_request(request) and play is None:
                raise TurnError("refused", NOT_LIFE)
            if play is not None and play.get("fight") and request.get("move") is None:
                # In a fight only a move goes: no words, no verb, no card (item 20).
                raise TurnError("refused", FIGHT_ON)
            if play is not None and play.get("encounter") and request.get("act") is None:
                # Someone met waits for the beat: only its cards go (item 31).
                raise TurnError("refused", ENCOUNTER_ON)
            if request.get("verb") is not None:
                # A verb is settled by the engine alone (no model needed), outside a scene and
                # once a new save's opening scene is played (item 25).
                if play.get("scene"):
                    raise TurnError("refused", SCENE_ON)
                if play.get("opening"):
                    raise TurnError("refused", OPENING_ON)
                await asyncio.to_thread(check_can_play, ws.records, save.name, save.value)
                if request["verb"].get("kind") == "elaborate":
                    # 写一段: the model writes out a verb turn's annals line.
                    if not annals_of(save.value, request["verb"].get("turnId")):
                        raise TurnError("refused", "没有这一行年谱，写不了")
                    if not self.runtime.profiles.load("default").model:
                        raise TurnError("model_not_configured", "请先在模型连接中配置模型", 400)
                action, actions = {"verb": request["verb"]}, []
            elif request.get("step") is not None:
                # A step in a secret realm, settled by the engine alone (one that opens a scene
                # goes on into the model for its first beat), outside a scene (item 32).
                if play.get("scene"):
                    raise TurnError("refused", SCENE_ON)
                if play.get("opening"):
                    raise TurnError("refused", OPENING_ON)
                await asyncio.to_thread(check_can_play, ws.records, save.name, save.value)
                action = {"step": request["step"], "words": step_words(request["step"], save.value)}
                actions = []
            elif request.get("move") is not None:
                # A move in a fight, settled by the engine alone (the one that ends it goes on
                # into the model for the battle report).
                if not play.get("fight"):
                    raise TurnError("refused", "眼下没有斗法")
                await asyncio.to_thread(check_can_play, ws.records, save.name, save.value)
                action = {"move": request["move"],
                          "words": move_words(request["move"], save.value)}
                actions = []
            elif request.get("act") is not None:
                # The card the player took, from the beat before: a missing or ineligible one is
                # refused before anything is written; the model writes the beat on its outcome.
                card = picked_card(play, request["act"])
                await asyncio.to_thread(check_can_play, ws.records, save.name, save.value)
                if not self.runtime.profiles.load("default").model:
                    raise TurnError("model_not_configured", "请先在模型连接中配置模型", 400)
                action, actions = {"text": card["title"]}, []
            else:
                await asyncio.to_thread(check_can_play, ws.records, save.name, save.value)
                words = str(request.get("input") or "").strip()
                if play is not None and (guide := protected_action(words)):
                    raise TurnError("refused", guide + "本次行动未执行，材料未消耗。")
                verb = None
                if play is not None and not play.get("scene") and not play.get("opening") and (
                    words and not (request.get("option") or request.get("queue"))
                ):
                    # Words that say 修炼 or 调息 and nothing else are that verb (item 12).
                    verb = await free_verb(save.value, words, request_id)
                if verb is not None:
                    action, actions = {"verb": verb}, []
                else:
                    if quota is not None:
                        await quota()
                    if not self.runtime.profiles.load("default").model:
                        raise TurnError("model_not_configured", "请先在模型连接中配置模型", 400)
                    action, actions = requested_action(
                        save.value, request.get("input", ""), request.get("option"),
                        request.get("queue") or [], carried=carried,
                    )
            self.admit(ws.user)
            run = TurnRun(ws.user.id, save, request_id, turn_count(save.data["logs"]) + 1,
                          request, seed=seed)
            task = asyncio.get_running_loop().create_task(
                self.play(run, ws, action, actions, taken=carried is not None),
                context=self.usage_context(ws.user, "recall", request_id),
            )
            return self.register(ws.user.id, run, task)

    def admit(self, user):
        """429 busy past the player's or the server's main turns at once (frx.usage). Nothing
        is awaited between this and the run's registration, so two requests cannot both pass
        for the last place."""
        meter = getattr(self.runtime, "meter", None)
        if meter is not None:
            meter.admit(user, [run.user_id for run in self.runs.values() if not run.finished])

    def usage_context(self, user, purpose, request_id):
        """The context a turn's task runs in: the model calls it makes beyond the main turn's own
        (memory recall's) are the player's."""
        return usage.task_context(getattr(self.runtime, "meter", None), user.id, purpose,
                                  request_id)

    def known(self, ws, save, request_id):
        """A turn request seen before, answered again without playing it twice."""
        try:
            attempt = ws.records.request(request_id)
        except HTTPException:
            return None
        if attempt["archive"] != save.name:
            raise TurnError("turn_in_progress", "请求编号已用于另一存档")
        if attempt["status"] == "ready":
            turn = self.ready_view(save, attempt)
            run = TurnRun(ws.user.id, save, request_id, turn["no"], {})
            run.emit("turn", turn={"id": request_id, "no": turn["no"]})
            run.emit("done", turn=turn, version=save.version)
            run.finish("pending")
            return run
        # its turn told again from the history: the save whole, its round snapshots and all
        save = find_save(ws.records, save.archive_id)
        run = TurnRun(ws.user.id, save, request_id, 0, {})
        turn = next((t for t in history(save.name, save.value, turn_requests(
            ws.records, save.name), places_of(ws.records, save, keep=False))
            if t["id"] == request_id), None)
        run.no = turn["no"] if turn else turn_count(save.data["logs"]) + 1
        run.emit("turn", turn={"id": request_id, "no": run.no})
        if turn:
            run.emit("done", turn=turn, version=save.version)
        else:
            run.emit("error", code="cancelled" if attempt["status"] == "cancelled"
                     else "model_failed", message="这一回合没有完成", retryable=True)
        run.finish(turn["status"] if turn else "failed")
        return run

    # ------------------------------------------------------------ playing it

    async def state_of(self, ws, archive_id, progress=None, version=None):
        """The save and its state view as the interface reads them; `progress` the engine's
        progress of the state a verb's turn committed at `version`, which its settle read already:
        used while the save is still that version (nothing written since, such as a death's
        eulogies), else read afresh."""
        # the state view never reads the round snapshots a life save keeps beside it
        save = await asyncio.to_thread(find_save, ws.records, archive_id, True)
        art = await asyncio.to_thread(art_of, ws.records, save)
        looks = await asyncio.to_thread(places_of, ws.records, save)
        if progress is None or save.version != version:
            plot = save.plot()
            progress = await engine_progress(save.value, plot_payload(plot) if plot else None)
        return save, state_view(save, art, progress, looks).wire()

    async def settle_place(self, ws, after, action="", request_id=None):
        """The looks of the save's places with the one the turn ended at kept (play_places
        settle_look: another name of a place kept before is that place; else the rules' look,
        and where the place's own name leaves some of it open, the model's reading of the
        arrival's story, checked by the rules). It comes after the story, so it never holds the
        words up; a place already kept is not looked at again."""
        book = play_places.PlaceBook(ws.records)
        looks = await asyncio.to_thread(book.looks, after.archive_id)
        reading = place_reading(after)
        if reading.key in looks:
            return looks
        recent = after.recent(1)
        story = recent[0][0] if recent else ""
        look, source = await play_places.settle_look(
            reading.key, reading.rules, looks, self.runtime, ws.user, after.location.text, story,
            action, request_id)
        looks[reading.key] = await asyncio.to_thread(book.keep, after.archive_id, reading.key,
                                                     look, source)
        return looks

    async def play(self, run, ws, action, actions, taken=False):
        """Play the turn and turn what happens into the contract's events. A verb's turn has
        no action block: its annals line comes first (docs/play-contracts.md)."""
        first = None
        # a verb's turn and a realm step's have no action block: their annals line comes first
        if "verb" not in action and "step" not in action:
            text = (action.get("text") if run.request.get("act")
                    else action.get("words") if "move" in action else run.request.get("input", ""))
            text = str(text or "").strip()
            if "option" in action:
                text = plain(OPTION_LETTER.sub("", action["option"], count=1))
            first = {"id": run.next_id(), **action_block(text, run.request.get("queue"))}
        run.emit("turn", turn={"id": run.request_id, "no": run.no})
        if first is not None:
            run.emit("block", block=first)
        try:
            async with asyncio.timeout(GENERATION_SECONDS + 30):
                await self.play_out(run, ws, action, actions, first, taken)
        except TurnError as error:
            if await self.finish_committed(run, ws):
                return
            await self.end_failed(ws, run)
            run.emit("error", code=error.code, message=error.message, retryable=error.retryable,
                     **error.retry_timing())
            run.finish("failed")
        except asyncio.CancelledError:
            if await self.finish_committed(run, ws):
                return
            await asyncio.to_thread(ws.records.cancel_request, run.request_id)
            run.emit("error", code="cancelled", message="本回合已停止", retryable=True)
            run.finish("cancelled")
        except Exception as error:
            logger.warning("play_turn_failed error=%s", type(error).__name__)
            if await self.finish_committed(run, ws):
                return
            await self.end_failed(ws, run)
            message = ("回合等待超时，可以重试或回到上一回合继续。"
                       if isinstance(error, TimeoutError) else "回合未能完成，请稍后重试")
            run.emit("error", code="engine_failed", message=message, retryable=True)
            run.finish("failed")

    async def end_failed(self, ws, run):
        """End an unfinished generation; an already-ready result stays available for recovery."""
        try:
            await asyncio.to_thread(ws.records.fail_request, run.request_id)
        except Exception as error:  # an unfinished generation still has a bounded lease
            logger.warning("play_turn_unsettled error=%s", type(error).__name__)

    async def play_out(self, run, ws, action, actions, first, taken=False):
        # The work after the turn before runs alongside this turn and writes the save when it is
        # over (play_jobs); only a world evolution that is due has to land first, and the player
        # is told what the turn waits for.
        waiting = await self.jobs.blocking(ws, run.name)
        if waiting:
            run.emit("waiting", text="等上一回合的" + "、".join(waiting) + "写完……")
            await self.jobs.settled(ws.user.id, run.name)
            run.emit("waiting", text="")
        # the state before the turn, as far as its changes compare it: no engine call for it; the
        # place the player is at keeps its look first, as reading the state view would have it
        before = await asyncio.to_thread(find_save, ws.records, run.archive_id, True)
        await asyncio.to_thread(places_of, ws.records, before)
        before_view = change_basis(before)
        # a save of the cultivation life ends a beat with its cards, never with options
        life = life_of(before.value) is not None
        cast = Cast(before.state.get("currentState") or {})
        streamed = [first] if first is not None else []
        story = {"stream": StoryStream(cast, run.next_id), "filter": StoryFilter()}
        # What goes out once the story is told: a scene's close card and mark, the beat's cards.
        after_story = []

        def show(block):
            block = {"id": run.next_id(), **block}
            streamed.append(block)
            run.emit("block", block=block)

        def tell(events):
            for event in events:
                if event[0] == "open":
                    run.emit("open", block=event[1])
                elif event[0] == "text":
                    run.emit("text", blockId=event[1], delta=event[2])
                else:
                    run.emit("close", blockId=event[1], **({"replace": event[2]}
                                                          if event[2] else {}))
                    streamed.append(event[3])

        def restart(reply_over):
            """The story told so far is discarded: a new reply (a tool round's, or a retry of
            an empty one), or the same reply's story starting over in its <content> block."""
            kept = [b for b in streamed if b["type"] not in {"narration", "speech"}]
            streamed[:] = kept
            story["stream"] = StoryStream(cast, run.next_id)
            if reply_over:
                story["filter"] = StoryFilter()
            run.emit("reset", keep=[b["id"] for b in kept])

        def heard(kind, value):
            if kind == "chronicle":
                # a verb's annals lines, before its receipts; the turn's last is the latest
                for index, entry in enumerate(chronicle_entries(value)):
                    block = {"id": run.next_id(),
                             **chronicle_block(entry, now=index == len(value) - 1)}
                    streamed.append(block)
                    run.emit("block", block=block)
            elif kind == "receipts":
                for receipt in value:
                    later = told_after(receipt)
                    for block in receipt_blocks(receipt):
                        if later:
                            after_story.append(block)
                        else:
                            show(block)
            elif kind == "text":
                for part in story["filter"].parts(value):
                    if part is None:
                        restart(reply_over=False)
                    else:
                        tell(story["stream"].tell(part))
            elif kind == "reset":
                restart(reply_over=True)
            elif kind == "actions":
                after_story.append(value)
            elif kind == "replied":
                tell(story["stream"].finish())
                if not life and (options := options_block(branches_of(value))):
                    show(options)
                for block in after_story:
                    show(block)
                after_story.clear()
                # No model call is left: what remains is the settlement and the commit, which the
                # page says as they are, not as words still being written.
                run.emit("settling")

        request = {key: run.request[key] for key in REQUEST_KEYS
                   if run.request.get(key) is not None}
        turn = TurnPlay(ws, self.runtime, run.name, run.request_id, action, actions,
                        listener=heard, jobs=self.jobs, request=request, taken=taken,
                        life=action.get("verb"), move=action.get("move"),
                        step=action.get("step"), seed=run.seed)
        try:
            committed = await turn.run()
        except BaseException:
            # failed or stopped before its reply landed: the player's line goes back out
            try:
                await asyncio.to_thread(turn.withdraw)
            except Exception as error:  # the line stays; the turn still ends as it would
                logger.warning("play_turn_line_kept error=%s", type(error).__name__)
            raise
        await self.finish(run, ws, turn, committed, before, before_view, streamed, first)

    async def finish(self, run, ws, turn, committed, before, before_view, streamed, first,
                     *, recovering=False):
        """After the commit: the blocks only the state can tell, the state, and the finished
        turn under the ids its blocks streamed with. `first` is the turn's action block (none
        for a verb's turn, whose annals lines take its place and whose reply is no story)."""
        value = committed["value"]
        pending = bool(value["data"]["logs"][-1].get("frxPending"))
        after = Save(run.name, committed["version"], value)
        try:
            if recovering:
                looks = await asyncio.to_thread(places_of, ws.records, after, False)
            else:
                looks = await self.settle_place(ws, after, (first or {}).get("text") or "",
                                                run.request_id)
        except Exception as error:  # the turn is saved; its place shows by the rules
            logger.warning("place_look_failed error=%s", type(error).__name__)
            looks = None
        lines = chronicle_entries(turn.chronicle)
        play = life_of(after.value)
        final = turn_blocks(
            action={k: v for k, v in first.items() if k != "id"} if first else None,
            receipts=turn.receipts,
            story=story_of(turn.reply) if turn.tells_story else "",
            branches="" if play is not None else branches_of(turn.reply),
            before=before, after=after, notice=PENDING if pending else None, looks=looks,
            chronicle=[chronicle_block(entry, now=index == len(lines) - 1)
                       for index, entry in enumerate(lines)],
            # the cards wait while a fight is on: its commands are the choices then
            actions=actions_block(play.get("cards"))
            if play is not None and not play.get("fight") else None,
            perks=perks_on_offer(play),
            notes=turn.notes,
        )
        blocks = adopt_ids(final, streamed, run.next_id)
        version = committed["version"]
        if turn.death:
            # The life is over: no options; the save has started over (play_death).
            if turn.death.written:
                blocks = [block for block in blocks if block["type"] != "options"]
                version = turn.death.written["version"]
            blocks.append({"id": run.next_id(), **turn.death.block()})
        try:
            # The history reads the turn back under these ids (play_blocks.history): the page
            # keys the performances and the turn menu by them.
            await asyncio.to_thread(ws.records.keep_block_ids, run.request_id, blocks)
        except Exception as error:  # the history numbers the turn's blocks in order instead
            logger.warning("block_ids_not_kept error=%s", type(error).__name__)
        known = {block["id"] for block in streamed}
        kept = {block["id"] for block in blocks}
        if any(b["type"] in {"narration", "speech"} and b["id"] not in kept for b in streamed):
            # The story that streamed is not the one committed (the whole reply was rewritten
            # after it streamed): take it back before the committed one is told.
            run.emit("reset", keep=[b["id"] for b in streamed if b["id"] in kept])
        for block in blocks:
            if block["id"] not in known:
                run.emit("block", block=block)
        if not recovering and getattr(turn.death, "mourn", None) is not None:
            # A death of old age (play_legacy): its blocks are out; now the heir's root and the
            # eulogies, written into the save, each eulogy said before done.
            mourned = await turn.death.mourn()
            for block in (mourned or {}).get("blocks") or []:
                block = {"id": run.next_id(), **block}
                blocks.append(block)
                run.emit("block", block=block)
            version = (mourned or {}).get("version", version)
        try:
            # a verb's turn: its settle read the progress of the state it committed (a turn left
            # pending committed nothing: its state is read afresh)
            settled = None if pending else getattr(getattr(turn, "pilot", None),
                                                   "after_progress", None)
            _, after_view = await self.state_of(ws, run.archive_id, progress=settled,
                                                version=committed["version"])
            run.emit("state", state=after_view, changes=changes_between(before_view, after_view))
        except Exception as error:  # the turn is saved; the client reads the state again
            logger.warning("state_view_failed error=%s", type(error).__name__)
        status = "pending" if pending else "done"
        run.emit("done", turn={"id": run.request_id, "no": run.no, "status": status,
                               "blocks": blocks, "at": iso_now()},
                 version=version)
        run.finish(status)

    # ------------------------------------------------------------ retry, cancel, undo

    async def retry(self, ws, save, turn_id, version):
        """Try a turn again: settle a pending turn's reply once more, play a turn that never got
        its reply again with the same words, or write the last turn anew (the turn menu's 重试)."""
        try:
            attempt = await asyncio.to_thread(ws.records.request, turn_id)
        except HTTPException:
            raise TurnError("not_found", "没有这一回合", 404) from None
        if attempt["archive"] != save.name:
            raise TurnError("not_found", "没有这一回合", 404)
        if attempt["status"] == "ready":
            async with self.lock(ws.user.id, save.name):
                running = self.run(ws.user.id, turn_id)
                if running is not None and not running.finished:
                    return running
                self.check_version(ws.user.id, save, version)
                run = TurnRun(ws.user.id, save, turn_id, turn_count(save.data["logs"]) + 1, {})
                task = asyncio.get_running_loop().create_task(self.recover(run, ws))
                return self.register(ws.user.id, run, task)
        if attempt["status"] == "committed":
            return await self.again(ws, save, turn_id, attempt, version)
        if attempt["status"] in {"pending", "repairing"}:
            async with self.lock(ws.user.id, save.name):
                running = self.run(ws.user.id, turn_id)
                if running is not None and not running.finished:
                    return running
                self.check_version(ws.user.id, save, version)
                self.admit(ws.user)
                run = TurnRun(ws.user.id, save, turn_id, turn_count(save.data["logs"]) + 1, {})
                task = asyncio.get_running_loop().create_task(
                    self.repair(run, ws), context=self.usage_context(ws.user, "retry", turn_id)
                )
                return self.register(ws.user.id, run, task)
        if attempt["status"] == "generating":
            async with self.lock(ws.user.id, save.name):
                if self.running(ws.user.id, save.archive_id):
                    raise TurnError("turn_in_progress", "本回合正在生成，请先停止或等待")
                self.check_version(ws.user.id, save, version)
                try:
                    timeline = CardTimeline(ws.records)
                    await asyncio.to_thread(timeline.undo, save.name, save.version, turn_id)
                except HTTPException as error:
                    raise turn_error(error) from None
            save = await asyncio.to_thread(find_save, ws.records, save.archive_id, True)
            version = save.version
        if attempt["status"] in {"generating", "failed", "cancelled", "expired"}:
            # The same request again: the words, the option and the action chips, from the run
            # while the server keeps it, else as the request row kept them (after a restart or
            # a minute). The chips' calls are the earlier attempt's: what it took out of the
            # bag stays out and is not taken twice.
            context = attempt.get("context") or {}
            kept = context.get("playRequest")
            earlier = self.run(ws.user.id, turn_id)
            if earlier and earlier.request:
                request = dict(earlier.request)
            elif kept:
                request = {key: kept[key] for key in REQUEST_KEYS if key in kept}
            else:
                request = {"input": (context.get("turnAction") or {}).get("text", "")}
            carried = kept.get("actions") if kept and not life_request(kept) else None
            seed = attempt["seed"]
            return await self.start(ws, save, str(uuid4()), {**request, "version": version},
                                    carried=carried, seed=seed if attempt["status"] == "generating"
                                    or seed.startswith(REROLL_PREFIX) else None)
        raise TurnError("version_conflict", "这一回合已经结算，不能重试")

    async def again(self, ws, save, turn_id, attempt, version):
        """The last turn written anew (spec 五, 回合菜单: 重试 on the last turn only): it is taken
        back as 撤回 takes it, and its request is played again, the same words, option and chips.
        This explicit retry of a finished life turn uses a fresh seed for its dice."""
        last = next((log for log in reversed(save.data["logs"]) if is_turn(log)), None)
        if not last or last.get("frxRequestId") != turn_id:
            raise TurnError("version_conflict", "只能重新写最后一回合", 409)
        context = attempt.get("context") or {}
        kept = context.get("playRequest")
        if kept:
            request = {key: kept[key] for key in REQUEST_KEYS if key in kept}
        else:
            request = {"input": (context.get("turnAction") or {}).get("text", "")}
        async with self.lock(ws.user.id, save.name):
            self.check_version(ws.user.id, save, version)
            if self.running(ws.user.id, save.archive_id):
                raise TurnError("turn_in_progress", "回合正在进行，请等它结束或停止后再重试")
            try:
                await asyncio.to_thread(CardTimeline(ws.records).undo, save.name, save.version)
            except HTTPException as error:
                raise turn_error(error) from None
        taken_back = await asyncio.to_thread(find_save, ws.records, save.archive_id)
        seed = (REROLL_PREFIX + ws.records.new_seed()
                if life_of(taken_back.value) is not None else None)
        return await self.start(ws, taken_back, str(uuid4()),
                                {**request, "version": taken_back.version}, seed=seed)

    async def recover(self, run, ws):
        """Commit the persisted result after a restart, with no model or action replay."""
        run.emit("turn", turn={"id": run.request_id, "no": run.no})
        run.emit("settling")
        try:
            attempt = await asyncio.to_thread(ws.records.request, run.request_id)
            save = await asyncio.to_thread(find_save, ws.records, run.archive_id, True)
            if attempt["status"] == "committed":
                await self.repaired(run, ws, {
                    "value": save.value, "version": save.version,
                }, enqueue=False)
                return
            if attempt["status"] != "ready":
                raise TurnError("version_conflict", "回合状态已变化，请重新读取")
            context = attempt.get("context") or {}
            metadata = context.get("commit")
            if not isinstance(metadata, dict):
                raise TurnError("engine_failed", "回合的提交资料缺失，请停止后重新行动")
            result = attempt.get("settlement") or {}
            turn = TurnPlay(ws, self.runtime, save.name, run.request_id, {}, [], jobs=self.jobs)
            turn.reply = attempt["response"]
            turn.reservation = {"seed": attempt["seed"]}
            turn.settings = metadata["settings"]
            turn.chronicle = list(metadata.get("chronicle") or [])
            turn.recovery = {**metadata, "notes": result.get("firstNotes") or []}
            turn.receipts = [receipt for receipt in result.get("receipts") or []
                             if not receipt.get("readOnly") and not receipt.get("quiet")]
            before = Save(save.name, save.version, reserved_archive(save.value, attempt))
            first = None
            request = context.get("playRequest") or {}
            if not request.get("verb") and not request.get("step"):
                action = context.get("turnAction") or {}
                words = request.get("input") or action.get("text") or action.get("option") or ""
                first = {"id": run.next_id(), **action_block(plain(words), request.get("queue"))}
                run.emit("block", block=first)
            committed = await turn.commit()
            await self.finish(run, ws, turn, committed, before, change_basis(before),
                              [first] if first else [], first, recovering=True)
        except asyncio.CancelledError:
            if await self.finish_committed(run, ws):
                return
            # The ready result remains durable and recoverable on the next request.
            run.emit("error", code="cancelled", message="恢复已停止，已保存的回复仍可继续提交",
                     retryable=True)
            run.finish("pending")
        except Exception as error:
            if await self.finish_committed(run, ws):
                return
            failure = turn_error(error)
            run.emit("error", code=failure.code, message=failure.message, retryable=True)
            run.finish("pending")

    async def repair(self, run, ws):
        run.emit("turn", turn={"id": run.request_id, "no": run.no})
        run.emit("settling")
        try:
            committed = await repair_turn(self.runtime, ws.records, ws.user.id, run.request_id)
            await self.repaired(run, ws, committed)
        except asyncio.CancelledError:
            if await self.finish_committed(run, ws):
                return
            run.emit("error", code="cancelled", message="结算重试已停止，原始回复已保留",
                     retryable=True)
            run.finish("cancelled")
        except Exception as error:
            if await self.finish_committed(run, ws):
                return
            failure = turn_error(error)
            run.emit("error", code=failure.code, message=failure.message,
                     retryable=failure.status != 409, **failure.retry_timing())
            run.finish("pending")

    async def finish_committed(self, run, ws):
        """An interrupted presentation cannot turn a durable commit into a retryable failure.

        Read the completed turn without repeating its model calls, actions or after-turn jobs.
        If its history cannot be rendered, retain the blocks already sent and the saved version.
        """
        try:
            attempt = await asyncio.to_thread(ws.records.request, run.request_id)
        except Exception:
            return False
        if attempt["status"] != "committed":
            return False
        try:
            save = await asyncio.to_thread(find_save, ws.records, run.archive_id, True)
            turn = {**run.turn(), "status": "done"}
            try:
                replay = await asyncio.to_thread(self.known, ws, save, run.request_id)
                done = next(event for event in replay.events if event["event"] == "done")
                turn = done["turn"]
            except Exception as error:
                logger.warning("committed_turn_view_failed error=%s", type(error).__name__)
            run.emit("done", turn=turn, version=save.version)
        except Exception as error:
            logger.warning("committed_turn_read_failed error=%s", type(error).__name__)
            run.emit("error", code="engine_failed", message="回合已保存，请重新读档查看",
                     retryable=False)
        run.finish("done")
        return True

    async def repaired(self, run, ws, committed, *, enqueue=True):
        """Finish a repaired or recovered result from the durable history."""
        logs = committed["value"]["data"]["logs"]
        if enqueue and not logs[-1].get("frxPending"):
            self.jobs.enqueue(ws, run.name, run.request_id, logs[-1]["id"])
        # A recovery commits through the lean path; history needs the referenced snapshots.
        repaired = await asyncio.to_thread(find_save, ws.records, run.archive_id)
        turns = history(run.name, repaired.value, turn_requests(ws.records, run.name),
                        places_of(ws.records, repaired))
        finished = next(turn for turn in turns if turn["id"] == run.request_id)
        for block in finished["blocks"]:
            run.emit("block", block=block)
        try:
            _, view = await self.state_of(ws, run.archive_id)
            run.emit("state", state=view, changes=[])
        except Exception as error:
            logger.warning("state_view_failed error=%s", type(error).__name__)
        run.emit("done", turn=finished, version=committed["version"])
        run.finish(finished["status"])

    async def cancel(self, ws, save, turn_id):
        run = self.run(ws.user.id, turn_id)
        if run and run.archive_id != save.archive_id:
            run = None
        if run and not run.finished:
            run.task.cancel()
            await asyncio.gather(run.task, return_exceptions=True)
            if not run.finished:
                # Cancellation can arrive before the task's coroutine starts its try block.
                if not await self.finish_committed(run, ws):
                    try:
                        attempt = await asyncio.to_thread(ws.records.request, turn_id)
                    except HTTPException:
                        attempt = {}
                    if attempt.get("status") == "ready":
                        run.emit("error", code="cancelled", retryable=True,
                                 message="恢复已停止，已保存的回复仍可继续提交")
                        run.finish("pending")
                    else:
                        await asyncio.to_thread(ws.records.cancel_request, turn_id)
                        run.emit("error", code="cancelled", message="本回合已停止", retryable=True)
                        run.finish("cancelled")
            return {"status": run.status}
        try:
            attempt = await asyncio.to_thread(ws.records.request, turn_id)
        except HTTPException:
            raise TurnError("not_found", "没有这一回合", 404) from None
        if attempt["archive"] != save.name:
            raise TurnError("not_found", "没有这一回合", 404)
        changed = await asyncio.to_thread(ws.records.cancel_request, turn_id)
        if changed:
            attempt = await asyncio.to_thread(ws.records.request, turn_id)
        return {"status": attempt["status"]}

    async def undo(self, ws, save, version, to_turn=None, pending_id=None):
        """Take back the latest turn, or go back to the end of turn `to_turn`."""
        async with self.lock(ws.user.id, save.name):
            self.check_version(ws.user.id, save, version)
            if self.running(ws.user.id, save.archive_id):
                raise TurnError("turn_in_progress", "回合正在进行，请等它结束或停止后再撤回")
            timeline = CardTimeline(ws.records)
            try:
                if to_turn is not None and pending_id is not None:
                    raise TurnError("refused", "请选择撤回待结算回合或回到指定回合")
                if to_turn:
                    logs = settled_turns(save.data["logs"])
                    if not 1 <= to_turn <= len(logs):
                        raise TurnError("not_found", "没有这一回合", 404)
                    await asyncio.to_thread(timeline.restore_snapshot, save.name, save.version,
                                            logs[to_turn - 1]["id"])
                else:
                    await asyncio.to_thread(timeline.undo, save.name, save.version, pending_id)
            except HTTPException as error:
                raise turn_error(error) from None
        after, view = await self.state_of(ws, save.archive_id)
        return {"state": view, "turns": turn_count(after.data["logs"])}

    # ------------------------------------------------------------ reading

    def page(self, ws, save, before=None, limit=10):
        replies = [log for log in save.data["logs"] if is_turn(log)]
        end = min(len(replies), max(0, before - 1)) if before else len(replies)
        start = max(0, end - limit)
        if start == end:
            return {"turns": [], "more": start > 0}
        ids = {log["frxRequestId"] for log in replies[start:end] if log.get("frxRequestId")}
        turns = history(save.name, save.value, turn_requests(ws.records, save.name, ids),
                        places_of(ws.records, save, keep=False), numbers=range(start + 1, end + 1))
        return {"turns": turns, "more": start > 0}

    def pending(self, ws, save):
        """The turn under way or waiting for its settlement, or None when there is none."""
        run = self.running(ws.user.id, save.archive_id)
        if run:
            return run.turn()
        logs = save.data["logs"]
        with ws.records.sessions() as session:
            rows = session.scalars(ws.records.requests_of(save.name).where(
                CardRequest.status.in_(("ready", "generating")))
                .order_by(CardRequest.created_at.desc())).all()
            for row in rows:
                context = row.context or {}
                if row.status == "ready":
                    return self.ready_view(save, {"id": row.id, "response": row.response,
                                                  "created_at": row.created_at})
                tip = logs[-1].get("id") if logs else None
                if (tip and context.get("userLogId") == tip) or request_blocks_archive(row):
                    notice = {"id": "interrupted-generation", **PENDING,
                              "text": "上次生成已中断。可以重新执行行动，或放弃本回合。"}
                    return {"id": row.id, "no": turn_count(logs) + 1, "status": "pending",
                            "blocks": [notice], "at": row.created_at}
        last = next((log for log in reversed(logs) if is_turn(log)), None)
        if last and last.get("frxPending"):
            save = find_save(ws.records, save.archive_id)
            return history(save.name, save.value, turn_requests(ws.records, save.name),
                           places_of(ws.records, save, keep=False))[-1]
        return None

    @staticmethod
    def ready_view(save, attempt):
        """Expose a durable result awaiting commit through the existing retry affordance."""
        blocks = []
        story = plain(story_of(attempt.get("response") or ""))
        if story:
            blocks.append({"id": "recovery-story", "type": "narration", "text": story})
        blocks.append({"id": "recovery-notice", **PENDING,
                       "text": "回复和结算已保存，请重试提交以继续。"})
        return {"id": attempt["id"], "no": turn_count(save.data["logs"]) + 1,
                "status": "pending", "blocks": blocks,
                "at": attempt.get("created_at") or iso_now()}
