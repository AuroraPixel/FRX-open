"""What drives the pictures: portrait recipes, the scene of a place, weather, species and icons.

The keyword mappings live in content/art/ (changing them needs no code): portrait-rules.json,
scenes.json, species.json and item-icons.json. The portrait kit's manifest says which faces,
hair, bodies and traits each base has.

Recipes are stored in archive_portraits, owned by the save's archive_art row. The play_art
service operation projects those domain rows for the renderer. A character gets a recipe
the first time a save is read; it changes only when the player picks another one.
"""

import copy
import json
import re
from dataclasses import dataclass, replace
from functools import cache

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import play_places as places
from .domain import ROOT
from .play_errors import not_found
from .play_sheet import js_trim, parse_int
from .save_schema import Archive

ART = ROOT / "content/art"
ASSETS = ROOT / "apps/play-web/assets"
COLLECTION = "play_art"  # registered in card_store.SERVER_COLLECTIONS
REALM_ORDER = ("凡人", "炼气", "筑基", "结丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫")
# Hair tints the kit knows (kit.js TINTS and TINTS_LIGHT): which apply depends on the hair's paint.
TINTS = {"black": {"brown", "chestnut", "wine", "ink", "snow", "grey"}, "white": {"grey", "ash"}}


@cache
def _content(name):
    return json.loads((ART / name).read_text(encoding="utf-8"))


@cache
def _manifest(path):
    return json.loads((ASSETS / path).read_text(encoding="utf-8"))


def kit():
    """The portrait kit's manifest: bases by sex and age, each with its faces, hair, bodies
    (with the roles they suit) and trait parts."""
    return _manifest("portrait-kit/manifest.json")


# ---------------------------------------------------------------- the kit's random recipe

M32 = 0xFFFFFFFF


def _int32(value):
    value &= M32
    return value - 0x100000000 if value & 0x80000000 else value


def _imul(left, right):
    return _int32((left & M32) * (right & M32))


def _hash(seed):
    """kit.js hash(): FNV-1a over the UTF-16 code units of the seed."""
    value = 2166136261
    data = str(seed).encode("utf-16-le", "surrogatepass")
    for index in range(0, len(data), 2):
        value ^= data[index] | data[index + 1] << 8
        value = _imul(value, 16777619) & M32
    return value


def random_stream(seed):
    """kit.js rng(seed): the same numbers in the same order, so a recipe drawn here is the
    recipe the page's kit.random(seed, filter) draws."""
    state = _hash(seed)

    def draw():
        nonlocal state
        state = (state + 0x6D2B79F5) & M32
        t = _imul(state ^ (state >> 15), state | 1)
        t = _int32((t & M32) ^ ((t + _imul((t & M32) ^ ((t & M32) >> 7), (t & M32) | 61)) & M32))
        return (((t & M32) ^ ((t & M32) >> 14)) & M32) / 4294967296

    return draw


def _pick(draw, items):
    return items[int(draw() * len(items)) % len(items)]


def _weighted(draw, pairs):
    value = draw() * sum(weight for _, weight in pairs)
    for choice, weight in pairs:
        value -= weight
        if value <= 0:
            return choice
    return pairs[-1][0]


def _tints(base, hair):
    if hair.get("colour") == "white":
        return [(None, 8), ("grey", 2), ("ash", 1)]
    if base["age"] == "child":
        return [(None, 16), ("brown", 4)]
    if base["age"] == "mid":
        if base["sex"] == "m":
            return [(None, 14), ("brown", 3), ("ink", 2)]
        return [(None, 12), ("brown", 3), ("grey", 2), ("ink", 1)]
    if base["age"] == "old":
        return [(None, 6), ("snow", 2), ("grey", 2)]
    if base["sex"] == "m":
        return [(None, 14), ("brown", 4), ("ink", 2), ("snow", 1)]
    return [(None, 12), ("brown", 4), ("ink", 2), ("chestnut", 2), ("wine", 1), ("snow", 1)]


def _fits(base, sex, age, role):
    return (
        (not sex or base["sex"] == sex)
        and (not age or base["age"] == age)
        and (not role or any(role in body.get("roles", []) for body in base["bodies"]))
    )


def random_recipe(seed, sex=None, age=None, role=None):
    """kit.js PortraitKit.random(seed, {sex, age, role}); None when no base fits."""
    bases = kit()["bases"]
    keys = [key for key, base in bases.items() if _fits(base, sex, age, role)]
    if not keys:
        return None
    draw = random_stream(seed)
    key = _pick(draw, keys)
    base = bases[key]
    bodies = [b for b in base["bodies"] if role in b.get("roles", [])] if role else base["bodies"]
    hair = _pick(draw, base["hair"])
    tint = _weighted(draw, _tints(base, hair))
    tilt = _pick(draw, [-3, -2, 2, 3] if hair.get("layer") == "split" else [-4, -3, -2, 2, 3, 4])
    recipe = {"base": key, "face": _pick(draw, base["faces"])["id"], "hair": hair["id"]}
    if tint:
        recipe["tint"] = tint
    recipe["body"] = _pick(draw, bodies)["id"]
    recipe["tilt"] = tilt
    return recipe


# ---------------------------------------------------------------- who a character looks like


def _words_in(text, words):
    return any(word and word in text for word in words)


def _realm_rank(text):
    for rank, name in enumerate(REALM_ORDER):
        if name in text or (name == "结丹" and "金丹" in text):
            return rank
    return None


def _age_from_rules(text, realm):
    for rule in _content("portrait-rules.json").get("age", []):
        when = rule.get("when") or {}
        if when.get("anyWord") and not _words_in(text, when["anyWord"]):
            continue
        floor = when.get("realmAtLeast")
        if floor:
            rank, needed = _realm_rank(realm), _realm_rank(floor)
            if rank is None or needed is None or rank < needed:
                continue
        if when.get("anyWord") or floor:
            return rule["age"]
    return None


def _age_from_years(years):
    """A mortal-scale age (a cultivator past a hundred keeps whatever looks they kept)."""
    if not isinstance(years, int) or years < 0 or years > 100:
        return None
    return "child" if years <= 12 else "young" if years <= 30 else "mid" if years <= 55 else "old"


def look_of(character):
    """Sex, age, role and trait kinds a character's own words decide; None where they do not."""
    text = " ".join(
        str(character.get(field) or "")
        for field in ("name", "realm", "identity", "background", "attire", "figure", "appearance")
    )
    gender = str(character.get("gender") or "")
    sex = "m" if gender.startswith("男") else "f" if gender.startswith("女") else None
    rules = _content("portrait-rules.json")
    age = _age_from_rules(text, str(character.get("realm") or ""))
    if age is None:
        age = _age_from_years(parse_int(character.get("age")) if character.get("age") else None)
    # The role is what the person does: the realm (凡人 for every mortal) is no calling.
    calling = " ".join(
        str(character.get(field) or "")
        for field in ("name", "identity", "background", "attire", "figure", "appearance")
    )
    role = next((r["role"] for r in rules.get("role", []) if _words_in(calling, r["anyWord"])),
                None)
    kinds = []
    for rule in rules.get("race", []):
        if _words_in(text, rule["anyWord"]):
            kinds += [kind for kind in rule["trait"] if kind not in kinds]
    return sex, age, role, kinds


def recipe_for(seed, character):
    """A new recipe: the character's words decide what they can, the seed decides the rest."""
    sex, age, role, kinds = look_of(character)
    if age is None:
        weights = _content("portrait-rules.json").get("ageDefault") or {"young": 1}
        age = _weighted(random_stream(seed + "#age"), list(weights.items()))
    if sex is None:
        sex = _pick(random_stream(seed + "#sex"), ["m", "f"])
    for wanted in ((sex, age, role), (sex, age, None), (sex, None, None), (None, None, None)):
        recipe = random_recipe(seed, *wanted)
        if recipe:
            break
    have = [t["kind"] for t in kit()["bases"][recipe["base"]].get("traits", [])]
    trait = [kind for kind in kinds if kind in have]
    if trait:
        recipe["trait"] = trait
    return recipe


def check_recipe(recipe):
    """The problem with a recipe the player picked, or None when the kit can draw it."""
    base = kit()["bases"].get(recipe.get("base"))
    if not base:
        return "部件库里没有这个底模"
    hair = next((h for h in base["hair"] if h["id"] == recipe.get("hair")), None)
    if not hair:
        return "这个底模没有这种发型"
    if not any(f["id"] == recipe.get("face") for f in base["faces"]):
        return "这个底模没有这张脸"
    if not any(b["id"] == recipe.get("body") for b in base["bodies"]):
        return "这个底模没有这套身体"
    if recipe.get("tint") and recipe["tint"] not in TINTS.get(hair.get("colour"), set()):
        return "这种发型不能染这个颜色"
    kinds = {t["kind"] for t in base.get("traits", [])}
    if any(kind not in kinds for kind in recipe.get("trait") or []):
        return "这个底模没有这种特征"
    return None


# ---------------------------------------------------------------- the play_art record


class ArtStore:
    """One save's play_art record: portraits by character id and the save summary the list
    shows. Read and written through the user's CardStore, never mixed into the save."""

    def __init__(self, records, archive_id):
        self.records = records
        self.archive_id = archive_id

    def load(self):
        with self.records.sessions() as session:
            row = self.records.record(session, COLLECTION, self.archive_id)
            return copy.deepcopy(row.value) if row and isinstance(row.value, dict) else self.empty()

    def empty(self):
        return {"archiveId": self.archive_id, "portraits": {}}

    def update(self, change):
        """Apply change(value) and store the result; returns the stored value. Two first reads at
        once both try to create the row: the loser reads the winner's row and applies again."""
        for attempt in range(2):
            try:
                with self.records.sessions.begin() as session:
                    self.records.lock(session)
                    owner = session.scalar(select(Archive.archive_id).where(
                        Archive.user_id == self.records.user_id,
                        Archive.archive_id == self.archive_id, Archive.deleted.is_(False),
                    ))
                    if owner is None:
                        raise not_found()
                    row = self.records.record(session, COLLECTION, self.archive_id, lock=True)
                    value = (
                        copy.deepcopy(row.value)
                        if row and isinstance(row.value, dict)
                        else self.empty()
                    )
                    if not change(value):
                        return value
                    if row:
                        row.value = value
                        row.version += 1
                    else:
                        session.add(self.records.new_record(COLLECTION, self.archive_id, value))
                    return value
            except IntegrityError:
                if attempt:
                    raise


def _who(character):
    """What tells one person from another behind a reused id: the name, and the start of the
    background the people table keeps for them."""
    background = re.sub(r"<[^>]*>|\s", "", str(character.get("background") or ""))
    return {"name": plain_name(character.get("name")), "background": background[:24]}


def same_name(old, new):
    """Whether two names are one person's: the same, or one grown out of or trimmed from the
    other (青年散修 → 冷眼旁观的青年散修)."""
    return bool(old) and bool(new) and (old in new or new in old)


def _same_person(held, who):
    """Whether the person an id names now is the one its recipe was made for. Recipes kept
    before names were (and the player's) belong to whoever has the id; a name that grew or was
    trimmed (青年散修 → 冷眼旁观的青年散修) or a new name over the same background is a rename."""
    old, new = held.get("name"), who["name"]
    if old is None or not new or old in new or new in old:
        return True
    return bool(held.get("background")) and held["background"] == who["background"]


def named_recipe(value, name):
    """The recipe kept for a person by name: the one an id named before it went to someone else
    (portraitsByName), or anyone kept under that name; None when there is none."""
    kept = (value.get("portraitsByName") or {}).get(name) or {}
    if kept.get("recipe"):
        return kept["recipe"]
    return next(
        (entry["recipe"] for entry in (value.get("portraits") or {}).values()
         if entry.get("name") == name and entry.get("recipe")),
        None,
    )


def fill_portraits(value, archive_id, characters):
    """Give every listed character a recipe of their own; True when any was added or changed.

    Recipes are kept by character id, with the name (and background) they were made for: the
    model reuses ids for other people (item 33's playtest: one old man's face on four people).
    When an id names someone else, the earlier person's recipe is kept under their name for
    their return under another id (portraitsByName), and the newcomer gets their own: the one
    of the same name when they were seen before (under any id), else a new one."""
    portraits = value.setdefault("portraits", {})
    by_name = value.setdefault("portraitsByName", {})
    changed = False
    for char_id, character in characters.items():
        who = _who(character)
        held = portraits.get(char_id)
        if held is not None and _same_person(held, who):
            if who["name"] and (held.get("name"), held.get("background")) != (
                who["name"], who["background"]
            ):
                held.update(who)
                changed = True
            continue
        if held is not None:
            by_name.setdefault(held["name"], {k: v for k, v in held.items()
                                              if k not in {"name", "background"}})
        # Someone seen before, under another id: the same face.
        kept = by_name.get(who["name"]) if who["name"] else None
        if kept is None and who["name"]:
            kept = next((entry for key, entry in portraits.items()
                         if key != char_id and entry.get("name") == who["name"]), None)
        if kept:
            portraits[char_id] = {**{k: copy.deepcopy(v) for k, v in kept.items()
                                     if k not in {"name", "background"}}, **who}
        else:
            seed = archive_id + ":" + char_id + ("" if held is None else ":" + who["name"])
            portraits[char_id] = {"recipe": recipe_for(seed, character), **who}
        changed = True
    return changed


# ---------------------------------------------------------------- places and scenes


def scene_names():
    return _content("scenes.json")["scenes"]


def _rule_scene(fields):
    for rule in _content("scenes.json")["rules"]:
        text = fields.get(rule.get("field", "name")) or ""
        if _words_in(text, rule["anyWord"]):
            return rule["sceneId"]
    return None


def poi_scene(poi):
    """The scene type of a map place, by the rules on its name and description."""
    return (
        _rule_scene({"name": poi.get("name") or "", "description": poi.get("description") or ""})
        or (_content("scenes.json")["fallback"])
    )


def pois_of(world_map):
    pois = (world_map or {}).get("points_of_interest") if isinstance(world_map, dict) else None
    return [p for p in pois or [] if isinstance(p, dict) and isinstance(p.get("name"), str)]


def named_poi(world_map, spot):
    """The map place a spot names: the place itself, or the longest place name inside it
    (「听澜院传功堂」 is in 听澜院)."""
    if not spot:
        return None
    pois = pois_of(world_map)
    exact = next((p for p in pois if p["name"] == spot), None)
    inside = [p for p in pois if p["name"] and p["name"] in spot]
    return exact or (max(inside, key=lambda p: len(p["name"])) if inside else None)


def nearest_poi(world_map, xy, reach=15):
    """The map place nearest to the coordinates, within `reach` map units (10 km each)."""
    if not xy:
        return None
    near = [
        ((p["x"] - xy[0]) ** 2 + (p["y"] - xy[1]) ** 2, p)
        for p in pois_of(world_map)
        if isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float))
    ]
    if not near:
        return None
    distance, poi = min(near, key=lambda pair: pair[0])
    return poi if distance <= reach**2 else None


def _last_clue(text, groups):
    """Which group of words the narration mentions last, or None."""
    best, where = None, -1
    for name, words in groups.items():
        for word in words:
            at = text.rfind(word)
            if at >= 0 and at + len(word) > where:
                best, where = name, at + len(word)
    return best


def drawn(scene_id):
    return (ASSETS / "scenes" / scene_id / "scene.json").is_file()


def has_kit(kit):
    """Whether a kit of painted pieces is there (assets/scenes/<kit>/kit.json)."""
    return (ASSETS / "scenes" / kit / "kit.json").is_file()


@cache
def kit_family(kit):
    """The painted scene a kit's places fall back to when the page cannot compose them."""
    manifest = json.loads((ASSETS / "scenes" / kit / "kit.json").read_text(encoding="utf-8"))
    return manifest.get("family") or _content("scenes.json")["fallback"]


def own_name(world_map, spot):
    """The part of a spot that is its own name: what follows the map place it names
    (听澜院灵药园西厢柴房 → 灵药园西厢柴房), the whole spot when it names none, and nothing when
    the spot is the map place itself."""
    poi = named_poi(world_map, spot)
    if not poi:
        return spot or ""
    return spot[spot.rfind(poi["name"]) + len(poi["name"]):]


@cache
def _spot_word_pattern():
    words = {word for word, _, _ in places._lexicon()}
    return re.compile("|".join(re.escape(word) for word in sorted(words, key=len, reverse=True)))


def named_scene(spot):
    """The scene type the place rules choose by a spot's own name, read with the words that say
    what kind of spot it is blanked out (神手谷内堂门外 → 神手谷内··): what is left names the place
    it is in, so the 堂 of a hall or the 道 of a path does not make a sect's spot a town."""
    return _rule_scene({"name": _spot_word_pattern().sub("·", spot)}) if spot else None


def spot_scene(world_map, spot, xy):
    """The scene type of where the player is: the map place the spot names, else the rules on
    the spot's own name (named_scene), else the map place at its coordinates, else the rules on
    the whole name (a lone 「青云阁」), else the fallback."""
    poi = named_poi(world_map, spot)
    if poi:
        return poi_scene(poi)
    by_name = named_scene(spot)
    if by_name:
        return by_name
    poi = nearest_poi(world_map, xy)
    if poi:
        return poi_scene(poi)
    return (_rule_scene({"name": spot}) if spot else None) or _content("scenes.json")["fallback"]


def last_move(text):
    """("in" or "out", the words of the move) when the narration says the player went into a
    building or came out of one (the last such move), else (None, "")."""
    moves = _content("scenes.json")["moves"]
    best, words, where = None, "", -1
    for name in ("in", "out"):
        for found in re.finditer(moves[name], text or ""):
            if found.end() > where:
                best, words, where = name, found[0], found.end()
    return best, words



def _sentence_at(text, at):
    """The sentence of `text` around position `at`, and where `at` falls in it."""
    start = max(text.rfind(mark, 0, at) for mark in "。！？!?\n") + 1
    ends = [found for found in (text.find(mark, at) for mark in "。！？!?\n") if found >= 0]
    return text[start:min(ends) if ends else len(text)], at - start


def player_flies(narration, action="", subjects=("你", "我")):
    """Whether the sky the narration ends in is the player's (scenes.json "flight"): the player's
    own words for the turn say they fly, or the sentence of the narration's last sky word has the
    player fly in it (你催动法器，御剑飞行而去). Someone the player watches (你目送马师叔化作一道
    遁光) or anyone else (一道灰色遁光便自半空按下) is not the player up there."""
    rules = _content("scenes.json")["flight"]
    if action and re.search(rules["player"], action):
        return True
    text = narration or ""
    at = max((text.rfind(word) for word in _content("scenes.json")["skyWords"]), default=-1)
    if at < 0:
        return False
    sentence, _ = _sentence_at(text, at)
    # what someone says is no flight of the player's
    sentence = re.sub(r"“[^”]*”|「[^」]*」|\"[^\"]*\"", lambda m: "·" * len(m[0]), sentence)
    for found in re.finditer(rules["player"], sentence):
        before = sentence[: found.start()]
        clause = re.split(r"[，,、；;：:]", before)[-1]
        if (any(subject and subject in before for subject in subjects)
                and not re.search(rules["seeing"], clause) and not before.endswith("的")):
            return True
    return False


@dataclass(frozen=True)
class PlaceReading:
    """Where the player is, read from the spot and the turns spent there (read_place).

    `key` is the place's look's key: the place itself, and for a place whose name says nothing of
    inside or outside (a map place, a broad area) its inside apart (「…#inside」), each kept once.
    `title` is the name a plaque shows, `family` the scene type of the place it is or is near
    (content/art/scenes.json), `aspect` how the player is there (inside, outside, ground, sky,
    water), `flying` the player's own flight on arrival (shown as the sky, kept as nothing), and
    `rules` the look by the rules (play_places.Look)."""

    key: str
    title: str
    family: str
    aspect: str
    flying: bool
    rules: places.Look
    poi: dict | None
    composed_id: str
    # the name a room's own plaque shows (play_places.room_name): the house it is in, or its own
    room: str = ""
    # the name over the door of the building the spot is before or in the yard of
    # (play_places.house_name), or ""
    house: str = ""


def place_text(region, area, spot):
    return "/".join(part for part in (region, area, spot) if part) or "?"


def as_alias(world_map, reading, other):
    """The reading of a place the story now calls by another name (play_places.alias_of: 柴房
    for 后院柴房), composed as the place it first was: the same layout and the same plaque."""
    spot = places.spot_of(other)
    poi = named_poi(world_map, spot)
    own, title = own_name(world_map, spot), title_of(spot, poi)
    return replace(reading, composed_id=spot, room=room_of(spot, own, poi, title),
                   house=room_of(spot, own, poi, title, places.house_name))


def title_of(spot, poi):
    """The name a place's plaques show: the map place it names, else the start of the spot up to
    its first word for a kind of place when that is a name of its own (百草园南侧药田 → 百草园,
    黑虎寨聚义厅 → 黑虎寨), else the spot."""
    if poi:
        return poi["name"]
    found = places.tokens(spot)
    if found and found[0].start > 0:
        return spot[: found[0].end]
    return spot


def read_place(world_map, spot, xy, narration, earlier=(), action="", subjects=("你", "我"),
               region="", area=""):
    """Where the player is (PlaceReading). `earlier`: the narrations of the turns before this one
    spent at the same place, oldest first; `action`: the player's own words for the turn;
    `subjects`: what the narration calls the player (你, 我, their name).

    A spot whose own name says what it is decides on its own, every time the player is there,
    whatever the narration mentions (item 53's playtest: 西厢柴房 a hall one visit and the sect's
    gate the next): a building is inside, the ground it names is outside, 「…前」「…外」 before
    what it names, and the look is the name's (play_places.read_name). Where the name does not
    say (听澜院, 岩汀门, a broad 神手谷), inside or outside is decided on arriving, by the last clue
    in that turn's narration; while the player stays, only a clear move in or out of a building
    changes it, so a hall or a courtyard merely mentioned does not flip the scene from one turn
    to the next. The sky when the spot names it, or when the narration of an arrival at a place
    the name does not settle ends in the player's own flight (player_flies: someone else's 遁光
    is not the player up there). Off the map, a spot that starts with the name of a place of its
    own (百草园西侧土坡, 太南谷燕家客栈) is read after that name: it is where the spot is, the rest
    what the spot is (a slope, an inn), and its ground only where the rest names none."""
    rules = _content("scenes.json")
    poi = named_poi(world_map, spot)
    title = title_of(spot, poi)
    whole = own_name(world_map, spot)
    own, before, place = whole, (spot or "")[: len(spot or "") - len(whole)] if whole else "", ""
    if (poi is None and title and title != spot and (spot or "").startswith(title)
            and places.tokens(spot[len(title):])):
        # (a rest that names no kind of place, 百草园废弃枯井, is read whole: a well in the field)
        own, before, place = spot[len(title):], title, title
    name = places.read_name(own, before, place)
    family = spot_scene(world_map, spot, xy)
    groups = {"indoor": rules["indoorWords"], "outdoor": rules["outdoorWords"],
              "sky": rules["skyWords"]}
    story = (earlier[0] if earlier else narration) or ""
    room_story = ()
    # Someone's 遁光 passing a room the player stays in is not the player flying.
    flying = name.aspect == "sky" or _last_clue(spot or "", groups) == "sky"
    # a name that says nothing of inside or outside (a map place, a broad area), and a building's
    # own name (望仙楼: in the house or its yard?): the arrival decides, the stay only by a move
    open_ended = name.aspect is None or name.building
    if not open_ended:
        aspect = name.aspect
    else:
        inside = False
        for index, text in enumerate([*earlier, narration or ""]):
            move, words = last_move(text)
            if move:
                inside = move == "in"
                room_story = (words, text) if inside else room_story
            elif index == 0:
                clue = _last_clue(text, groups) or _last_clue(spot or "", groups)
                # at a building named for itself the player is in it, unless the story leaves
                # them outside it (门前, 廊下, 院中)
                inside = clue == "indoor" or (clue is None and name.building)
                room_story = (text,) if inside else room_story
        aspect = "inside" if inside else ("outside" if name.building else "ground")
        flying = flying or (not earlier and _last_clue(narration or "", groups) == "sky"
                            and player_flies(narration, action, subjects))
    key = place_text(region, area, spot) + ("#inside" if open_ended and aspect == "inside"
                                            else "")
    # no map place named or near: the family is only the fallback, and the look the wild's
    nowhere = (poi is None and family == rules["fallback"] and not named_scene(spot)
               and nearest_poi(world_map, xy) is None)
    look = places.look_by_rules(name, family, aspect, own, poi, story, room_story, nowhere)
    composed_id = poi["name"] if poi and not whole else spot
    return PlaceReading(key=key, title=title, family=family, aspect=aspect, flying=flying,
                        rules=look, poi=poi, composed_id=composed_id,
                        room=room_of(spot, whole, poi, title),
                        house=room_of(spot, whole, poi, title, places.house_name))


def room_of(spot, own, poi, title, named=places.room_name):
    """The name a room's own plaque shows (play_places.room_name; `named`: house_name, the
    building's before its door): after the map place, or after the place off the map whose name
    the spot starts with (太南谷燕家客栈 → 燕家客栈)."""
    if not own:
        return ""
    if poi is None and title and title != spot and spot.startswith(title):
        return named(spot[len(title):], spot)
    return named(own)


def _matches(when, look):
    for field_name, allowed in when.items():
        value = look.get(field_name)
        if field_name == "features":
            if not any(feature in allowed for feature in value or []):
                return False
        elif value not in allowed:
            return False
    return True


def scene_for(look, family, flying=False):
    """(the painted scene, indoor, the kit to compose it from or None) for a look: the first rule
    of places.json "scenes" that fits it and has something painted (a kit, else a painting),
    else the place's family, else the fallback. A flight on arrival is the sky."""
    rules = _content("scenes.json")
    fallback = rules["fallback"]
    shown, kit = None, None
    if flying:
        shown = "gaokong"
    else:
        for rule in places.vocabulary()["scenes"]:
            if not _matches(rule["when"], look):
                continue
            kit = next((c for c in rule["use"] if c.startswith("kit-") and has_kit(c)), None)
            shown = next((c for c in rule["use"] if not c.startswith("kit-") and drawn(c)), None)
            if kit or shown:
                shown = shown or kit_family(kit)
                break
    if not shown or not drawn(shown):
        kit = None
        shown = next((s for s in (family, fallback) if drawn(s)), fallback)
    return shown, bool(rules["scenes"].get(shown, {}).get("indoor")), kit


@cache
def kit_layout(kit):
    """How a kit lays its places out (street, gate, coast, room, wild)."""
    manifest = json.loads((ASSETS / "scenes" / kit / "kit.json").read_text(encoding="utf-8"))
    return manifest.get("layout")


def kit_names(kit):
    """Whose name a kit's subject carries when it composes a spot of another family: "house",
    the building's (a courtyard's hall or gate: play_places.house_name), else the map place's."""
    manifest = json.loads((ASSETS / "scenes" / kit / "kit.json").read_text(encoding="utf-8"))
    return manifest.get("names")


def composed_place(reading, look, kit, region=""):
    """The place the page composes the scene for (play_models.ComposedPlace, as a dict), or None
    when the scene is one painting. A kit of the map place's own family composes the map place
    (听澜院山门 is 听澜院's gate, 回潮渡西街 its town); any other kit composes the spot itself (two
    halls of a sect are two halls), after the map place it is in: its description and its family
    (`kind`, which a room takes after), and the map place's name on the plaques, but for a room,
    which shows its own (the house it is in, or its own name: play_places.room_name), and for a
    courtyard's building, which shows the building's when the spot names one (杂务堂外 → 杂务堂:
    play_places.house_name). The id seeds the layout, so a place always looks the same; the look
    chooses the pieces."""
    if not kit:
        return None
    poi = reading.poi
    own_family = poi is not None and kit == f"kit-{poi_scene(poi)}"
    place_id = poi["name"] if own_family else reading.composed_id
    if not place_id:
        return None
    name = reading.title
    if not own_family and reading.room and kit_layout(kit) == "room":
        name = reading.room
    elif not own_family and reading.house and kit_names(kit) == "house":
        name = reading.house
    description = plain_name((poi or {}).get("description"))
    return {
        "kit": kit, "id": place_id, "name": name,
        "region": (poi or {}).get("main_region") or region or "",
        **({"description": description} if description else {}),
        "kind": reading.family, "look": look,
    }


def place_scene(world_map, spot, xy, narration, earlier=(), action="", subjects=("你", "我")):
    """(the place's scene type, the scene to show, indoor) by the rules alone (no kept look):
    read_place, then scene_for."""
    reading = read_place(world_map, spot, xy, narration, earlier, action, subjects)
    shown, indoor, _ = scene_for(reading.rules.look, reading.family, reading.flying)
    return reading.family, shown, indoor


def story_weather(text):
    """The weather the narration states (the last mention), as one of the stage's five kinds,
    or None. A mention followed by its ending (雨停, 雾散, 细雨方歇) is a clear sky; a likeness
    (灵气如细雨入海, 碎石如暴雨般倾泻, 雨点般的拳头) is no weather at all."""
    rules = _content("scenes.json")["storyWeather"]
    text = text or ""
    best, where = None, -1
    for kind, words in rules["words"].items():
        for word in words:
            at = text.rfind(word)
            while at >= 0 and _a_likeness(rules, text, at, word):
                at = text.rfind(word, 0, at)
            if at < 0 or at + len(word) <= where:
                continue
            ended = kind != "clear" and re.match(rules["ends"], text[at + len(word):])
            best, where = ("clear" if ended else kind), at + len(word)
    return best


def _a_likeness(rules, text, at, word):
    """Whether the weather word at `at` only says what something is like: a likeness word just
    before it in the same clause (如细雨, 宛如一场大雪) or 般 / 似的 just after it (雨点般)."""
    return bool(re.search(rules["likeBefore"], text[max(0, at - 6):at])
                or re.match(rules["likeAfter"], text[at + len(word):]))


def weather_of(seed, region, area, month):
    """A weather key the stage knows (clear, cloud, mist, rain, snow): the first rule for the
    region (main or sub) and month, picked by the seed so it holds for the whole day."""
    for rule in _content("scenes.json")["weather"]:
        if rule.get("region") and rule["region"] not in (region, area):
            continue
        if rule.get("months") and month not in rule["months"]:
            continue
        return _pick(random_stream(seed), rule["pick"])
    return "clear"


# ---------------------------------------------------------------- beasts and items


def species_of(name):
    for rule in _content("species.json")["rules"]:
        if _words_in(name, rule["anyWord"]):
            return rule["species"]
    return _manifest("bestiary/bestiary.json").get("fallback", "silhouette")


def icon_of(name, item_type):
    for rule in _content("item-icons.json")["rules"]:
        if (not rule.get("type") or rule["type"] == item_type) and _words_in(name, rule["anyWord"]):
            return rule["icon"]
    defaults = _manifest("icons/icons.json")["defaults"]
    return defaults.get(item_type, defaults.get("其他物品", "unknown"))


def plain_name(text):
    """A name as text: the colour tags the card's prompts ask for removed."""
    return js_trim(re.sub(r"<[^>]*>", "", str(text or "")))
