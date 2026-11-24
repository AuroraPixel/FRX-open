"""The state view: a save's raw tables read into the named, typed shapes of the contracts.

Column meanings follow docs/data-model.md (状态表) and the old page's
own readers (frx.play_sheet); attribute totals are the old page's calculateTotalAttributes.
Pictures (portraits, scenes, icons, species) come from frx.play_art.
"""

import html
import json
import logging
import math
import re
from typing import get_args

from pydantic import ValidationError

from . import play_art as art
from . import play_models as M
from . import play_places as places
from .card_director import active_plot, committed_turns, condition_text, current_index
from .card_director import is_turn as committed
from .card_store import card_story
from .domain import ROOT
from .life import life_of
from .play_sheet import (
    ATTRIBUTE_KEYS,
    SLOTS,
    Sheet,
    bag_rows,
    character_data,
    item_stack_count,
    js_get,
    js_or,
    js_trim,
    js_values,
    parse_int,
    parse_nested_json,
    time_row,
    to_number,
    to_text,
    total_attributes,
    truthy,
)

logger = logging.getLogger(__name__)

EMPTY = {"", "无", "待定", "未知", "暂无", "暂无描述", "暂无加成", "无消耗", "undefined", "null"}
# How many of the latest turns the scene looks back over (a stay at one place, a day's weather).
RECENT_TURNS = 12
SHOWN_ATTRIBUTES = [key for key in ATTRIBUTE_KEYS if key != "血量"]  # 血量 is the hp gauge
# The spirit beasts' rules (item 41): the days of 认主 and the feeds a month.
BEAST_RULES = json.loads((ROOT / "content/life/beasts.json").read_text(encoding="utf-8"))
GLYPHS = (
    ("炼气", "炼"),
    ("筑基", "筑"),
    ("结丹", "丹"),
    ("金丹", "丹"),
    ("元婴", "婴"),
    ("化神", "神"),
    ("炼虚", "虚"),
    ("合体", "合"),
    ("大乘", "乘"),
    ("渡劫", "劫"),
    ("凡人", "凡"),
)
ITEM_TYPES = set(get_args(M.ItemType))
ITEM_SYNONYMS = {"丹药": "消耗品", "法器": "法宝"}
EQUIPPABLE = {"武器", "护甲", "功法", "法宝"}
MONTHS = "正月 二月 三月 四月 五月 六月 七月 八月 九月 十月 冬月 腊月".split()
NUMERALS = "一二三四五六七八九十"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
HOURS = {**dict.fromkeys("戌亥子丑寅", "night"), "卯": "dawn", "酉": "dusk"}  # the rest: day


def text_of(value):
    """Model-written text as plain text: tags and entities resolved, placeholders dropped."""
    if not truthy(value):
        return ""
    text = js_trim(html.unescape(re.sub(r"<[^>]*>", "", to_text(value))))
    return "" if text in EMPTY else text


def optional(value):
    return text_of(value) or None


def whole(value, default=0):
    number = to_number(value)
    return default if not math.isfinite(number) else int(math.floor(number + 0.5))


# ---------------------------------------------------------------- time and place


def chinese_number(n):
    if n <= 10:
        return NUMERALS[max(n, 1) - 1]
    if n < 20:
        return "十" + NUMERALS[n - 11]
    tens, ones = divmod(n, 10)
    return NUMERALS[tens - 1] + "十" + (NUMERALS[ones - 1] if ones else "")


def lunar_day(day):
    if day <= 10:
        return "初" + NUMERALS[day - 1]
    if 20 < day < 30:
        return "廿" + NUMERALS[day - 21]
    return chinese_number(day)


# A month and a day as the model may write them: the calendar's month names, and 十一月, 十二月
# (冬月, 腊月 in the calendar's words); the day in any of the usual spellings.
DATE_WORDS = re.compile(
    "(十一月|十二月|" + "|".join(MONTHS) + ")"
    "(初[一二三四五六七八九十]+|廿[一二三四五六七八九十]?|[一二三]?十[一二三四五六七八九]?"
    "|[一二三四五六七八九](?![十百千万月年]))"
)
DIGITS = {char: n for n, char in enumerate("一二三四五六七八九", 1)}


def day_number(words):
    """The day a day word means (初十一, 十一, 二十一, 廿一 …), or None when it is not one."""
    text = words.removeprefix("初")
    if text.startswith("廿"):
        rest = text[1:]
        return 20 + (DIGITS.get(rest, 0) if rest != "十" else 0) if len(rest) <= 1 else None
    if "十" in text:
        head, _, tail = text.partition("十")
        if (head and head not in DIGITS) or (tail and tail not in DIGITS):
            return None
        return DIGITS.get(head, 1) * 10 + DIGITS.get(tail, 0)
    return DIGITS.get(text) if len(text) == 1 else None


def calendar_words(text):
    """The dates of model-written text in the calendar's words, as the engine writes them
    (clock.dateOf: 正月初三, 二月十一, 冬月廿九): 「二月初十一」 is 二月十一, 「十一月初三」 is
    冬月初三. A day past thirty, or one that is no day, stays as written."""
    def fixed(found):
        month, words = found.group(1), found.group(2)
        day = day_number(words)
        if day is None or not 1 <= day <= 30:
            return found.group(0)
        name = {"十一月": "冬月", "十二月": "腊月"}.get(month, month)
        return name + lunar_day(day)
    return DATE_WORDS.sub(fixed, str(text or ""))


class Moment:
    """The time part of the time row: 「0001年 01月 03日 23:40」."""

    def __init__(self, text):
        self.text = text
        found = re.search(
            r"(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{1,2}))?", text
        )
        self.year, self.month, self.day = (
            (int(found.group(i)) for i in (1, 2, 3)) if found else (0, 0, 0)
        )
        self.hour = int(found.group(4)) if found and found.group(4) else None
        named = re.search(r"([子丑寅卯辰巳午未申酉戌亥])时", text)
        if self.hour is None and named:  # a time row that names the 时辰 instead of the hour
            self.hour = BRANCHES.index(named.group(1)) * 2 % 24

    @property
    def date(self):
        if not (1 <= self.month <= 12 and 1 <= self.day <= 99):
            return ""
        return MONTHS[self.month - 1] + lunar_day(self.day)

    @property
    def branch(self):
        """The 时辰: 子 is 23:00–1:00, 丑 1:00–3:00 and so on."""
        if self.hour is None or not 0 <= self.hour < 24:
            return ""
        return BRANCHES[((self.hour + 1) // 2) % 12]

    def clock(self):
        return M.Clock(
            text=self.text,
            date=self.date,
            hour_name=self.branch + "时" if self.branch else "",
            hour=HOURS.get(self.branch, "day"),
        )


def _clean(part):
    """A region or area name without its coordinates and bracketed spot (app.js 26196)."""
    return re.split(r"[（(]", re.split(r"\s+-?\d", part)[0])[0].strip()


class Location:
    """The time row: 「0001年 01月 02日 12:35/潮岚道/云汀湾（百草园南侧药田）3393,1848」, or the
    opening's 「…/潮岚道/云汀湾|(岩汀门) |3275,1855」."""

    def __init__(self, full):
        time_part, slash, rest = full.partition("/")
        self.moment = Moment(js_trim(time_part) if slash else full)
        coords = re.search(r"(-?\d+),(-?\d+)", full)
        self.xy = (int(coords.group(1)), int(coords.group(2))) if coords else None
        parts = [js_trim(part) for part in rest.replace("|", " ").split("/")] if slash else []
        self.region = _clean(parts[0]) if parts else ""
        area_part = parts[1] if len(parts) > 1 else ""
        self.area = _clean(area_part)
        spot = re.search(r"[（(]\s*([^（）()]*?)\s*[）)]", area_part)
        self.spot = spot.group(1) if spot else (_clean(parts[2]) if len(parts) > 2 else "")

    @property
    def text(self):
        return (
            " · ".join(part for part in (self.area or self.region, self.spot) if part) or "未知之地"
        )

    def place(self):
        return M.Place(
            text=self.text,
            region=self.region,
            area=self.area,
            poi=self.spot or None,
            x=float(self.xy[0]) if self.xy else None,
            y=float(self.xy[1]) if self.xy else None,
        )


def realm_glyph(realm):
    for name, glyph in GLYPHS:
        if name in realm:
            return glyph
    return "凡" if realm in EMPTY else realm[:1]


# ---------------------------------------------------------------- items, skills, beasts, quests

COLOUR_GRADES = {"green": 2, "dodgerblue": 3, "mediumorchid": 4, "crimson": 5}
STAGE_GRADES = (("天阶", 5), ("地阶", 4), ("玄阶", 3), ("黄阶", 2))
WORD_GRADES = (
    ("绝品", 5),
    ("极品", 4),
    ("上品", 3),
    ("中品", 2),
    ("良品", 2),
    ("下品", 1),
    ("凡品", 1),
)
QUALITY_GRADES = {"神话": 5, "神迹": 5, "传说": 4, "史诗": 3, "稀有": 2, "普通": 1, "平庸": 1}


def numeral_value(text):
    if text.isdigit():
        return int(text)
    if "十" not in text:
        return NUMERALS.index(text) + 1 if len(text) == 1 else 0
    tens, _, ones = text.partition("十")
    if len(tens) > 1 or len(ones) > 1 or "十" in ones:
        return 0
    return (NUMERALS.index(tens) + 1 if tens else 1) * 10 + (
        NUMERALS.index(ones) + 1 if ones else 0
    )


def grade_of(raw_name, text, effect):
    """Quality 1–5 from the item's own wording, in the card's conventions: the colour its name
    is painted in (黄阶 green … 天阶 crimson), a 天地玄黄 stage, an 「N品」 rank (1–4 黄, 5–10 玄,
    11–16 地, 17+ 天), a 极品 / 上品 … word, then the 「品质:」 prefix of its effect; else 1."""
    colour = re.search(r"color\s*:\s*([a-z]+)", str(raw_name), re.I)
    if colour and colour.group(1).lower() in COLOUR_GRADES:
        return COLOUR_GRADES[colour.group(1).lower()]
    words = art.plain_name(raw_name) + " " + text
    for word, grade in STAGE_GRADES:
        if word in words or word in effect:
            return grade
    rank = re.search(r"([一二三四五六七八九十]{1,3}|\d{1,2})品", words)
    number = numeral_value(rank.group(1)) if rank else 0
    if number:
        return 2 if number <= 4 else 3 if number <= 10 else 4 if number <= 16 else 5
    for word, grade in WORD_GRADES:
        if word in words:
            return grade
    qualities = [
        QUALITY_GRADES[q]
        for q in re.findall(r"(神话|神迹|传说|史诗|稀有|普通|平庸)\s*[:：]", effect)
    ]
    return max(qualities) if qualities else 1


def item_view(entry, quantity=None):
    """A bag row (numbered columns) or a worn item (named fields) as an Item."""

    def field(named, column):
        return js_or(js_get(entry, named), js_get(entry, column))

    raw_type = text_of(field("type", "2"))
    item_type = raw_type if raw_type in ITEM_TYPES else ITEM_SYNONYMS.get(raw_type, "其他物品")
    raw_name = to_text(field("name", "1")) if truthy(field("name", "1")) else ""
    name = art.plain_name(raw_name) or "无名之物"
    text = text_of(field("description", "3"))
    effect = (
        text_of(field("currentEffect", "9"))
        if item_type == "功法"
        else text_of(field("effect", "4"))
    )
    if quantity is None:
        count = parse_int(field("quantity", "5"))
        quantity = count if isinstance(count, int) and count >= 0 else 1
    return M.Item(
        id=to_text(field("id", "0")) if truthy(field("id", "0")) else "",
        name=name,
        type=item_type,
        text=text,
        effect=effect or None,
        quantity=quantity,
        grade=grade_of(raw_name, text, effect),
        icon=art.icon_of(name, item_type),
        equippable=item_type in EQUIPPABLE,
        usable=item_type == "消耗品",
    )


def equipment_view(player):
    slots = {}
    for slot in SLOTS:
        held = js_or(player.get(slot), [])
        held = (held if isinstance(held, list) else [held])[:6]
        cells = [item_view(item) if isinstance(item, dict) else None for item in held]
        slots[slot] = cells + [None] * (6 - len(cells))
    return M.Equipment(**slots)


def bag_view(tables):
    return [item_view(row, quantity=item_stack_count(js_get(row, "5"))) for row in bag_rows(tables)]


def skill_kind(name, sort, text):
    """功法 (technique), 法术 (spell) or 杂学 (misc), from the skill's name and type words."""
    if re.search(
        r"炼丹|炼器|制符|画符|阵法|布阵|采药|种植|鉴定|驭兽|御兽|医术|厨艺|杂学|技艺|手艺",
        name + sort,
    ):
        return "misc"
    if re.search(r"功法|心法|吐纳|内功", sort + text) or re.search(
        r"(功|诀|决|经|心法|典|录)$", name
    ):
        return "technique"
    return "spell"


def _layer(value):
    text = text_of(value)
    return (
        text
        if text and len(text) <= 8 and re.search(r"层|重|^[0-9一二三四五六七八九十/]+$", text)
        else None
    )


def skill_view(key, row):
    """Columns of table 8 as the old page's skill detail reads them (app.js 44311)."""
    name = art.plain_name(js_get(row, "1")) or "无名之术"
    layer = _layer(js_get(row, "5")) or _layer(js_get(row, "2"))
    grade = optional(js_get(row, "2"))
    proficiency = re.match(r"\s*(\d+)\s*/\s*(\d+)", to_text(js_get(row, "7")))
    sort = text_of(js_get(row, "3"))
    text = text_of(js_get(row, "4")) or text_of(js_get(row, "6"))
    return M.Skill(
        id=to_text(js_or(js_get(row, "0"), key)),
        name=name,
        grade=grade if grade != layer else None,
        layer=layer,
        proficiency=(
            M.Gauge(current=int(proficiency.group(1)), max=int(proficiency.group(2)))
            if proficiency
            else None
        ),
        cost=optional(js_get(row, "8")),
        text=text,
        kind=skill_kind(name, sort, text),
    )


# The grades of a beast's aptitude and the progress each holds: the page's BEAST_APTITUDE_CONFIG
# (app.js 43806, apps/engine/core/beasts.cjs; a test holds the two together).
BEAST_APTITUDE = (
    ("凡品", 100), ("灵品", 300), ("玄品", 600), ("地品", 1000), ("天品", 2500), ("仙品", 5000),
    ("神品", 10000), ("圣品", 99999),
)


def beast_aptitude(value):
    """parseBeastAptitude (app.js 43827): 「灵品|12」 as grade and progress, an unknown grade read
    as the first one."""
    name, current = "凡品", 0
    if truthy(value):
        parts = to_text(value).split("|")
        name = parts[0] or "凡品"
        number = parse_int(parts[1]) if len(parts) > 1 else 0
        current = number if isinstance(number, int) else 0
    tier, top = next((grade for grade in BEAST_APTITUDE if grade[0] == name), BEAST_APTITUDE[0])
    return M.Aptitude(tier=tier, current=current, max=top)


def beast_view(key, row):
    name = art.plain_name(js_get(row, "1")) or "无名灵兽"
    affection = parse_int(js_or(js_get(row, "10"), "0"))
    return M.Beast(
        id=to_text(js_or(js_get(row, "0"), key)),
        name=name,
        level=optional(js_get(row, "2")),
        species=art.species_of(name),
        text=text_of(js_get(row, "3")) or text_of(js_get(row, "4")),
        hp=optional(js_get(row, "8")),
        mp=optional(js_get(row, "9")),
        skills=optional(js_get(row, "5")),
        aptitude=beast_aptitude(js_get(row, "7")),
        affection=affection if isinstance(affection, int) else None,
    )


def quest_view(key, row):
    """A task as the old page's board shows it (app.js 43672): done or failed by its status
    words, otherwise under way."""
    status = to_text(js_or(js_get(row, "5"), "进行中"))
    done = any(word in status for word in ("达成", "完成", "成功"))
    failed = not done and any(word in status for word in ("失败", "放弃"))
    return M.Quest(
        id=to_text(js_or(js_get(row, "0"), key)),
        title=art.plain_name(js_get(row, "1")) or "未知任务",
        text=text_of(js_get(row, "2")),
        reward=optional(js_get(row, "3")),
        penalty=optional(js_get(row, "4")),
        status="done" if done else "failed" if failed else "active",
        note=optional(status),
    )


def rows_of(table):
    if isinstance(table, dict):
        return [(str(key), row) for key, row in table.items() if isinstance(row, dict)]
    return [(to_text(js_get(row, "0")), row) for row in js_values(table) if isinstance(row, dict)]


def counted(condition, mark):
    """A counted condition's (灵石, 持有) have and need, read off the engine's mark (its detail:
    「当前灵石5块」, 「有「回气丹」共2件」, 「没有「回气丹」」), else None."""
    kind = condition.get("kind")
    if kind not in ("灵石", "持有") or not isinstance(mark, dict):
        return None
    if mark.get("kind") not in (None, kind):
        return None
    detail = str(mark.get("detail") or "")
    count = mark.get("count", condition.get("count"))
    if kind == "灵石":
        have = re.search(r"当前灵石(\d+)块", detail)
        value = str(condition.get("value") or "")
        need = count if isinstance(count, int) else re.search(r"\d+", value)
        need = need if isinstance(need, int) else int(need.group()) if need else None
        have = int(have.group(1)) if have else None
    else:
        found = re.search(r"共(\d+)件", detail)
        have = int(found.group(1)) if found else 0 if detail.startswith("没有") else None
        need = count if isinstance(count, int) and count >= 1 else 1
    return (have, need) if isinstance(have, int) and isinstance(need, int) and need >= 1 else None


def mainline_view(plot, marks, story=False):
    """The current chapter of the server's storyline (card_director) with each condition as a
    clue, done by the engine's marks (a counted one with what the player has of what it wants),
    and the next chapter's title; with `story` (a save of the cultivation life, plan item 26)
    also the storyline's title and hook."""
    position = current_index(plot) if plot else None
    if position is None:
        return None
    chapter = plot["chapters"][position]
    found = None
    if isinstance(marks, dict):
        found = next(
            (
                c.get("conditions")
                for c in marks.get("chapters") or []
                if c.get("id") == chapter.get("id")
            ),
            None,
        )
    clues = []
    for index, condition in enumerate(
        c for c in chapter.get("conditions") or [] if isinstance(c, dict)
    ):
        mark = found[index] if isinstance(found, list) and index < len(found) else None
        met = (
            isinstance(mark, dict)
            and mark.get("met") is True
            and mark.get("kind") in (None, condition.get("kind"))
        )
        tally = counted(condition, mark)
        pending = story and condition.get("kind") == "其他" and not met
        clues.append(M.Clue(text=condition_text(condition), done=bool(met),
                            pending=True if pending else None,
                            **({"have": tally[0], "need": tally[1]} if tally else {})))

    def titled(index):
        title = str(plot["chapters"][index].get("title") or "")
        bare = re.sub(r"^第[一二三四五六七八九十\d]+章\s*[：:·、.\s]*", "", title) or title
        return f"第{chinese_number(index + 1)}章 · {bare}"

    chapters = plot["chapters"]
    following = position + 1 < len(chapters) and isinstance(chapters[position + 1], dict)
    return M.Mainline(
        chapter=titled(position),
        goal=str(chapter.get("goal") or ""),
        clues=clues,
        title=str(plot.get("title") or "") or None if story else None,
        hook=str(plot.get("hook") or "") or None if story else None,
        next=titled(position + 1) if following else None,
    )


# ---------------------------------------------------------------- characters


def gauge(stat):
    return M.Gauge(current=whole(js_get(stat, "current")), max=whole(js_get(stat, "max")))


def attributes_view(char_id, data):
    """The eleven attributes as the old page totals them (calculateTotalAttributes): `total` is
    the current value with the bonuses (the page shows it first), `max` the upper value with
    them (shown second) when it differs, `base` the current value before them, `sources` each
    item, buff and trait that adds to it."""
    totals = total_attributes(data, char_id == "B1")
    stats = js_or(data.get("detailedAttributes"), {})
    shown = []
    for key in SHOWN_ATTRIBUTES:
        total = totals[key]
        current, upper = whole(total["current"]), whole(total["max"])
        shown.append(
            M.Attribute(
                key=key,
                label=key,
                base=whole(js_or(js_get(js_or(js_get(stats, key), {}), "current"), 0)),
                max=upper if upper != current else None,
                bonus=whole(total["bonus"]),
                total=current,
                sources=[
                    M.AttributeSource(source=art.plain_name(name) or "未名", value=whole(value))
                    for name, value in total["parts"]
                ],
            )
        )
    return shown


def life_attributes(data, gear):
    """The player's attributes in the cultivation life: the engine's totals with the active gear
    (gear.cjs totals: only the pieces that count, by their tier, attunement and condition), over
    the same base and the same buffs and traits as the old totals; `sources` the buffs and traits
    as before and each active piece's own bonus (the life view's gear: active, pieces)."""
    shown = attributes_view("B1", {**data, **{slot: [] for slot in SLOTS}})
    totals = gear.get("totals") or {}
    pieces = gear.get("pieces") or {}
    stats = js_or(data.get("detailedAttributes"), {})
    for attribute in shown:
        upper = totals.get(attribute.key)
        if not isinstance(upper, (int, float)):
            continue
        stat = js_or(js_get(stats, attribute.key), {})
        base_max = whole(js_or(js_get(stat, "max"), 0))
        bonus = whole(upper) - base_max
        current = attribute.base + bonus
        attribute.bonus, attribute.total = bonus, current
        attribute.max = whole(upper) if whole(upper) != current else None
        attribute.sources += [
            M.AttributeSource(source=art.plain_name((pieces.get(piece.get("id")) or {}).get("name"))
                              or "未名", value=whole(piece["bonus"][attribute.key]))
            for piece in gear.get("active") or []
            if isinstance(piece.get("bonus"), dict) and piece["bonus"].get(attribute.key)
        ]
    return shown


def relation_to_player(data):
    for part in to_text(js_or(data.get("rawRelations"), "")).split(";"):
        target, _, desc = part.partition(":")
        if js_trim(target) == "B1" and js_trim(desc):
            return js_trim(desc)
    return None


def character_fields(char_id, data, recipe, present):
    gender = to_text(data.get("gender")) if truthy(data.get("gender")) else ""
    realm = text_of(data.get("realm")) or "未知"
    stats = js_or(data.get("detailedAttributes"), {})
    affection = parse_int(data.get("favorability")) if truthy(data.get("favorability")) else None
    return dict(
        id=char_id,
        name=art.plain_name(data.get("name")) or char_id,
        sex="m" if gender.startswith("男") else "f" if gender.startswith("女") else None,
        realm=realm,
        realm_glyph=realm_glyph(realm),
        role=optional(data.get("identity")),
        hp=gauge(js_get(stats, "血量")),
        mp=gauge(js_get(stats, "法力")),
        attributes=attributes_view(char_id, data),
        relation=relation_to_player(data),
        affection=affection if isinstance(affection, int) else None,
        portrait=M.Recipe.model_validate(recipe),
        present=present,
        bonded=True if data.get("isBonded") is True else None,
    )


def character_view(char_id, data, recipe, present):
    return M.Character(**character_fields(char_id, data, recipe, present))


def statuses_of(status):
    """The status column: 「①名:说明(效果)②…」 entries, or one plain status."""
    text = text_of(status)
    if not text or text == "一切正常":
        return []
    shown = []
    for entry in re.findall(r"[①-⑳]([^①-⑳]*)", text) or [text]:
        found = re.match(r"([^:：(（]+)[:：]?\s*(.*)$", js_trim(entry), re.S)
        if found and js_trim(found.group(1)):
            shown.append(
                M.Status(name=js_trim(found.group(1)), text=js_trim(found.group(2)) or None)
            )
    return shown


def traits_of(traits):
    shown = []
    for trait in traits if isinstance(traits, list) else []:
        if isinstance(trait, dict) and truthy(trait.get("name")):
            text = text_of(trait.get("desc")) or text_of(trait.get("effects"))
            shown.append(M.NamedText(name=art.plain_name(trait["name"]), text=text))
    return shown


# ---------------------------------------------------------------- one save


class Save:
    """One save read through the old page's eyes: its record, its tables as the page reads
    them, where and when the player is, and the people the page lists."""

    def __init__(self, name, version, value):
        self.name, self.version, self.value = name, version, value
        self.data = value.get("data") if isinstance(value.get("data"), dict) else {}
        self.archive_id = str(self.data.get("archiveId") or "")
        state = self.data.get("state")
        self.state = state if isinstance(state, dict) else {}
        self.sheet = Sheet(self.state)
        self.player = self.sheet.player or character_data({"0": "B1"}, "B1") | {"playerTraits": []}
        self.location = Location(self.sheet.location_text)

    def known(self):
        """People met who are not in the scene: bonded characters, then the biographies the
        page keeps for characters who left (worldBookEntries keyed C… or G…)."""
        people = {
            key: data for key, data in self.sheet.bonded.items() if key not in self.sheet.scene
        }
        for entry in self.state.get("worldBookEntries") or []:
            key = str(entry.get("key") or "") if isinstance(entry, dict) else ""
            if (
                not re.match(r"^[CG][A-Za-z0-9_-]{0,127}$", key)
                or key in self.sheet.scene
                or key in people
            ):
                continue
            row = biography_row(entry)
            if row:
                people[key] = character_data({**row, "0": key}, key)
        return people

    def present(self):
        """The characters in the scene (table 0 without the player), bonded ones first, as the
        old page's 周围人物 list sorts them (app.js 37973)."""
        return dict(sorted(self.sheet.scene.items(), key=lambda pair: not pair[1].get("isBonded")))

    def everyone(self):
        return {"B1": self.player, **self.present(), **self.known()}

    def departed(self, char_id, name=None):
        """Someone no longer in the scene whom the save keeps no biography of (a speaker who
        left in the same turn, say), as the latest turn snapshot that still has them in the
        people table; None when no snapshot has them. With `name`, the latest snapshot in which
        the id still named someone of that name (the model gives ids to other people). Read
        only."""
        if not re.match(r"^[CG][A-Za-z0-9_-]{0,127}$", char_id or ""):
            return None
        needle = '"' + char_id + '"'
        logs = self.data.get("logs") if isinstance(self.data.get("logs"), list) else []
        for log in reversed(logs):
            snapshot = log.get("stateSnapshot") if isinstance(log, dict) else None
            if not isinstance(snapshot, str) or needle not in snapshot:
                continue
            if name is not None and name not in snapshot:
                continue
            tables = parse_nested_json(snapshot, {})
            people = tables.get("0") if isinstance(tables, dict) else None
            row = people.get(char_id) if isinstance(people, dict) else None
            if not isinstance(row, dict):
                continue
            data = character_data({**row, "0": char_id}, char_id)
            if name is None or art.plain_name(data.get("name")) == name:
                return data
        return None

    def narration(self):
        """The latest committed reply as plain text, for the place's indoor and sky clues."""
        recent = self.recent(1)
        return recent[0][0] if recent else ""

    def action_words(self):
        """The player's own words for the latest committed turn (their log before the reply),
        for whether it was the player who flew."""
        logs = self.data.get("logs") if isinstance(self.data.get("logs"), list) else []
        for index in range(len(logs) - 1, 0, -1):
            if committed(logs[index]):
                before = logs[index - 1]
                if isinstance(before, dict) and before.get("type") == "user":
                    return re.sub(r"<[^>]*>", "", str(before.get("content") or ""))
                return ""
        return ""

    def subjects(self):
        """What the narration calls the player: 你, 我, or their name (a third-person save)."""
        name = art.plain_name(self.player.get("name"))
        return ("你", "我", *([name] if name and name not in {"你", "我"} else []))

    def recent(self, limit=RECENT_TURNS):
        """The latest committed turns, newest first (at most `limit`): each one's story as
        plain text and where and when it ended (the newest: the save's own time row; earlier
        ones: their log's state snapshot, None when it has none)."""
        from .card_director import clean_text

        logs = self.data.get("logs") if isinstance(self.data.get("logs"), list) else []
        turns = []
        for log in reversed(logs):
            if len(turns) >= limit:
                break
            if not committed(log):
                continue
            where = self.location if not turns else snapshot_location(log.get("stateSnapshot"))
            turns.append((clean_text(card_story(str(log.get("content") or ""))), where))
        return turns

    def turns(self):
        return committed_turns(self.value)

    def plot(self):
        return active_plot(self.data)


def biography_row(entry):

    content = entry.get("content")
    if isinstance(content, dict):
        return content
    try:
        row = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        return None
    return row if isinstance(row, dict) and row.get("1") else None


TIME_ROW = re.compile(r'\{[^{}]*"TIME_LOCATION_ROW"[^{}]*\}')


def snapshot_location(snapshot):
    """Where and when a turn ended, from its log's stateSnapshot (the tables as a JSON string),
    or None when the snapshot has no time row."""

    if not isinstance(snapshot, str):
        return None
    found = TIME_ROW.search(snapshot)
    try:
        row = json.loads(found[0]) if found else time_row(json.loads(snapshot))
    except (ValueError, TypeError, AttributeError):
        return None
    text = to_text(js_get(row, "0")) if isinstance(row, dict) and truthy(js_get(row, "0")) else ""
    return Location(text) if text else None


def place_reading(save):
    """Where the player is (play_art.read_place), read from the turns spent at the place: the
    arrival decides inside or outside where the name does not, and only a clear move in or out
    changes it during the stay."""
    here = save.location
    recent = save.recent()
    stay = []
    for text, where in recent[1:]:
        if where is None or where.text != here.text:
            break
        stay.append(text)
    return art.read_place(
        save.state.get("worldMap"), here.spot, here.xy, recent[0][0] if recent else "",
        list(reversed(stay)), action=save.action_words(), subjects=save.subjects(),
        region=here.region, area=here.area,
    )


def scene_view(save, looks=None):
    """The scene, its weather (one of the stage's five kinds), inside or outside and the place's
    look. The look is the one the place keeps (`looks`: key → look, play_places.PlaceBook), else
    the rules'; it picks the painted scene or the kit (art.scene_for), so a place looks the same
    on every visit. Weather the story states holds for the rest of that day, else the default for
    the region and month. A scene with a kit names the place it is composed for."""
    here, moment = save.location, save.location.moment
    reading = place_reading(save)
    looks = looks or {}
    keys = list(looks)
    # another name of a place kept earlier (柴房 for 后院柴房) is that place
    alias = places.alias_of(reading.key, keys[: keys.index(reading.key)] if reading.key in looks
                            else keys)
    look = looks.get(reading.key) or (looks.get(alias) if alias else None) or reading.rules.look
    if alias:
        reading = art.as_alias(save.state.get("worldMap"), reading, alias)
    shown, indoor, kit = art.scene_for(look, reading.family, reading.flying)
    composed = art.composed_place(reading, look, kit, here.region)
    seed = f"{save.archive_id}:{moment.year}-{moment.month}-{moment.day}"
    weather = None
    for text, where in save.recent():
        day = where.moment if where else None
        if day is None or (day.year, day.month, day.day) != (moment.year, moment.month, moment.day):
            break
        weather = art.story_weather(text)
        if weather:
            break
    weather = weather or art.weather_of(seed, here.region, here.area, moment.month)
    return M.SceneRef(
        scene_id=shown, weather=weather, indoor=indoor, look=M.PlaceLook(**look),
        composed=M.ComposedPlace(**composed) if composed else None,
    )


def player_view(save, recipe, cultivation, gear=None):
    """The player: the character fields plus what only the player has; in the cultivation life
    (`gear`, the life view's) the attributes count the active gear only (life_attributes)."""
    data = save.player
    remarks = data.get("remarks") or {}
    progress = parse_int(data.get("progress"))
    age, lifespan = parse_int(remarks.get("年龄")), parse_int(remarks.get("寿元"))
    root = (cultivation or {}).get("root") or {}
    stones = parse_int(data.get("spiritStones"))
    fields = character_fields("B1", data, recipe, True)
    if isinstance(gear, dict) and gear.get("totals"):
        fields["attributes"] = life_attributes(data, gear)
    return M.Player(
        **fields,
        xp=M.Gauge(current=progress if isinstance(progress, int) else 0, max=100),
        lifespan=M.Lifespan(
            age=age if isinstance(age, int) else 0, max=lifespan if isinstance(lifespan, int) else 0
        ),
        stones=stones if isinstance(stones, int) and stones > 0 else 0,
        root=M.Root(
            name=text_of(data.get("linggen")) or "无", multiplier=float(root.get("factor", 1) or 0)
        ),
        technique=technique_of(save, (cultivation or {}).get("technique") or {}),
        traits=traits_of(data.get("playerTraits")),
        statuses=statuses_of(data.get("status")),
        progress=progress_of(cultivation),
    )


def technique_of(save, technique):
    """The method the engine cultivates with: a worn 功法 or a learned skill of that name."""
    name = technique.get("name")
    if not name:
        return None
    for item in save.player.get("technique") or []:
        if (
            isinstance(item, dict)
            and art.plain_name(js_or(js_get(item, "name"), js_get(item, "1"))) == name
        ):
            return M.Technique(
                item_id=to_text(js_or(js_get(item, "id"), js_get(item, "0"))), name=name
            )
    for key, row in rows_of(js_get(save.sheet.tables, "8")):
        if art.plain_name(js_get(row, "1")) == name:
            return M.Technique(item_id=key, name=name, layer=skill_view(key, row).layer)
    return M.Technique(item_id="", name=name)


def progress_of(cultivation):
    """The engine's cultivation view (progress mode) as the old page words it (host.js 676)."""
    if not cultivation or not isinstance(cultivation.get("next"), dict):
        return None
    step = cultivation["next"]
    if step.get("kind") == "已至顶峰":
        return M.Progress(
            per_day=float(cultivation.get("perDay") or 0),
            next="已至当前版本的最高境界",
            ready=False,
        )
    missing = [c for c in step.get("conditions") or [] if not c.get("met")]
    target = f"下一步：{step.get('target')}" + ("（突破）" if step.get("kind") == "突破" else "")
    if step.get("cooldownUntil"):
        text = f"{target} · 冲关受挫，{step['cooldownUntil']}后可再试"
    elif not missing:
        text = f"{target} · 条件已齐" + ("，可以冲关" if step.get("kind") == "突破" else "")
    else:
        text = f"{target} · 缺：" + "、".join(
            c.get("label", "")
            + (f"（{c['detail']}）" if c.get("detail") and re.search(r"\d", c["detail"]) else "")
            for c in missing
        )
    ready = step.get("kind") == "突破" and not missing and not step.get("cooldownUntil")
    return M.Progress(per_day=float(cultivation.get("perDay") or 0), next=text, ready=ready)


def recipe_of(art_value, char_id):
    return ((art_value.get("portraits") or {}).get(char_id) or {}).get("recipe")


SCENE_ON = "这场戏还没收场"
OPENING_ON = "开场戏还没演完：先把这一场演完"
# The protagonist died of old age and the heir is still to be chosen (item 49: legacy.cjs).
LEGACY_HELD = json.loads(
    (ROOT / "content/life/legacy.json").read_text(encoding="utf-8"))["held"]


def calendar_entry(row):
    """A calendar entry as the engine gives it (apps/engine/life/calendar.cjs: the date as
    { text, year, month, day }, the days left, whose it is) in the contract's words."""
    return M.CalendarEntry(
        date=str((row.get("date") or {}).get("text") or ""),
        title=str(row.get("title") or ""),
        place=row.get("place") or None,
        days=int(row.get("days") or 0),
        kind=row.get("kind") or None,
    )


def play_view(save, progress):
    """The cultivation life's part of the state view, for a save in it (life.life_of), else None:
    the day, age and lifespan, the place (its kind, aura, danger in words and venues) and the
    nearest places to set out for, the clocks, the nearest calendar entries, the standing verbs
    (with 采集 and 狩猎 where the place allows them), the next gate in brief, the fight under way,
    the secret realm the player is in, 丹毒 and the pills, the leads, the ledger, the heart knots,
    the things to do next (接下来), the home and the arrays where the player is as the engine's
    progress mode read them (progress["life"]), and the scene under way (frxPlay.scene)."""
    play = life_of(save)
    if play is None:
        return None
    life = (progress or {}).get("life") or {}
    date = life.get("date") if isinstance(life.get("date"), dict) else None

    def whole_number(value):
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    def rows(key):
        return [row for row in life.get(key) or [] if isinstance(row, dict)]

    scene = play.get("scene") if isinstance(play.get("scene"), dict) else None
    place = life.get("place") if isinstance(life.get("place"), dict) else None
    mind = life.get("mind") if isinstance(life.get("mind"), dict) else None
    # the engine lists every verb, 采集 and 狩猎 where the place allows them (rewards.listed)
    verbs = rows("verbs")
    legacy = life.get("legacy") if isinstance(life.get("legacy"), dict) else None
    choosing = (legacy or {}).get("state") == "choosing"
    held = SCENE_ON if scene else OPENING_ON if play.get("opening") else \
        LEGACY_HELD if choosing else None
    if held:
        # No standing verb while a scene is on, before a new save's opening scene is played, nor
        # while the heir is to be chosen (the server refuses one with these words).
        verbs = [{**{k: v for k, v in row.items() if k != "main"}, "off": True,
                  "note": held} for row in verbs]
    return M.PlayView(
        date=M.PlayDate.model_validate(date) if date else None,
        age=whole_number(life.get("age")),
        lifespan=whole_number(life.get("lifespan")),
        mind=M.PlayMind.model_validate(mind) if mind else None,
        place=M.PlayPlace.model_validate(place) if place else None,
        near=[M.PlayNear.model_validate(row) for row in rows("near")] if "near" in life else None,
        scene=M.PlayScene(title=str(scene.get("title") or ""), beats=int(scene.get("beats") or 0))
        if scene else None,
        verbs=[M.PlayVerb.model_validate(
            {key: row[key] for key in ("kind", "glyph", "label", "main", "off", "note", "options")
             if row.get(key) not in (None, False, "")}) for row in verbs
            # a verb the contract does not name yet is left out rather than failing the view
            if row.get("kind") in get_args(M.VerbKind)],
        clocks=[M.PlayClock.model_validate(
            {key: row[key] for key in ("id", "name", "size", "value", "note")})
            for row in rows("clocks")],
        calendar=[calendar_entry(row) for row in rows("calendar")],
        gate=M.PlayGate.model_validate(life["gate"]) if isinstance(life.get("gate"), dict)
        else None,
        fight=fight_view(life["fight"]) if isinstance(life.get("fight"), dict) else None,
        realm=M.PlayRealm.model_validate(life["realm"]) if isinstance(life.get("realm"), dict)
        else None,
        toxin=M.PlayToxin.model_validate(life["toxin"]) if isinstance(life.get("toxin"), dict)
        else None,
        pills=[M.PlayPill.model_validate(row) for row in rows("pills")] if "pills" in life
        else None,
        gear=gear_view(life.get("gear")),
        # the storyline's open questions (item 26), the ledger and the heart knots (item 40)
        leads=[M.PlayLead.model_validate(row) for row in rows("leads")] if "leads" in life
        else None,
        karma=[M.PlayKarma.model_validate(row) for row in rows("karma")] if "karma" in life
        else None,
        knots=[M.PlayKnot.model_validate(row) for row in rows("knots")] if "knots" in life
        else None,
        # the story threads the scenes left open (batch 9: the engine's threads.view)
        threads=[M.PlayThread.model_validate(row) for row in rows("threads")]
        if "threads" in life else None,
        # the book: the volume under way and the last 回 (item 38)
        book=M.PlayBook.model_validate(life["book"]) if isinstance(life.get("book"), dict)
        else None,
        # the player's sect (item 46), none for a loose cultivator
        sect=M.PlaySect.model_validate(life["sect"]) if isinstance(life.get("sect"), dict)
        else None,
        # the ways into a sect for a loose cultivator (item 46's panel)
        joining=M.PlayJoining.model_validate(life["joining"])
        if isinstance(life.get("joining"), dict) else None,
        # 接下来: what to do now, once nothing holds the verbs (the engine's hints.cjs)
        next=[M.PlayHint.model_validate(row) for row in rows("next")]
        if "next" in life and not held else None,
        # the home (item 45) and the arrays here (item 43): the engine's home.view and arrays.view
        home=M.PlayHome.model_validate(life["home"]) if isinstance(life.get("home"), dict)
        else None,
        arrays=M.PlayArrays.model_validate(life["arrays"]) if isinstance(life.get("arrays"), dict)
        else None,
        # the spirit beasts (item 41): the engine's beasts.view, with the days of binding left
        beasts=beasts_view(life["beasts"], play) if isinstance(life.get("beasts"), dict)
        else None,
        # the lifespan's last years and its end (item 49: legacy.cjs)
        legacy=M.PlayLegacy.model_validate(legacy) if legacy else None,
    )


def beasts_view(beasts, play):
    """The spirit beasts as the engine's progress mode reads them (beasts.view), for the panel:
    each beast's days of binding left (beasts.json bind.days less frxPlay.beasts' binding, while
    not bound), its feeds of the month (used of feed.perMonth), the days a hurt takes to heal,
    whether it heeds orders; and the eggs with their days left."""
    records = (play or {}).get("beasts") if isinstance((play or {}).get("beasts"), dict) else {}
    month = BEAST_RULES["feed"]["perMonth"]
    shown = []
    for beast in beasts.get("list") or []:
        if not isinstance(beast, dict):
            continue
        record = records.get(beast.get("id")) or {}
        bound = bool(beast.get("bound"))
        left = (beast.get("feeds") or {}).get("left")
        shown.append({
            **{key: beast[key] for key in ("id", "name", "species", "level", "tier",
                                           "temperament", "act", "aptitude", "hp", "mp",
                                           "favour", "use") if beast.get(key) is not None},
            "heeds": bool(beast.get("obeys")),
            "bound": bound,
            **({} if bound else {"bindDays": max(0, BEAST_RULES["bind"]["days"]
                                                 - int(record.get("binding") or 0))}),
            "feeds": {"used": max(0, month - int(left if left is not None else month)),
                      "of": month},
            "out": bool(beast.get("out")),
            **({"hurtDays": int(beast["injury"]["days"])}
               if isinstance(beast.get("injury"), dict) else {}),
            "foods": [{"itemId": food.get("itemId"), **{key: food[key] for key in (
                "name", "tier", "factor", "same", "low", "high", "crit") if key in food}}
                for food in beast.get("foods") or [] if isinstance(food, dict)],
        })
    return M.PlayBeasts.model_validate({
        "kept": int(beasts.get("kept") or 0), "cap": int(beasts.get("cap") or 0),
        **({"out": beasts["out"]} if beasts.get("out") else {}),
        "beasts": shown,
        "eggs": [{key: egg[key] for key in ("id", "name", "tier", "days") if key in egg}
                 for egg in beasts.get("eggs") or [] if isinstance(egg, dict)],
    })


def gear_view(gear):
    """The gear as the engine's progress mode reads it (gear.view, items 33 and 34), or None: a
    piece the contract cannot take leaves the panel without the gear's marks rather than failing
    the state view."""
    if not isinstance(gear, dict):
        return None
    try:
        return M.PlayGear.model_validate(gear)
    except ValidationError as error:
        logger.warning("life_gear_view_skipped errors=%s", str(error)[:300])
        return None



def fight_view(fight):
    """The fight under way (item 20) as the engine's progress mode reads it, each thing at the
    belt with the icon its name and type give it (play_art.icon_of)."""
    belt = [{"itemId": str(thing.get("itemId") or ""), "name": str(thing.get("name") or ""),
             "icon": art.icon_of(str(thing.get("name") or ""), str(thing.get("type") or "")),
             "quantity": int(thing.get("quantity") or 0)}
            for thing in fight.get("belt") or [] if isinstance(thing, dict)]
    beast, tame = fight.get("beast"), fight.get("tame")
    return M.PlayFight.model_validate({
        **{key: fight[key] for key in ("round", "foes", "commands", "skills", "arrays")
           if key in fight},
        "belt": belt,
        # the spirit beast out beside the player and 驯 on offer (item 41)
        **({"beast": {**{key: beast[key] for key in ("id", "name", "hp", "temperament", "act",
                                                       "orders") if beast.get(key) is not None},
                      "heeds": bool(beast.get("obeys"))}} if isinstance(beast, dict) else {}),
        **({"tame": {key: tame[key] for key in ("foeId", "name", "glyph", "note", "odds", "off")
                     if tame.get(key) is not None}} if isinstance(tame, dict) else {}),
    })


def state_view(save, art_value, progress=None, looks=None):
    """The whole state view. art_value holds a recipe for everyone in save.everyone();
    progress is the engine's progress-mode result (cultivation and storyline marks, and the
    life's day for a save in the cultivation life) or None; looks are the looks the save's
    places keep (scene_view)."""
    progress = progress or {}
    tables = save.sheet.tables
    present = save.present()
    gear = (progress.get("life") or {}).get("gear") if life_of(save) else None
    return M.StateView(
        version=save.version,
        turn_no=save.turns(),
        player=player_view(save, recipe_of(art_value, "B1"), progress.get("cultivation"), gear),
        equipment=equipment_view(save.player),
        bag=bag_view(tables),
        skills=[skill_view(key, row) for key, row in rows_of(js_get(tables, "8"))],
        beasts=[beast_view(key, row) for key, row in rows_of(js_get(tables, "7"))],
        quests=[quest_view(key, row) for key, row in rows_of(js_get(tables, "6"))],
        mainline=mainline_view(save.plot(), progress.get("plot"), story=life_of(save) is not None),
        people=[
            character_view(key, data, recipe_of(art_value, key), True)
            for key, data in present.items()
        ],
        place=save.location.place(),
        time=save.location.moment.clock(),
        scene=scene_view(save, looks),
        in_combat=to_text(js_get(js_get(js_get(tables, "0"), "B1"), "31")).strip() == "true",
        play=play_view(save, progress),
    )


def change_basis(save):
    """What a turn's changes compare (play_turns.changes_between) of the state view, from the save
    alone, as state_view has them: the player's 气血, 法力, 修为, realm and stones, the place, the
    time and the bag. None of them reads the engine's progress, the art or the places' looks, so
    the state before a turn needs no engine call (batch 4's latency work)."""
    data = save.player
    stats = js_or(data.get("detailedAttributes"), {})
    progress = parse_int(data.get("progress"))
    stones = parse_int(data.get("spiritStones"))
    return {
        "player": {
            "hp": gauge(js_get(stats, "血量")).wire(), "mp": gauge(js_get(stats, "法力")).wire(),
            "xp": M.Gauge(current=progress if isinstance(progress, int) else 0, max=100).wire(),
            "realm": text_of(data.get("realm")) or "未知",
            "stones": stones if isinstance(stones, int) and stones > 0 else 0,
        },
        "place": save.location.place().wire(),
        "time": save.location.moment.clock().wire(),
        "bag": [item.wire() for item in bag_view(save.sheet.tables)],
    }


# ---------------------------------------------------------------- the save list


def summary_fields(save):
    """What the save list shows of a save, kept in its play_art record by version so that the
    list never has to read whole saves again."""
    clock = save.location.moment.clock()
    logs = save.data.get("logs") if isinstance(save.data.get("logs"), list) else []
    last_log = logs[-1] if logs and isinstance(logs[-1], dict) else {}
    last_reply = next(
        (log for log in reversed(logs) if isinstance(log, dict) and log.get("type") == "ai"), None
    )
    realm = text_of(save.player.get("realm")) or "未知"
    return {
        "version": save.version,
        "name": save.name,
        "player": {
            "name": art.plain_name(save.player.get("name")) or "无名氏",
            "realm": realm,
            "realmGlyph": realm_glyph(realm),
        },
        "place": save.location.text,
        "date": clock.date,
        "hourName": clock.hour_name,
        "turns": save.turns(),
        "lastPlayedAt": str(last_log.get("timestamp") or ""),
        "waiting": bool(last_reply and last_reply.get("frxPending")),
        # the save list's 修仙人生 tag; a save of the novel has no `play`
        **({"play": "life"} if life_of(save) is not None else {}),
    }


def save_summary(archive_id, art_value, busy):
    summary = art_value["summary"]
    return M.SaveSummary(
        id=archive_id,
        name=summary["name"],
        version=summary["version"],
        player=M.SavePlayer(
            **summary["player"], portrait=M.Recipe.model_validate(recipe_of(art_value, "B1"))
        ),
        place=summary["place"],
        date=summary["date"],
        hour_name=summary["hourName"],
        turns=summary["turns"],
        last_played_at=summary["lastPlayedAt"],
        pending=summary["waiting"] or busy,
        play=summary.get("play"),
    )
