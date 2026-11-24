"""The cultivation life's turns that call no model (docs/gameplay-plan.md, 「回合的四种走法」 and
item 5): a standing verb (静候, and the verbs later work adds) is settled by the engine at once and
written as lines of the annals (年谱), never by the model.

Such a turn goes through the same commit and undo as any other (play_turns): the player's log is
the verb in words (「静候　五日」, frxKind "verb"), the reply is the annals lines with the engine's
receipts (synthesize, as an engine-settled turn's final reply), and the whole-turn settlement
(turn_runtime.settle_card) turns the receipts into the new state, frxPlay included. life_stream
plays the part pilot_stream plays for a turn the model writes: it records the result on the
request row and yields the shared pipeline's frames (the seed, the chronicle lines, the receipts'
cards, the final reply, the end mark), which TurnPlay.generate reads as it reads pilot_stream's.

A verb reaches the engine as it was sent: the server adds nothing to it and knows no verb but by
its kind's name in the player's log (VERB_NAMES). A new verb kind is a handler in
apps/engine/life/verbs.cjs, its kind in play_models.VerbKind and, when it needs the model (写一段),
in MODEL_VERBS; a stretch the engine cannot settle in one call (more than limits.monthsPerCall
months, content/life/chronicle.json) is split here into calls the engine can take.
"""

import asyncio
import copy
import json
import logging
import re
import time
from types import SimpleNamespace

from .card_director import active_plot, plot_payload
from .card_store import state_digest
from .card_turns import (
    PilotTurn,
    TurnMetrics,
    admission,
    close_stream,
    event,
    has_words,
    run_engine,
    synthesize,
)
from .domain import ROOT
from .gateway import Gateway, ModelFailure, model_failure
from .life import life_of
from .life_cards import (
    CARD,
    FIELDS,
    SAID,
    clock_completions,
    close_weight,
    couplet_of,
    kept_reply,
    known_thread_ids,
    leave_line,
    parse_actions,
    scene_title,
    settled_of,
    thread_changes,
    threads_of,
    volume_of,
)
from .life_memory import active_matters, life_evidence, past_accounts
from .life_prompt import (
    OPENING_BEATS,
    PROMPT,
    ROUTES,
    elaborate_messages,
    fill,
    length_of,
    length_range,
)
from .play_blocks import actions_block, is_turn, plain, row_name, story_of
from .play_sheet import time_row
from .play_state import (
    OPENING_ON,  # noqa: F401 (the words that hold verbs before the opening)
    Moment,
)
from .request_policy import GENERATION_SECONDS
from .turn_runtime import (
    LifeRefusal,
    error_frame,
    recall_memory,
    record_turn,
    settle_card,
    sse,
    store_failure,
)

logger = logging.getLogger(__name__)

CHRONICLE = json.loads((ROOT / "content/life/chronicle.json").read_text(encoding="utf-8"))
CALENDAR = json.loads((ROOT / "content/cultivation.json").read_text(encoding="utf-8"))["calendar"]
DAYS_PER_YEAR = CALENDAR["daysPerMonth"] * CALENDAR["monthsPerYear"]
# The longest stretch one engine call settles: limits.monthsPerCall months of daysPerMonth days.
DAYS_PER_CALL = CHRONICLE["limits"]["monthsPerCall"] * CALENDAR["daysPerMonth"]

# A verb's name in the player's log (「静候　五日」). A kind not listed shows as itself.
VERB_NAMES = {
    "wait": "静候", "cultivate": "修炼", "rest": "调息", "breakthrough": "冲关", "perk": "悟得",
    "elaborate": "写一段", "travel": "赶路", "calm": "守拙", "gather": "采集", "hunt": "狩猎",
    "ask": "打探", "job": "接差事", "trade": "买卖", "craft": "炼制", "refine": "祭炼",
    "repair": "修补", "bind": "认主", "visit": "拜访", "follow": "接着办",
    "array": "布阵", "home": "洞府",
    "duty": "宗门差事", "contest": "宗门比试",
}
# The verbs whose thing the contract names by `id` and the engine by its own key: the piece of
# gear refined or mended (gear.cjs), the spirit beast bound (beasts.cjs).
ID_ARGS = {"refine": "itemId", "repair": "itemId", "bind": "beastId"}
# Verbs that ask the model (the turn's quota applies): none settles by the engine alone.
MODEL_VERBS = {"elaborate"}

NOT_LIFE = "这个存档不是修仙人生，没有常驻指令、行动卡和斗法"

DIGITS = "零一二三四五六七八九"
PLACES = ("千", "百", "十", "")


def numeral(n):
    """A whole number in Chinese, as the annals write it (apps/engine/life/chronicle.cjs):
    五, 十二, 四十五, 一百零一, 一万零五十."""
    if n < 10:
        return DIGITS[n]
    if n < 20:
        return "十" + (DIGITS[n % 10] if n % 10 else "")
    if n < 10000:
        text, gap = "", False
        for place, digit in enumerate(str(n).rjust(4, "0")):
            if digit == "0":
                gap = text != ""
                continue
            text += ("零" if gap else "") + DIGITS[int(digit)] + PLACES[place]
            gap = False
        return text
    rest = n % 10000
    return numeral(n // 10000) + "万" + (("零" if rest < 1000 else "") + numeral(rest)
                                        if rest else "")


def day_of(year, month, day):
    """A day counted from 0001-01-01 (day 0), in the game's calendar."""
    return (year - 1) * DAYS_PER_YEAR + (month - 1) * CALENDAR["daysPerMonth"] + day - 1


def until_day(text):
    """The day a verb's `until` names ("0001-03-15"), or None."""
    found = re.fullmatch(r"\s*(\d{1,6})-(\d{1,2})-(\d{1,2})\s*", str(text or ""))
    if not found:
        return None
    year, month, day = (int(part) for part in found.groups())
    if year < 1 or not 1 <= month <= CALENDAR["monthsPerYear"] or not (
            1 <= day <= CALENDAR["daysPerMonth"]):
        return None
    return day_of(year, month, day)


def date_words(text):
    """「三月十五」 for "0001-03-15", with the year when it is not the first (「二年三月十五」)."""
    found = re.fullmatch(r"\s*(\d{1,6})-(\d{1,2})-(\d{1,2})\s*", str(text or ""))
    if not found or until_day(text) is None:
        return str(text or "")
    year, month, day = (int(part) for part in found.groups())
    words = CHRONICLE["months"][month - 1] + CHRONICLE["days"][day - 1]
    return (numeral(year) + "年" + words) if year > 1 else words


def verb_words(verb):
    """The player's log of a verb: its name and what it was given (「静候　五日」,
    「静候　到三月十五」, 「调息　三个时辰」)."""
    kind = str(verb.get("kind") or "")
    parts = []
    if isinstance(verb.get("days"), int):
        parts.append(numeral(verb["days"]) + CHRONICLE["spans"]["day"])
    if verb.get("until"):
        parts.append("到" + date_words(verb["until"]))
    if verb.get("full"):
        parts.append("修满为止")
    if isinstance(verb.get("hours"), int):
        parts.append(f"{numeral(verb['hours'])}个小时")
    if verb.get("stones"):
        parts.append("用灵石")
    if isinstance(verb.get("index"), int):
        parts.append(f"第{numeral(verb['index'])}条")
    if verb.get("to"):
        parts.append(f"往{verb['to']}")
    if verb.get("tier"):
        parts.append(str(verb["tier"]))
    if verb.get("recipe"):
        parts.append(str(verb["recipe"]))
    if isinstance(verb.get("batches"), int):
        parts.append(f"{numeral(verb['batches'])}炉")
    if verb.get("hire"):
        parts.append("请人代做")
    if verb.get("smith"):
        parts.append("请匠人")
    return "　".join([VERB_NAMES.get(kind, kind), *parts]).strip()


def calls_model(verb):
    """Whether a turn with this verb asks the model (and so counts against the model quota)."""
    return str((verb or {}).get("kind")) in MODEL_VERBS


class LifeTurn:
    """What life_stream settled, read by TurnPlay as it reads an engine-settled turn: the
    receipts in order, the annals lines (the engine's, { kind, date: { text, year, month, day },
    text, line }), the final reply and the settlement recorded on the request row."""

    def __init__(self):
        self.receipts = []
        self.chronicle = []
        self.final = ""
        self.settlement = None
        # the engine's progress of the settled state (settle_card after_progress): the state view
        # after the commit reads it instead of asking the engine once more
        self.after_progress = None


def today_words(archive, receipts=()):
    """The day the beat is written on, in the calendar's words (正月初三): where the last receipt
    that moved the clock left it, else the save's time row; None when neither reads."""
    for receipt in reversed(list(receipts or [])):
        after = (receipt.get("time") or {}).get("after") if isinstance(receipt, dict) else None
        if after:
            return Moment(str(after)).date or None
    for row in ((archive["data"]["state"].get("currentState") or {}).get("4") or []):
        if isinstance(row, dict) and row.get("id") == "TIME_LOCATION_ROW":
            return Moment(str(row.get("0") or "")).date or None
    return None


def today_of(archive):
    """The day the save's time row is on, or None when it has no readable date."""
    for row in ((archive["data"]["state"].get("currentState") or {}).get("4") or []):
        if isinstance(row, dict) and row.get("id") == "TIME_LOCATION_ROW":
            found = re.search(r"(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日", str(row.get("0") or ""))
            if found:
                return day_of(*(int(part) for part in found.groups()))
    return None


def engine_verb(verb):
    """The verb as the engine reads it: the contract's `id` is a piece's `itemId` (refine,
    repair) or a beast's `beastId` (bind)."""
    key = ID_ARGS.get(str(verb.get("kind")))
    if key and verb.get("id") and not verb.get(key):
        return {**verb, key: verb["id"]}
    return verb


def stretches(archive, verb):
    """The verb as the engine is called with it: once as sent, or, for a stretch of more days
    than one call settles, as calls of at most DAYS_PER_CALL days each (the last the rest)."""
    verb = engine_verb(verb)
    days = verb.get("days") if isinstance(verb.get("days"), int) else None
    if days is None and verb.get("until") and not verb.get("full"):
        target, today = until_day(verb["until"]), today_of(archive)
        if target is not None and today is not None and target - today > DAYS_PER_CALL:
            days = target - today
    if days is None or days <= DAYS_PER_CALL:
        return [verb]
    base = {key: value for key, value in verb.items() if key not in {"days", "until"}}
    calls = []
    while days > 0:
        calls.append({**base, "days": min(days, DAYS_PER_CALL)})
        days -= DAYS_PER_CALL
    return calls


def storyline(archive):
    """The storyline as the engine reads it (card_director.plot_payload), or None: a verb's
    stretch stops on its chapter's day (the engine's calendar.mainDay), and the preview says so."""
    plot = active_plot((archive or {}).get("data") or {})
    return plot_payload(plot) if plot else None


async def run_verb(archive, seed, verb, knowledge=None):
    """The engine's verb op on the save as the turn reserved it: its receipts and annals lines.
    A long stretch is settled call after call, each starting from the receipts before it, until
    one is broken off or ends with the lifespan.
    Raises LifeRefusal when the engine refuses, ModelFailure when it fails."""
    receipts, chronicle = [], []
    plot = storyline(archive)
    for args in stretches(archive, verb):
        result = await run_engine({
            "mode": "life", "op": "verb", "archive": archive, "seed": seed, "args": args,
            "receipts": receipts, "knowledge": knowledge or {},
            **({"plot": plot} if plot else {}),
        })
        if result.get("error") == "not_life":
            raise LifeRefusal(NOT_LIFE)
        if result.get("error"):
            raise LifeRefusal(str(result.get("reason") or "这个指令现在做不了"))
        if result.get("errors"):
            logger.warning("life_engine_failed errors=%s", "；".join(result["errors"])[:300])
            raise ModelFailure("引擎结算没有完成，请稍后重试")
        receipts += result.get("receipts") or []
        chronicle += result.get("chronicle") or []
        if interruption_of(result.get("receipts")) is not None or died(result.get("receipts")):
            # broken off (or given way to a pending event), or the lifespan ended on the way
            # (item 49: its last day stops every stretch): the rest of the stretch is not lived
            break
    return receipts, chronicle


def died(receipts):
    """Whether the player died of old age in these receipts (the engine's legacy.cjs, item 49)."""
    return any(receipt.get("kind") == "legacy" and (receipt.get("legacy") or {}).get("action")
               == "died" for receipt in receipts or [])


# ---------------------------------------------------------------- what a verb would do (item 12)


async def preview_verb(archive, verb, knowledge=None):
    """What a standing verb would do if done now (POST …/preview): the engine's preview op, the
    verb op's own code with nothing written, as play_models.VerbPreview has it. Raises
    LifeRefusal for a save not of the life, ModelFailure when the engine fails."""
    plot = storyline(archive)
    result = await run_engine({
        "mode": "life", "op": "preview", "archive": archive, "seed": "preview",
        "args": engine_verb(verb), "receipts": [], "knowledge": knowledge or {},
        **({"plot": plot} if plot else {}),
    })
    if result.get("error") == "not_life":
        raise LifeRefusal(NOT_LIFE)
    if result.get("error"):
        raise LifeRefusal(str(result.get("reason") or "这个指令现在看不了"))
    if result.get("errors") or not isinstance(result.get("preview"), dict):
        logger.warning("life_preview_failed errors=%s", "；".join(result.get("errors") or [])[:300])
        raise ModelFailure("引擎没有算出预览，请稍后重试")
    return result["preview"]


# The reasons presettle gives words that cultivate now and words that rest
# (apps/engine/turn-rules.cjs), and the one any word of cultivating gets.
CULTIVATING = "行动是修炼，修为由引擎结算"
MAY_CULTIVATE = "行动可能是修炼"
RESTING = "行动可能是休整恢复"
VERB_RULES = json.loads((ROOT / "content/life/verbs.json").read_text(encoding="utf-8"))
REST_HOURS = VERB_RULES["rest"]["hours"]
SPAN = re.compile(r"([0-9]+|[零一二两三四五六七八九十百千]+|半)\s*个?\s*"
                  r"(天|日|月|年|时辰|小时|钟头)")
FULL = re.compile(r"修满|圆满|满为止|修为满")
STONES = re.compile(r"(?<![不别没])(?:用|以|拿|握着?|借助?|耗)灵石")
UNITS = {"天": 1, "日": 1, "月": CALENDAR["daysPerMonth"], "年": DAYS_PER_YEAR}


def count_of(word):
    """A count written in digits or Chinese numerals (十二, 两, 一百零五), 半 as a half."""
    if word.isdigit():
        return int(word)
    if word == "半":
        return 0.5
    total, number = 0, 0
    for char in word:
        if char in DIGITS or char == "两":
            number = 2 if char == "两" else DIGITS.index(char)
        else:
            total += (number or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            number = 0
    return total + number


FEE_PAYMENT = re.compile(
    r"(?:^|[，,；;。！？\n])\s*"
    r"(?:(?:我|你|亲手|主动|径直|直接|先|随后|再|便|就|并|"
    r"(?:自|从)(?:袖[口中底里]|怀[中里]|衣袖|钱袋|储物袋)[中里]?|"
    r"(?:向|给)[^，,；;。！？：:\n]{1,12}?)\s*){0,3}"
    r"(?:缴(?:纳|付|交)?|支付|付(?:了|出|给)?|(?:交|递|给|奉)(?:出|上|给)?)"
    r"\s*([0-9]{1,8}|[零一二两三四五六七八九十百千]{1,12})\s*[块枚颗]\s*"
    r"(下品|中品)?灵石"
)
FEE_PURPOSE = re.compile(
    r"入场|进场|入市|入集|门资|门票|过路|通行费|丁税|船资|车资|房钱|缴税"
)
FEE_CONDITIONAL = re.compile(
    r"如果|要是|倘若|是否|能否|能不能|问(?:清|明)|打算|试探|展示|验看|出示|"
    r"(?:先|想|试着)(?:询问|问问)|(?:不|没|未|别|莫|拒绝)(?:先|再|想|愿)?(?:付|交|缴|给|递)"
)


def stated_fee(text):
    """One explicit player-authorized fee, in lower-grade stones, with no model pricing."""
    if not FEE_PURPOSE.search(text) or FEE_CONDITIONAL.search(text):
        return None
    payments = FEE_PAYMENT.findall(text)
    if len(payments) != 1:
        return None
    number, grade = payments[0]
    amount = count_of(number) * (100 if grade == "中品" else 1)
    return amount if amount > 0 else None


def words_verb(kind, text):
    """The verb `kind` (cultivate or rest) for as long as free words say: days, months and years
    (or 修满, and 用灵石) for cultivating, 时辰 and hours for resting. Unsaid, cultivating takes one
    day and resting the longest a rest takes (verbs.json rest.hours.max)."""
    days = hours = 0
    for number, unit in SPAN.findall(text):
        if unit in UNITS:
            days += count_of(number) * UNITS[unit]
        else:
            hours += count_of(number) * (2 if unit == "时辰" else 1)
    if kind == "cultivate":
        verb = {"kind": "cultivate"}
        if FULL.search(text) and not days:
            verb["full"] = True
        else:
            verb["days"] = max(1, round(days))
        if STONES.search(text):
            verb["stones"] = True
        return verb
    hours = round(hours) if hours else REST_HOURS["max"]
    return {"kind": "rest", "hours": min(REST_HOURS["max"], max(REST_HOURS["min"], hours))}


async def free_verb(archive, text, seed):
    """The standing verb a life save's free words mean, when today's presettle reads them as
    cultivating now or resting and as nothing else (no thing used or taken, no trade, check,
    skill, fight or gate): cultivate or rest for as long as the words say (words_verb), else
    None and the model writes the turn."""
    plan = await run_engine({"mode": "presettle", "archive": archive,
                             "action": {"text": text, "items": []}, "seed": seed})
    if plan.get("errors") or plan.get("receipts") or plan.get("fight"):
        return None
    reasons = set(plan.get("reasons") or [])
    if reasons - {CULTIVATING, MAY_CULTIVATE, RESTING}:
        return None
    if CULTIVATING in reasons:
        return words_verb("cultivate", text)
    if RESTING in reasons:
        return words_verb("rest", text)
    return None


# What holds every other turn while someone met in the wild waits for the beat (item 31): the
# engine's own words for it (encounter.cjs hold).
ENCOUNTER_ON = "眼前撞上的事还没了，先在这一拍里拿个主意"

# A move's command as the player's log and its action block say it (攻 术 物 御 遁 察 和 驯), and
# what the spirit beast beside the player is told (item 41).
COMMAND_WORDS = {"strike": "攻", "skill": "术", "item": "物", "guard": "御", "flee": "遁",
                 "probe": "察", "talk": "和", "tame": "驯", "break": "破"}
ORDER_WORDS = {"attack": "令灵兽扑咬", "guard": "令灵兽护主", "harass": "令灵兽袭扰"}
FIGHT_ON = "斗法还没有结束：先出手，或者遁走"


# The commands that are aimed at a foe: the first one standing when the move names none.
AIMED = {"strike", "skill", "probe", "talk", "tame"}
# 降服 named at no one goes, as the engine sends it (fight.cjs tameTarget), at the first beast
# standing below this share of its 气血 (content/life/beasts.json tame.below).
TAME_BELOW = json.loads(
    (ROOT / "content/life/beasts.json").read_text(encoding="utf-8"))["tame"]["below"]


def health_of(row):
    """A row's 气血 now and at most, from its panel (column 11), as (current, max)."""
    panel = (row or {}).get("11")
    if isinstance(panel, str):
        try:
            panel = json.loads(panel)
        except ValueError:
            panel = {}
    held = (panel or {}).get("血量") if isinstance(panel, dict) else None
    if isinstance(held, dict):
        return float(held.get("current") or 0), float(held.get("max") or 0)
    if isinstance(held, (int, float)):
        return float(held), float(held)
    return 0.0, 0.0


def tame_target(fight, state):
    """The foe 降服 goes at when the move names none: the first beast standing below TAME_BELOW
    percent of its 气血 (the engine's tameTarget), or None."""
    for foe in fight.get("foes") or []:
        if not isinstance(foe, dict) or foe.get("out") or foe.get("class") != "beast":
            continue
        current, most = health_of((state.get("0") or {}).get(foe.get("id")))
        if current > 0 and most > 0 and 100 * current / most < TAME_BELOW:
            return foe.get("id")
    return None


def move_words(move, archive):
    """A move in words: its command, and the skill, the thing and the foe it names by their names
    in the save (「术　火弹术　黑衣劫修」); a move aimed at no one in particular is aimed, as the
    engine aims it, at the first foe standing."""
    state = archive["data"]["state"].get("currentState") or {}

    def name_of(table, key):
        row = (state.get(table) or {}).get(key)
        return plain(str((row or {}).get("1") or "")).split("|")[0].strip() or key

    command = str(move.get("command") or "")
    target = move.get("targetId")
    fight = (life_of(archive) or {}).get("fight") or {}
    if not target and command == "tame":
        target = tame_target(fight, state)
    elif not target and command in AIMED:
        target = next((foe.get("id") for foe in fight.get("foes") or []
                       if isinstance(foe, dict) and not foe.get("out")), None)
    parts = [COMMAND_WORDS.get(command, command)]
    for key, table in (("skillId", "8"), ("itemId", "1")):
        if move.get(key):
            parts.append(name_of(table, move[key]))
    if target:
        parts.append(name_of("0", target))
    if move.get("order") in ORDER_WORDS:
        parts.append(ORDER_WORDS[move["order"]])
    return "　".join(parts)


# A realm step in the player's log (item 32): 「入秘境　沉钟泽」, 「秘境　第三层·宝」, 「出秘境」.
STEP_WORDS = {"enter": "入秘境", "node": "秘境", "leave": "出秘境"}


REALMS = json.loads((ROOT / "content/life/realms.json").read_text(encoding="utf-8"))["realms"]


def realm_args(step, archive=None):
    """A realm step as the engine's realm op takes it; going in without naming the realm is the
    one whose place the player's time row is at (content/life/realms.json)."""
    args = {"action": step.get("action"),
            **{key: step[key] for key in ("node", "realm") if step.get(key)}}
    if args["action"] == "enter" and not args.get("realm") and archive is not None:
        rows = (archive["data"]["state"].get("currentState") or {}).get("4") or []
        here = next((str(row.get("0") or "") for row in rows if isinstance(row, dict)
                     and row.get("id") == "TIME_LOCATION_ROW"), "")
        found = next((key for key, spec in REALMS.items()
                      if spec.get("place") and spec["place"] in here), None)
        if found:
            args["realm"] = found
    return args


def step_words(step, archive):
    """A realm step in words: entering (the realm named), a node by its layer and kind as the
    map shows it, or leaving."""
    action = str(step.get("action") or "")
    parts = [STEP_WORDS.get(action, action)]
    realm = (life_of(archive) or {}).get("realm") or {}
    if action == "enter" and step.get("realm"):
        # the realm by its name (「入秘境　沉钟泽」), not its id
        parts.append(str((REALMS.get(step["realm"]) or {}).get("name") or step["realm"]))
    if action == "node" and step.get("node"):
        node = next((each for layer in realm.get("layers") or [] for each in layer
                     if isinstance(each, dict) and each.get("id") == step["node"]), None)
        layer = str(step["node"]).split("-")[0]
        kind = (node or {}).get("kind")
        parts.append(f"第{numeral(int(layer))}层" + (f"·{kind}" if kind else "")
                     if layer.isdigit() else str(step["node"]))
    return "　".join(parts)


def scene_opened(receipts):
    """The scene a realm step opened (a 秘: the engine's scene receipt, action open), as the
    beat's prompt takes it: { origin, title }; None when none opened."""
    for receipt in receipts or []:
        if receipt.get("kind") == "scene" and receipt.get("action") == "open":
            scene = receipt.get("scene") or {}
            return {"origin": str(scene.get("origin") or "realm"),
                    "title": str(scene.get("title") or "")}
    return None


def fight_end_of(receipts):
    """How the fight ended on this move ({ end, loss?, … } of its fight receipt), or None while
    it goes on."""
    for receipt in reversed(receipts or []):
        fight = receipt.get("fight") if receipt.get("kind") == "fight" else None
        if isinstance(fight, dict) and fight.get("end"):
            return fight
    return None


def engine_report(ended):
    """A routine fight's battle report as the engine wrote it (report.cjs, batch 9: a hunt's
    beast, a beast met in the wild): its lines as the turn's story, or None when the model is to
    write the report (people, a foe the story brought, a scene of the story's)."""
    lines = (ended or {}).get("report")
    if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
        return None
    # a paragraph a line, as the model's report has its paragraphs
    told = "\n\n".join(line.strip() for line in lines if line.strip())
    return told or None


async def close_reported(archive, seed, knowledge, receipts):
    """After a routine fight the engine reported, the scene it was fought in closes at the plain
    weight, as the 离开 card closes one (scene.cjs close): its receipts, none when no scene is
    on."""
    if not (play_after(receipts, archive) or {}).get("scene"):
        return []
    result = await life_op(archive, seed, knowledge, receipts, "scene", {"action": "close"})
    return result.get("receipts") or []


# ---------------------------------------------------------------- the gate (item 22)


async def gate_sheet(archive, aids=None, knowledge=None):
    """The next gate's preparation sheet (GET …/gate): the engine's gate op, with the pills `aids`
    (bag ids) priced when given, an empty list for none; None counts the bag's, as many as count.
    Raises LifeRefusal for a save not of the life, ModelFailure when the engine fails."""
    args = {"aids": aids} if aids is not None else {}
    result = await life_op(archive, "gate", knowledge, [], "gate", args)
    if not isinstance(result.get("gate"), dict):
        raise ModelFailure("引擎没有给出准备单，请稍后重试")
    return result["gate"]


def gate_of(receipts):
    """The attempt at a gate among a verb's receipts (the breakthrough verb's receipt with the gate
    it was), or None. Every gate is a major realm's; layers inside 炼气 come with cultivating."""
    return next((receipt for receipt in receipts or [] if receipt.get("kind") == "breakthrough"
                 and isinstance(receipt.get("gate"), dict)), None)


def amount(n):
    """A count in Chinese words, 两 for two: 两年, 十一个月, 三十年."""
    return "两" if n == 2 else numeral(n)


def span_words(days):
    """A span of days in words: 九日, 三个月, 两年零三个月 (thirty-day months, to the nearest)."""
    years, rest = divmod(max(0, int(days)), 360)
    months = round(rest / 30)
    if years and months:
        return f"{amount(years)}年零{amount(months)}个月"
    if years:
        return f"{amount(years)}年"
    return f"{amount(months)}个月" if months else f"{amount(rest)}日"


def ago_words(key, now):
    """How long before `now` (a Moment) a date key (0001-01-20) was: 四个月前, 三十年前, 今日 for
    the same day; empty when either is unknown."""
    found = re.fullmatch(r"(\d+)-(\d+)-(\d+)", str(key or ""))
    if not found or not now.year:
        return ""
    year, month, day = (int(part) for part in found.groups())
    days = (now.year - year) * 360 + (now.month - month) * 30 + now.day - day
    return span_words(days) + "前" if days > 0 else PROMPT["situation"]["demonToday"]


def cost_words(receipt):
    """What a failed attempt cost as the engine settled it, for the big scene to say: the years
    of the lifespan lost and how long before the gate may be tried again (the real model wrote
    「三年之内」 for a cooldown of three months: the receipt had the date, the scene's words now
    say it)."""
    check, gate = receipt.get("breakthrough") or {}, receipt.get("gate") or {}
    said = PROMPT["situation"]
    words = []
    if gate.get("lifespanLost"):
        words.append(fill(said["gateYears"], {"年": amount(int(gate["lifespanLost"]))}))
    until, after = Moment(str(check.get("cooldownUntil") or "")), Moment(
        str((receipt.get("time") or {}).get("after") or ""))
    if until.year and after.year:
        days = ((until.year - after.year) * 360 + (until.month - after.month) * 30
                + until.day - after.day)
        if days > 0:
            words.append(fill(said["gateCooldown"], {"期": span_words(days), "日期": until.date}))
    return words


def gate_words(receipt):
    """What the big scene's prompt says of an attempt at a gate: its name, whether it went through,
    the realm reached and the foundation it left, or what failing cost; and the 心魔 of its heart
    knots at 结丹 and 元婴 (item 40): each knot's kind, person and deed, how long before the
    attempt it was, and whether the 神识 check held. A failure's cost is the engine's: the years
    lost and the span before the next try take the place of the rule's own words for the wait
    (the real model wrote 「一年之内」 beside 「一段时日内」 for a wait of a month)."""
    check, gate = receipt.get("breakthrough") or {}, receipt.get("gate") or {}
    realm = check.get("realm") or {}
    success = bool(realm) and realm.get("before") != realm.get("after")
    began = Moment(str((receipt.get("time") or {}).get("before") or ""))
    demons = [{"kind": str((d.get("knot") or {}).get("kind") or ""),
               "who": str(((d.get("knot") or {}).get("who") or {}).get("name") or ""),
               "what": str((d.get("knot") or {}).get("what") or ""),
               "ago": ago_words((d.get("knot") or {}).get("date"), began),
               "held": (d.get("check") or {}).get("outcome") in ("成功", "大成功")}
              for d in receipt.get("demons") or [] if isinstance(d, dict)]
    cost = [] if success else cost_words(receipt)
    consequence = str(check.get("consequence") or "")
    wait = PROMPT["situation"]["gateWait"]
    if any(wait in each for each in cost):
        consequence = "，".join(part for part in consequence.split("，") if wait not in part)
    return {"name": str(gate.get("name") or check.get("to") or ""), "success": success,
            "to": str(check.get("to") or realm.get("after") or ""),
            "foundation": str(gate.get("foundation") or check.get("foundation") or ""),
            "consequence": "；".join([consequence, *cost]).strip("；"),
            **({"demons": demons} if demons else {}),
            # the volume the gate closed (item 38): its number and the annals its page shows
            **({"volume": receipt["volume"]} if isinstance(receipt.get("volume"), dict) else {})}


# ---------------------------------------------------------------- what the server marks (item 25)

FIRST_NOTES = PROMPT["firstNotes"]
# The receipt line of the opening's first method, put on for the player (item 25).
FIRST_METHOD = PROMPT["opening"]["equipped"]


def gate_reached(receipts):
    """Whether the turn brought the player to a gate: 修为 full on cultivating, 打磨, or an attempt
    at the gate itself."""
    for receipt in receipts or []:
        after = ((receipt.get("cultivation") or {}).get("after") or {}).get("progress")
        if receipt.get("kind") == "cultivate" and isinstance(after, int | float) and after >= 100:
            return True
        if receipt.get("kind") in {"polish", "gate"} or gate_of([receipt]):
            return True
    return False


# The scene closes that say how to go on from them (the owner's second playtest: after a scene the
# page led with the main line and the way on from the scene was lost): the first three of a life.
CLOSE_NOTES = 3


def mark_play(settlement, archive_before, receipts, verb=False):
    """What the server itself keeps in the turn's frxPlay (the engine keeps the rest): the opening
    scene done once a scene closes in the turn, and the notes shown the first time each new thing
    is met (frxPlay.seen: cards, a standing verb, a clock, the gate) and on the first CLOSE_NOTES
    scene closes (close, kept once for each), returned for the turn's notice blocks and kept on
    the settlement (firstNotes)."""
    before = life_of(archive_before) or {}
    after = settlement.get("frxPlay")
    if not isinstance(after, dict):
        after = settlement["frxPlay"] = copy.deepcopy(before)
    closed = any(receipt.get("kind") == "close" for receipt in receipts or [])
    if after.get("opening") and closed:
        after["opening"] = None
    seen = list(after.get("seen") or before.get("seen") or [])
    notes = []
    if closed and seen.count("close") < CLOSE_NOTES:
        notes.append("close")
    if verb and "verb" not in seen:
        notes.append("verb")
    if after.get("cards") and not after.get("fight") and "cards" not in seen:
        notes.append("cards")
    if after.get("clocks") and "clock" not in seen:
        notes.append("clock")
    if "gate" not in seen and gate_reached(receipts):
        notes.append("gate")
    after["seen"] = seen + notes
    settlement["firstNotes"] = notes
    return notes


def interruption_of(receipts):
    """The stretch of days the engine broke off (item 16): the `interruption` a verb's receipt
    carries ({ origin, cause, day, date, minutes, clock?, event?, chance? }), or None."""
    return next((receipt["interruption"] for receipt in receipts or []
                 if isinstance(receipt.get("interruption"), dict)), None)


def present_of(interruption):
    """Who the scene an interruption opens has in it from its first beat: the person visited
    (拜访) or the 故人 a pending event of theirs brought (pending.cjs fire: event.person), by id;
    the scene op brings one off the scene back from the biography (scene.cjs open)."""
    found = interruption.get("visit") or (interruption.get("event") or {}).get("person")
    return [str(found["id"])] if isinstance(found, dict) and found.get("id") else []


TIME_ROW = re.compile(r'add\("TIME_LOCATION_ROW",\s*(\{[^{}]*\})\)')


def road_of(receipts):
    """Where a journey broken off on the road leaves the player, as its time row writes the place
    (after the first slash: 「潮岚道/云汀湾（途中）3282,1865」); None when no journey is among the
    receipts or it arrived."""
    for receipt in reversed(receipts or []):
        journey = receipt.get("travel") if receipt.get("kind") == "travel" else None
        if not isinstance(journey, dict) or not receipt.get("ok"):
            continue
        if journey.get("arrived"):
            return None
        for found in reversed(TIME_ROW.findall(str(receipt.get("commands") or ""))):
            try:
                text = str(json.loads(found).get("0") or "")
            except ValueError:
                continue
            if "/" in text:
                return text.split("/", 1)[1]
        return None
    return None


def held_to_road(commands, road):
    """The story's commands with each time row's place held to the road's (its time left to the
    beat's limits). The model writes the place of the state its prompt shows, the one before the
    journey: back at the start when the road is still near it, else another map place, which the
    engine refuses (the turn waited for its settlement after a rewrite that did the same; batch
    5)."""
    def hold(found):
        try:
            data = json.loads(found[1])
        except ValueError:
            return found[0]
        text = str(data.get("0") or "")
        if "/" not in text:
            return found[0]
        data["0"] = text.split("/", 1)[0] + "/" + road
        return 'add("TIME_LOCATION_ROW",' + json.dumps(data, ensure_ascii=False) + ")"
    return TIME_ROW.sub(hold, str(commands or ""))


def interrupted_words(verb, interruption):
    """What the beat's prompt says of an interruption: the verb's name, the day of the stretch
    and its date in words, and the cause (life_prompt.LifeBeat.interrupted); `first` when the
    stretch never began (day 0: a pending event went off in its place); `person` the 故人 the
    event brought, in the scene from its first beat; `thread` the story thread the scene takes up
    ({ text, spot }), `taken` when the player took it up (接着办) rather than its time coming."""
    day = interruption.get("day")
    visit = interruption.get("visit")
    person = (interruption.get("event") or {}).get("person")
    # a story thread (batch 9): taken up (接着办: the interruption's own), or its time come
    thread = interruption.get("thread") or (interruption.get("event") or {}).get("thread")
    return {"doing": VERB_NAMES.get(str(verb.get("kind")), str(verb.get("kind") or "")),
            "day": numeral(day) if isinstance(day, int) else str(day or ""),
            "date": str((interruption.get("date") or {}).get("text") or ""),
            "cause": str(interruption.get("cause") or ""),
            **({"first": True} if day == 0 else {}),
            # 拜访: the scene opens on the visit, not on something that broke the days off
            **({"visit": visit} if isinstance(visit, dict) else {}),
            **({"thread": {"text": str(thread.get("text") or ""),
                           "spot": str(thread.get("spot") or "")},
                "taken": isinstance(interruption.get("thread"), dict)}
               if isinstance(thread, dict) else {}),
            **({"person": str(person.get("name") or "")}
               if isinstance(person, dict) and person.get("name") else {})}


def failure_frame(message, code):
    """The pipeline's error frame with the contract's code: "refused" when the engine refused the
    verb, "engine_failed" when the engine or the store failed (no model is in a verb's turn)."""
    return "data: " + json.dumps({"error": {"message": message, "code": code}},
                                  ensure_ascii=False) + "\n\n"


def life_stream(runtime, records, running, request_id, reservation, archive_before, verb,
                settled=None, story=None):
    """A verb's turn: the engine settles it, the whole-turn settlement makes the new state,
    and the result is recorded on the request row (status "ready"), as pilot_stream records an
    engine-settled turn's. Returns the turn (receipts and chronicle filled as they settle) and
    the frames. No model is called and no usage recorded. `settled`: the verb's receipts and
    annals lines when the engine has settled it already (TurnPlay.prepare_life); `story` the
    reply's words when they are not the annals lines (a move: its rounds' summaries)."""
    context = reservation.get("context") or {}
    seed = reservation["seed"]
    turn = LifeTurn()

    async def output():
        status = "failed"
        runtime.active[running] = asyncio.current_task()
        try:
            yield "data: " + json.dumps({"frx": {"seed": seed}}) + "\n\n"
            turn.receipts, turn.chronicle = settled or await run_verb(
                archive_before, seed, verb, context.get("knowledge"))
            yield event({"chronicle": turn.chronicle})
            yield event({"cards": []})
            told = story if story is not None else "\n".join(
                line["line"] for line in turn.chronicle)
            turn.final = synthesize(told, turn.receipts, "", "")
            plot = active_plot(archive_before.get("data") or {})
            settlement = await settle_card(
                archive_before, "", seed, context.get("knowledge"), reply=turn.final,
                pilot={"receipts": turn.receipts, "story": told},
                after_progress={"plot": plot_payload(plot)} if plot else {},
            )
            if settlement.get("errors"):
                logger.warning("life_settlement_failed errors=%s",
                               json.dumps(settlement["errors"], ensure_ascii=False)[:300])
                raise ModelFailure("引擎结算没有通过，存档没有改动，请稍后重试")
            after = settlement.pop("afterProgress", None)
            turn.after_progress = after if isinstance(after, dict) and not after.get(
                "errors") else None
            settlement.setdefault("beforeStateHash", state_digest(archive_before["data"]["state"]))
            settlement["receipts"] = turn.receipts
            mark_play(settlement, archive_before, turn.receipts,
                      verb=bool(verb) and "command" not in verb)
            turn.settlement = settlement
            yield event({"final": turn.final})
            status = "ready"
            if not records.finish_request(request_id, turn.final, status, settlement):
                raise ModelFailure("本回合已停止或回溯，结果未应用")
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            status = "cancelled"
            raise
        except LifeRefusal as refusal:
            yield failure_frame(str(refusal), "refused")
        except Exception as exc:
            busy = store_failure(exc)
            if isinstance(exc, ModelFailure) or busy:
                message = str(busy or exc)
            else:
                logger.warning("life_turn_failed error=%s", type(exc).__name__)
                message = "引擎结算没有完成，请稍后重试"
            yield failure_frame(message, "engine_failed")
        finally:
            runtime.active.pop(running, None)
            if status != "ready":
                records.finish_request(request_id, turn.final, status)

    return turn, output()


# ---------------------------------------------------------------- 写一段 (item 13)


# The model logs that keep a turn's annals lines (frxChronicle): a verb's, an interrupted verb's
# and an attempt at a gate's.
ANNALS_KINDS = {"chronicle", "interrupted", "breakthrough"}


def annals_of(archive, turn_id):
    """The annals lines of the verb turn `turn_id` ({ date, text }), or None when the save has no
    such turn (写一段 writes out one turn's lines)."""
    for log in (archive["data"].get("logs") or []):
        if log.get("frxRequestId") == turn_id and log.get("frxKind") in ANNALS_KINDS:
            lines = [entry for entry in log.get("frxChronicle") or [] if isinstance(entry, dict)]
            return lines or None
    return None


def elaborate_stream(runtime, records, running, request_id, reservation, archive_before, verb,
                     config):
    """写一段: the model writes the days of one turn's annals lines out as a passage. Nothing in
    the state changes and no time passes (the whole-turn settlement has no receipts and no
    commands); it is no beat of a scene. Returns the turn (no receipts) and the frames, which
    record the request as any turn's."""
    context = reservation.get("context") or {}
    seed = reservation["seed"]
    turn = LifeTurn()
    metrics = TurnMetrics("elaborate")
    player = ((archive_before["data"]["state"].get("currentState") or {}).get("0") or {}).get("B1")
    name = str((player or {}).get("1") or "").split("|")[0] or "你"
    messages = elaborate_messages(name, annals_of(archive_before, verb.get("turnId")) or [],
                                  length_of(life_of(archive_before)))

    async def output():
        status, text, upstream = "failed", "", None
        runtime.active[running] = asyncio.current_task()
        started = time.monotonic()
        try:
            async with asyncio.timeout(210):
                yield "data: " + json.dumps({"frx": {"seed": seed}}) + "\n\n"
                metrics.calls += 1
                usage = None
                upstream = await Gateway.complete(
                    config, messages, stream=True, stream_options={"include_usage": True},
                    max_tokens=4000, temperature=0.8, timeout=180,
                )
                async for chunk in upstream:
                    usage = getattr(chunk, "usage", None) or usage
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        metrics.first_token()
                        text += delta
                        if len(text) > 20000:
                            raise ModelFailure("回复超过长度上限")
                        yield sse(delta)
                metrics.add_usage(usage)
                story = story_of(text).strip()
                if not has_words(story):
                    raise ModelFailure("模型的回复里没有正文")
                turn.final = f"<content>{story}</content>"
                settlement = await settle_card(
                    archive_before, "", seed, context.get("knowledge"), reply=turn.final,
                    pilot={"receipts": [], "story": story},
                )
                if settlement.get("errors"):
                    raise ModelFailure("结算没有通过，存档没有改动，请稍后重试")
                settlement.setdefault(
                    "beforeStateHash", state_digest(archive_before["data"]["state"]))
                settlement["receipts"] = []
                settlement["metrics"] = metrics.snapshot()
                turn.settlement = settlement
                yield event({"final": turn.final})
                status = "ready"
                if not records.finish_request(request_id, turn.final, status, settlement):
                    raise ModelFailure("本回合已停止或回溯，回复未应用")
                yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            status = "cancelled"
            raise
        except Exception as exc:
            error = (exc if isinstance(exc, ModelFailure) else store_failure(exc)
                     or model_failure(exc, stage="elaborate", started=started, timeout=180))
            yield error_frame(error)
        finally:
            runtime.active.pop(running, None)
            if status != "ready":
                records.finish_request(request_id, turn.final or text, status)
            record_turn(runtime, records, request_id, metrics)
            if upstream:
                await close_stream(upstream)

    return turn, output()


# ---------------------------------------------------------------- a scene's beat, by the model

# The tools a model's beat of the cultivation life is offered (when its model passed tool
# admission): the ones that register things, move_place, the journey to another map place (plan
# item 28), prove_lead, a lead proven (item 26), note_karma and note_knot, the ledger and the
# heart knots (item 40), and grant_chance, the next gate's 机缘 a scene plainly gives (the engine's
# chance op, item 50's fixes). Checks, attacks, skills, items, rest, cultivation and breakthroughs
# are the player's cards and verbs.
LIFE_TOOLS = ("lookup_inventory", "claim_item", "recall_memory", "update_quest", "move_place",
              "prove_lead", "note_karma", "note_knot", "grant_chance")
SCENE_RULES = json.loads((ROOT / "content/life/scene.json").read_text(encoding="utf-8"))


async def life_op(archive, seed, knowledge, receipts, op, args):
    """One op of the engine's life mode on the reserved save, after this turn's receipts so far.
    Raises LifeRefusal with the engine's words when it refuses, ModelFailure when it fails."""
    result = await run_engine({
        "mode": "life", "op": op, "archive": archive, "seed": seed, "args": args,
        "receipts": receipts, "knowledge": knowledge or {},
    })
    if result.get("error") == "not_life":
        raise LifeRefusal(NOT_LIFE)
    if result.get("error"):
        raise LifeRefusal(str(result.get("reason") or "这件事现在做不了"))
    if result.get("errors"):
        logger.warning("life_engine_failed op=%s errors=%s", op, "；".join(result["errors"])[:300])
        raise ModelFailure("引擎结算没有完成，请稍后重试")
    return result


def opening_beat(beat):
    """Which beat of the opening scene the model is writing (0 when it is not the opening's)."""
    try:
        return int(((beat or {}).get("opening") or {}).get("beat") or 0)
    except (TypeError, ValueError):
        return 0


def next_beat(scene):
    """Ordinary scenes can resolve on any beat. Each request still writes one beat."""
    return {"beat": int(scene.get("beats") or 0) + 1, "mayClose": True, "mustClose": False}


def brief(scene):
    return {key: scene.get(key) for key in ("id", "title", "origin", "beats")}


# A row's status that says the person is dead, as the engine reads it (karma.cjs DEAD).
DEAD = re.compile(r"身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落")


def ledger_of(play, archive):
    """The ledger's open entries and the open heart knots whose person is on the scene (a row of
    the character table, alive), as the beat lists them by id (item 40): { karma, knots } of lines,
    or None. note_karma's done and note_knot's resolve name an entry by its id, and settle only with
    its person present, so these are the ones the beat can settle."""
    rows = (archive["data"]["state"].get("currentState") or {}).get("0") or {}
    present = {key for key, row in rows.items()
               if re.match(r"^[CG]", key) and isinstance(row, dict)
               and not DEAD.search(plain(row.get("4")))}

    def line(entry):
        who = entry.get("who") if isinstance(entry.get("who"), dict) else {}
        return (f"{entry.get('id')} {entry.get('kind')}：{who.get('name') or who.get('id')}"
                f"（{who.get('id')}），{entry.get('what')}（第{entry.get('year')}年）")

    def here(entry):
        return (isinstance(entry, dict) and isinstance(entry.get("who"), dict)
                and entry["who"].get("id") in present)

    karma = [line(entry) for entry in play.get("karma") or []
             if here(entry) and not entry.get("done") and not entry.get("broken")]
    knots = [line(entry) for entry in play.get("knots") or [] if here(entry)]
    return {"karma": karma, "knots": knots} if karma or knots else None


async def before_story(plan, archive, seed, knowledge, admitted, life):
    """A model's beat of the cultivation life, before the story: the engine-settled route with
    only LIFE_TOOLS (none when the model has not passed tool admission) and nothing forced; a
    scene opened when none is on (origin free); then the card the player took (`life["act"]`,
    from frxPlay.cards) or the free text (`life["text"]`, an ad hoc card the engine sorts): its
    roll, costs and outcome settle now, before the story. Free text that comes out without a
    roll settles nothing (静观: no roll, no cost); a card or free text that comes to blows
    reaches the model only as a note (the fight waits for item 20). A stretch of days the
    engine broke off (`life["interrupted"]`, with the verb's receipts in the plan already) opens
    its scene from the interruption's origin, and no card is taken: the model writes the scene
    from its cause. Returns the plan with these receipts and the beat (plan["life"]: scene,
    next, opened, act, length, and interrupted: its words for the prompt)."""
    plan = {**plan, "route": "pilot", "mustTool": False,
            "tools": [name for name in plan.get("tools") or [] if name in LIFE_TOOLS]
            if admitted else []}
    receipts = list(plan.get("receipts") or [])
    play = life_of(archive) or {}
    scene, opened, act, event = play.get("scene"), False, None, None
    if life.get("entered"):
        # a realm step's 秘 opened the scene in this turn (the engine's realm op): its first beat
        scene, opened = (play_after(receipts, archive) or {}).get("scene"), True
    if life.get("gated"):
        # A gate's big scene (item 22) is a passage of its own: no scene opens, no card is taken.
        scene, upcoming = None, None
    elif scene:
        upcoming = next_beat(scene)
        scene = brief(scene)
    else:
        # a scene of the player's own doing, or the one an interruption of the days opens; a
        # pending event that goes off now opens the player's own instead (its cause, its line)
        origin = (life.get("interrupted") or {}).get("origin") or "free"
        present = present_of(life.get("interrupted") or {})
        if not life.get("interrupted") and not play.get("opening"):
            # words that carry on a story thread hold a `now` event back for this scene (batch 9:
            # the owner typed 「送孙老道到落雁坡」 and got the chapter's reveal instead)
            result = await life_op(archive, seed, knowledge, receipts, "pending",
                                   {"action": "fire", "words": str(life.get("text") or "")})
            receipts += result.get("receipts") or []
            plan["annals"] = result.get("chronicle") or []
            fired = result.get("fired")
            if isinstance(fired, dict):
                origin = fired.get("origin") or origin
                person = (fired.get("event") or {}).get("person")
                present = present_of(fired)
                event = {"cause": str(fired.get("cause") or ""),
                         **({"person": str(person.get("name") or "")}
                            if isinstance(person, dict) and person.get("name") else {})}
        # the interruption's cause: a small matter's opens a light scene (scene.json light)
        cause = str((life.get("interrupted") or {}).get("cause") or "")
        result = await life_op(archive, seed, knowledge, receipts, "scene",
                               {"action": "open", "origin": origin,
                                **({"present": present} if present else {}),
                                **({"cause": cause} if cause else {})})
        receipts += result.get("receipts") or []
        scene, upcoming, opened = result["scene"], result["next"], True
    # a light scene the model wrote the lines of when it opened (batch 8)
    light = (play.get("scene") or {}).get("light") if not opened else None
    # a fight came of it (a card or words came to blows: the beat that opened the fight wrote no
    # scene beat, after_story): from its battle report it goes on as any scene (batch 8's
    # real-model run: eleven fights left their scenes light to the end)
    unlight = bool(light) and bool(life.get("fought"))
    if life.get("act"):
        result = await life_op(archive, seed, knowledge, receipts, "act", {"index": life["act"]})
        made = result.get("receipts") or []
        receipts += made
        act = next((receipt for receipt in made if receipt.get("kind") == "act"), None)
        if isinstance(light, dict) and light.get("ready"):
            # the card taken closes it with the model's line: no model call (light_reply)
            canned, why = await light_reply(archive, seed, knowledge, play, life["act"],
                                            receipts, act)
            if canned:
                plan["light"], plan["tools"] = canned, []
            else:
                # the model writes the beat, and the request says why (its plan's reasons)
                unlight = True
                plan["reasons"] = [*(plan.get("reasons") or []), f"小事没有一拍了结：{why}"]
    elif str(life.get("text") or "").strip():
        unlight = bool(light)
        if unlight:
            plan["reasons"] = [*(plan.get("reasons") or []), "小事没有一拍了结：玩家写了话"]
        text = str(life["text"]).strip()
        fee = stated_fee(text)
        card = {"kind": "买卖" if fee else "", "title": text[:200], "target": "", "tier": "",
                "gate": "", **({"fee": fee} if fee else {})}
        try:
            result = await life_op(archive, seed, knowledge, receipts, "act", {"card": card})
        except LifeRefusal:
            if fee:
                raise
            result = None
        made = (result or {}).get("receipts") or []
        found = next((receipt for receipt in made if receipt.get("kind") == "act"), None)
        if found and (found.get("check") or opens_fight(made)
                      or (found.get("owns") or {}).get("currency")):
            receipts += made
            act = found
        elif found and found.get("fight"):
            act = {key: found[key] for key in ("card", "fight") if key in found}
    plan["receipts"] = receipts
    plan["life"] = {"scene": scene, "next": upcoming, "opened": opened, "act": act,
                    "length": length_of(play), "routeChoices": True}
    plan["life"]["threadFacts"] = True
    tasks = clock_tasks(play_after(receipts, archive) or {})
    if tasks:
        plan["life"]["clockTasks"] = tasks
    if unlight:
        plan["life"]["unlight"] = True
    # the day in the calendar's words, for the story to write it so (not 「二月初十一」)
    today = today_words(archive, receipts)
    if today:
        plan["life"]["today"] = today
    if life.get("interrupted"):
        plan["life"]["interrupted"] = interrupted_words(life["verb"], life["interrupted"])
        road = road_of(receipts)
        if road:
            # broken off on the road: the beat's time row keeps the road (held_to_road)
            plan["life"]["interrupted"]["road"] = road
    elif life.get("entered"):
        plan["life"]["entered"] = {"title": str(life["entered"].get("title") or "")}
    elif event:
        plan["life"]["event"] = event
    if life.get("fought"):
        plan["life"]["fought"] = {key: life["fought"].get(key) for key in ("end", "loss")}
    if life.get("gated"):
        plan["life"]["gated"] = gate_words(life["gated"])
    else:
        # the ledger's open entries and knots of the people on the scene, by id (item 40)
        ledger = ledger_of(play_after(receipts, archive) or {}, archive)
        if ledger:
            plan["life"]["ledger"] = ledger
        # the story threads still open, so the beat leaves none twice and settles the one it
        # sees to; the one this scene took up (batch 9)
        open_threads = threads_open(play_after(receipts, archive) or {})
        if open_threads:
            plan["life"]["threads"] = open_threads
        taking = thread_taken(play_after(receipts, archive) or {})
        if taking:
            plan["life"]["taking"] = taking
    fortune = fortune_of(scene, receipts, archive)
    if fortune is not None:
        # what a 奇遇's scene gives at its close, known before the beat that may close it
        plan["life"]["fortune"] = fortune
    opened_fight = fight_opened(receipts)
    if opened_fight and opened_fight.get("end"):
        # its first strikes ended it (an ambush that felled the player): no fight goes on, so the
        # beat is its battle report and hands back cards (or closes), as a fight's last move does
        plan["life"]["fought"] = {**{key: opened_fight.get(key) for key in ("end", "loss")},
                                  "atOnce": True}
    elif opened_fight:
        plan["life"]["fighting"] = True
    # a new save's opening scene (item 25), while it is to be played and no other scene is on
    opening = play.get("opening")
    if isinstance(opening, dict) and scene and (opened or play.get("scene")) and upcoming:
        plan["life"]["opening"] = {"birth": opening.get("birth"), "beat": upcoming.get("beat")}
    # someone met in the wild who still waits after what was settled (item 31): the beat's cards
    # are the engine's; `first` when the interruption met them this turn
    met = (play_after(receipts, archive) or {}).get("encounter")
    if isinstance(met, dict):
        first = bool((life.get("interrupted") or {}).get("encounter"))
        plan["life"]["met"] = {**{key: str(met.get(key) or "") for key in (
            "name", "who", "realm", "spotted")}, "first": first}
    elif opened and ((play_after(receipts, archive) or {}).get("scene") or {}).get("light"):
        # a small matter's scene opens: the model writes its cards' lines and 回目 now
        plan["life"]["light"] = True
    # Keep the exact evidence alongside this request's fixed receipts. A reconnect or repair
    # must continue this action, not rebuild its premise from a later version of the save.
    situation = plan["life"]
    focus = " ".join(str(value or "") for value in (
        life.get("text"), (act or {}).get("card", {}).get("title"),
        (situation.get("interrupted") or situation.get("event") or {}).get("cause"),
        (situation.get("taking") or {}).get("text"), (scene or {}).get("title"),
    ))
    situation["continuity"] = story_continuity(archive, receipts, act, focus=focus)
    return plan


# The outcomes of a roll whose line is the card's 败 (a light scene's, batch 8).
FAILED = {"失败", "大失败"}


def thread_line(thread):
    """A story thread as the beat's prompt names it: its id, its words, whom and where."""
    who = (thread.get("who") or {}).get("name") if isinstance(thread.get("who"), dict) else ""
    where = "".join(str(part) for part in (thread.get("place"), thread.get("spot")) if part)
    extra = "，".join(part for part in (who, where) if part)
    told = f"{thread.get('id')} {thread['text']}"
    return f"{told}（{extra}）" if extra else told


def threads_open(play):
    """The open story threads of frxPlay (threads.cjs), one line each for the beat's prompt, by
    id: a 了结 line names one the beat saw to. The one this scene took up is threads_taken's."""
    return [thread_line(thread) for thread in play.get("threads") or []
            if isinstance(thread, dict) and thread.get("text") and not thread.get("taken")
            and not thread.get("completed")]


def thread_taken(play):
    """The story thread the scene on took up (threads.cjs take: under way in the scene of its
    number), as { id, text }, or None."""
    scene = (play.get("scene") or {}).get("id")
    for thread in play.get("threads") or []:
        taken = thread.get("taken") if isinstance(thread, dict) else None
        if (isinstance(taken, dict) and not thread.get("completed") and scene
                and f"S{taken.get('scene')}" == scene):
            return {"id": str(thread.get("id") or ""), "text": str(thread.get("text") or "")}
    return None


def story_continuity(archive, receipts=(), act=None, *, focus=""):
    """A small evidence window, never a second model's retelling or a new source of truth.

    Only committed turn text/summaries and the choices actually taken belong here. Unchosen
    branches, failed/pending replies and hidden commands are not events that happened. The
    current state and fixed engine receipts always outrank these historical summaries.
    """
    def short(value, limit):
        text = plain(value).strip() if isinstance(value, str) else ""
        return text if len(text) <= limit else text[:limit] + "…"

    data = archive.get("data") or {}
    recent, choice = [], ""
    # Older turns in the assembled prompt can be compressed to summaries.
    for log in (data.get("logs") or [])[-48:]:
        if not isinstance(log, dict):
            continue
        if log.get("type") == "user":
            choice = short(log.get("content"), 140).lstrip("> ")
        elif is_turn(log):
            if not log.get("frxPending"):
                summary = short(log.get("smallSummary"), 360)
                if not summary:
                    summary = short(log.get("largeSummary"), 360)
                if not summary:
                    body = plain(story_of(log.get("content"))).strip()
                    summary = body if len(body) <= 360 else "…" + body[-360:]
                if summary:
                    recent.append({"choice": choice, "result": summary})
                    recent = recent[-3:]
            choice = ""
    current = (data.get("state") or {}).get("currentState") or {}
    now = (time_row(current) or {}).get("0")
    for receipt in receipts or []:
        if isinstance(receipt, dict):
            now = (receipt.get("time") or {}).get("after") or now
    result = {"now": short(now, 240), "recent": recent}
    if isinstance(act, dict):
        card, check = act.get("card") or {}, act.get("check") or {}
        result["selected"] = {
            "title": short(card.get("title"), 160), "kind": short(card.get("kind"), 20),
            "outcome": short(check.get("outcome"), 20),
            "consequence": short(check.get("consequence"), 180),
            **({"route": short(card.get("route"), 8), "intent": short(card["intent"], 64)}
               if card.get("intent") else {}),
        }
    play = play_after(receipts, archive) or {}
    result["goals"] = active_matters(play)
    result.update(life_evidence(play, focus))
    accounts = past_accounts((log for log in data.get("logs") or []
                              if is_turn(log) and not log.get("frxPending")), focus,
                             lambda body: plain(story_of(body)))
    if accounts:
        result["relatedAccounts"] = accounts
    return result


def open_karma(play, person):
    """Whether the ledger has an entry with `person` not yet settled (karma.cjs)."""
    return any(isinstance(entry, dict) and not entry.get("done")
               and (entry.get("who") or {}).get("id") == person
               for entry in play.get("karma") or [])


async def light_reply(archive, seed, knowledge, play, index, receipts, act):
    """The reply the server writes for a card taken in a light scene (batch 8, scene.json light),
    in place of the model's beat, and why not: (reply, '') or (None, why). The reply is the card's
    line for its outcome (成 for a success or a card without a roll, 败 for a failure, 离 for the
    离开 card) and the close at the light weight with the 回目 the model wrote when the scene
    opened. None, and the model writes the beat as ever, when the card has no line for it, it came
    to blows or met someone, the ledger moved or the card is aimed at someone with something open
    on it, someone was registered since the scene opened, or the engine's check of the story finds
    the line telling what did not happen."""
    scene = play.get("scene") or {}
    light = scene.get("light") or {}
    cards = play.get("cards") or []
    try:
        card = cards[int(index) - 1]
    except (TypeError, ValueError, IndexError):
        return None, "没有这张卡"
    if not isinstance(card, dict) or not isinstance(act, dict):
        return None, "这张卡没有结算"
    after = play_after(receipts, archive) or {}
    if act.get("fight") or fight_opened(receipts) or after.get("fight"):
        return None, "动起手来"
    if after.get("encounter"):
        return None, "撞上了谁"
    if any(receipt.get("kind") in {"karma", "knot"} for receipt in receipts):
        return None, "记下了因果"
    tables = archive["data"]["state"].get("currentState") or {}
    people = {key for key in (tables.get("0") or {}) if key[:1] in {"C", "G"}}
    if people - set((scene.get("start") or {}).get("favour") or {}):
        return None, "戏里登记了新人物"
    aimed = card.get("object") or {}
    if aimed.get("type") == "person" and open_karma(play, aimed.get("id")):
        return None, "对着的人因果未了"
    if card.get("leave"):
        line = light.get("leave")
    else:
        said = card.get("said") or {}
        line = said.get("failure") if act.get("outcome") in FAILED else said.get("success")
    if not line:
        return None, "这张卡没有写好的那一句"
    checked = await run_engine({"mode": "story", "archive": archive, "seed": seed,
                                "knowledge": knowledge or {}, "story": line,
                                "receipts": receipts})
    if checked.get("mismatches") or checked.get("error"):
        return None, "那一句和结算对不上"
    weight = SCENE_RULES["light"]["weight"]
    couplet = light.get("couplet") or ""
    close = "" if card.get("leave") else f"\n<title>{couplet}</title><close>{weight}</close>"
    return f"<content>{line}</content><upstore></upstore>{close}", ""


def fortune_of(scene, receipts, archive):
    """What a 奇遇's scene gives at its close (item 50's fixes), for the beat that may close it
    (LifeBeat.fortune): the fortune receipt when this turn's card closed it (离开), else the
    engine's offer on frxPlay (rewards.cjs: what closing now gives, which the close then gives).
    None for a scene of another origin, or with no word from the engine."""
    if (scene or {}).get("origin") != "fortune":
        return None

    def worded(items):
        return [{"name": str(item.get("name") or ""), "count": int(item.get("count") or 1),
                 "unit": str(item.get("unit") or "")} for item in items or []
                if isinstance(item, dict)]

    given = next((receipt.get("fortune") for receipt in receipts or []
                  if receipt.get("kind") == "fortune" and isinstance(receipt.get("fortune"), dict)),
                 None)
    if given is not None:
        won = given.get("chance") if isinstance(given.get("chance"), dict) else {}
        chance = str(won.get("name") or won.get("gate") or "")
        return {"items": worded(given.get("items")), "closed": True,
                **({"chance": chance} if chance else {})}
    kept = (play_after(receipts, archive) or {}).get("fortune")
    offer = kept.get("offer") if isinstance(kept, dict) else None
    if not isinstance(offer, dict) or kept.get("scene") != (scene or {}).get("id"):
        return None
    # a gate's 机缘 the close would bring as well (an 元婴's 化神, rewards.cjs)
    chance = str(offer.get("chance") or "")
    return {"items": worded(offer.get("items")), "closed": False,
            **({"chance": chance} if chance else {})}


def play_after(receipts, archive):
    """frxPlay as the receipts leave it: the last one's that carries it, else the save's."""
    for receipt in reversed(receipts or []):
        if isinstance(receipt.get("frxPlay"), dict):
            return receipt["frxPlay"]
    return life_of(archive)


def fight_opened(receipts):
    """The fight the receipts open (the act op's fight.open: a fight receipt `opened`), as its
    receipt says it ({ end, loss } when its first strikes ended it), or None."""
    return next((receipt["fight"] for receipt in receipts or []
                 if receipt.get("kind") == "fight" and (receipt.get("fight") or {}).get("opened")),
                None)


def opens_fight(receipts):
    """Whether the receipts open a fight (the act op's fight.open: a fight receipt `opened`)."""
    return fight_opened(receipts) is not None


# A row the story's commands set (set({…})), as the card's command language writes it.
STORY_SET = re.compile(r"\bset\(\s*(?=\{)")


def story_rows(commands):
    """The rows the story's commands set (set({…})), as written, in order."""
    text = str(commands or "")
    decoder = json.JSONDecoder()
    rows = []
    for found in STORY_SET.finditer(text):
        try:
            row, _ = decoder.raw_decode(text, found.end())
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def place_part(text):
    """Where a time row's text puts the player, for the close rule: what follows its first
    slash, without coordinates, brackets or spaces ('' when it names none)."""
    text = str(text or "")
    if "/" not in text:
        return ""
    return re.sub(r"-?\d+\s*,\s*-?\d+|[\s（）()]", "", text.split("/", 1)[1])


def written_place(commands):
    """The place the last time row of some commands writes, as place_part reads it, or ''."""
    for found in reversed(TIME_ROW.findall(str(commands or ""))):
        try:
            return place_part(json.loads(found).get("0"))
        except (ValueError, AttributeError):
            continue
    return ""


def matter_opened(archive, receipts, commands):
    """What a beat's story opened that a close on it would lose (batch 9): { entered, moved }, the
    names of the people its commands set who were not on the scene (by id or by name), and
    whether its time row puts the player somewhere else (neither place inside the other's name:
    茶铺 and 茶铺二楼 are one place, 泊灯城西市 and 潮契楼二层 two); None for neither."""
    state = archive["data"]["state"].get("currentState") or {}
    rows = state.get("0") or {}
    names = {row_name(row) for row in rows.values() if isinstance(row, dict)}
    entered = []
    for row in story_rows(commands):
        key, name = str(row.get("0") or ""), row_name(row)
        if (re.match(r"^[CG]", key) and key not in rows and name and name not in names
                and name not in entered):
            entered.append(name)
    before = ""
    for receipt in receipts or []:
        before = written_place(receipt.get("commands")) or before
    before = before or place_part((time_row(state) or {}).get("0"))
    after = written_place(commands)
    moved = bool(before and after and before not in after and after not in before)
    return {"entered": entered, "moved": moved} if entered or moved else None


async def after_story(archive, seed, knowledge, receipts, raw, beat, commands="", seen=None):
    """A model's beat, after its story: the scene's beat (its <scene> name; its <close> weight,
    or the opening's instructional close on its third beat), then, unless the scene
    closed, the cards for the next beat (its <actions>, else its <branches> sorted by the
    engine). Returns (receipts, priced cards). Nothing when no scene is on (the 离开 card closed
    it before the story). A <close> on the beat the story's `commands` bring someone on or move
    the player elsewhere (matter_opened) is not taken when the beat gave cards: the scene goes on
    with them (batch 9: three of three conversation scenes closed on the beat their matter
    opened); not on the opening's last beat or one that must close. Without cards the close
    stands. Only concrete business recorded by the story is carried to a new scene.
    `seen` (a dict) is told what the close found: seen["matter"] = { entered, moved, kept }."""
    volume = (beat.get("gated") or {}).get("volume")
    if volume:
        # a gate passed closed the book's volume: its page with the model's words (item 38)
        result = await life_op(archive, seed, knowledge, receipts, "book",
                               {"no": volume.get("no"), "text": volume_of(raw)})
        return result.get("receipts") or [], []
    if not beat.get("scene") or any(receipt.get("kind") == "close" for receipt in receipts):
        return [], []
    if beat.get("fighting"):
        # a fight opened: its moves come next, and the cards wait for its battle report
        return [], []
    made = []
    # while someone met waits, the scene stays open: its beats are the engine's cards (item 31)
    opening = opening_beat(beat)
    close = "" if beat.get("met") or 0 < opening < OPENING_BEATS else close_weight(raw)
    opened = matter_opened(archive, receipts, commands) if close else None
    if opened:
        opened["kept"] = bool(not beat.get("opening") and not (beat.get("next") or {}).get(
            "mustClose") and parse_actions(raw)[0])
        if opened["kept"]:
            close = ""
        if seen is not None:
            seen["matter"] = opened
    # a light scene's opening keeps the model's lines for the close (batch 8): its 回目 and the
    # line for leaving (each card's go with the cards); without one card's lines it goes on as
    # any scene, and so it does after a beat the model wrote again
    light = None
    if beat.get("light"):
        written = any(card.get("said") for card in parse_actions(raw)[0])
        light = {"couplet": couplet_of(raw), "leave": leave_line(raw)} if written else False
    elif beat.get("unlight"):
        light = False
    result = await life_op(archive, seed, knowledge, receipts, "scene", {
        "action": "beat", "title": scene_title(raw), "close": close, "couplet": couplet_of(raw),
        **({"light": light} if light is not None else {})})
    made += result.get("receipts") or []
    if "closed" in result:
        return made, []
    if not beat.get("met") and opening_beat(beat) >= OPENING_BEATS:
        # the opening is three beats (item 25): its last was asked to close it, and when the model
        # left it open the engine closes it now, at the plain weight, as the 离开 card would
        result = await life_op(archive, seed, knowledge, receipts + made, "scene",
                               {"action": "close"})
        return made + (result.get("receipts") or []), []
    cards, fallback = parse_actions(raw)
    result = await life_op(archive, seed, knowledge, receipts + made, "cards",
                           {"cards": cards, "fallback": fallback})
    made += result.get("receipts") or []
    return made, result.get("cards") or []


def settled_archive(archive, settlement):
    """The save as a settlement leaves it, for an engine op on what the story's own commands
    brought (the state tables, frxPlay, the ledger, the map), as card_store.apply_settlement
    would write them; nothing is stored."""
    value = copy.deepcopy(archive)
    state = value["data"]["state"]
    state["currentState"] = copy.deepcopy(settlement["state"])
    for key in ("frxPlay", "frxProgress", "dailyItemUses", "worldMap"):
        if key in settlement:
            state[key] = copy.deepcopy(settlement[key])
    return value


async def repriced(archive, settlement, seed, knowledge, receipts, late, raw, cards):
    """The beat's next cards priced again on the save as the story left it (item 8's prices):
    after_story priced them before the story's own commands, so a card aimed at someone the
    story brought on (or whose favour it moved) showed odds it would not roll with. Returns the
    cards op's receipt, settled after the story (afterStory), and the cards; None when there are
    no cards, an encounter's own cards stand, the story's commands did not settle, or the prices
    come out the same."""
    if not cards or settlement.get("errors"):
        return None
    after = settled_archive(archive, settlement)
    play = play_after(late, after) or {}
    if play.get("encounter") or not play.get("scene"):
        return None
    shown, fallback = parse_actions(raw)
    try:
        result = await life_op(after, seed, knowledge, list(late), "cards",
                               {"cards": shown, "fallback": fallback})
    except (LifeRefusal, ModelFailure):
        return None
    again = result.get("cards") or []
    receipt = next((made for made in result.get("receipts") or []
                    if made.get("kind") == "cards"), None)
    if receipt is None or again == cards:
        return None
    return {**receipt, "id": f"R{len(receipts) + 1}", "afterStory": True}, again


def meets_thread(settlement):
    """Whether the save as the story left it has an open thread not yet seen to whose person is on
    the scene (the thread op then marks it seen to: its lapse is no miss, threads.attend)."""
    play = settlement.get("frxPlay") or {}
    names = {row_name(row) for row in ((settlement.get("state") or {}).get("0") or {}).values()
             if isinstance(row, dict)}
    return any(isinstance(thread, dict) and not thread.get("taken") and not thread.get("attended")
               and not thread.get("completed")
               and ((thread.get("who") or {}).get("name") in names)
               for thread in play.get("threads") or [])


def beat_thread_changes(raw, beat):
    if not beat.get("threadFacts"):
        return [], [], []
    known = known_thread_ids(beat.get("threads"), beat.get("taking"), beat.get("continuity"))
    return thread_changes(raw, known)


def clock_tasks(play):
    return [{"id": clock["id"], "name": clock.get("name", ""), "scope": clock.get("scope"),
             "task": rule["task"]}
            for clock in play.get("clocks") or [] if isinstance(clock, dict) and clock.get("id")
            for rule in clock.get("falls") or [] if isinstance(rule, dict)
            and rule.get("kind") == "task" and rule.get("task")]


BOUNTY_CLAIM = re.compile(
    r"交差|讨赏|领赏|收赏|(?:索要|索取|讨|领|收|兑现|结清).{0,20}(?:悬赏|赏金|赏格|酬劳|报酬)"
)
BOUNTY_PAID = re.compile(
    r"(?:结清|付清|交付|兑现).{0,12}(?:悬赏|赏金|赏格|酬劳|报酬)"
    r"|(?:^\s*(?:你|主角).{0,12}(?:收下|领到|收到了|接过)|(?:交|递|付)给你)"
    r".{0,16}(?:灵石|赏金|酬劳)"
)
BOUNTY_UNPAID = re.compile(
    r"[？?]|未|没|不曾|不肯|不愿|拒绝|尚欠|分期|日后|改日|另日|将来|许诺|答应|打算|待到|只要|若|倘"
)


def bounty_claim(raw, beat, receipts):
    """Recognize a paid story bounty; its amount never comes from the model's state block."""
    act = beat.get("act") or {}
    check = act.get("check") or {}
    card = act.get("card") or {}
    if (check.get("outcome") not in {"成功", "大成功"}
            or not BOUNTY_CLAIM.search(" ".join(card.get(key) or "" for key in ("title", "intent")))
            or any(r.get("ok") and (r.get("owns") or {}).get("currency") for r in receipts)):
        return None
    # A quoted offer or a promise to pay on another day is not a delivery.
    story = re.sub(r'“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"', "", plain(story_of(raw)))
    if "灵石" not in story or not any(
            BOUNTY_PAID.search(clause) and not BOUNTY_UNPAID.search(clause)
            for clause in re.split(r"(?<=[。！？?；\n，,])", story)):
        return None
    return {"outcome": check["outcome"], "target": (check.get("target") or {}).get("id")}


def show_bounty(close, bounty):
    """Include the engine's late payout in this turn's close card."""
    before, after, amount = bounty["before"], bounty["after"], bounty["amount"]
    label = "灵石赏金" if any(line.get("kind") == "stones" for line in close["lines"]) else "灵石"
    text = f"赏金入账：灵石 {before}→{after}（+{amount}）"
    close["lines"].append({"kind": "stones", "label": label, "before": before, "after": after,
                           "change": amount, "to": "当前灵石", "text": text})
    close["summary"] += "；" + text


async def threads_noted(archive, settlement, seed, knowledge, receipts, late, raw, beat, tasks):
    """The story threads the beat left (<threads>, threads_of), those it says it saw to (了结,
    settled_of), and the open ones it sees to with their person there (threads.attend). The thread
    op on the save as the story's commands left it, after the turn's other late receipts (`late`:
    the cards priced again), which checks them against it (threads.cjs). Its receipt settles
    after the story (afterStory). None when there is nothing to note, the story's commands did not
    settle, or the engine refused or noted nothing."""
    if settlement.get("errors"):
        return None
    candidates, settled = threads_of(raw), settled_of(raw)
    updates, _, _ = beat_thread_changes(raw, beat)
    settled = ([] if beat.get("threadFacts") else
               [found for found in settled if found.startswith("T")])
    closes = [receipt for receipt in receipts or [] if receipt.get("kind") == "close"]
    if not (candidates or settled or updates or tasks or meets_thread(settlement)):
        return None
    scene = ((settlement.get("frxPlay") or {}).get("scene")
             or (closes[-1].get("scene") if closes else None) or beat.get("scene") or {})
    claim = (bounty_claim(raw, beat, receipts)
             if any(update["status"] == "completed" for update in updates) else None)
    try:
        result = await life_op(settled_archive(archive, settlement), seed, knowledge, list(late),
                               "thread", {"action": "add", "threads": candidates,
                                          "settle": settled, "updates": updates,
                                          "clockTasks": tasks,
                                          **({"bounty": claim} if claim else {}),
                                          "from": str(scene.get("title") or "")})
    except (LifeRefusal, ModelFailure):
        return None
    receipt = next((made for made in result.get("receipts") or [] if made.get("kind") == "thread"),
                   None)
    if receipt is None:
        return None
    if receipt.get("bounty"):
        if closes:
            show_bounty(closes[-1], receipt["bounty"])
            receipt["bountyInClose"] = True
        else:
            receipt["hidden"] = False
    return {**receipt, "id": f"R{len(receipts) + 1}", "afterStory": True}


async def promises_kept(archive, settlement, seed, knowledge, receipts, late, raw):
    """The entries of the ledger the beat says it saw to (a 了结|Y3 line of <threads>, as the beat's
    prompt lists the open ones by id): each settled through the engine's karma op (done, its person
    present), as note_karma's done would, so a promise kept never lapses into 「没有办到」 (the
    owner's 孙老道, batch 9). Their receipts settle after the story (afterStory); one the engine
    refuses is left out."""
    if settlement.get("errors"):
        return []
    made = []
    for entry in (found for found in settled_of(raw) if found.startswith("Y")):
        try:
            result = await life_op(settled_archive(archive, settlement), seed, knowledge,
                                   list(late) + made, "karma",
                                   {"done": entry, "how": PROMPT["situation"]["karmaKept"]})
        except (LifeRefusal, ModelFailure):
            continue
        made += [{**receipt, "id": f"R{len(receipts) + len(made) + 1}", "afterStory": True}
                 for receipt in result.get("receipts") or [] if receipt.get("kind") == "karma"]
    return made


def bag_owner(bag, rows):
    """Whose 储物袋 a bag the story handed over is: the person on the scene (a C or G row) whom the
    bag's name or where it came from names, the longest name first; else, with one person on the
    scene, that one; else None."""
    people = [(row_id, row_name(row)) for row_id, row in (rows or {}).items()
              if str(row_id)[:1] in ("C", "G") and isinstance(row, dict) and row_name(row)]
    text = f"{bag.get('name') or ''} {bag.get('from') or ''}"
    named = next((row_id for row_id, name in sorted(people, key=lambda each: -len(each[1]))
                  if name in text), None)
    return named or (people[0][0] if len(people) == 1 else None)


async def bags_opened(archive, settlement, seed, knowledge, receipts, late):
    """The 储物袋 the story had someone hand over (the owner's fourth playtest: 孙老道 gave his for
    the escort he had promised it for, and nothing came of it). settle.cjs storyThing leaves such
    a bag out of the story's commands (pilot.bags: { name, from }); here each is opened by the
    engine's bag op on the save as the story left it, as a felled person's would be, its owner the
    person on the scene, as the beat began or as the story left it, bag_owner finds (one the
    story's commands took off the scene in that beat goes with their row as it began). Their
    receipts settle after the story (afterStory); a bag nobody on the scene owns, or one the engine
    refuses (opened before), is left out."""
    if settlement.get("errors"):
        return []
    rows = (settlement.get("state") or {}).get("0") or {}
    began = ((archive.get("data") or {}).get("state") or {}).get("currentState", {}).get("0") or {}
    made = []
    for bag in (settlement.get("pilot") or {}).get("bags") or []:
        owner = bag_owner(bag, {**began, **rows}) if isinstance(bag, dict) else None
        if owner is None:
            continue
        args = {"from": owner, **({} if owner in rows else {"row": began[owner]})}
        try:
            result = await life_op(settled_archive(archive, settlement), seed, knowledge,
                                   list(late) + made, "bag", args)
        except (LifeRefusal, ModelFailure):
            continue
        made += [{**receipt, "id": f"R{len(receipts) + len(made) + 1}", "afterStory": True}
                 for receipt in result.get("receipts") or [] if receipt.get("kind") == "bag"]
    return made


async def first_method(archive, settlement, seed, knowledge, receipts, beat):
    """The opening's first method put on (item 25): when the opening closes and no main method
    is worn, the first 功法 in the bag goes on through the engine's equip op, on the save as the
    story left it (the method came by the story's own commands). Its receipt settles after the
    story (afterStory) and says it was put on. None when there is nothing to put on, or the
    engine will not (two tiers up)."""
    if (not (beat or {}).get("opening") or settlement.get("errors")
            or not any(receipt.get("kind") == "close" for receipt in receipts or [])):
        return None
    after = settled_archive(archive, settlement)
    try:
        worn = (await life_op(after, seed, knowledge, [], "view", {})).get("view") or {}
    except (LifeRefusal, ModelFailure):
        return None
    if any(piece.get("role") == "main" for piece in (worn.get("gear") or {}).get("active") or []):
        return None
    bag = (after["data"]["state"]["currentState"].get("1") or {})
    method = next((item_id for item_id, row in bag.items()
                   if isinstance(row, dict) and plain(str(row.get("2") or "")) == "功法"), None)
    if method is None:
        return None
    try:
        result = await life_op(after, seed, knowledge, [], "equip", {"itemId": method})
    except (LifeRefusal, ModelFailure):
        return None
    receipt = next((made for made in result.get("receipts") or []
                    if made.get("kind") == "equip_item" and made.get("ok")
                    and not made.get("readOnly")), None)
    if receipt is None:
        return None
    name = (receipt.get("item") or {}).get("name") or ""
    return {**receipt, "id": f"R{len(receipts) + 1}", "afterStory": True,
            "summary": fill(FIRST_METHOD, {"功法": name})}


def beat_metrics(final, beat):
    """What the usage record keeps of a beat's length: the story's characters, and the tier and
    range it was asked for (never rewritten for it)."""
    words = len(re.sub(r"\s", "", plain(story_of(final))))
    big = bool((SCENE_RULES["origins"].get((beat.get("scene") or {}).get("origin")) or {})
               .get("big"))
    return {"storyChars": words, "length": beat.get("length"),
            "lengthRange": list(length_range(beat.get("length"), big))}


def frame_data(chunk):
    raw = chunk.removeprefix("data: ").strip()
    if raw == "[DONE]":
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def light_complete(text, metrics):
    """The model's call for a card taken in a light scene, which is no call (batch 8): the reply
    the server wrote (light_reply), streamed as one chunk, and not counted (TurnMetrics.calls,
    so no usage is recorded)."""

    async def complete(config, messages, **kwargs):
        metrics.calls -= 1

        async def chunks():
            delta = SimpleNamespace(content=text, tool_calls=None)
            yield SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason="stop")],
                                  usage=None)

        return chunks()

    return complete


# Only unmistakable out-of-world labels, not words such as "寻找最佳突破时机".
CHOICE_SOLUTION = re.compile(
    r"(?:^|[（(【])\s*(?:最优解|最优(?:选项|选择|路线)|最佳(?:选项|选择|路线)|"
    r"正确(?:选项|选择|答案)|推荐(?:选项|选择|路线)|必选项?)\s*(?:[：:）)】]|$)"
)


def choice_continuity_errors(raw, beat, proposed):
    """Check explicit contradictions only; no keyword classifier judges narrative progress.

    A model-declared settled *known* goal cannot also be offered verbatim as unfinished.
    Ordinary failed attempts and repeated kinds (investigation, talk, waiting) stay legal.
    """
    errors = []
    if any(CHOICE_SOLUTION.search(card["title"]) for card in proposed):
        errors.append("行动卡不要标注最优解、推荐路线或正确答案；只写角色的行动意图")
    goals = list((beat.get("continuity") or {}).get("goals") or [])
    if isinstance(beat.get("taking"), dict):
        goals.append(beat["taking"])
    updates, _, _ = beat_thread_changes(raw, beat)
    declared_done = ({update["id"] for update in updates if update["status"] == "completed"}
                     if beat.get("threadFacts") else set(settled_of(raw)))
    completed = {goal["text"] for goal in goals if isinstance(goal, dict)
                 and goal.get("id") in declared_done and isinstance(goal.get("text"), str)}
    if any(card["title"] in completed for card in proposed):
        errors.append("已在<threads>明确了结的事项不能原样再列为待办行动；承接其后果给出下一步")
    return errors


def route_errors(proposed, priced, selected):
    """Check the purposes of routes the player can actually take.

    Several ways to learn something may stand alone when they lead to different decisions.
    The chosen intent is evidence of an attempt. Only its settled success closes that option.
    """
    allowed = ROUTES
    for card in proposed:
        intent = card.get("intent") or ""
        if (card.get("route") not in allowed or not 4 <= len(intent) <= 64
                or re.search(r"[<>\[\]|]", intent)):
            return ["每条行动卡末段须写「方向：具体目的」，方向用" + "、".join(allowed)
                    + "之一，目的写四至六十四字，点明这一步要改变的具体事情"]
    available = [card for card in priced if not card.get("locked")]
    if len(available) < 2:
        return ["当前条件下至少要有两条可以执行的不同路线；检查角色已有的物品、灵石、能力与人物"]
    # Use the parsed, proposed metadata for a comparison independent of engine pricing.
    selectable = {card["title"] for card in available}
    routes = [card for card in proposed if card["title"] in selectable]

    def normalized(value):
        return re.sub(r"[\s，。！？、：:；;·]", "", value).casefold()

    purposes = [normalized(card["intent"].partition("→")[0]) for card in routes]
    vague = {"打听消息", "获取情报", "收集情报", "了解情况", "继续观察", "静观其变",
             "探明虚实", "摸清情况", "观察动向", "了解更多", "打探虚实", "推动剧情"}
    if (any(goal in vague for goal in purposes)
            or any(normalized(card["title"]) in vague for card in routes)):
        return ["请写出具体要查明哪个问题、取得何物或谈成何事，不要只写打听消息、观察动向"]
    if len(set(purposes)) < len(purposes) or any(len(goal) < 4 for goal in purposes):
        return ["每条可选路线应有不同的具体目的，不能只换手段或标题去重复办同一件事"]
    achieved = selected.get("intent") or ""
    if (achieved and selected.get("outcome") in {"成功", "大成功"}
            and selected.get("route") not in {"修行", "经营"}):
        if normalized(achieved.partition("→")[0]) in purposes:
            return ["本拍已经成功办过的具体目的不能原样再列为待办，请承接判定给出新的决定"]
    if routes and all(card["route"] == "求证" for card in routes):
        decisions = [normalized(card["intent"].partition("→")[2]) for card in routes]
        if any(len(goal) < 4 for goal in decisions) or len(set(decisions)) < len(decisions):
            return ["这些卡全是求证，请给出现在可直接做的事；若确实只能求证，"
                    "各自用箭头写明查清以后哪件事可以决定，比如是否收货或是否赴约"]
    return []


def life_protocol(raw, beat, receipts, cards):
    """Definite missing output, distinct from free-text story consistency checks.

    A legitimate close, fight, gate or encounter has no model cards. An open ordinary scene
    must offer actual choices: the engine's automatic leave card cannot stand in for them.
    """
    errors = []
    content = re.search(r"<content>([\s\S]*?)</content>", raw, re.I)
    if content is None or not has_words(story_of(content[0])):
        errors.append("缺少完整且非空的<content>正文</content>")
    if not re.search(r"<upstore>[\s\S]*?</upstore>", raw, re.I):
        errors.append("缺少完整的<upstore>状态指令</upstore>，无指令也须保留空块")
    if re.search(r"</?(?:content|upstore)\s+>", raw, re.I):
        errors.append("正文和状态标签须照写<content>与<upstore>，标签内不加空格")
    tags = ("content", "upstore", "actions", "branches", "scene", "close", "title", "volume",
            "threads")
    for tag in tags:
        opened = len(re.findall(rf"<{tag}\s*>", raw, re.I))
        closed = len(re.findall(rf"</{tag}\s*>", raw, re.I))
        if opened != closed:
            errors.append(f"<{tag}>标签没有完整闭合")
        elif tag in {"content", "upstore", "actions"} and opened > 1:
            errors.append(f"<{tag}>只能有一个完整块")
    closed = any(receipt.get("kind") == "close" for receipt in receipts)
    if (not beat.get("scene") or closed or beat.get("fighting") or beat.get("met")
            or beat.get("gated")):
        return errors
    block = re.search(r"<actions\s*>([\s\S]*?)</actions\s*>", raw, re.I)
    proposed, fallback = parse_actions(raw)
    if block is None or fallback:
        errors.append("未收场的戏缺少有效的<actions>行动卡，不能用<branches>代替")
        return errors
    written = CARD.findall(block[1])
    remainder = CARD.sub("", block[1])
    if (len(written) != len(proposed)
            or any(len(FIELDS.split(card)) > 6 for card in written)
            or any(line.strip() and not SAID.match(line) for line in remainder.splitlines())):
        errors.append("行动卡格式或类型有误，每条写成[类型|标题|对象|难度|门槛|方向：具体目的]")
    invalid = [f"第{i}张「{card['kind'][:12]}」" for i, card in enumerate(proposed, 1)
               if card["kind"] not in PROMPT["cards"]["kinds"]]
    if invalid:
        errors.append("行动卡首段类型无效（" + "、".join(invalid) + "），首段只能写"
                      + "、".join(PROMPT["cards"]["kinds"])
                      + "；经营或放弃等方向写最后一段。主动拒绝无须检定时首段用静观")
    playable = [card for card in cards if not card.get("leave") and not card.get("talk")]
    if not 2 <= len(proposed) <= 4 or len(playable) < 2:
        errors.append("未收场的戏须在<actions>给出二到四条不同的行动路线，不能只剩离开或一条路线")
    elif len(playable) < len(proposed):
        errors.append("行动卡被引擎过滤，请给出能独立结算的路线，离开由引擎添加")
    if len({card["title"] for card in proposed}) != len(proposed):
        errors.append("每张行动卡必须是一条不同的路线，不得重复标题")
    errors.extend(choice_continuity_errors(raw, beat, proposed))
    if (beat.get("routeChoices") and not errors
            and sum(not card.get("locked") for card in playable) < 2):
        errors.append("当前条件下至少要有两条可以执行的不同路线；检查角色已有的物品、灵石、能力与人物")
    return errors


def card_advice(raw, beat, cards):
    """Route labels and purposes guide the model, while playable cards are the commit boundary."""
    if not beat.get("routeChoices") or not cards:
        return []
    proposed, _ = parse_actions(raw)
    priced = [card for card in cards if not card.get("leave") and not card.get("talk")]
    selected = (beat.get("continuity") or {}).get("selected") or {}
    return route_errors(proposed, priced, selected)


def life_settler(archive_before, seed, knowledge, beat, turn):
    """Shared by first generation and repair; replay fixed receipts, never repeat the action."""
    after = {"receipts": [], "cards": [], "matter": None, "protocol": []}
    road = (beat.get("interrupted") or {}).get("road")

    async def settle(raw, story, commands):
        if road:
            commands = held_to_road(commands, road)
        # A rewrite settles again: the beat's own receipts go and are made anew from it.
        turn.receipts[:] = [receipt for receipt in turn.receipts
                            if not any(receipt is made for made in after["receipts"])]
        before_receipts = copy.deepcopy(turn.receipts)
        seen = {}
        after["receipts"], after["cards"] = await after_story(
            archive_before, seed, knowledge, turn.receipts, raw, beat, commands,
            seen)
        # a close on the beat a matter opened (batch 9's close rule), for the turn's metrics
        after["matter"] = seen.get("matter")
        turn.receipts.extend(after["receipts"])
        settled = await settle_card(
            archive_before, commands, seed, knowledge, reply=raw,
            pilot={"receipts": turn.receipts, "story": story},
        )
        late = []
        # the opening's first method came by the story's commands: put on once they have
        method = await first_method(archive_before, settled, seed, knowledge,
                                    turn.receipts + late, beat)
        if method is not None:
            late.append(method)
        # a 储物袋 the story had someone hand over: the engine opens it (the owner's fourth
        # playtest)
        late += await bags_opened(archive_before, settled, seed, knowledge,
                                  turn.receipts + late, late)
        # the ledger's entries the beat says it saw to (a 了结|Y3 line), then the story threads it
        # left, settled or met, and any actual progress on them
        late += await promises_kept(archive_before, settled, seed, knowledge,
                                    turn.receipts + late, late, raw)
        act = beat.get("act") or {}
        failed = (act.get("outcome") or (act.get("check") or {}).get("outcome")) in FAILED
        tasks, ignored = clock_completions(raw, [] if failed else beat.get("clockTasks") or [])
        noted = await threads_noted(archive_before, settled, seed, knowledge,
                                    turn.receipts + late, late, raw, beat, tasks)
        if noted is not None:
            late.append(noted)
        # Price the next choice on settled people, items and clocks, including a clock just cleared.
        priced = await repriced(archive_before, settled, seed, knowledge,
                                turn.receipts + late, late, raw, after["cards"])
        if priced is not None:
            receipt, after["cards"] = priced
            late.append(receipt)
        if late:
            after["receipts"].extend(late)
            turn.receipts.extend(late)
            settled = await settle_card(
                archive_before, commands, seed, knowledge, reply=raw,
                pilot={"receipts": turn.receipts, "story": story},
            )
        after["protocol"] = life_protocol(raw, beat, turn.receipts, after["cards"])
        settled.setdefault("pilot", {})["protocol"] = after["protocol"]
        _, metadata_errors, dropped = beat_thread_changes(raw, beat)
        if dropped:
            settled["pilot"]["threadUpdatesDropped"] = dropped
        if metadata_errors:
            settled["pilot"]["threadMetadataErrors"] = metadata_errors
            # A claimed payout with no receipt needs a verified completion. Ordinary
            # optional thread notes can be ignored without changing the turn's result.
            if bounty_claim(raw, beat, turn.receipts):
                after["protocol"].extend(metadata_errors)
        if not after["protocol"] and (advice := card_advice(raw, beat, after["cards"])):
            settled["pilot"]["cardAdvice"] = advice
        if ignored:
            settled["pilot"]["clockCompletionsDropped"] = ignored
        settled["lifeReply"] = raw
        settled["lifeBeforeReceipts"] = before_receipts
        return settled

    return after, settle


def life_pilot_stream(runtime, records, running, request_id, reservation, archive_before, pilot,
                      messages, config, chronicle=(), verb=None):
    """A life scene's story, priced cards, and durable settlement with its original protocol."""
    context = reservation.get("context") or {}
    seed = reservation["seed"]
    beat = pilot.get("life") or {}

    # a card taken in a light scene: the server's reply in place of the model's (light_reply)
    canned = pilot.get("light")
    metrics = TurnMetrics("light" if canned else "pilot")
    turn = PilotTurn(
        complete=light_complete(canned, metrics) if canned else Gateway.complete,
        config=config,
        messages=messages,
        plan=pilot,
        archive=archive_before,
        seed=seed,
        sse=sse,
        metrics=metrics,
        recall=lambda args: recall_memory(runtime.profiles, records, archive_before, args),
        low_effort_tools=bool(admission(config.model).get("lowEffort")),
        settle=None,
        # move_place's journey stops on the chapter's day as the verb travel does (batch 7)
        plot=storyline(archive_before),
    )
    after, turn.settle = life_settler(archive_before, seed, context.get("knowledge"), beat, turn)

    async def output():
        status = "failed"
        runtime.active[running] = asyncio.current_task()
        started = time.monotonic()
        try:
            async with asyncio.timeout(GENERATION_SECONDS):
                if chronicle:
                    yield event({"chronicle": list(chronicle)})
                # what settled before the story (the opening mark, the card's check) goes first
                yield event({"cards": []})
                async for chunk in turn.run():
                    data = frame_data(chunk) or {}
                    if "final" in (data.get("frx") or {}):
                        # settled with the story: the scene's beat or close, the next cards
                        yield event({"cards": []})
                        visible_cards = [] if after["protocol"] else after["cards"]
                        turn.final = kept_reply(turn.final, visible_cards)
                        block = actions_block(visible_cards)
                        if block:
                            yield event({"actions": block})
                        yield event({"final": turn.final})
                        continue
                    yield chunk
                settlement = turn.settlement
                settlement.setdefault(
                    "beforeStateHash", state_digest(archive_before["data"]["state"])
                )
                settlement["metrics"] = {**turn.metrics.snapshot(),
                                         **beat_metrics(turn.final, beat),
                                         **({"closeMatter": after["matter"]}
                                            if after["matter"] else {})}
                mark_play(settlement, archive_before, turn.receipts,
                          verb=bool(chronicle) if verb is None else verb)
                status = "ready"
                if not records.finish_request(request_id, turn.final, status, settlement):
                    raise ModelFailure("本回合已停止或回溯，回复未应用")
                yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            status = "cancelled"
            raise
        except LifeRefusal as refusal:
            yield failure_frame(str(refusal), "refused")
        except Exception as exc:
            error = (
                exc
                if isinstance(exc, ModelFailure)
                else store_failure(exc)
                or model_failure(exc, stage="life_pilot", started=started, timeout=180)
            )
            yield error_frame(error)
        finally:
            runtime.active.pop(running, None)
            if status != "ready":
                diagnostic = {"pilotFirstReply": turn.first_reply} if turn.first_reply else None
                records.finish_request(request_id, turn.final, status, diagnostic)
            record_turn(runtime, records, request_id, turn.metrics)
            if turn.upstream:
                await close_stream(turn.upstream)

    return turn, output()
