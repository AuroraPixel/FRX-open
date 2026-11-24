"""How the old page reads the state tables: a faithful port of its script, js/app.js (435bfa8).

The state view must show the numbers the old page shows, so this module ports the page's own
readers line by line: parseRemarksString (app.js 9895), parseNestedJsonString (10694),
storedItemIds and itemStackCount (12399), syncStateFromTables (12425) and
calculateTotalAttributes (46699). It keeps JavaScript's semantics where the data can reach
them: `||` falls through on 0, "" and NaN; `+` joins strings; Math.round rounds halves up;
\\s, \\d and trim() mean what they mean in a browser. tests/fixtures/parity/state/ holds what
the old page rendered for six saves, and the tests compare every total with it.

Known quirk kept on purpose (app.js 46735): an equipped 功法 is read from its currentEffect, but
only after a check on its effect, so a 功法 that has a currentEffect and no effect adds nothing.

Where the page would throw (a status or an effect that is a number, a trait that is null) this
port reads the value as text or skips it instead; those saves show no totals on the old page.
"""

import json
import math
import re

UNDEFINED = type(
    "Undefined", (), {"__repr__": lambda self: "undefined", "__bool__": lambda self: False}
)()
NAN = float("nan")

# JavaScript's WhiteSpace and LineTerminator characters: what \s matches and trim() removes.
JS_SPACE = "\t\n\v\f\r   " + "".join(map(chr, range(0x2000, 0x200B))) + ("    　﻿")
_WS = "[" + re.escape(JS_SPACE) + "]"
_DOT = "[^\n\r  ]"  # JavaScript's `.` stops at every line terminator

ATTRIBUTE_KEYS = (
    "血量",
    "物攻",
    "物防",
    "脚力",
    "法攻",
    "法防",
    "法力",
    "神识",
    "物理穿透",
    "法术穿透",
    "气运",
    "魅力",
)
SLOTS = ("weapon", "armor", "technique", "treasure")
TIME_ROW_ID = "TIME_LOCATION_ROW"

_EFFECT = re.compile("([一-龥]+)" + _WS + "*([+-])" + _WS + "*([0-9]+\\.?[0-9]*)(%?)")
_BUFF = re.compile("[①-⑳][^:(]+:?" + _DOT + "*?\\(([^)]*)\\)")
_SPREAD = re.compile(r"^0:[\s\S]\|1:")
_HEAD = re.compile("^([0-9]+):")
_COORDS = re.compile("(-?[0-9]+),(-?[0-9]+)")


# ---------------------------------------------------------------- JavaScript values


def js_trim(text):
    return text.strip(JS_SPACE)


def truthy(value):
    if value is UNDEFINED or value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == value and value != 0
    if isinstance(value, str):
        return value != ""
    return True


def js_or(*values):
    for value in values[:-1]:
        if truthy(value):
            return value
    return values[-1]


def is_object(value):
    """typeof value === 'object' && value !== null."""
    return isinstance(value, (dict, list))


def js_get(value, key):
    """value[key] for the shapes JSON gives (a missing key, or a key of a non-object, is
    undefined; a string's characters and an array's elements are reached by index)."""
    if isinstance(value, dict):
        return value.get(key, UNDEFINED)
    if isinstance(value, (list, str)) and isinstance(key, str) and key.isdigit():
        index = int(key)
        return value[index] if index < len(value) else UNDEFINED
    return UNDEFINED


def js_values(value):
    """Object.values for what JSON gives."""
    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, (list, str)):
        return list(value)
    return []


def number_text(number):
    """Number.prototype.toString for a double."""
    if number != number:
        return "NaN"
    if number in (math.inf, -math.inf):
        return "Infinity" if number > 0 else "-Infinity"
    if number == int(number) and abs(number) < 1e21:
        return str(int(number))
    sign = "-" if number < 0 else ""
    mantissa, _, exponent = repr(abs(float(number))).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = (whole + fraction).lstrip("0")
    point = (
        len(whole)
        + int(exponent or 0)
        - (len(whole + fraction) - len((whole + fraction).lstrip("0")))
    )
    digits = digits.rstrip("0") or "0"
    k, n = len(digits), point
    if k <= n <= 21:
        text = digits + "0" * (n - k)
    elif 0 < n <= 21:
        text = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        text = "0." + "0" * -n + digits
    else:
        e = n - 1
        text = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-")
        text += str(abs(e))
    return sign + text


def to_text(value):
    """ToString."""
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "null"
    if value is True or value is False:
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return number_text(float(value)) if isinstance(value, float) else str(value)
    if isinstance(value, list):
        return ",".join(
            "" if item is None or item is UNDEFINED else to_text(item) for item in value
        )
    return "[object Object]"


_NUMERIC = re.compile(r"^[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$")


def to_number(value):
    """ToNumber."""
    if value is UNDEFINED:
        return NAN
    if value is None:
        return 0.0
    if value is True or value is False:
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, (list, dict)):
        return to_number(to_text(value))
    text = js_trim(value)
    if not text:
        return 0.0
    if _NUMERIC.match(text):
        return float(text.replace("Infinity", "inf"))
    for prefix, base in (("0x", 16), ("0o", 8), ("0b", 2)):
        if text[:2].lower() == prefix:
            try:
                return float(int(text[2:], base))
            except ValueError:
                return NAN
    return NAN


def js_add(left, right):
    """The + operator."""
    left = to_text(left) if isinstance(left, (list, dict)) else left
    right = to_text(right) if isinstance(right, (list, dict)) else right
    if isinstance(left, str) or isinstance(right, str):
        return to_text(left) + to_text(right)
    return to_number(left) + to_number(right)


def js_round(value):
    """Math.round: halves go up. NaN and the infinities stay as they are."""
    number = to_number(value)
    if number != number or number in (math.inf, -math.inf):
        return number
    floor = math.floor(number)
    return floor + 1 if number - floor >= 0.5 else floor


def js_floor(number):
    return number if number != number or number in (math.inf, -math.inf) else math.floor(number)


def parse_int(value):
    """parseInt(value, 10): leading digits after an optional sign, NaN when there are none."""
    match = re.match(r"[+-]?[0-9]+", to_text(value).lstrip(JS_SPACE))
    return int(match.group(0)) if match else NAN


def _json(text):
    def refuse(constant):
        raise ValueError(constant)

    def integer(digits):
        number = int(digits)
        return number if abs(number) <= 2**53 else float(number)

    return json.loads(text, parse_constant=refuse, parse_int=integer)


# ---------------------------------------------------------------- the page's readers


def parse_nested_json(value, fallback):
    """parseNestedJsonString (app.js 10694)."""

    def default():
        return list(fallback) if isinstance(fallback, list) else fallback

    if not isinstance(value, str) or not value:
        return value if is_object(value) else default()
    current = value
    for _ in range(3):
        if not isinstance(current, str):
            return current
        text = js_trim(current)
        try:
            current = _json(text)
            continue
        except ValueError:
            pass
        if len(text) > 1 and text[0] == text[-1] and text[0] in "\"'":
            text = text[1:-1]
        try:
            current = _json(text.replace("'", '"'))
            continue
        except ValueError:
            pass
        break
    return current if is_object(current) else default()


def parse_remark_fields(text):
    """parseRemarkFields (app.js 9919)."""
    fields = {}
    for part in text.split("|"):
        colon = part.find(":")
        if colon > -1:
            key = js_trim(part[:colon])
            if key:
                fields[key] = js_trim(part[colon + 1 :])
    return fields


def parse_remarks(value):
    """parseRemarksString (app.js 9895)."""
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        return {str(index): item for index, item in enumerate(value)}
    text = to_text(value) if truthy(value) else ""
    if _SPREAD.match(text):
        # An older merge spread a remarks string into one key per character ("0:灵|1:根|…").
        chars, cursor = [], 0
        while cursor < len(text):
            head = _HEAD.match(text[cursor:])
            if (
                not head
                or int(head.group(1)) != len(chars)
                or cursor + len(head.group(0)) >= len(text)
            ):
                break
            chars.append(text[cursor + len(head.group(0))])
            cursor += len(head.group(0)) + 1
            if text[cursor : cursor + 1] == "|":
                cursor += 1
        if len(chars) >= 3:
            return {**parse_remark_fields("".join(chars)), **parse_remark_fields(text[cursor:])}
    return parse_remark_fields(text)


def item_stack_count(value):
    """itemStackCount (app.js 12418): a row's quantity, NaN when it is not a whole number."""
    if value is UNDEFINED:
        return 1
    if isinstance(value, bool) or not (
        isinstance(value, (int, float))
        or (isinstance(value, str) and re.fullmatch("[0-9]+", js_trim(value)))
    ):
        return NAN
    count = to_number(value)
    if math.isfinite(count) and count == int(count) and 0 <= count <= 2**53 - 1:
        return int(count)
    return NAN


def equipped_item_rows(row):
    """equippedItemRows (app.js 12394)."""
    remarks = parse_remarks(js_get(row, "9"))
    slots = js_or(parse_nested_json(remarks.get("equipment", UNDEFINED), {}), {})
    items = []
    for slot in js_values(slots):
        items.extend(slot if isinstance(slot, list) else [slot])
    return [item for item in items if truthy(item)]


def _item_id(item):
    return js_or(js_get(item, "id"), js_get(item, "0"))


def stored_item_ids(state, include_player_equipment=True):
    """storedItemIds (app.js 12399): items held in someone's inventory, warehouse or gear."""
    ids = set()

    def remember(item):
        identity = _item_id(item)
        if truthy(identity) and not isinstance(identity, (dict, list)):
            ids.add(identity)

    for row in js_values(js_get(state, "0")):
        if not truthy(row):
            continue
        remarks = parse_remarks(js_get(row, "9"))
        for key in ("inventory", "warehouse"):
            items = parse_nested_json(remarks.get(key, UNDEFINED), [])
            if isinstance(items, list):
                for item in items:
                    remember(item)
        if js_get(row, "0") == "B1" and not include_player_equipment:
            continue
        for item in equipped_item_rows(row):
            remember(item)
    return ids


def time_row(state):
    rows = js_get(state, "4")
    rows = rows if isinstance(rows, list) else []
    found = next((row for row in rows if js_get(row, "id") == TIME_ROW_ID), None)
    return found if found is not None else (rows[0] if rows else None)


def _split(value, default):
    text = to_text(js_or(value, default))
    parts = text.split("|")
    return parts[0], parts[1] if len(parts) > 1 else UNDEFINED


def _equipment(remarks):
    equipment = {slot: [None] * 6 for slot in SLOTS}
    stored = parse_nested_json(remarks.get("equipment", UNDEFINED), {})
    for slot in SLOTS:
        held = js_get(stored, slot)
        if truthy(held):
            equipment[slot] = held if isinstance(held, list) else [held]
    return equipment


def character_data(row, key):
    """One row of table 0 as syncStateFromTables reads it (app.js 12464)."""
    name, gender = _split(js_get(row, "1"), "|")
    realm, identity = _split(js_get(row, "2"), "|")
    remarks = parse_remarks(js_get(row, "9"))
    action = to_text(js_or(js_get(row, "16"), "||||")).split("|")
    stats = parse_nested_json(js_get(row, "11"), {})
    hp = js_get(stats, "血量")
    hp_text = remarks.get("hp", UNDEFINED)
    if (not truthy(hp) or not is_object(hp)) and isinstance(hp_text, str) and "/" in hp_text:
        if isinstance(stats, dict):
            current, maximum = hp_text.split("/")[:2]
            # A copy: the save's own row must not change while it is being read.
            stats = {
                **stats,
                "血量": {
                    "current": js_or(parse_int(current), 0),
                    "max": js_or(parse_int(maximum), 100),
                },
            }
    location = action[2] if len(action) > 2 and action[2] else "未知"
    identity_of = js_get(row, "0")
    data = {
        "id": identity_of if isinstance(identity_of, str) and identity_of else key,
        "name": name,
        "gender": gender,
        "realm": js_trim(to_text(js_or(realm, ""))),
        "identity": js_trim(to_text(js_or(identity, ""))),
        "personality": js_get(row, "3"),
        "status": js_get(row, "4"),
        "linggen": js_or(js_get(row, "5"), "无"),
        "background": js_get(row, "10"),
        "detailedAttributes": stats,
        "motive": js_get(row, "12"),
        "rawRelations": js_get(row, "13"),
        "favorability": js_or(js_get(row, "15"), "0"),
        "action": action[0] if action[0] else "无",
        "attire": action[1] if len(action) > 1 and action[1] else "无",
        "location": location,
        "figure": action[3] if len(action) > 3 and action[3] else "未知",
        "appearance": action[4] if len(action) > 4 and action[4] else "未知",
        "age": js_or(remarks.get("年龄", UNDEFINED), "未知"),
        "shouyuan": js_or(remarks.get("寿元", UNDEFINED), "未知"),
        "spiritStones": js_get(row, "26"),
        "isBonded": remarks.get("isBonded") == "true",
        "deeds": js_or(remarks.get("deeds", UNDEFINED), ""),
        "inCombat": js_get(row, "31"),
        "npcTraits": parse_nested_json(remarks.get("traits", UNDEFINED), []),
        "remarks": remarks,
        **{str(column): js_get(row, str(column)) for column in (27, 28, 29, 35)},
        **_equipment(remarks),
    }
    match = _COORDS.search(location)
    data["coordinates"] = [int(match.group(1)), int(match.group(2))] if match else None
    return data


def player_data(row):
    """The player's row with the remarks syncStateFromTables adds for B1 (app.js 12583)."""
    data = character_data(row, "B1")
    remarks = data["remarks"]
    return {
        **data,
        "linggen": js_or(remarks.get("灵根", UNDEFINED), "无"),
        "shanE": js_or(remarks.get("善恶值", UNDEFINED), "0"),
        "progress": to_text(js_or(remarks.get("修为进度", UNDEFINED), "0%")).replace("%", "", 1),
        "hp": js_get(data["detailedAttributes"], "血量"),
        "playerTraits": parse_nested_json(remarks.get("traits", UNDEFINED), []),
        "isExtreme": remarks.get("isExtreme") == "true",
        "deathCount": parse_int(js_or(remarks.get("deathCount", UNDEFINED), "0")),
    }


def bag_rows(state):
    """The rows of table 1 the old page shows in the bag (syncStateFromTables 12606 and
    renderInventory 29816): not held by anyone, a positive count, not worn by the player."""
    held = stored_item_ids(state)
    worn = [_item_id(item) for item in equipped_item_rows(js_get(js_get(state, "0"), "B1"))]
    rows = []
    for row in js_values(js_get(state, "1")):
        if not truthy(row):
            continue
        identity = js_get(row, "0")
        count = item_stack_count(js_get(row, "5"))
        hashable = isinstance(identity, (str, int, float))
        if (
            (hashable and identity in held)
            or not (count == count and count > 0)
            or identity in worn
        ):
            continue
        rows.append(row)
    return rows


class Sheet:
    """The page's in-memory reading of a save: the player, the characters it lists around the
    player (the scene, then the bonded ones) and where the time row puts the player."""

    def __init__(self, archive_state):
        state = archive_state.get("currentState") if isinstance(archive_state, dict) else None
        self.tables = state if isinstance(state, dict) else {}
        rows = js_get(self.tables, "0")
        self.player = None
        self.scene = {}
        for key, row in rows.items() if isinstance(rows, dict) else enumerate(js_values(rows)):
            if not truthy(row) or not isinstance(row, dict):
                continue
            if js_get(row, "0") == "B1":
                self.player = player_data(row)
            else:
                data = character_data(row, str(key))
                self.scene[data["id"]] = data
        bonded = archive_state.get("bondedCharacters") if isinstance(archive_state, dict) else None
        bonded = bonded if isinstance(bonded, dict) else {}
        self.bonded = {
            key: {**value, **self.scene[key]} if key in self.scene else value
            for key, value in bonded.items()
            if isinstance(value, dict)
        }
        self.characters = {**self.scene, **self.bonded}
        row = time_row(self.tables)
        self.location_text = to_text(js_get(row, "0")) if truthy(js_get(row, "0")) else ""


# ---------------------------------------------------------------- calculateTotalAttributes


def total_attributes(character, is_player):
    """calculateTotalAttributes (app.js 46699) for one character.

    Returns {key: {current, max, bonus, sources, parts}} for the twelve keys, where the first
    four are what the page computes (numbers, NaN where the page gets NaN) and parts names
    every contribution: (source name, value) pairs for the state view's attribute sources.
    """
    base_attributes = js_or(character.get("detailedAttributes", UNDEFINED), {})
    totals = {}
    for key in ATTRIBUTE_KEYS:
        base_attribute = js_or(js_get(base_attributes, key), {"current": 0, "max": 0})
        base = js_or(js_get(base_attribute, "max"), 0)
        equipment, buffs, traits, sect = 0.0, 0.0, 0.0, 0.0
        parts = []
        if is_player:
            for slot in SLOTS:
                for item in js_or(character.get(slot, UNDEFINED), []):
                    gains = list(_equipment_gains(item, key, base))
                    for gain in gains:
                        equipment = js_add(equipment, gain)
                    if gains:
                        parts.append((_item_name(item), sum(gains)))
        status = js_or(character.get("status", UNDEFINED), "")
        if truthy(status) and status != "一切正常":
            for name, gain in _buff_gains(to_text(status), key):
                buffs = js_add(buffs, gain)
                parts.append((name, gain))
        trait_list = js_or(
            character.get("playerTraits", UNDEFINED), character.get("npcTraits", UNDEFINED), []
        )
        if isinstance(trait_list, list):
            for trait in trait_list:
                bonus = (
                    js_get(js_get(trait, "bonus"), key)
                    if truthy(js_get(trait, "bonus"))
                    else UNDEFINED
                )
                if truthy(bonus):
                    traits = js_add(traits, bonus)
                    parts.append((to_text(js_get(trait, "name")), to_number(bonus)))
        total = js_add(js_add(js_add(sect, equipment), buffs), traits)
        totals[key] = {
            "current": js_round(js_add(js_or(js_get(base_attribute, "current"), 0), total)),
            "max": js_round(js_add(js_or(js_get(base_attribute, "max"), 0), total)),
            "bonus": js_round(total),
            "sources": {
                "base": js_round(base),
                "traits": js_round(traits),
                "equipment": js_round(equipment),
                "sect": js_round(sect),
                "buffs": js_round(buffs),
            },
            "parts": parts,
        }
    return totals


def _item_name(item):
    return to_text(js_or(js_get(item, "name"), js_get(item, "1"), ""))


def _equipment_gains(item, key, base):
    """What each part of one worn item's effect adds to one attribute (app.js 46734)."""
    if not truthy(item) or not truthy(js_get(item, "effect")):
        return
    field = "currentEffect" if js_get(item, "type") == "功法" else "effect"
    effect = js_or(js_get(item, field), "")
    if not truthy(effect):
        return
    for part in re.split("[,，]", to_text(effect)):
        match = _EFFECT.search(js_trim(part))
        if not match or match.group(1) != key:
            continue
        value = float(match.group(3))
        signed = value if match.group(2) == "+" else -value
        yield js_floor(to_number(base) * (signed / 100)) if match.group(4) == "%" else signed


def _buff_gains(status, key):
    """The (buff name, value) pairs a status string gives one attribute (app.js 46761)."""
    pattern = re.compile("^" + re.escape(key) + _WS + "*([+-])" + _WS + "*([0-9]+)")
    for match in _BUFF.finditer(status):
        name = re.split("[:(]", match.group(0)[1:], maxsplit=1)[0]
        for segment in re.split("[,，|]", match.group(1)):
            found = pattern.match(js_trim(segment))
            if found:
                value = int(found.group(2))
                yield js_trim(name), value if found.group(1) == "+" else -value
