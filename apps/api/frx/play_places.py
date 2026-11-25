"""What a place looks like: its scene description, how it is read, asked for and kept.

A place's look says where the player is (setting: outdoor, indoor, underground, sky, water), on
what ground (terrain), at or in what building (structure), with what in sight (features, at most
four), how narrow or open it is (scale) and its mood; the vocabulary is content/art/places.json.
The look picks the painted scene or the kit a place is composed from (play_art.scene_for), so a
herb field is a field and not the sect's gate it is near, a servants' dormitory is not the great
hall, a narrow canyon is not a town street.

Reading a place (read_place): the part of the spot's name that is its own (what follows the map
place it names, or the whole name of a spot off the map) is read word by word; the last word that
says what kind of place it is decides inside or outside, the most particular landform is the
terrain. A map place itself, or a short name that is only a broad area (神手谷, 黑风岭), says
nothing of inside or outside: the turn of arrival decides, as play_art always did, and the place
keeps one look for its outside and one for its inside. Where the words leave the look undecided
(a name without any of them, or the inside of a place whose room the story does not name), one
small call to the server's model may settle it (ask_model): its own usage purpose, the player's
quota, a short timeout, and the rules' answer stands whenever it fails.

A look is kept per save and place in place_looks (PlaceBook): the first look a place gets is the
one it keeps, so a place looks the same on every visit. The rows are the player's like the save
(row-level security on PostgreSQL, the user's own sessions), go into backups and save files and
go with the save when it is deleted. A look the rules gave is kept under the rules' version
(places.json "version"): when the reading is mended and the version goes up, such a look counts
as not kept, so the place is read again by the mended rules the next time it is shown, and the
new look replaces the old; a look the model gave stays (it answered what the rules could not).
"""

import asyncio
import copy
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from functools import cache

from sqlalchemy import JSON, ForeignKey, ForeignKeyConstraint, Integer, String, delete, or_, select
from sqlalchemy.orm import Mapped, mapped_column

from .domain import ROOT
from .storage import Base, now

logger = logging.getLogger(__name__)

PLACES = ROOT / "content/art/places.json"


@cache
def default_world_map():
    return json.loads((ROOT / "content/map.json").read_text(encoding="utf-8"))


@cache
def story_places():
    rules = json.loads((ROOT / "content/life/travel.json").read_text(encoding="utf-8"))
    return rules.get("storyPlaces", [])


def known_world_map(world_map, life=False):
    has_map = isinstance(world_map, dict) and world_map.get("points_of_interest")
    source = world_map if has_map else default_world_map()
    if not life or not story_places():
        return source
    points = source["points_of_interest"]
    names = {row.get("name") for row in points if isinstance(row, dict)}
    areas = {(row.get("main_region"), row.get("name"))
             for row in (source.get("sub_regions") or []) if isinstance(row, dict)}
    extra = [row for row in story_places() if row["name"] not in names
             and (row["main_region"], row["sub_region"]) in areas]
    return {**source, "points_of_interest": [*points, *extra]} if extra else source
FIELDS = ("setting", "terrain", "structure", "features", "scale", "mood")
SCALES = ("narrow", "open")
MOODS = ("calm", "lively", "tense", "eerie", "solemn", "desolate")
MOOD_ORDER = ("eerie", "tense", "desolate", "solemn", "lively")
MOST_FEATURES = 4
STORY_FEATURES = 2
# The model's call: the purpose its usage is recorded under, how long the turn waits for it, the
# longest answer it may write and how much of the story it is shown.
PURPOSE = "scene"
MODEL_SECONDS = 6.0
MODEL_TOKENS = 220
STORY_HEAD, STORY_TAIL = 600, 300
KEY_LIMIT = 300


@cache
def vocabulary():
    return json.loads(PLACES.read_text(encoding="utf-8"))


def kinds_of(group):
    """The ids a field of the look may take (terrain, structures, features)."""
    return [key for key in vocabulary()[group] if key != "about"]


def rules_version():
    """The version of the reading (places.json "version"): looks the rules gave under an older
    one are read again."""
    return int(vocabulary().get("version", 1))


# ---------------------------------------------------------------- the words of a name


@dataclass(frozen=True)
class Token:
    start: int
    end: int
    word: str
    kind: str  # terrain, structure, outside, sky, water (the head words) or feature
    value: str


@cache
def _lexicon():
    """(word, kind, value) of every word that says what a place is, longest first."""
    words = vocabulary()
    entries = []
    for group, kind in (("terrain", "terrain"), ("structures", "structure")):
        for value, spec in words[group].items():
            if isinstance(spec, dict):
                entries += [(word, kind, value) for word in spec.get("words", [])]
    for kind in ("outside", "sky", "water"):
        entries += [(word, kind, kind) for word in words[kind]]
    return sorted(entries, key=lambda entry: -len(entry[0]))


@cache
def _feature_words():
    return sorted(
        ((word, value) for value, spec in vocabulary()["features"].items()
         for word in spec.get("words", [])),
        key=lambda pair: -len(pair[0]),
    )


def _found(text, entries):
    """Every occurrence of the entries' words, those inside a longer one dropped."""
    hits = []
    for entry in entries:
        word = entry[0]
        at = text.find(word)
        while at >= 0:
            hits.append((at, at + len(word), entry))
            at = text.find(word, at + 1)
    return [
        hit for hit in hits
        if not any(o[0] <= hit[0] and hit[1] <= o[1] and o[1] - o[0] > hit[1] - hit[0]
                   for o in hits)
    ]


def tokens(text):
    """The head words of a name (terrain, structures, outside, sky, water), in order."""
    found = _found(text or "", _lexicon())
    return sorted((Token(a, b, w, k, v) for a, b, (w, k, v) in found),
                  key=lambda t: (t.end, t.end - t.start))


def features_in(text):
    """The features a text names, in the order they appear."""
    found = sorted(_found(text or "", _feature_words()))
    out = []
    for _, _, (_, value) in found:
        if value not in out:
            out.append(value)
    return out


def _words_in(text, words):
    return any(word in (text or "") for word in words)


def mood_in(text):
    """The mood the words of a text carry, or None: the longest word found decides (阴影 is a
    lurking shadow before 阴 is anything eerie), then the order eerie, tense, desolate, solemn,
    lively."""
    moods = vocabulary()["moods"]
    found = [(len(word), -MOOD_ORDER.index(mood), mood) for mood in MOOD_ORDER
             for word in moods[mood] if word in (text or "")]
    return max(found)[2] if found else None


def scale_in(text):
    scale = vocabulary()["scale"]
    if _words_in(text, scale["narrow"]):
        return "narrow"
    if _words_in(text, scale["open"]):
        return "open"
    return None


# ---------------------------------------------------------------- a name read


@dataclass
class NameReading:
    """What the own part of a spot's name says. `aspect` is how the name places the player when it
    does: inside (a building), outside (before or outside what it names: 草堂外, 井口), ground (on
    or in the ground it names: 药田, 石穴), sky or water; None when the name says nothing of it (a
    broad area, or none of the words). The rest are None where the name is silent.

    `building`: the name is a building's own (望仙楼, 燕家客栈), which says what it is but not
    whether the player is inside it or in its yard; `kind_named`: the name says what kind of
    building it is (not only 楼, 阁, 前台); `head`: its last word for a kind of place; `across`:
    the landform a word that runs over from the map place's name into this one names (白苇集脚);
    `area`: the particular ground the place the spot is in names (百草园 · 管事草堂外: a field)."""

    aspect: str | None = None
    terrain: str | None = None
    structure: str | None = None
    features: list = field(default_factory=list)
    scale: str | None = None
    mood: str | None = None
    building: bool = False
    kind_named: bool = True
    head: str = ""
    across: str | None = None
    # the particular ground of the place the spot is in (百草园: a field), where the name has none
    area: str | None = None


def _structure_spec(structure):
    return vocabulary()["structures"].get(structure) or {}


def _terrain_spec(terrain):
    return vocabulary()["terrain"].get(terrain) or {}


def _best_terrain(found, until=None):
    """The most particular landform among the tokens (the higher tier; the later on a tie)."""
    terrains = [t for t in found if t.kind == "terrain" and (until is None or t.end <= until)]
    if not terrains:
        return None
    return max(terrains, key=lambda t: (_terrain_spec(t.value).get("tier", 0), t.end)).value


def _generic(token):
    """Whether a structure word names any building's part (楼, 阁, 房, 前台, 雅座) rather than a
    kind of building."""
    return token.word in (_structure_spec(token.value).get("generic") or [])


def _structure_of(found, until=None):
    """The building the name names last and whether the name says what kind it is.

    A word for any building's part (楼, 阁, 房, 室, 前台, 雅座) gives way to an earlier word that
    says what kind of building it is (药房二楼 is the pharmacy, 听风阁茶楼二楼雅座 the teahouse);
    with none, the name does not say (望仙楼: a tower, a tavern, a library?). A room of a kind
    within a building of another (places.json "within") is what that building has: the hall of
    an inn is the inn's, a quiet room in an inn or a mansion is a room, not a cave."""
    named = [t for t in found if t.kind == "structure" and (until is None or t.end <= until)]
    if not named:
        return None, True
    last = named[-1]
    if _generic(last):
        earlier = [t for t in named[:-1] if not _generic(t)]
        if earlier:
            return earlier[-1].value, True
        # a 房 or a 室 is a room whatever else it is; a 楼 or a 前台 says no kind of building
        return last.value, last.value == "room"
    within = _structure_spec(last.value).get("within") or {}
    earlier = [t for t in named[:-1] if not _generic(t) and t.value != last.value]
    if earlier and earlier[-1].value in within:
        return within[earlier[-1].value], True
    return last.value, True


def _own_spot(own, found):
    """The part of a name that is the spot itself: after the last 外围 / 旁 that ties it to a
    place it is near (百草园外围荒林 is a forest, whatever 百草园 has), up to the head's own one
    (百草园废弃枯井旁 is beside the well of the herb garden)."""
    head = found[-1]
    ties = [t for t in found[:-1] if t.kind == "outside"]
    start = ties[-1].end if ties else 0
    return own[start:head.start] if head.kind == "outside" else own[start:]


def _behind_a_building(own, found):
    """The building whose back the name ends at (草堂后, 大殿后头: places.json "behind"), or None.
    Only a building with an inside: behind a door or a screen is through it."""
    for word in sorted(vocabulary().get("behind", {}).get("words", []), key=len, reverse=True):
        if own.endswith(word):
            before = [t for t in found if t.end == len(own) - len(word) and t.kind == "structure"]
            if before and _structure_spec(before[-1].value).get("inside"):
                return before[-1]
            return None
    return None


UNDERGROUND = ("cave", "shaft", "tunnel")


def _underground(terrain):
    return _terrain_spec(terrain).get("setting") == "underground"


def read_name(own, before="", place=""):
    """What the own part of a name says (NameReading). `before` is the rest of the spot's name
    (the map place it names): a landform word it starts, which the own part ends (白苇集 · 脚青石亭:
    山脚), is the name's too. `place`: the name of a place off the map the spot is in (百草园),
    whose ground is the spot's where its own name gives none."""
    found = tokens(own)
    reading = NameReading(features=features_in(own), scale=scale_in(own), mood=mood_in(own))
    if before:
        joined = tokens(before + own)
        cut = len(before)
        reading.across = next((t.value for t in joined if t.kind == "terrain" and t.start < cut
                               < t.end), None)
    if place:
        area = _best_terrain(tokens(place))
        if area and not _underground(area):
            reading.area = area
    if not found:
        return reading
    head = found[-1]
    reading.head = head.word
    reading.features = features_in(_own_spot(own, found))
    reading.terrain = _best_terrain(found)
    reading.structure, kind_named = _structure_of(found)
    behind = _behind_a_building(own, found)
    if behind:
        reading.aspect = "outside"
        reading.structure = behind.value
    elif head.kind in ("sky", "water"):
        reading.aspect = head.kind
    elif head.kind == "outside":
        reading.aspect = "outside"
        reading.structure, kind_named = _structure_of(found, head.start)
    elif head.kind == "structure":
        inside = _structure_spec(reading.structure).get("inside")
        reading.aspect = "inside" if inside else "outside"
        if _underground(reading.terrain) and reading.structure in ("hall", "room", "tower"):
            # a cave's 地厅 or 石室 off a passage: a chamber of the cave, nobody's hall
            reading.aspect, reading.structure, kind_named = "ground", None, True
        elif (head.end == len(own) and reading.structure in vocabulary()["buildings"]["structures"]
              and (not _generic(head) or (head.value == "tower" and not kind_named))):
            # 望仙楼, 燕家客栈, 听风阁: a building's own name, not a room or a floor of it (前台,
            # 雅座, 茶楼二楼); inside or in its yard is the arrival's to say
            reading.building = True
    else:
        broad = vocabulary()["broad"]
        alone = len(found) == 1 and len(head.word) == 1 and len(own) <= broad["longest"]
        if not (alone and head.value in broad["terrain"]):
            reading.aspect = "ground"
            # a ground word after a building names the ground, not the building; nor does it
            # after an estate it is merely part of (秦家灵药庄西山田垄, 黑虎寨后山暗渠): only a
            # building right before it is where on that ground (山门石阶)
            named = [t for t in found if t.kind == "structure"]
            between = own[named[-1].end:head.start] if named else ""
            if reading.structure and (_structure_spec(reading.structure).get("inside")
                                      or not named or any(c not in QUALIFIERS for c in between)):
                reading.structure = None
            kind_named = True
    reading.kind_named = kind_named
    return reading


# ---------------------------------------------------------------- the look


def _family_look(family):
    look = vocabulary()["families"].get(family) or vocabulary()["families"]["guanyuntai"]
    return copy.deepcopy(look)


def _allowed(features, setting):
    specs = vocabulary()["features"]
    out = []
    for feature in features:
        if feature in specs and setting in specs[feature]["settings"] and feature not in out:
            out.append(feature)
    return out[:MOST_FEATURES]


def _setting_of(aspect, terrain, structure):
    if aspect in ("sky", "water"):
        return aspect
    if aspect == "inside":
        return _structure_spec(structure).get("setting") or (
            "underground" if _terrain_spec(terrain).get("setting") == "underground" else "indoor"
        )
    if aspect == "outside":
        return "outdoor"
    return _terrain_spec(terrain).get("setting") or "outdoor"


def _mood_of(look, *texts):
    words = next((mood for mood in (mood_in(text) for text in texts) if mood), None)
    if words:
        return words
    by_structure = vocabulary()["structureMoods"].get(look.get("structure"))
    return by_structure or look.get("mood") or "calm"


def check_look(look):
    """The look with every field in the vocabulary, or None when it is not a look at all."""
    if not isinstance(look, dict):
        return None
    words = vocabulary()
    out = {
        "setting": look.get("setting") if look.get("setting") in words["settings"] else None,
        "terrain": look.get("terrain") if look.get("terrain") in kinds_of("terrain") else None,
        "structure": (look.get("structure") if look.get("structure") in kinds_of("structures")
                      else None),
        "scale": look.get("scale") if look.get("scale") in SCALES else None,
        "mood": look.get("mood") if look.get("mood") in MOODS else None,
    }
    if None in out.values():
        return None
    features = look.get("features") if isinstance(look.get("features"), list) else []
    out["features"] = _allowed([f for f in features if isinstance(f, str)], out["setting"])
    return {name: out[name] for name in FIELDS}


def story_features(text, setting):
    """The visible things the arrival's story mentions most that a place of this setting can
    have (places.json story), at most two: counted in the story's second half, where the player
    has arrived (the first is often the way there), else in all of it. The story's own words
    that are too often something else (places.json story ambiguous: 花 in 百花酿, 松 in 放松) do
    not count there."""
    specs = vocabulary()["features"]
    allowed = [f for f in vocabulary()["story"]["features"] if setting in specs[f]["settings"]]
    ambiguous = set(vocabulary()["story"].get("ambiguous", []))
    text = text or ""
    for part in (text[len(text) // 2:], text):
        counts = {}
        for word, value in _feature_words():
            if value in allowed and word not in ambiguous:
                counts[value] = counts.get(value, 0) + part.count(word)
        ranked = sorted((value for value, n in counts.items() if n), key=lambda v: -counts[v])
        if ranked:
            return ranked[:STORY_FEATURES]
    return []


def room_in(*texts):
    """The kind of room a story says the player is in (places.json rooms): the last named in the
    first of the texts that names one (the words that took the player inside, then the story)."""
    for text in texts:
        best, where = None, -1
        for structure, words in vocabulary()["rooms"].items():
            if structure == "about":
                continue
            for word in words:
                at = (text or "").rfind(word)
                if at >= 0 and at + len(word) > where:
                    best, where = structure, at + len(word)
        if best:
            return best
    return None


CORE = ("setting", "terrain", "structure")


@dataclass
class Look:
    """A place's look by the rules, whether the rules settle it, and which of its fields the
    place's own name fixes (`sure`): the model may change only the others, and of these only to
    what refines them (REFINE). `building`: the kind of building whose own name the place is (its
    rooms and yard are what the model may say the player is in)."""

    look: dict
    decided: bool
    sure: frozenset = frozenset(FIELDS)
    building: str | None = None
    # the ground outside a building whose own name the place is (its yard, before its door)
    ground: str | None = None


def _sentences(text):
    return [part for part in re.split(r"(?<=[。！？!?\n])", text or "") if part.strip()]


def story_terrain(text, word=""):
    """The landform the arrival's story puts the place in (places.json terrainNear): the most
    particular one in the sentence that first names the place (its last word: 亭, 草堂) and the
    sentences either side of it, else the particular one the story's second half names most (at
    least twice); None when the story says nothing particular (a mountain, a valley or a road
    are too broad to go by)."""
    sentences = _sentences(text)
    reach = int(vocabulary().get("terrainNear", {}).get("sentences", 1))
    if word:
        at = next((i for i, sentence in enumerate(sentences) if word in sentence), None)
        if at is not None:
            near = "".join(sentences[max(0, at - reach):at + reach + 1])
            found = [t for t in tokens(near) if t.kind == "terrain" and len(t.word) >= 2
                     and _terrain_spec(t.value).get("tier", 0) >= 3 and not _underground(t.value)]
            if found:
                return max(found, key=lambda t: (_terrain_spec(t.value).get("tier", 0),
                                                 len(t.word))).value
    half = (text or "")[len(text or "") // 2:]
    counts = {}
    for found in tokens(half):
        particular = _terrain_spec(found.value).get("tier", 0) >= 3
        if found.kind == "terrain" and len(found.word) >= 2 and particular \
                and not _underground(found.value):
            counts[found.value] = counts.get(found.value, 0) + 1
    best = max(counts, key=lambda value: counts[value], default=None)
    return best if best and counts[best] >= 2 else None


def story_kind(text):
    """What kind of building a name that only says 楼, 阁 or 前台 is, by the arrival's story
    (places.json kinds): the kind whose words it uses most; None when it uses none."""
    counts = {}
    for kind, words in vocabulary()["kinds"].items():
        if kind == "about":
            continue
        counts[kind] = sum((text or "").count(word) for word in words)
    best = max(counts, key=lambda kind: counts[kind], default=None)
    return best if best and counts[best] else None


def in_a_yard(text):
    """Whether the arrival's story leaves the player in a building's yard (places.json buildings
    yards): a yard named after the last word for inside a house (scenes.json indoorWords)."""
    from .play_art import _content

    text = text or ""
    yard = max((text.rfind(word) for word in vocabulary()["buildings"]["yards"]), default=-1)
    inside = max((text.rfind(word) for word in _content("scenes.json")["indoorWords"]),
                 default=-1)
    return yard >= 0 and yard > inside


# The houses whose hall and private room are two scenes: the scale tells them apart (a narrow
# tavern is its 雅间), so it is the words', not the model's sense of a room's size.
HOUSE_HALLS = ("tavern", "teahouse")


def private_room(text):
    """Whether the arrival's story leaves the player in a house's private room (雅间, 包厢)
    rather than its hall (大堂): the parts of a house (places.json structures inn generic) the
    scale calls narrow or open, the later one in the story counting."""
    parts = set(_structure_spec("inn").get("generic") or [])
    scale = vocabulary()["scale"]
    text = text or ""

    def last(words):
        return max((text.rfind(word) for word in words if word in parts), default=-1)

    private = last(scale["narrow"])
    return private >= 0 and private > last(scale["open"])


def _outdoor_terrain(name, family_look, own, story=""):
    """(the ground outside, whether the name says it). The name's landform, or at the mouth of a
    cave, a well or a passage the ground around it (a field's well) or the hole itself in the
    rock (the mouth of a mine: the wild's cave mouth); a name with no particular landform of its
    own goes by the particular ground of the place it is in (百草园: a field), then by where the
    arrival's story puts it (a pavilion among pines and bamboo is in the forest), then by a broad
    one of its own (山脚), then by the place's family."""
    terrain = name.terrain
    if _underground(terrain):
        above = [t for t in tokens(own) if t.kind == "terrain" and not _underground(t.value)]
        if above:
            best = max(above, key=lambda t: (_terrain_spec(t.value).get("tier", 0), t.end))
            return best.value, True
        return terrain, True
    if terrain and _terrain_spec(terrain).get("tier", 0) >= 2:
        return terrain, True
    if name.area and _terrain_spec(name.area).get("tier", 0) >= 2:
        return name.area, True
    # only what stands out in the country (a pavilion, a hut, the outskirts) is where the story
    # says; an arena, a hall or a market stands on its own place's ground
    if (name.structure or "none") in vocabulary()["terrainNear"]["structures"]:
        near = story_terrain(story, name.head)
        if near:
            return near, False
    if terrain or name.across or name.area:
        return terrain or name.across or name.area, False
    return (family_look["terrain"] if family_look["setting"] == "outdoor" else "mountain"), False


def look_by_rules(name, family, aspect, own="", poi=None, story="", room_story=(), nowhere=False):
    """The look of a place by the rules, from the best evidence there is: the place's own name
    read correctly, then the arrival's story, then the place it is in. `name` is its own name
    read (read_name), `family` the scene family of the place it is in or near, `aspect` where the
    player is (inside, outside, ground, sky, water), `own` the own part of its name, `poi` the map
    place it is or is in, `story` the arrival's story (for the ground around a place the name
    gives none, the kind of a building the name only calls 楼, a building's yard, things in
    sight) and `room_story` what took the player inside: the words of the move and its story
    (for the kind of room, when the name does not say). `nowhere`: no map place is named or
    near, so the place's family is only the fallback; its look starts from the wild's
    (places.json "nowhere"), not the cloud terrace's."""
    look = copy.deepcopy(vocabulary()["nowhere"]) if nowhere else _family_look(family)
    poi_text = ((poi or {}).get("name") or "") + " " + ((poi or {}).get("description") or "")
    sure = set(FIELDS)
    building = None
    if aspect in ("sky", "water"):
        look.update(terrain=name.terrain or ("cloud_sea" if aspect == "sky" else "lake"),
                    structure=name.structure or "none", features=[], scale="open")
    elif name.aspect is not None:
        # the name says what the place is: its words make the look, the story what they leave
        terrain = name.terrain
        structure = name.structure or "none"
        if not name.kind_named:
            # 望仙楼, 前台: the kind of building is the story's (a tavern's staff and jars)
            structure = story_kind(story) or structure
            sure.discard("structure")
        if name.building:
            # a building's own name: inside it or in its yard is the arrival's
            building = structure
            sure.discard("setting")
            sure.discard("structure")
            if aspect != "inside" and in_a_yard(story):
                structure = "courtyard"
        if aspect == "inside":
            terrain = terrain if _underground(terrain) else "none"
        elif aspect == "outside" or not terrain:
            terrain, named = _outdoor_terrain(name, look, own, story)
            if not named:
                sure.discard("terrain")
        elif _terrain_spec(terrain).get("tier", 0) < 2:
            sure.discard("terrain")
        private = building in HOUSE_HALLS and aspect == "inside" and private_room(story)
        scale = name.scale or ("narrow" if private else None) or (
            _structure_spec(structure).get("scale") if aspect == "inside" else None
        ) or _terrain_spec(terrain).get("scale") or "open"
        look.update(terrain=terrain, structure=structure, features=list(name.features),
                    scale=scale, mood="calm")
    elif aspect == "inside":
        # the inside of a place whose name says nothing of it: the room the story names
        room = room_in(*room_story)
        structure = room or vocabulary()["indoorOf"].get(family) or "room"
        if room is None:
            sure.discard("structure")
        look.update(structure=structure, terrain="none", features=[], mood="calm",
                    scale=_structure_spec(structure).get("scale") or "narrow")
    elif poi or not name.terrain:
        # a map place (or an area of one: 回潮渡西街), or a name with none of the words: the
        # look of its family
        if not poi:
            sure = set()
        if name.terrain:
            look["terrain"] = name.terrain
        look["features"] = list(dict.fromkeys(look["features"] + features_in(poi_text)))
    else:
        # an area off the map whose name is only its kind of ground (神手谷, 黑风岭): that ground
        look.update(terrain=name.terrain, structure="none", features=list(name.features),
                    scale=name.scale or _terrain_spec(name.terrain).get("scale") or "open",
                    mood="calm")
        poi_text = ""
    look["setting"] = _setting_of(aspect, look["terrain"], look["structure"])
    look["features"] = _allowed(
        list(dict.fromkeys(look["features"] + story_features(story, look["setting"]))),
        look["setting"])
    look["mood"] = _mood_of(look, own, poi_text if name.aspect is None else "")
    checked = check_look(look)
    if checked is None:
        return Look(check_look(_family_look("guanyuntai")), False, frozenset())
    ground = None
    if building:
        ground = (look["terrain"] if look["setting"] == "outdoor"
                  else _outdoor_terrain(name, _family_look(family), own, story)[0])
    return Look(checked, set(CORE) <= sure, frozenset(sure), building, ground)


# ---------------------------------------------------------------- one place, two names

# What may stand between the words of one place's two names: where in it (后院, 南侧, 西厢, 二楼)
QUALIFIERS = set("东西南北前后左右侧边内外里上下中正偏院区角隅处头尾厢楼层间"
                 "一二三四五六七八九十甲乙丙丁号字座")


def _parts(key):
    """(where: region/area and inside or not, the spot) of a place's key."""
    inside = key.endswith("#inside")
    text = key[: -len("#inside")] if inside else key
    where, _, spot = text.rpartition("/")
    return (where, inside), spot


def _head(spot):
    found = tokens(spot)
    return found[-1] if found else None


def _within(short, long):
    """Whether `long` is `short` with only qualifiers put in (百草园 → 百草园南侧)."""
    at = 0
    extra = []
    for char in long:
        if at < len(short) and char == short[at]:
            at += 1
        else:
            extra.append(char)
    return at == len(short) and all(char in QUALIFIERS for char in extra)


def same_place(key, other):
    """Whether two keys name one place: the story calls a room 后院柴房 one turn and 柴房 the
    next, a field 西山田垄 and then 西山药田. Same region and area, both inside or both not, the
    same kind of place last (柴房 and 柴房; 田垄 and 药田, both fields), and what comes before it
    the same but for words of where in it (后院, 南侧, 西厢, 二楼)."""
    if key == other:
        return True
    (where, spot), (where2, spot2) = _parts(key), _parts(other)
    if where != where2 or not spot or not spot2:
        return False
    head, head2 = _head(spot), _head(spot2)
    if head is None or head2 is None or (head.kind, head.value) != (head2.kind, head2.value):
        return False
    if spot[head.end:] != spot2[head2.end:]:
        # 草堂 and 草堂后: the hut and its back
        return False
    if (head.kind == "structure" and head.value in vocabulary()["buildings"]["structures"]
            and (not _generic(head) or head.value == "tower")):
        # two buildings of a kind are two buildings (望仙楼, 听风楼); two of their private rooms
        # may be one (茶楼二楼雅座, 茶楼雅座)
        return False
    before, before2 = spot[: head.start], spot2[: head2.start]
    if not before or not before2:
        return False
    short, long = sorted((before, before2), key=len)
    return _within(short, long)


def alias_of(key, kept):
    """The first of the kept keys (in the order they were kept) that names the same place as
    `key`, or None."""
    return next((other for other in kept if other != key and same_place(key, other)), None)


def spot_of(key):
    return _parts(key)[1]


PLAQUE_LONGEST = 6  # the composer leaves a plaque blank for a longer name (compose.ts LONGEST)


def room_name(rest, whole=None):
    """The name a room's plaque shows. `rest` is the spot's own name after the place it is in (望仙
    楼柴房 in 太南谷, 炼丹房 in 听澜院), `whole` its own name with that place (the spot, off the
    map). The house it is in when that has a name of its own (望仙楼柴房 → 望仙楼, 听风阁茶楼二楼
    雅座 → 听风阁, 燕家客栈三楼静室 → 燕家客栈), else its own name when a plaque takes it (炼丹
    房, 执法堂地牢, 黑虎寨聚义厅), else the room's own words after what it is part of (灵药园西厢
    柴房 → 西厢柴房, 百草园管事草堂 → 管事草堂)."""
    whole = whole or rest
    found = tokens(rest)
    if not found:
        return whole if len(whole) <= PLAQUE_LONGEST else rest
    kinds = vocabulary()["buildings"]["structures"]
    house = next((t for t in found if t.kind == "structure" and t.value in kinds), None)
    if house is not None and house.start > 0:
        return rest[: house.end]
    if len(whole) <= PLAQUE_LONGEST:
        return whole
    head = found[-1]
    earlier = [t for t in found[:-1] if t.end <= head.start]
    return rest[earlier[-1].end:] if earlier else rest


# a garden or a yard at the end of a name, besides a building's yards (places.json buildings)
GARDENS = ("后花园", "花园", "庭院", "院落")


def house_name(rest, whole=None):
    """The name over the door of the building a spot is before or in the yard of (杂务堂外 → 杂务
    堂, 藏经阁前 → 藏经阁, 望仙楼后院 → 望仙楼, 韩府后花园 → 韩府), as room_name names a room;
    "" when the spot names only a yard or a garden (庭院, 后院), which the place it is in names.
    `rest` and `whole` as for room_name."""
    words = vocabulary()
    ends = sorted({*words["outside"], *words["behind"]["words"], *words["buildings"]["yards"],
                   *GARDENS}, key=len, reverse=True)
    whole = whole or rest
    while rest:
        if rest in ends:
            return ""
        end = next((end for end in ends if rest.endswith(end)), None)
        if end is None:
            break
        rest, whole = rest[: -len(end)], whole[: -len(end)]
    return room_name(rest, whole) if rest else ""


# ---------------------------------------------------------------- asking the model


def _choices(group):
    return "、".join(
        f"{key}（{spec['label']}）" for key, spec in vocabulary()[group].items()
        if isinstance(spec, dict) and key != "about"
    )


def model_messages(place, story, action, rules):
    """The small prompt for the model: the place, the player's action, the story's start and
    end, the values each field may take, and the rules' look with the fields the place's own
    name fixes."""
    words = vocabulary()
    look, sure = (rules.look, rules.sure) if isinstance(rules, Look) else (rules, frozenset())
    text = story or ""
    if len(text) > STORY_HEAD + STORY_TAIL:
        text = text[:STORY_HEAD] + "……" + text[-STORY_TAIL:]
    system = (
        "你替一款仙侠文字游戏的舞台美术判断主角此刻所在之处的样子。"
        "只回答一个 JSON 对象，不要别的字。"
        "字段：setting 是 " + "、".join(f"{k}（{v}）" for k, v in words["settings"].items())
        + "之一；terrain 是 " + _choices("terrain") + "之一；structure 是 " + _choices("structures")
        + "之一；features 是至多四个，取自 " + _choices("features") + "；scale 是 narrow（狭窄）或"
        " open（开阔）；mood 是 " + "、".join(MOODS) + "之一。屋里时 terrain 写 none；"
        "没有建筑时 structure 写 none。按地点名和正文里这一回合结束时主角所在的地方判断，"
        "不要按路上或别处的景物。楼、阁要看是酒楼、茶楼、客栈还是别的楼；天然的洞穴、岩缝没有建筑。"
    )
    fixed = [name for name in FIELDS if name in sure and name in CORE]
    user = (
        f"地点：{place}\n主角的行动：{(action or '')[:200]}\n正文：{text}\n"
        f"按规则的猜测（拿不准的地方可以改）：{json.dumps(look, ensure_ascii=False)}"
        + (f"\n地点名已经说定的（不要改）：{'、'.join(fixed)}" if fixed else "")
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# What a field the place's own name fixes may still become: an underground passage may be a cave
# or a shaft; a room no word says the kind of may be any room.
REFINE = {
    "terrain": {"cave": {"tunnel", "shaft"}, "tunnel": {"cave", "shaft"},
                "shaft": {"cave", "tunnel"}},
    "structure": {"room": {"storeroom", "study", "dormitory", "hut", "cell", "alchemy_room",
                           "workshop"}},
}
# What the player may be in at a building whose own name the place is: the building, a room, a
# floor or the yard of it.
BUILDING_PARTS = {"courtyard", "room", "storeroom", "cellar", "workshop", "study", "hall", "shop",
                  "inn", "tavern", "teahouse", "tower", "alchemy_room", "corridor"}


def _coherent(look, rules):
    """The look with its ground fitting where the player is: none indoors (a cellar, a cave keep
    theirs), some ground outdoors (the rules' outdoor ground, else the mountains)."""
    terrain, setting = look["terrain"], look["setting"]
    if setting == "indoor" and terrain != "none" and not _underground(terrain):
        look["terrain"] = "none"
    elif setting == "outdoor" and terrain == "none":
        before = rules.look if isinstance(rules, Look) else rules
        outside = (rules.ground if isinstance(rules, Look) else None) or before.get("terrain")
        look["terrain"] = outside if outside not in (None, "none") else "mountain"
    elif setting == "underground" and terrain not in UNDERGROUND and terrain != "none":
        look["terrain"] = "cave"
    return check_look(look)


def parse_answer(content, rules, story=""):
    """The model's look merged over the rules' (`rules`: a Look, or a look none of whose fields
    the rules are sure of), or None when the answer holds no JSON object. A field the model got
    wrong keeps the rules' value; so does one the place's own name fixes (Look.sure), unless the
    model only refines it (REFINE: the passage is a crack in the rock); at a building whose own
    name the place is, the model says which part of it the player is in (BUILDING_PARTS) or
    keeps the rules' word, and in a tavern or a teahouse the hall or the private room is the
    name's and the arrival's `story`'s (private_room). The ground then fits the setting (an
    indoor answer has none)."""
    found = re.search(r"\{[\s\S]*\}", content or "")
    if not found:
        return None
    try:
        answer = json.loads(found[0])
    except ValueError:
        return None
    if not isinstance(answer, dict):
        return None
    look, sure = (rules.look, rules.sure) if isinstance(rules, Look) else (rules, frozenset())
    building = rules.building if isinstance(rules, Look) else None
    merged = dict(look)
    for name in FIELDS:
        if name not in answer:
            continue
        value = answer[name]
        if name in CORE and name in sure and value != look[name] and value not in REFINE.get(
                name, {}).get(look[name], ()):
            continue
        if name == "structure" and building and value not in BUILDING_PARTS | {building}:
            continue
        trial = check_look({**merged, name: value})
        if trial and (name != "features" or isinstance(value, list)):
            merged = trial
    if building and merged["structure"] in HOUSE_HALLS:
        # a tavern's hall the model called narrow showed as its private room (林川 at 灵泉镇酒楼,
        # among the other tables of the hall)
        named = look["structure"] in HOUSE_HALLS and look["scale"] == "narrow"
        merged["scale"] = "narrow" if named or private_room(story) else "open"
    return _coherent(merged, rules)


async def ask_model(runtime, user, place, story, action, rules, request_id=None):
    """The model's look for a place the rules leave undecided, or None (no model, the player at
    their limit, a failure or no answer within MODEL_SECONDS): the rules' look then stands. The
    call is the player's, under its own purpose and the turn's request."""
    from . import usage
    from .gateway import Gateway, ModelFailure

    config = runtime.profiles.load("default")
    if not config.model:
        return None
    meter = getattr(runtime, "meter", None)
    if meter is not None and user is not None:
        problem = await asyncio.to_thread(meter.quota_problem, user.id, user.limits)
        if problem:
            return None
    from .card_turns import admission

    options = {"temperature": 0, "max_tokens": MODEL_TOKENS}
    if admission(config.model).get("lowEffort"):
        options["reasoning_effort"] = "low"
    try:
        response = await asyncio.wait_for(
            Gateway.complete(config, model_messages(place, story, action, rules),
                             stream=False, timeout=MODEL_SECONDS, **options),
            MODEL_SECONDS + 0.5,
        )
    except (ModelFailure, TimeoutError):
        return None
    except Exception as error:  # the rules' look stands whatever went wrong
        logger.warning("scene_model_failed error=%s", type(error).__name__)
        return None
    if user is not None and meter is not None:
        with usage.scope(meter, user.id, PURPOSE, request_id):
            await usage.note("default", getattr(response, "usage", None))
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError):
        return None
    return parse_answer(content, rules, story)


async def settle_look(key, rules, kept, runtime, user, place, story, action, request_id=None):
    """(the look, its source) a place arriving for the first time keeps. Another name of a place
    kept before (alias_of) is that place, with its look. Otherwise the rules' look, from the
    place's own name, the arrival's story and the place it is in; where the name leaves where
    the player is, the ground or the building open (Look.decided), the model reads the
    arrival's story (ask_model), and its answer is checked by what the name does fix
    (parse_answer). The rules' look stands whenever the model cannot answer."""
    alias = alias_of(key, list(kept))
    if alias:
        return copy.deepcopy(kept[alias]), "rules"
    if rules.decided:
        return rules.look, "rules"
    asked = await ask_model(runtime, user, place, story, action, rules, request_id)
    return (asked, "model") if asked else (rules.look, "rules")


# ---------------------------------------------------------------- keeping it


class PlaceLookRow(Base):
    __tablename__ = "place_looks"
    __table_args__ = (ForeignKeyConstraint(
        ["user_id", "archive_id"], ["archives.user_id", "archives.archive_id"], ondelete="CASCADE",
    ),)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    place: Mapped[str] = mapped_column(String(KEY_LIMIT), primary_key=True)
    look: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(16))  # rules | model
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    # the rules' version the look was read under (rules_version; none: before versions)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)


def place_key(text):
    """A place's key in place_looks: its text, or a digest of it when too long."""
    text = (text or "").strip() or "?"
    if len(text) <= KEY_LIMIT:
        return text
    return text[: KEY_LIMIT - 41] + "#" + hashlib.sha1(text.encode()).hexdigest()


class PlaceBook:
    """One user's kept looks, through their own store's sessions (frx.card_store.CardStore)."""

    def __init__(self, records):
        self.records = records
        self.user_id = records.user_id

    def looks(self, archive_id):
        """Every kept look of a save: key → look, in the order the places were first kept (a
        place another name of an earlier one is composed as that one, alias_of). A look the
        rules gave under an older version of the rules is left out: the place is read again
        (keep replaces it)."""
        with self.records.sessions() as session:
            self.records.read_lock(session)
            rows = session.scalars(
                select(PlaceLookRow).where(PlaceLookRow.user_id == self.user_id,
                                           PlaceLookRow.archive_id == archive_id)
                .order_by(PlaceLookRow.created_at, PlaceLookRow.place)
            ).all()
            return {row.place: copy.deepcopy(row.look) for row in rows if not _stale(row)}

    def keep(self, archive_id, key, look, source):
        """Keep a look unless the place has one already (one the rules gave under an older
        version of them is replaced); the look the place keeps."""
        from .play_errors import not_found
        from .save_schema import Archive

        if not archive_id:
            return look
        row = {"user_id": self.user_id, "archive_id": archive_id, "place": place_key(key),
               "look": look, "source": source, "created_at": now(), "version": rules_version()}
        with self.records.sessions.begin() as session:
            self.records.lock(session)
            parent = session.scalar(select(Archive.archive_id).where(
                Archive.user_id == self.user_id, Archive.archive_id == archive_id,
                Archive.deleted.is_(False),
            ))
            if parent is None:
                raise not_found()
            if session.bind.dialect.name == "postgresql":
                from sqlalchemy.dialects.postgresql import insert
            else:
                from sqlalchemy.dialects.sqlite import insert
            statement = insert(PlaceLookRow).values(**row)
            stale = (PlaceLookRow.source == "rules") & or_(
                PlaceLookRow.version.is_(None), PlaceLookRow.version < rules_version())
            session.execute(statement.on_conflict_do_update(
                index_elements=["user_id", "archive_id", "place"],
                set_={name: statement.excluded[name]
                      for name in ("look", "source", "created_at", "version")},
                where=stale,
            ))
            kept = session.get(PlaceLookRow, (self.user_id, archive_id, place_key(key)))
            return copy.deepcopy(kept.look) if kept else look

    def forget(self, archive_id, session=None):
        """Drop every look of a save (the save is deleted)."""
        statement = delete(PlaceLookRow).where(PlaceLookRow.user_id == self.user_id,
                                               PlaceLookRow.archive_id == archive_id)
        if session is not None:
            self.records.lock(session)
            session.execute(statement)
            return
        with self.records.sessions.begin() as own:
            self.records.lock(own)
            own.execute(statement)

    def rows_of(self, archive_ids, session):
        """The kept looks of these saves, as a backup carries them."""
        self.records.read_lock(session)
        rows = session.scalars(
            select(PlaceLookRow).where(PlaceLookRow.user_id == self.user_id,
                                       PlaceLookRow.archive_id.in_(sorted(archive_ids)))
            .order_by(PlaceLookRow.archive_id, PlaceLookRow.place)
        ).all()
        return [{"archiveId": row.archive_id, "place": row.place, "look": copy.deepcopy(row.look),
                 "source": row.source, "version": row.version} for row in rows]

    def add_rows(self, rows, session):
        """Restore looks a backup or a save file carried (already checked, ids rewritten)."""
        self.records.lock(session)
        for row in rows:
            look = check_look(row.get("look"))
            if look is None or not row.get("archiveId") or not row.get("place"):
                continue
            version = row.get("version")
            session.merge(PlaceLookRow(
                user_id=self.user_id, archive_id=row["archiveId"], place=place_key(row["place"]),
                look=look, source=row.get("source") if row.get("source") in ("rules", "model")
                else "rules", created_at=now(),
                version=version if isinstance(version, int) and not isinstance(version, bool)
                else None,
            ))


def _stale(row):
    """Whether a kept look is one the rules gave under an older version of them."""
    return row.source == "rules" and (row.version is None or row.version < rules_version())


def check_rows(rows, archive_ids):
    """Whether a backup's or a save file's looks are well formed and belong to its saves."""
    if not isinstance(rows, list) or len(rows) > 100000:
        return False
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("archiveId") not in archive_ids:
            return False
        place = row.get("place")
        if not isinstance(place, str) or not 0 < len(place) <= KEY_LIMIT:
            return False
        if check_look(row.get("look")) is None or (row["archiveId"], place) in seen:
            return False
        version = row.get("version")
        if version is not None and (not isinstance(version, int) or isinstance(version, bool)
                                    or version < 0):
            return False
        seen.add((row["archiveId"], place))
    return True
