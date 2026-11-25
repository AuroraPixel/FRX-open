"""Data contracts of the new interface (docs/play-contracts.md).

Turn blocks and the turn event stream, the state view, save summaries and the other read views,
request bodies, scene files and asset manifests. On the wire every field name is camelCase and an
absent optional field is left out rather than sent as null. tools/play_schema.py exports these
models as JSON Schema and TypeScript for the front end; edit them here, then regenerate.
"""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError


class Contract(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def wire(self) -> dict:
        """The JSON shape sent to the browser: camelCase names, absent fields left out."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


# Optional fields: allowed to be missing, never null on the wire.
OptStr = str | SkipJsonSchema[None]
OptInt = int | SkipJsonSchema[None]
OptFloat = float | SkipJsonSchema[None]
OptBool = bool | SkipJsonSchema[None]

Hour = Literal["night", "dawn", "day", "dusk"]
ItemType = Literal["武器", "护甲", "功法", "法宝", "消耗品", "材料", "重要物品", "其他物品"]
ErrorCode = Literal[
    "version_conflict",
    "turn_in_progress",
    "pending_settlement",
    "not_found",
    "unauthorized",
    "quota_exceeded",
    "input_too_large",
    "model_not_configured",
    "model_failed",
    "email_unavailable",
    "engine_failed",
    "cancelled",
    "refused",
    "forbidden",
    "busy",
    "too_many_attempts",
    "invalid_input",
]

# The two ways a save is played: the novel, as the old page plays it, and the cultivation life
# (修仙人生), whose saves carry data.state.frxPlay.
PlayMode = Literal["novel", "life"]
# The cultivation life's standing commands (常驻指令) in its first version; later work adds its
# own (travel, gather, hunt, ask, job, trade, craft …). refine (祭炼) and repair (修补) are done
# on a piece of gear and bind (认主) on a spirit beast, from their panels: the bar never lists
# them.
VerbKind = Literal["wait", "cultivate", "rest", "breakthrough", "perk", "elaborate", "travel",
                   "calm", "gather", "hunt", "ask", "job", "trade", "craft", "refine", "repair",
                   "bind", "visit", "array", "home", "duty", "contest", "follow"]
# A move in a fight of the cultivation life: 攻 术 物 御 遁 察, 和 while the foe listens, 驯
# (tame) a beast foe worn down enough (item 41), and 破 (break) while the foes' array stands.
MoveCommand = Literal["strike", "skill", "item", "guard", "flee", "probe", "talk", "tame", "break"]
# What the verb home does (洞府, gameplay plan item 45).
HomeAction = Literal["buy", "rent", "claim", "take", "build", "plant", "harvest", "leave"]
# How long the cultivation life's beats run (frxPlay.length): 简, 中, 详.
LengthTier = Literal["brief", "standard", "full"]


# ---------------------------------------------------------------- small shared pieces


class Gauge(Contract):
    current: int
    max: int


class Modifier(Contract):
    label: str
    value: int


class Party(Contract):
    name: str
    char_id: OptStr = None


class Mark(Contract):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    kind: Literal["name", "term", "em"]
    char_id: OptStr = None


class QueueItem(Contract):
    kind: Literal["use", "gift", "travel", "discard", "say", "other"]
    text: str = Field(min_length=1, max_length=200)
    item_id: OptStr = None
    quantity: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    char_id: OptStr = None
    place_id: OptStr = None
    silent: OptBool = None
    # An `other` chip the server queued (a spirit beast's evolution after feeding): the line the
    # model gets, as the old page queued it; `text` is only the chip's label.
    note: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=4000)


class Recipe(Contract):
    """A portrait recipe; the portrait kit's compose() takes it as is."""

    base: str
    face: str
    hair: str
    tint: OptStr = None
    body: str
    tilt: OptFloat = None
    trait: list[str] | SkipJsonSchema[None] = None
    gain: OptFloat = None
    rim: OptFloat = None


# ---------------------------------------------------------------- turn blocks


class ActionBlock(Contract):
    id: str
    type: Literal["action"]
    text: str
    queue: list[QueueItem] | SkipJsonSchema[None] = None


class NarrationBlock(Contract):
    id: str
    type: Literal["narration"]
    text: str
    marks: list[Mark] | SkipJsonSchema[None] = None


class Speaker(Contract):
    name: str
    char_id: OptStr = None
    role: OptStr = None
    is_self: bool | SkipJsonSchema[None] = Field(default=None, alias="self")


class SpeechBlock(Contract):
    id: str
    type: Literal["speech"]
    speaker: Speaker
    lines: list[str] = Field(min_length=1)


class CheckBlock(Contract):
    id: str
    type: Literal["check"]
    title: str
    roll: int
    modifiers: list[Modifier]
    total: int
    difficulty: int
    outcome: Literal["success", "failure", "critical_success", "critical_failure"]
    note: OptStr = None


class CombatBlock(Contract):
    id: str
    type: Literal["combat"]
    attacker: Party
    defender: Party
    move: str
    roll: int
    modifiers: list[Modifier]
    total: int
    defense: int
    hit: bool
    damage: OptInt = None
    defender_hp: Gauge | SkipJsonSchema[None] = None
    end: Literal["win", "lose", "flee"] | SkipJsonSchema[None] = None


class ReceiptLine(Contract):
    label: str
    value: OptStr = None
    delta: OptStr = None


class CultivateFx(Contract):
    name: Literal["cultivate"]
    seconds: float = Field(gt=0)


class BreakthroughFx(Contract):
    name: Literal["breakthrough"]
    success: bool
    realm: str


class ReceiptBlock(Contract):
    """What the engine settled. `close` (a scene's close), `gate` (an attempt at a gate) and
    `legacy` (the lifespan's end: 大限将至, a death of old age) are the cultivation life's own."""

    id: str
    type: Literal["receipt"]
    kind: Literal[
        "cultivate",
        "breakthrough",
        "gain",
        "loss",
        "quest",
        "trade",
        "rest",
        "injury",
        "stones",
        "skill",
        "close",
        "gate",
        "legacy",
    ]
    title: str
    lines: list[ReceiptLine]
    fx: (
        Annotated[CultivateFx | BreakthroughFx, Field(discriminator="name")]
        | SkipJsonSchema[None]
    ) = None


class EnterBlock(Contract):
    id: str
    type: Literal["enter"]
    char_id: str
    name: str
    role: OptStr = None
    relation: OptStr = None
    first: bool
    line: OptStr = None


Setting = Literal["outdoor", "indoor", "underground", "sky", "water"]
Terrain = Literal[
    "none", "cave", "shaft", "tunnel", "waterfall", "canyon", "cliff", "peak", "field", "forest",
    "river", "lake", "coast", "desert", "grassland", "snowfield", "swamp", "ruins", "abyss",
    "battlefield", "cloud_sea", "valley", "path", "town", "mountain",
]
Structure = Literal[
    "none", "bandit_hall", "hall", "hut", "dormitory", "room", "abode", "shop", "inn", "tavern",
    "teahouse", "storeroom", "cellar", "alchemy_room", "workshop", "study", "cell", "corridor",
    "tower", "tomb", "tent", "boat", "courtyard", "temple", "gate", "stockade", "camp",
    "pavilion", "bridge", "market", "stall", "arena", "terrace",
]
Feature = Literal[
    "herb_beds", "well", "bamboo", "pines", "waterfall", "stream", "pond", "rocks", "vines",
    "torches", "lanterns", "banners", "bones", "statue", "stele", "altar", "formation",
    "furnace", "cabinets", "books", "bunks", "weapons", "skins", "bars", "flowers", "reeds",
    "graves", "ice", "fire", "jars",
]


class PlaceLook(Contract):
    """What a place looks like (content/art/places.json, frx.play_places): where the player is,
    the ground, the building, what is in sight, narrow or open, the mood. A place keeps the look
    it first gets, so it looks the same on every visit; the look picks the painted scene or the
    kit, and the composer lays a composed place out by it."""

    setting: Setting
    terrain: Terrain
    structure: Structure
    features: list[Feature] = Field(max_length=4)
    scale: Literal["narrow", "open"]
    mood: Literal["calm", "lively", "tense", "eerie", "solemn", "desolate"]


class ComposedPlace(Contract):
    """A place whose scene is composed from its family's kit of painted pieces rather than shown as
    the family's one painting (docs/play-contracts.md 五): the page lays it out with the stage's
    composer from /play/assets/scenes/<kit>/kit.json, so the places of a family each look their
    own and the same place always looks the same. Its id seeds the layout; its name goes on the
    plaques; its region leans the colours and its words pick the subject. Its kind is the scene
    type of the place itself (content/art/scenes.json): a room composed for it takes after it (a
    shop on the coast, a cave in the forest, the hall of a temple). Its look is the place's own
    (PlaceLook), which picks the pieces of a kit laid out by setting, terrain and structure."""

    kit: str
    id: str
    name: str
    region: str
    description: OptStr = None
    kind: OptStr = None
    look: PlaceLook | SkipJsonSchema[None] = None


class SceneBlock(Contract):
    id: str
    type: Literal["scene"]
    scene_id: str
    place: str
    hour: Hour
    hour_name: str
    date: str
    weather: str
    indoor: bool
    composed: ComposedPlace | SkipJsonSchema[None] = None
    look: PlaceLook | SkipJsonSchema[None] = None


class OptionItem(Contract):
    index: int = Field(ge=1)
    text: str


class OptionsBlock(Contract):
    id: str
    type: Literal["options"]
    items: list[OptionItem]


# A first-time note of the cultivation life (life_turns.mark_play, content/life/prompt.json
# firstNotes): the first action cards, standing verb, clock and gate, and the first three scene
# closes (close, which the page shows under 接下来 rather than in the turn).
FirstNote = Literal["cards", "verb", "clock", "gate", "close"]


class NoticeBlock(Contract):
    id: str
    type: Literal["notice"]
    level: Literal["info", "warn", "error"]
    text: str
    action: Literal["retry", "resume", "reload"] | SkipJsonSchema[None] = None
    note: FirstNote | SkipJsonSchema[None] = None


class DeathBlock(Contract):
    """Extreme mode: the protagonist died this turn (the old page's alert) and the save has
    already started over from its opening. `deaths` counts his deaths, this one included."""

    id: str
    type: Literal["death"]
    text: str
    deaths: int = Field(ge=1)


# The cultivation life's blocks (saves with data.state.frxPlay; the novel never has them).


class ClockMark(Contract):
    """A pressure clock as an annals line shows it moved: its name and how many of its segments
    are full now."""

    name: str
    size: int = Field(ge=1)
    value: int = Field(ge=0)


class ChronicleBlock(Contract):
    """A line of the annals (年谱): a stretch of days the engine settled at once and wrote from a
    template, without the model. `date` is the game day it starts on (「正月初三」); `now` marks
    the latest line; `clock` the pressure clock that moved in it, drawn as its pips beside the
    line (gameplay plan item 18)."""

    id: str
    type: Literal["chronicle"]
    date: str
    text: str
    now: OptBool = None
    clock: ClockMark | SkipJsonSchema[None] = None


class MarkBlock(Contract):
    """Where a scene (一场戏) opens or closes: a mark across the page with the scene's name. In a
    save of the cultivation life a scene is one 回 of the book (plan item 38): `chapter` its
    number, and at the close `couplet` its 回目 (two lines apart by a full-width space, or the
    engine's own line when the model's did not hold)."""

    id: str
    type: Literal["mark"]
    kind: Literal["open", "close"]
    title: str
    chapter: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    couplet: OptStr = None


class BookLine(Contract):
    """A line of a volume's closing page or of 出关见闻: its day (none when unknown) and words."""

    date: "PlayDate | SkipJsonSchema[None]" = None
    text: str


class VolumeBlock(Contract):
    """The closing page of a volume of the book (卷末语, plan item 38): the volume that closed,
    why (a gate passed, a one-off great event's aftermath) and its name, the days it spans, the
    annals the engine picked from it, the words the model wrote for it (an event's is its
    aftermath's line), and the volume that opens."""

    id: str
    type: Literal["volume"]
    no: int = Field(ge=1)
    cause: Literal["gate", "event"] | SkipJsonSchema[None] = None
    name: OptStr = None
    since: "PlayDate | SkipJsonSchema[None]" = None
    until: "PlayDate | SkipJsonSchema[None]" = None
    annals: list[BookLine]
    text: OptStr = None
    next: int = Field(ge=2)


class EmergeBlock(Contract):
    """出关见闻 (plan item 38): after a stretch of years in one command, what the world did
    meanwhile, listed by the engine without the model: the calendar's events that passed (one line
    each, with how many times), the people's news and the world line's lines, in their order."""

    id: str
    type: Literal["emerge"]
    years: int = Field(ge=1)
    since: "PlayDate | SkipJsonSchema[None]" = None
    until: "PlayDate | SkipJsonSchema[None]" = None
    lines: list[BookLine]


class ActionCard(Contract):
    """One action card, priced by the engine. `index` counts from 1 and is what TurnRequest.act
    sends; `kind` is the action's type (交涉, 探查 …) and `glyph` its one character; `sub` the
    small line under the title (what it rolls against, the difficulty, the cost, what failing
    brings); `odds` the chance of success in percent and `tone` how good it is; `plain` a card
    taken without a roll (直行); `locked` a card the player does not qualify for, `reason` what
    is missing."""

    index: int = Field(ge=1)
    kind: str
    glyph: str
    title: str
    sub: str
    odds: int | SkipJsonSchema[None] = Field(default=None, ge=0, le=100)
    tone: Literal["good", "mid", "poor"] | SkipJsonSchema[None] = None
    locked: OptBool = None
    reason: OptStr = None
    plain: OptBool = None


class ActionsBlock(Contract):
    """The cultivation life's options: action cards (行动卡) in place of an options block.
    `fallback`: the model gave no cards, so the engine sorted its sentences into types."""

    id: str
    type: Literal["actions"]
    items: list[ActionCard]
    fallback: OptBool = None


class PerkChoice(Contract):
    """An insight on offer: `index` counts from 1 and is what Verb.index sends with kind perk;
    `text` says what it does; `rare` marks a rare one."""

    index: int = Field(ge=1)
    name: str
    text: str
    rare: OptBool = None


class PerksBlock(Contract):
    """The insights (悟得) offered after a major realm is broken: the player takes one of them."""

    id: str
    type: Literal["perks"]
    items: list[PerkChoice]


Block = Annotated[
    ActionBlock
    | NarrationBlock
    | SpeechBlock
    | CheckBlock
    | CombatBlock
    | ReceiptBlock
    | EnterBlock
    | SceneBlock
    | OptionsBlock
    | NoticeBlock
    | DeathBlock
    | ChronicleBlock
    | MarkBlock
    | ActionsBlock
    | PerksBlock
    | VolumeBlock
    | EmergeBlock,
    Field(discriminator="type"),
]


class Turn(Contract):
    """A turn of the save. In a save of the cultivation life the history also says the book's
    volume and 回 the turn ended in (`volume`, `chapter`; plan item 38), for its navigation."""

    id: str
    no: int = Field(ge=1)
    status: Literal["streaming", "done", "pending", "failed", "cancelled"]
    blocks: list[Block]
    at: str
    volume: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    chapter: int | SkipJsonSchema[None] = Field(default=None, ge=0)


class TurnPage(Contract):
    turns: list[Turn]
    more: bool


# ---------------------------------------------------------------- state view


class AttributeSource(Contract):
    source: str = Field(alias="from")
    value: int


class Attribute(Contract):
    key: str
    label: str
    base: int
    max: OptInt = None
    bonus: int
    total: int
    sources: list[AttributeSource]


class Character(Contract):
    id: str
    name: str
    sex: Literal["m", "f"] | SkipJsonSchema[None] = None
    realm: str
    realm_glyph: str
    role: OptStr = None
    hp: Gauge
    mp: Gauge
    attributes: list[Attribute]
    relation: OptStr = None
    affection: OptInt = None
    portrait: Recipe
    present: bool
    # Marked as bonded (the page's isBonded); absent when not.
    bonded: OptBool = None
    # Dead and remembered: a protagonist of this save who died of old age and went on in an heir
    # (gameplay plan item 49, frxPlay.lives); absent for everyone else.
    dead: OptBool = None


class Lifespan(Contract):
    age: int
    max: int


class Root(Contract):
    name: str
    multiplier: float


class Technique(Contract):
    item_id: str
    name: str
    layer: OptStr = None


class NamedText(Contract):
    name: str
    text: str


class Status(Contract):
    name: str
    text: OptStr = None


class Progress(Contract):
    per_day: float
    next: str
    ready: bool


class Player(Character):
    xp: Gauge
    lifespan: Lifespan
    stones: int
    root: Root
    technique: Technique | SkipJsonSchema[None] = None
    traits: list[NamedText]
    statuses: list[Status]
    progress: Progress | SkipJsonSchema[None] = None


class GearAttune(Contract):
    """A piece's refining (祭炼): the days done of the days its tier needs; until full it works at
    half."""

    done: int = Field(ge=0)
    need: int = Field(ge=0)


class Item(Contract):
    id: str
    name: str
    type: ItemType
    text: str
    effect: OptStr = None
    quantity: int = Field(ge=0)
    grade: Literal[1, 2, 3, 4, 5]  # card-era visual quality, separate from realm tier
    tier: OptStr = None
    attune: GearAttune | SkipJsonSchema[None] = None
    icon: str
    equippable: bool
    usable: bool


class Equipment(Contract):
    weapon: list[Item | None] = Field(min_length=6, max_length=6)
    armor: list[Item | None] = Field(min_length=6, max_length=6)
    technique: list[Item | None] = Field(min_length=6, max_length=6)
    treasure: list[Item | None] = Field(min_length=6, max_length=6)


class Skill(Contract):
    id: str
    name: str
    grade: OptStr = None
    layer: OptStr = None
    proficiency: Gauge | SkipJsonSchema[None] = None
    cost: OptStr = None
    text: str
    kind: Literal["technique", "spell", "misc"]


class Aptitude(Contract):
    """A beast's aptitude as the old page reads it: the grade (凡品 to 圣品) and the progress
    within it; feeding past `max` breaks through to the next grade."""

    tier: str
    current: int
    max: int


class Beast(Contract):
    id: str
    name: str
    level: OptStr = None
    species: str
    text: str
    hp: OptStr = None
    mp: OptStr = None
    skills: OptStr = None
    aptitude: Aptitude | SkipJsonSchema[None] = None
    affection: OptInt = None


class Quest(Contract):
    id: str
    title: str
    text: str
    reward: OptStr = None
    penalty: OptStr = None
    status: Literal["active", "done", "failed"]
    note: OptStr = None


class Clue(Contract):
    """A condition of the main line's chapter: its words, whether it is met, and for one that is
    counted (灵石, 持有) how many the player has of how many it wants (5 of 20)."""

    text: str
    done: bool
    pending: Literal[True] | SkipJsonSchema[None] = None
    have: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    need: int | SkipJsonSchema[None] = Field(default=None, ge=1)


class Mainline(Contract):
    """The current chapter of the save's storyline: its title, its goal and its conditions
    (clues, done by the engine's marks; a counted one with what the player has of what it
    wants), and the next chapter's title when the storyline has written one (`next`). A save
    of the cultivation life also has the storyline's title and hook (主线的名字和引子, plan
    item 26); a save of the novel never does."""

    chapter: str
    goal: str
    clues: list[Clue]
    title: OptStr = None
    hook: OptStr = None
    next: OptStr = None


class Place(Contract):
    text: str
    region: str
    area: str
    poi: OptStr = None
    x: OptFloat = None
    y: OptFloat = None


class Clock(Contract):
    text: str
    date: str
    hour_name: str
    hour: Hour


class SceneRef(Contract):
    scene_id: str
    weather: str
    indoor: bool
    composed: ComposedPlace | SkipJsonSchema[None] = None
    look: PlaceLook | SkipJsonSchema[None] = None


# The cultivation life's part of the state view (StateView.play).


class PlayDate(Contract):
    """A game day as written (「正月初三」) and as numbers: a month has 30 days."""

    text: str
    year: int
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=30)


class PlayScene(Contract):
    """The scene under way: its name and how many beats it has had."""

    title: str
    beats: int = Field(ge=0)


class PlayVerbOption(Contract):
    """One of the choices a command takes before it goes (狩猎: the tiers of beast this place
    has): `value` what the verb sends (狩猎's tier), `label` its words (一阶)."""

    value: str
    label: str


class PlayVerb(Contract):
    """A standing command here and now: `kind` is what Verb.kind sends, `glyph` the character on
    its button, `label` its name (修炼); `main` the one to do now, `off` one that cannot be done
    now, `note` why, or a word on it; `options` the choices it takes (狩猎's tiers), one of which
    goes with it."""

    kind: VerbKind
    glyph: str
    label: str
    main: OptBool = None
    off: OptBool = None
    note: OptStr = None
    options: list[PlayVerbOption] | SkipJsonSchema[None] = None


class PlaceRealm(Contract):
    """The secret realm whose entrance is the player's place (gameplay plan item 32; the engine's
    realm.entrance): its id and name, whether it is open today, the day it closes (until, while
    open) or next opens (next, while closed), and off with the reason when it cannot be entered
    now (closed, already entered this opening, the realm or the identity it asks for, inside one
    already). 入秘境 is step { action: 'enter' }."""

    id: str
    name: str
    open: bool
    until: PlayDate | SkipJsonSchema[None] = None
    next: PlayDate | SkipJsonSchema[None] = None
    off: OptBool = None
    note: OptStr = None


class PlayPlace(Contract):
    """Where the player is in the cultivation life (gameplay plan item 27): the map place (none
    off the map), its kind (城镇, 坊市, 宗门 …), its aura (无, 薄, 中, 浓), its danger in words
    (太平, 偶有凶险 …), the venues it has (客栈, 茶肆, 店铺 …), and the secret realm whose entrance
    is here (realm), when there is one."""

    name: OptStr = None
    kind: str
    aura: str
    danger: str
    venues: list[str]
    realm: PlaceRealm | SkipJsonSchema[None] = None


class MindMark(Contract):
    """A realm's 心境 threshold and whether the player's 心境 has reached it."""

    realm: str
    need: int = Field(ge=0)
    met: bool


class PlayMind(Contract):
    """心境 (阅历, gameplay plan item 36): the number, which only rises; `text` is the character
    panel's line (「阅历 62 · 筑基要 30，已到 · 结丹要 100」); `now` the current major realm's
    threshold (below it cultivating is halved), `next` the next gate's (below it the gate is
    shut)."""

    value: int = Field(ge=0)
    text: str
    now: MindMark | SkipJsonSchema[None] = None
    next: MindMark | SkipJsonSchema[None] = None


class PlayNear(Contract):
    """A place the player may set out for (the 去处 list, gameplay plan item 28): a map place of
    the same main region, its kind and venues, the distance on the map and the days it takes on
    foot (路程 ÷ 日行, rounded up)."""

    name: str
    kind: str
    venues: list[str]
    distance: int = Field(ge=0)
    days: int = Field(ge=1)


class PlayClock(Contract):
    """A pressure clock (压力钟): something closing in, `value` of its `size` segments filled;
    `note` says how to turn it back."""

    id: str
    name: str
    size: int = Field(ge=1)
    value: int = Field(ge=0)
    note: str


class CalendarEntry(Contract):
    """Something ahead on the calendar: the day, what, where, and how many days off. `kind` says
    whose it is: the region's fixed events (固), what the plot's director scheduled (局), or what
    the engine registered for the player (己: a gate's cooldown)."""

    date: str
    title: str
    place: OptStr = None
    days: int = Field(ge=0)
    kind: Literal["fixed", "own", "director"] | SkipJsonSchema[None] = None


class CalendarView(Contract):
    """GET /saves/{id}/calendar (gameplay plan item 14): the next years of the calendar, fixed
    events and the save's own, by date."""

    entries: list[CalendarEntry]


class Notice(Contract):
    """A notice on a board (告示, gameplay plan item 35): its kind (采药, 猎妖, 护送, 寻人, 矿役),
    title and text, the map place where it is done and how (goal: travel there, gather there,
    hunt a beast there, play a scene out there), the days it gives once taken and the stones it
    pays; `taken` when the player took it."""

    id: str
    kind: str
    title: str
    text: str
    place: str
    goal: Literal["travel", "gather", "hunt", "scene"]
    days: int = Field(ge=1)
    pay: int = Field(ge=0)
    taken: OptBool = None


class NoticeBoard(Contract):
    """GET /saves/{id}/notices (gameplay plan item 35): the notices up at the player's map place
    this half-year (`open`: a 告示 or a 执事堂 is here), and the day they stand until."""

    place: OptStr = None
    open: bool
    until: PlayDate | SkipJsonSchema[None] = None
    notices: list[Notice]


class ShopGood(Contract):
    """A good on a shop's list (its catalogue id) or a thing of the bag the shop takes (its bag id,
    and `count` held): its name, measure word and the price of one piece; with the perk 识货, its
    true tier, its base price and this year's market price."""

    id: str
    name: str
    unit: str
    price: int = Field(ge=0)
    count: OptInt = None
    tier: OptStr = None
    base: OptInt = None
    market: OptInt = None


class ShopHaggle(Contract):
    """Whether this month's haggle at this shop is still to be had, and the percent it takes off
    a purchase (or adds to a sale)."""

    open: bool
    off: int = Field(ge=0, le=100)


class ShopView(Contract):
    """GET /saves/{id}/shop (gameplay plan item 35): what the shops at the player's map place sell
    this year (`sells`) and which of the bag's things they take (`buys`), each at its price;
    `open` whether a shop is here, `appraise` whether the player has 识货 (then the tiers and the
    prices behind them show)."""

    place: OptStr = None
    open: bool
    appraise: bool
    haggle: ShopHaggle
    sells: list[ShopGood]
    buys: list[ShopGood]


class PlayGate(Contract):
    """The next gate (下一关) in brief: the realm it opens, the chance now in percent, the
    foundation it would leave (虚浮, 稳固, 圆满) and what is still missing, each in a few words."""

    name: str
    odds: int = Field(ge=0, le=100)
    foundation: str
    missing: list[str]


class FightFoe(Contract):
    """A foe in the fight: what he means to do next when the player can see it (蓄势), and the
    small tags of his state."""

    char_id: str
    name: str
    intent: OptStr = None
    tags: list[str]


class FightSkill(Contract):
    """A skill 术 can cast now: its cost in words (耗法力八), the chance to hit in percent, and
    `off` when it cannot be cast now, `note` why (法力不足)."""

    skill_id: str
    name: str
    cost: OptStr = None
    odds: int | SkipJsonSchema[None] = Field(default=None, ge=0, le=100)
    off: OptBool = None
    note: OptStr = None


class FightCommand(Contract):
    """One of the fight's commands (攻 术 物 御 遁 察, 和 while the foe listens, 破 while the foes'
    array stands): `note` is its line (命中八成, 耗法力六); `hint` the one to use now, `used` one
    that is spent for this fight, `off` one that cannot be used now."""

    command: MoveCommand
    glyph: str
    note: str
    hint: OptBool = None
    used: OptBool = None
    off: OptBool = None


class BeltItem(Contract):
    """What hangs at the belt (腰带): the things 物 can use in a fight."""

    item_id: str
    name: str
    icon: str
    quantity: int = Field(ge=0)


class FightArray(Contract):
    """An array in the fight (gameplay plan item 43): laid by the player's side or the foes',
    `label` its name (困阵, 护府阵), its tier, the stones it still holds (`charge`) and the rounds
    they last, `power` 1 or less when it was laid badly (阵力减半)."""

    id: str
    name: str
    label: str
    side: Literal["player", "foes"]
    tier: str
    charge: int = Field(ge=0)
    rounds: int = Field(ge=0)
    power: float = Field(gt=0, le=1)


class FightOrder(Contract):
    """An order to the spirit beast fighting beside the player (item 41): 攻 扑击, 护 护主, 扰 扰敌;
    `off` with the reason in `note` while it will not heed one."""

    order: Literal["attack", "guard", "harass"]
    glyph: str
    label: str
    note: str
    off: OptBool = None


class FightBeast(Contract):
    """The spirit beast out with the player in the fight: its 气血, its temperament and what that
    makes it do by itself (`act`), whether it heeds an order now (its favour), and the orders."""

    id: str
    name: str
    hp: Gauge
    temperament: str
    act: OptStr = None
    heeds: bool
    orders: list[FightOrder]


class FightTame(Contract):
    """驯 (move tame) on offer: a beast foe worn below three tenths of its 气血, by its id and name;
    `odds` the chance in percent, or `off` with why it cannot be tried (a major realm above, no
    room to keep another)."""

    foe_id: str
    name: str
    glyph: str
    note: str
    odds: int | SkipJsonSchema[None] = Field(default=None, ge=0, le=100)
    off: OptBool = None


class PlayFight(Contract):
    """The fight under way: its round, the foes, the commands and the belt; `skills` what 术 can
    cast, each with its cost and its chance (the picker lists the save's skills without them);
    `arrays` the arrays in it, either side's (破 breaks the foes'); `beast` the spirit beast out
    fighting beside the player, and `tame` 驯 while a beast foe is worn down enough (item 41)."""

    round: int = Field(ge=1)
    foes: list[FightFoe]
    commands: list[FightCommand]
    belt: list[BeltItem]
    skills: list[FightSkill] | SkipJsonSchema[None] = None
    arrays: list[FightArray] | SkipJsonSchema[None] = None
    beast: FightBeast | SkipJsonSchema[None] = None
    tame: FightTame | SkipJsonSchema[None] = None


class BeastAptitude(Contract):
    """A beast's aptitude: its grade (凡品 …) and the points in it of the grade's most."""

    grade: str
    current: int
    max: int


class BeastUse(Contract):
    """What a beast of its species does for the player while it is out (代步, 寻药 …)."""

    name: str
    text: str


class BeastFood(Contract):
    """Something in the bag the beast can be fed (投喂): the food's tier, the factor its tier and
    element give, and the aptitude a feed may bring (low to high, crit on a lucky one)."""

    item_id: str
    name: str
    tier: OptStr = None
    factor: float
    same: OptBool = None
    low: int
    high: int
    crit: int


class BeastFeeds(Contract):
    """The feeds of this month: `used` of the month's `of`."""

    used: int = Field(ge=0)
    of: int = Field(ge=1)


class PlayBeast(Contract):
    """A spirit beast the player keeps (灵兽, item 41): its level and tier (1 for 一阶 …),
    temperament and what it
    does by itself, aptitude, 气血 and 法力, favour and whether it heeds orders, bound (认主) or the
    days of binding left, this month's feeds, out with the player, the days a bad hurt still
    takes to heal, the use of its species, and what in the bag it can be fed."""

    id: str
    name: str
    species: OptStr = None
    level: str
    tier: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    temperament: str
    act: OptStr = None
    aptitude: BeastAptitude
    hp: Gauge
    mp: Gauge
    favour: int
    heeds: bool
    bound: bool
    bind_days: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    feeds: BeastFeeds
    out: bool
    hurt_days: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    use: BeastUse | SkipJsonSchema[None] = None
    foods: list[BeastFood]


class PlayEgg(Contract):
    """An egg being hatched: the beast it will be, its tier as the catalogue names it (一阶…),
    and the days left."""

    id: str
    name: str
    tier: OptStr = None
    days: int = Field(ge=0)


class PlayBeasts(Contract):
    """The spirit beasts (item 41): how many are kept (eggs count) of how many the player can
    keep, the one out, each beast, and the eggs."""

    kept: int = Field(ge=0)
    cap: int = Field(ge=0)
    out: OptStr = None
    beasts: list[PlayBeast]
    eggs: list[PlayEgg]


class RealmNode(Contract):
    """A node of a secret realm's map: walked (on the player's path), open (in the next layer,
    to be taken), passed (a layer behind, not taken) or hidden (deeper). `kind` and its `glyph`
    (战 险 宝 歇 秘 守) show but for the hidden ones; the deepest 守 always shows."""

    id: str
    kind: OptStr = None
    glyph: OptStr = None
    state: Literal["walked", "open", "passed", "hidden"]


class RealmOther(Contract):
    """Someone else in the realm: a fellow disciple (mate) or a rival, and how many layers he has
    walked (0 to the depth; the depth is the exit)."""

    id: str
    name: str
    side: Literal["mate", "rival"]
    layer: int = Field(ge=0)


class RealmTaken(Contract):
    """What the realm has given the player so far."""

    name: str
    count: int = Field(ge=1)


class PlayRealm(Contract):
    """The secret realm the player is in (秘境, gameplay plan item 32): its name, the day it
    closes and the days left, its depth, how many layers are behind the player (`at`; the next is
    layers[at]) and `exit` once past the deepest, the map a layer a list, the others inside and
    what it gave."""

    id: str
    name: str
    until: PlayDate
    days_left: int = Field(ge=0)
    depth: int = Field(ge=1)
    at: int = Field(ge=0)
    exit: bool
    layers: list[list[RealmNode]]
    others: list[RealmOther]
    taken: list[RealmTaken]


class PlayToxin(Contract):
    """丹毒 (gameplay plan item 44): its value up to its cap, the lines on its bar (法力上限 at 50,
    修炼 slower at 70, the cap) and the effects in force, each in words."""

    value: int = Field(ge=0)
    cap: int = Field(ge=1)
    marks: list[int]
    effects: list[str]


class PlayPill(Contract):
    """A cultivation pill in the bag and what 耐药 leaves of it this major realm: how many were
    taken, how many more will still help, and the line for its detail (「此丹已服三枚，尚可见效两
    枚」)."""

    item_id: str
    name: str
    taken: int = Field(ge=0)
    left: int = Field(ge=0)
    text: str


class PlayLead(Contract):
    """An open question of the storyline (疑点, plan item 26): one of the director's numbered
    threads as the player may read it (never its truth), whether it is proven, where to look and
    the chapter it was written in."""

    id: str
    text: str
    proven: bool
    where: OptStr = None
    chapter: OptStr = None


class PlayKarma(Contract):
    """An entry of the ledger (因果, plan item 40): its seal (恩 someone owes you, 怨 someone hates
    you, 债 you owe someone, 诺 you promised), who, what, how it might come back, the year; a 诺's
    day; done once settled, broken a 诺 whose day passed."""

    id: str
    kind: Literal["恩", "怨", "债", "诺"]
    who: str
    what: str
    back: str
    year: int
    due: PlayDate | SkipJsonSchema[None] = None
    done: OptBool = None
    broken: OptBool = None


class PlayKnot(Contract):
    """A heart knot (心结, plan item 40): its kind, who, what and the year. Each takes one off a
    gate's odds (three at most); at 结丹 and 元婴 each is a 心魔 beat with a 神识 check."""

    id: str
    kind: Literal["背弃同伴", "滥杀", "失信", "见死不救", "夺人机缘"]
    who: str
    what: str
    year: int


class PlayThreadWho(Contract):
    """Whom a story thread is with: the person's id (C3 …) and name."""

    id: str
    name: str


class PlayThreadWhen(Contract):
    """When a story thread can be taken up: `from` and `to` in game time, to the hour
    ("0001-03-15 23:00"), and `text` the same in the calendar's words
    (三月十五子时至三月十六丑时)."""

    from_: str = Field(alias="from")
    to: str
    text: str


class PlayThread(Contract):
    """A story thread (线头, batch 9): something a scene left open for the player to take up — an
    appointment at a place and time, someone waiting on an answer, a thing promised. `text` says
    it in one line; `who` whom it is with; `place` the map place it is at and `spot` where there;
    `when` the window it can be taken up in (within sixty days of when it was left); `item` a
    thing in the bag it needs; `since` when it was left and `expires` the last moment it can be
    taken up if there is a deadline, both in game time to the hour ("0001-03-15 20:00").
    `from` names the scene that left the thread. The follow verb takes it up inside its
    window, the scene opening with its people; past `expires` it is missed, with an annals line.
    Six are open at most."""

    id: str
    text: str
    who: PlayThreadWho | SkipJsonSchema[None] = None
    place: str
    spot: OptStr = None
    when: PlayThreadWhen | SkipJsonSchema[None] = None
    item: OptStr = None
    since: str
    expires: OptStr = None
    from_: str = Field(alias="from")


class PlayBook(Contract):
    """Where the player is in the book (plan item 38): the volume under way and the last 回 (a
    scene is one; 0 before the first). The page's title says 第几回, its right side 第几卷."""

    volume: int = Field(ge=1)
    chapter: int = Field(ge=0)


class BookChapter(Contract):
    """One 回 of the book: its number, its scene's name and 回目, and the turn it opened in."""

    no: int = Field(ge=1)
    title: OptStr = None
    couplet: OptStr = None
    turn: int = Field(ge=1)


class BookVolume(Contract):
    """One volume of the book: its number, why it closed and its name (none while under way), the
    days it spans, its closing page's words, the first turn of the history in it (`turn`, none
    when the history has none: where the history jumps to for the volume), and its 回."""

    no: int = Field(ge=1)
    cause: Literal["gate", "event"] | SkipJsonSchema[None] = None
    name: OptStr = None
    since: PlayDate | SkipJsonSchema[None] = None
    until: PlayDate | SkipJsonSchema[None] = None
    text: OptStr = None
    turn: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    chapters: list[BookChapter]


class BookView(Contract):
    """GET /saves/{id}/book (plan item 38): the book's volumes and their 回, for the history's
    navigation by volume and chapter; the volume under way last."""

    volume: int = Field(ge=1)
    chapter: int = Field(ge=0)
    volumes: list[BookVolume]


class Verb(Contract):
    """A standing command of the cultivation life (常驻指令). How long: `days`, `until` a game
    day ("0001-03-15", the year, month and day) or `full` (until the cultivation is full);
    `stones` cultivates with spirit stones; `hours` rests 1 to 12 hours; `aids` are the pills
    taken at a gate, by bag id, one entry a pill; `index` picks an insight on offer (perk);
    `turnId` is the turn whose annals line the model writes out (elaborate); `to` is the map place
    a journey goes to (travel); `clock` the pressure clock 守拙 turns back a step (calm); `days`
    also how long to gather (gather, 1 to 10), `tier` the tier of beast to hunt (hunt: 一阶 …);
    `by` is the check asking around rolls (ask: 探查 or 交涉, the better one when left out); `id`
    is the notice taken (job) or the good bought (its catalogue id) or sold (its bag id) (trade),
    `side` buy or sell, `count` how many, and `haggle` a 交涉 for a better price first, once a
    month at a shop (trade); `recipe` is the recipe crafted from (its name or bag id), `batches`
    how many batches (1 to 10) and `hire` has a craftsman do it for stones instead (craft); `id`
    is also the piece of gear refined (refine, 祭炼: `days` at most, the rest of its attunement
    when left out) or mended (repair, 修补: by the player's own hand with a material from the
    bag, or by a smith for stones with `smith`), by its bag id or its worn id; and the spirit
    beast bound (bind, 认主: its row id, P1 …), and the story thread taken up (follow: its id, T1 …;
    PlayView.threads). `name` is the array laid (array: 聚灵 禁制 隐匿
    护府 where the player is, or before a fight 困 杀 幻 护), `item` the disc or flags it takes (a
    bag id or a name; the best the 布阵 mastery reaches when left out), `charge` the stones a
    fight array or a 护府 holds, `person` the one lured in, and `repair` takes a broken teleport
    array's errand instead (array; gameplay plan item 43). `action` is what is done about the
    home (home: buy, rent, claim, take from `person`, build the `room`, plant the herb `item`
    (`count` of it), harvest, leave; item 45)."""

    kind: VerbKind
    days: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    until: str | SkipJsonSchema[None] = Field(
        default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$"
    )
    full: OptBool = None
    stones: OptBool = None
    hours: int | SkipJsonSchema[None] = Field(default=None, ge=1, le=12)
    aids: list[str] | SkipJsonSchema[None] = Field(default=None, max_length=10)
    index: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    turn_id: OptStr = None
    to: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=40)
    clock: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=20)
    tier: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=10)
    by: Literal["探查", "交涉"] | SkipJsonSchema[None] = None
    id: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=60)
    side: Literal["buy", "sell"] | SkipJsonSchema[None] = None
    count: int | SkipJsonSchema[None] = Field(default=None, ge=1, le=9999)
    haggle: OptBool = None
    recipe: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=40)
    batches: int | SkipJsonSchema[None] = Field(default=None, ge=1, le=10)
    hire: OptBool = None
    smith: OptBool = None
    name: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=10)
    item: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=60)
    charge: int | SkipJsonSchema[None] = Field(default=None, ge=1, le=1_000_000_000)
    person: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=20)
    repair: OptBool = None
    action: HomeAction | SkipJsonSchema[None] = None
    room: Literal["丹房", "器室"] | SkipJsonSchema[None] = None


# Where a thing to do next (PlayView.next) comes from: the main line (the director's chapter), a
# full clock, an event due, what blocks the next gate (内伤, 修为, 心境, the method; or the gate
# itself, open), a hook tied to another place, the notices or the shop here, the calendar, a story
# thread a scene left open (PlayView.threads; its verb follow).
HintKind = Literal[
    "main", "clock", "event", "injury", "cultivate", "mind", "method", "gate", "hook", "notice",
    "shop", "calendar", "earn", "job", "thread",
]


class HomeBed(Contract):
    """A bed of the home's herb garden: the herb and how many were planted, the day they are ripe
    ("0002-01-05") and whether that day has come."""

    id: str
    herb: str
    count: int = Field(ge=1)
    due: str
    ripe: bool


class HomeSeed(Contract):
    """An herb in the bag the home's garden takes (a catalogue good of the garden's class): its
    id in the bag, its name and how many there are."""

    id: str
    name: str
    count: int = Field(ge=1)


class HomeRent(Contract):
    """A rented home's rent: the yearly sum in spirit stones and the day the next is due."""

    yearly: int = Field(ge=0)
    due: str


class PlayHome(Contract):
    """The player's home (洞府, gameplay plan item 45): the map place it is at, its name and aura,
    its rooms (丹房, 器室), how it was had (buy, rent, claim, take), since when, the herb garden
    (`plots` beds at most) and the bag's herbs it takes (`seeds`), the rent of a rented one, and
    whether the player is there now (`here`). The arrays laid there are PlayArrays."""

    place: str
    name: str
    aura: str
    rooms: list[str]
    how: Literal["buy", "rent", "claim", "take"]
    since: str
    garden: list[HomeBed]
    plots: int = Field(ge=0)
    seeds: list[HomeSeed] = []
    rent: HomeRent | SkipJsonSchema[None] = None
    here: bool


class LaidArray(Contract):
    """An array laid where the player is (gameplay plan item 43): standing ones (聚灵 禁制 隐匿
    护府) or ones laid before a fight (困 杀 幻 护, on its `ground`: 守洞府, 伏击,
    引人入阵); `label` its name, its tier, `power` 1 or less when laid badly, the stones it holds
    (`charge`, a fight array's or a 护府's)."""

    id: str
    name: str
    label: str
    tier: str
    power: float = Field(gt=0, le=1)
    charge: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    ground: OptStr = None


class TeleportLink(Contract):
    """Where a teleport array goes and what a crossing costs in spirit stones."""

    to: str
    stones: int = Field(ge=0)


class TeleportStation(Contract):
    """The teleport array where the player is: its links; `broken` while its repair errand
    (`repair`, the 差事's title, taken with the verb array's `repair`) is not done."""

    links: list[TeleportLink]
    broken: OptBool = None
    repair: OptStr = None


class PlayArrays(Contract):
    """The arrays where the player is: the standing ones (`laid`), the ones laid before a fight
    (`field`), and the teleport array of the place (`station`)."""

    laid: list[LaidArray]
    field: list[LaidArray]
    station: TeleportStation | SkipJsonSchema[None] = None


class PlayHint(Contract):
    """One thing to do next (接下来, the engine's apps/engine/life/hints.cjs): `text` says it in a
    few words, `kind` where it comes from, `verb` the standing command that does it, ready to send
    as it is (wait until the injury heals, cultivate, travel, ask, breakthrough) or to open (job
    opens the notices, trade the shop)."""

    text: str
    kind: HintKind
    verb: Verb | SkipJsonSchema[None] = None


# A worn piece's kind of slot (content/life/gear.json slots): 武器, 护甲, 法宝, 功法.
GearSlot = Literal["weapon", "armor", "treasure", "technique"]


class GearStolen(Contract):
    """Whom a stolen piece (赃物) was taken from, and his faction (or his region) where using or
    selling it raises a clock."""

    owner: str
    faction: OptStr = None


class GearPiece(Contract):
    """A piece of gear, worn or in the bag, as the cultivation life reads it (gameplay plan items 33
    and 34; apps/engine/life/gear.cjs view): its tier (一阶 …) and quality (下品 … for a catalogue
    good), the refining, the condition (残, 常 or 精), `damaged` (its effect halved until mended),
    `stolen`, its traits by name, and `above`: how many tiers it stands above the player's (one
    works at a cost, two cannot be used)."""

    name: str
    slot: GearSlot
    tier: str
    quality: OptStr = None
    attune: GearAttune
    condition: str
    damaged: OptBool = None
    stolen: GearStolen | SkipJsonSchema[None] = None
    traits: list[str]
    above: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    unusable: OptStr = None


class GearActive(Contract):
    """A worn piece that counts (生效): its slot, `role` main or aux for a method, and what it
    gives now (`bonus`: a stat's name → points)."""

    id: str
    slot: GearSlot
    role: Literal["main", "aux"] | SkipJsonSchema[None] = None
    bonus: dict[str, int]


class GearInactive(Contract):
    """A worn piece that does not count, and why (「备用，不算数」, two tiers up)."""

    id: str
    slot: GearSlot
    reason: str


class BeltThing(Contract):
    """A thing at the belt (腰带): what 物 can use in a fight."""

    item_id: str
    name: str
    quantity: int = Field(ge=0)
    type: str


class PlayGear(Contract):
    """The gear of the cultivation life (gameplay plan items 33 and 34): the worn pieces that count
    and those that do not, the belt (its five places, null where empty), every piece worn or in the
    bag by its bag id, and the player's totals with the gear that counts."""

    active: list[GearActive]
    inactive: list[GearInactive]
    belt: list[BeltThing | None]
    pieces: dict[str, GearPiece]
    totals: dict[str, int | float]


class SectNext(Contract):
    """The next step of the sect's ladder and what it asks: the realm and the contribution earned
    in all; `met` when both are there (promote can be asked)."""

    status: str
    realm: str
    earned: int
    met: bool


class SectTask(Contract):
    """A duty of the sect's list (sects.json duties): its id, title, days and contribution."""

    id: str
    title: str
    days: int = Field(ge=1)
    contribution: int = Field(ge=0)


class SectDuty(Contract):
    """The year's duty: done of need duties in the year from `since` (a year without one starts
    the 门规责罚 clock); `assigned` the duty the sect gave at the start (its id); `next` the duty
    the verb duty would do now (the assigned one, else the first)."""

    done: int = Field(ge=0)
    need: int = Field(ge=0)
    since: OptStr = None
    assigned: OptStr = None
    next: SectTask | SkipJsonSchema[None] = None


class SectContest(Contract):
    """A contest of the sect (小比 every year, 大比 every three): its next day ("0001-08-15";
    this one's while it runs), how many days it runs and every how many years; `open` while it
    runs (the verb contest), `entered` when signed up for it."""

    name: str
    date: str
    days: int = Field(ge=1)
    every: int = Field(ge=1)
    open: OptBool = None
    entered: OptBool = None


class SectOffer(Contract):
    """One entry of the sect's exchange: in a hall (藏经阁, 丹房, 器库), its price in
    contribution and the status it asks; `off` with `note` when it cannot be had now."""

    id: str
    hall: str
    name: str
    price: int = Field(ge=0)
    status: str
    off: OptBool = None
    note: OptStr = None


class SectEntered(Contract):
    """The contest signed up for (小比 or 大比) and its day ("0001-08-15")."""

    contest: str
    date: str


class PlaySect(Contract):
    """The player's sect (gameplay plan item 46): its name, the status on the ladder (记名 外门
    内门 真传 执事 长老), the contribution that can be spent and all ever earned, the stipend a
    month in spirit stones, the next step, the year's duty, the exchange and the contest signed up
    for. None for a loose cultivator, who has no stipend and no duty."""

    name: str
    status: str
    contribution: int
    earned: int
    stipend: int = Field(ge=0)
    place: OptStr = None
    here: OptBool = None
    next: SectNext | SkipJsonSchema[None] = None
    duty: SectDuty
    exchange: list[SectOffer]
    contests: list[SectContest] | SkipJsonSchema[None] = None
    entered: SectEntered | SkipJsonSchema[None] = None


class JoinSect(Contract):
    """A sect one may join: its name and the map place of its gate (none for one without)."""

    name: str
    place: OptStr = None


class JoinFair(Contract):
    """开院会: where it is held, its next day ("0011-09-09"; this one's while it runs), `open`
    while it runs, and `why` it would not take the player now (「要先到泊灯城」,
    「只收二十岁以下的」)."""

    name: str
    place: str
    date: OptStr = None
    open: OptBool = None
    why: OptStr = None


class JoinToken(Contract):
    """听澜帖: whether one is in the bag (joining with it uses it up)."""

    name: str
    have: bool


class PlayJoining(Contract):
    """How a loose cultivator gets into a sect (gameplay plan item 46): the sects, 开院会 and
    听澜帖; POST …/actions sect_join with `sect` and `by` (fair or token)."""

    sects: list[JoinSect]
    fair: JoinFair
    token: JoinToken


class LegacyHeir(Contract):
    """Who may go on after the protagonist (gameplay plan item 49): a 道侣 or a 弟子 of the ties
    who lives, with the realm and the age they have now."""

    id: str
    name: str
    kind: str
    realm: OptStr = None
    age: OptInt = None
    gender: OptStr = None


class LegacyEulogy(Contract):
    """An old acquaintance's words on the dead (the model's, written in the dying turn): who
    (their id, name and tie to the dead, '' for none) and what they said."""

    id: OptStr = None
    name: str
    kind: OptStr = None
    text: str


class PlayLegacy(Contract):
    """The lifespan's end (gameplay plan item 49). `twilight`: ten years or fewer are left (the
    status column says 大限将至): the age, the lifespan, the years left and the day it runs out
    (`ends`, "0011-01-01"). `choosing`: the protagonist died of old age (坐化) on `died` at
    `place`, and every verb waits until the heir is chosen (POST /actions inherit): one of
    `heirs`, or a new one whose root is `root` (drawn after the dying turn, absent until then);
    `words` is the last word said when the player writes none; `eulogies` are the old
    acquaintances' words (absent until written, [] when they could not be)."""

    state: Literal["twilight", "choosing"]
    age: OptInt = None
    lifespan: OptInt = None
    left: OptInt = None
    ends: OptStr = None
    name: OptStr = None
    realm: OptStr = None
    died: OptStr = None
    place: OptStr = None
    heirs: list[LegacyHeir] | SkipJsonSchema[None] = None
    root: OptStr = None
    words: OptStr = None
    eulogies: list[LegacyEulogy] | SkipJsonSchema[None] = None


class LifeLine(Contract):
    """A line of a life's annals worth keeping (a gate, a death, a feud, a secret realm …): its
    day ("正月初四"), its kind (content/life/chronicle.json templates) and its words."""

    date: str
    kind: OptStr = None
    text: str


class LifeYear(Contract):
    """A year of a life: the game year, the age in it and the lines worth keeping."""

    year: int
    age: OptInt = None
    lines: list[LifeLine]


class LifeGate(Contract):
    """A gate passed: the day ("0012-03-04"), the age, the gate (its realm and name) and the
    realm reached, with the foundation it was passed on."""

    date: str
    age: OptInt = None
    gate: OptStr = None
    name: OptStr = None
    to: str
    foundation: OptStr = None


class LifeLeft(Contract):
    """What the protagonist left behind: the home's name, the things in the vault (仓库) and in
    the bag, the spirit stones, the last word and the heir who took it all (name and kind: 道侣,
    弟子 or 后人; absent until chosen)."""

    home: OptStr = None
    vault: list[str]
    bag: list[str]
    stones: int = Field(ge=0)
    words: OptStr = None
    heir: OptStr = None
    heir_kind: OptStr = None


class LifeView(Contract):
    """GET /saves/{id}/life (gameplay plan item 49): a whole life as data, for the chronicle
    page. By default the latest life that ended (`index` among the `lives` that ended, oldest
    first; ?index= for an earlier one); the protagonist's own while they await their heir; the
    life under way (alive, no end, no eulogies) when none has ended. Year by year the lines
    worth keeping, every gate passed, the volumes of the book this life saw (item 38's, as GET
    …/book gives them: why each closed, its days, its closing words and its 回; the one under way
    last), what was left behind and the old acquaintances' eulogies (written by the model in the
    dying turn; none when it could not).
    Each year has the age in it (the age goes up at every new year; a save's calendar starts at
    year 1, so the years before it are not there)."""

    name: str
    gender: OptStr = None
    realm: OptStr = None
    age: OptInt = None
    lifespan: OptInt = None
    died: OptStr = None
    place: OptStr = None
    alive: bool
    index: OptInt = None
    lives: int = Field(ge=0)
    years: list[LifeYear]
    gates: list[LifeGate]
    volumes: list[BookVolume]
    left: LifeLeft | SkipJsonSchema[None] = None
    eulogies: list[LegacyEulogy]


class PlayView(Contract):
    """The cultivation life's state (saves with data.state.frxPlay): the game day, age and
    lifespan, the 心境, the place and the nearest places to set out for (near, nearest first),
    the scene under way, the standing commands, the pressure clocks, the next five things on the
    calendar, the next gate, the fight under way, the secret realm the player is in, 丹毒 and the
    pills with what 耐药 leaves of them, the gear (what counts, the belt, each piece's marks),
    the storyline's open questions (leads, open ones first), the ledger (karma, open entries
    first), the heart knots, the story threads the scenes left open (threads, the nearest to run
    out first), the player's sect, next: at most three things to do now (接下来), the player's
    home and the arrays where the player is, the spirit beasts (beasts), and legacy: the
    lifespan's last years and its end."""

    date: PlayDate | SkipJsonSchema[None] = None
    age: OptInt = None
    lifespan: OptInt = None
    mind: PlayMind | SkipJsonSchema[None] = None
    place: PlayPlace | SkipJsonSchema[None] = None
    near: list[PlayNear] | SkipJsonSchema[None] = None
    scene: PlayScene | SkipJsonSchema[None] = None
    cards: list[ActionCard] | SkipJsonSchema[None] = None
    verbs: list[PlayVerb]
    clocks: list[PlayClock]
    calendar: list[CalendarEntry]
    gate: PlayGate | SkipJsonSchema[None] = None
    fight: PlayFight | SkipJsonSchema[None] = None
    realm: PlayRealm | SkipJsonSchema[None] = None
    toxin: PlayToxin | SkipJsonSchema[None] = None
    pills: list[PlayPill] | SkipJsonSchema[None] = None
    gear: PlayGear | SkipJsonSchema[None] = None
    leads: list[PlayLead] | SkipJsonSchema[None] = None
    karma: list[PlayKarma] | SkipJsonSchema[None] = None
    knots: list[PlayKnot] | SkipJsonSchema[None] = None
    threads: list[PlayThread] | SkipJsonSchema[None] = None
    book: PlayBook | SkipJsonSchema[None] = None
    next: list[PlayHint] | SkipJsonSchema[None] = None
    home: PlayHome | SkipJsonSchema[None] = None
    arrays: PlayArrays | SkipJsonSchema[None] = None
    beasts: PlayBeasts | SkipJsonSchema[None] = None
    sect: PlaySect | SkipJsonSchema[None] = None
    joining: PlayJoining | SkipJsonSchema[None] = None
    legacy: PlayLegacy | SkipJsonSchema[None] = None


class StateView(Contract):
    version: int
    turn_no: int
    # A fresh cultivation life's first request. Stable across page reloads and tabs;
    # omitted once any turn has been attempted, including failed or undone turns.
    opening_request_id: OptStr = None
    player: Player
    equipment: Equipment
    bag: list[Item]
    skills: list[Skill]
    beasts: list[Beast]
    quests: list[Quest]
    mainline: Mainline | SkipJsonSchema[None] = None
    people: list[Character]
    place: Place
    time: Clock
    scene: SceneRef
    in_combat: bool
    # The cultivation life's saves only: the novel's state view has no `play`.
    play: PlayView | SkipJsonSchema[None] = None


class Change(Contract):
    path: str
    label: str
    before: OptStr = Field(default=None, alias="from")
    after: OptStr = Field(default=None, alias="to")


# ---------------------------------------------------------------- the turn event stream


class TurnRef(Contract):
    id: str
    no: int


class TurnStartEvent(Contract):
    seq: int
    event: Literal["turn"]
    turn: TurnRef


class BlockEvent(Contract):
    seq: int
    event: Literal["block"]
    block: Block


class OpenEvent(Contract):
    seq: int
    event: Literal["open"]
    block: NarrationBlock


class TextEvent(Contract):
    seq: int
    event: Literal["text"]
    block_id: str
    delta: str


class CloseEvent(Contract):
    seq: int
    event: Literal["close"]
    block_id: str
    replace: Block | SkipJsonSchema[None] = None


class ResetEvent(Contract):
    seq: int
    event: Literal["reset"]
    keep: list[str]


class SettlingEvent(Contract):
    """The reply is all here: the server settles and commits the turn, no model call left."""

    seq: int
    event: Literal["settling"]


class WaitingEvent(Contract):
    """The turn waits for the work after the turn before before it starts (a world evolution
    that is due): `text` says what for, in words for the player; empty when the wait is over."""

    seq: int
    event: Literal["waiting"]
    text: str


class StateEvent(Contract):
    seq: int
    event: Literal["state"]
    state: StateView
    changes: list[Change]


class DoneEvent(Contract):
    seq: int
    event: Literal["done"]
    turn: Turn
    version: int


class ErrorEvent(Contract):
    seq: int
    event: Literal["error"]
    code: ErrorCode
    message: str
    retryable: bool
    retry_after: OptInt = None


TurnEvent = Annotated[
    TurnStartEvent
    | BlockEvent
    | OpenEvent
    | TextEvent
    | CloseEvent
    | ResetEvent
    | SettlingEvent
    | WaitingEvent
    | StateEvent
    | DoneEvent
    | ErrorEvent,
    Field(discriminator="event"),
]


# ---------------------------------------------------------------- saves and read views


class SavePlayer(Contract):
    name: str
    realm: str
    realm_glyph: str
    portrait: Recipe


class SaveSummary(Contract):
    id: str
    name: str
    version: int
    player: SavePlayer
    place: str
    date: str
    hour_name: str
    turns: int
    last_played_at: str
    pending: bool
    # A save of the cultivation life is "life"; a save of the novel has no `play`.
    play: PlayMode | SkipJsonSchema[None] = None


class Poi(Contract):
    id: str
    name: str
    kind: str
    x: float
    y: float
    text: OptStr = None
    scene_id: str
    distance_km: OptFloat = None


class Area(Contract):
    id: str
    name: str
    pois: list[Poi]


class Region(Contract):
    id: str
    name: str
    areas: list[Area]


class Here(Contract):
    region_id: str
    area_id: str
    poi_id: OptStr = None
    x: float
    y: float


class MapView(Contract):
    regions: list[Region]
    here: Here


class PeopleView(Contract):
    present: list[Character]
    known: list[Character]


class Deed(Contract):
    at: str
    text: str


class PersonDetail(Character):
    background: OptStr = None
    deeds: list[Deed]
    biography: OptStr = None


class WorldEvent(Contract):
    at: str
    text: str


class Biography(Contract):
    char_id: OptStr = None
    title: str
    text: str


class EventsView(Contract):
    events: list[WorldEvent]
    biographies: list[Biography]


class NewsAction(Contract):
    text: str
    queue: QueueItem


class NewsIssue(Contract):
    """One daily paper. `no` numbers the issues from the first; `turn` is the turn it came
    with (none for one the save keeps apart from its turns): a paper's title and date repeat
    when several issues fall on one game day."""

    id: str
    no: int
    turn: OptInt = None
    date: str
    title: str
    paragraphs: list[str]
    actions: list[NewsAction]


class NewsView(Contract):
    issues: list[NewsIssue]


# ---------------------------------------------------------------- request bodies and errors


class Move(Contract):
    """A move in a fight of the cultivation life: the command and what it uses (a skill, an
    item at the belt) and at whom; `order` what the spirit beast fighting beside the player is
    told to do (attack, guard, harass), heeded when its favour is high enough (item 41)."""

    command: MoveCommand
    skill_id: OptStr = None
    item_id: OptStr = None
    target_id: OptStr = None
    order: Literal["attack", "guard", "harass"] | SkipJsonSchema[None] = None


class RealmStep(Contract):
    """A step in a secret realm (gameplay plan item 32): go into one open here today (enter;
    `realm` its id, the one open here when left out), take a node of the next layer (node, its
    id: 「3-2」), or leave past the deepest."""

    action: Literal["enter", "node", "leave"]
    node: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=16)
    realm: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=40)


class TurnRequest(Contract):
    """A turn: what the player wrote, the option picked, the queued chips; or, in the
    cultivation life, a standing command (verb), the action card picked (act, from 1), a move
    in a fight or a step in a secret realm. At most one of option, verb, act, move and step; a
    verb, an act, a move or a step comes alone, with no words written and nothing queued."""

    request_id: UUID
    version: int = Field(ge=1)
    input: str = Field(max_length=4000)
    option: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    queue: list[QueueItem] | SkipJsonSchema[None] = Field(default=None, max_length=20)
    verb: Verb | SkipJsonSchema[None] = None
    act: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    move: Move | SkipJsonSchema[None] = None
    step: RealmStep | SkipJsonSchema[None] = None

    @model_validator(mode="after")
    def one_way(self):
        ways = ("option", "verb", "act", "move", "step")
        given = [name for name in ways if getattr(self, name) is not None]
        # contract_rule: the message is the player's (play_errors.request_problem passes it on)
        if len(given) > 1:
            raise PydanticCustomError(
                "contract_rule", "选项、指令、行动卡、斗法的一手和秘境的一步，一回合只能给一样"
            )
        if given and given[0] != "option" and (self.input or self.queue):
            raise PydanticCustomError(
                "contract_rule",
                "发指令、选行动卡、斗法出手或在秘境里走一步时，不能另写行动或排行动签",
            )
        return self


class GateRequirement(Contract):
    """A hard requirement of a gate (硬条件): met or not, and what stands now (「96/100」)."""

    key: str
    label: str
    met: bool
    text: str


class GatePreparation(Contract):
    """Something a gate can be prepared with (能备的): `state` have (有), can (可, in reach) or
    miss (缺); `odds` what it adds to the die, `points` what it has earned the foundation."""

    key: str
    label: str
    state: Literal["have", "can", "miss"]
    text: str
    odds: OptInt = None
    points: OptInt = None


class GateNextGrade(Contract):
    """The foundation grade above, and how many points it still needs."""

    grade: str
    need: int = Field(ge=0)


class GateFoundation(Contract):
    """The foundation (根基) an attempt now would leave: its points and grade (虚浮, 稳固,
    圆满), the third of the attributes' growth it takes and the speed it adds."""

    points: int = Field(ge=0)
    grade: str
    growth: str
    speed: float
    next: GateNextGrade | SkipJsonSchema[None] = None


class GateCooldown(Contract):
    """No attempt before this day: written 「0001-03-03」 and 「三月初三」."""

    date: str
    text: str


class GateSheet(Contract):
    """GET /saves/{id}/gate (gameplay plan item 22): the next gate's preparation sheet (准备单),
    as the engine's gate op gives it. `gate` is the realm it opens and `name` what the gate is
    called, `to` the step it leads into; past the last gate `beyond` is true and `text` says so.
    `requires` the hard requirements, `prepares` what can be prepared; `odds` the chance now in
    percent, `terms` and `formula` what makes it, against `dc` (`tier`), `faces` the die's ten
    faces by outcome; `foundation` what an attempt now leaves; `cooldown` no attempt before it;
    `days` what an attempt takes; `ready` whether one can be made now, `missing` what is not."""

    gate: OptStr = None
    name: str
    to: OptStr = None
    beyond: OptBool = None
    text: OptStr = None
    requires: list[GateRequirement]
    prepares: list[GatePreparation]
    tier: OptStr = None
    dc: OptInt = None
    terms: list[Modifier] | SkipJsonSchema[None] = None
    extra: OptInt = None
    odds: int = Field(ge=0, le=100)
    faces: dict[str, int] | SkipJsonSchema[None] = None
    formula: OptStr = None
    foundation: GateFoundation | SkipJsonSchema[None] = None
    cooldown: GateCooldown | SkipJsonSchema[None] = None
    days: OptInt = None
    ready: bool
    missing: list[str]


class PreviewRequest(Contract):
    """POST /saves/{id}/preview (gameplay plan item 12): a standing command to look at before it
    is done; nothing is written."""

    verb: Verb


class NumberSpan(Contract):
    """A number before and after: 修为 from 96 to 100."""

    before: float
    after: float


class TextSpan(Contract):
    """Words before and after: the realm from 炼气十二层 to 炼气十三层."""

    before: str
    after: str


class FormulaTerm(Contract):
    """One term of the speed's product, as the cultivation receipt writes it: 灵根 ×1.0,
    灵气 薄 ×0.6, 灵石 ×1.5."""

    label: str
    value: str


class VerbPreview(Contract):
    """What a standing command would do if done now, worked out as doing it works it out
    (POST /saves/{id}/preview). `ok` is false when it cannot be done now, and `reason` says why.
    `minutes` is how long it takes and `ends` the day it ends; `lines` say it in words, in order,
    ready to show. `progress` is 修为 before and after; `realm` the realm before and after, when
    it moves. `stones` is the spirit stones it spends; when they run short of the whole stretch,
    `shortfall` is how many more it would need (the lines say how many days they last).
    `formula` is the speed's terms, one by one; `risk` the chance, in percent, that something
    comes in on the way; `odds` the chance of each outcome, in percent (炼制: 精, 常, 残 and 毁
    of a batch)."""

    ok: bool
    reason: OptStr = None
    minutes: int = Field(ge=0)
    ends: PlayDate | SkipJsonSchema[None] = None
    lines: list[str]
    progress: NumberSpan | SkipJsonSchema[None] = None
    realm: TextSpan | SkipJsonSchema[None] = None
    stones: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    shortfall: int | SkipJsonSchema[None] = Field(default=None, ge=0)
    formula: list[FormulaTerm]
    risk: int | SkipJsonSchema[None] = Field(default=None, ge=0, le=100)
    odds: dict[str, int] | SkipJsonSchema[None] = None


class VersionRequest(Contract):
    version: int = Field(ge=1)


class UndoRequest(VersionRequest):
    to_turn: int | SkipJsonSchema[None] = Field(default=None, ge=1)
    pending_turn_id: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=100)


class PanelAction(VersionRequest):
    """POST /saves/{id}/actions: gear on and off (itemId, slot), tidying the bag, marking a
    character as bonded or not (charId), feeding a spirit beast one consumable (beastId,
    itemId), and in the cultivation life the length of a scene's beats (length) and the belt
    (belt: `items`, the bag ids of what 物 can use in a fight, at most five; an empty list empties
    it). In the cultivation life gear goes on and off by the life's own rules (tiers, the main
    method, the active slots: apps/engine/life/gear.cjs), and the spirit beasts are the life's
    own (apps/engine/life/beasts.cjs): feed (beastId, itemId) at most a few times a month, out
    (beastId: the one that goes out with the player) and in, hatch (itemId: an egg from the bag)
    and promote (beastId, itemId: the thing that takes it a tier up). The sect (gameplay plan
    item 46): joining (sect, by: 开院会 or a 听澜帖), an exchange (offerId), promotion and
    signing up for a contest (contest: 小比 or 大比); a contest itself is a turn: the verb
    contest. After the protagonist died of old age (item 49): inherit, the heir who goes on
    (heir: one of PlayLegacy.heirs by id, or "new" with a name, a gender and maybe a
    portrait) and the last word (words; the default one when absent)."""

    action: Literal["equip", "unequip", "primary_technique", "tidy", "bond", "unbond",
                    "feed", "length", "belt",
                    "out", "in", "hatch", "promote", "sect_join", "sect_exchange",
                    "sect_promote", "sect_enter", "inherit"]
    item_id: OptStr = None
    slot: OptStr = None
    char_id: OptStr = None
    beast_id: OptStr = None
    length: LengthTier | SkipJsonSchema[None] = None
    items: list[Annotated[str, Field(min_length=1, max_length=60)]] | SkipJsonSchema[None] = (
        Field(default=None, max_length=5))
    sect: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=20)
    by: Literal["fair", "token"] | SkipJsonSchema[None] = None
    offer_id: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=40)
    contest: Literal["小比", "大比"] | SkipJsonSchema[None] = None
    heir: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=40)
    name: str | SkipJsonSchema[None] = Field(default=None, min_length=1, max_length=20)
    gender: Literal["男性", "女性"] | SkipJsonSchema[None] = None
    words: str | SkipJsonSchema[None] = Field(default=None, max_length=80)
    portrait: Recipe | SkipJsonSchema[None] = None


class PanelResult(Contract):
    state: StateView
    changes: list[Change]
    # Chips the action puts in the action queue (a beast's evolution goes into the next turn).
    queue: list[QueueItem] | SkipJsonSchema[None] = None


class UndoResult(Contract):
    state: StateView
    turns: int


class Birthplace(Contract):
    region_id: str
    area_id: str
    poi_id: OptStr = None


class CreationInput(Contract):
    name: str = Field(min_length=1, max_length=20)
    difficulty: str
    birth: str
    race: str
    # The body the portrait kit draws on (its bases are men or women); without `gender`, also
    # the gender: 男性 or 女性.
    sex: Literal["m", "f"]
    # The old page's four genders (CREATION_CONFIG.GENDERS), its 选择性别 cards.
    gender: Literal["男性", "女性", "男生女相", "扶她"] | SkipJsonSchema[None] = None
    # The page's 初始年龄 (1 to 999); absent: 16, as the page starts.
    initial_age: int | SkipJsonSchema[None] = Field(default=None, ge=1, le=999)
    # The page's 人称选择: the player is 我, 你 or {{user}} in the story; absent: 第二人称.
    pronoun: Literal["第一人称", "第二人称", "第三人称"] | SkipJsonSchema[None] = None
    attributes: dict[str, int]
    seed: str
    traits: list[str]
    root: str
    world_factors: list[str] | SkipJsonSchema[None] = None
    birthplace: Birthplace
    portrait: Recipe
    # New saves always use the cultivation life; novel creation is closed.
    play: Literal["life"] = "life"


class DrawRequest(Contract):
    """POST /creation/draw: the trait options of a round, or the spirit root of a round, drawn
    with the creation's seed."""

    seed: str = Field(min_length=1, max_length=100)
    kind: Literal["traits", "root"]
    round: int = Field(default=1, ge=1, le=2000)


class DirectorAttempt(Contract):
    """The last plot evolution run: ok, failed (with the reason) or skipped (its result came
    too late for the timeline, or the player was at a usage limit)."""

    status: Literal["ok", "failed", "skipped"]
    at: OptStr = None
    error: OptStr = None


class DirectorView(Contract):
    """GET /saves/{id}/director: plot evolution for this save (card_director.Director.status).
    `serverOwned`: the server runs it (its model passed tool admission), so it can be run now.
    `guidance` is 我的指示, the save's currentState.state.latestPlotGuidance."""

    server_owned: bool
    enabled: bool
    frequency: int
    running: bool
    turns_since: int
    plot_disabled: bool
    guidance: str
    last: DirectorAttempt | SkipJsonSchema[None] = None


class GuidanceRequest(VersionRequest):
    text: str = Field(max_length=2000)


class PlotSwitch(Contract):
    enabled: bool


class DirectorChange(Contract):
    """What a write to plot evolution answers: its status and the save's state view (the new
    version, the mainline shown or not)."""

    director: DirectorView
    state: StateView


# ---------------------------------------------------------------- what the creation offers
# GET /creation: the old page's CREATION_CONFIG as content/creation.json keeps it (its own
# upper-case names and Chinese keys), the limits and costs its steps keep in code, the player's
# own custom options, and the map a new save is born on.


class Difficulty(Contract):
    points: int
    extreme: bool
    desc: OptStr = None


class Origin(Contract):
    """A birth or a race: what choosing it costs, what it is, what it adds to the attributes."""

    cost: int
    desc: str
    bonus: dict[str, int]


class GenderOption(Contract):
    effects: list[str]


class Rarity(Contract):
    cost: int
    color: str


class CreationTrait(Contract):
    """A trait as the creation offers it. The player's own traits (custom.traits) may carry
    fields of their own, which are kept."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")

    name: str
    desc: OptStr = None
    effects: OptStr = None
    bonus: dict[str, int | float] | SkipJsonSchema[None] = None
    item: OptStr = None
    rarity: OptStr = None


class RootChoice(Contract):
    cost: int


class WorldFactor(Contract):
    desc: str
    effect: str


class CreationConfig(Contract):
    difficulties: dict[str, Difficulty] = Field(alias="DIFFICULTIES")
    attributes: dict[str, str] = Field(alias="ATTRIBUTES")
    births: dict[str, Origin] = Field(alias="BIRTHS")
    genders: dict[str, GenderOption] = Field(alias="GENDERS")
    races: dict[str, Origin] = Field(alias="RACES")
    trait_rarities: dict[str, Rarity] = Field(alias="TRAIT_RARITIES")
    traits: dict[str, list[CreationTrait]] = Field(alias="TRAITS")
    linggen: dict[str, RootChoice] = Field(alias="LINGGEN")
    world_factors: dict[str, WorldFactor] = Field(alias="WORLD_FACTORS")


class TraitDraw(Contract):
    cost: int
    options: int
    weights: dict[str, int]


class Cost(Contract):
    cost: int


class CreationDefaults(Contract):
    age: int
    pronoun: str
    avatar: str


class CreationRules(Contract):
    """What the old page's steps keep in code: each attribute 0 to attributeMax, at most
    maxTraits traits, a trait draw and a root draw cost points, a trait picked from the whole
    list costs traitPick.cost."""

    attribute_max: int
    max_traits: int
    trait_draw: TraitDraw
    trait_pick: Cost
    root_draw: Cost
    defaults: CreationDefaults


class CustomOptions(Contract):
    """The player's own traits, races, births and world factors, as the old page keeps them."""

    traits: list[dict[str, Any]]
    races: list[dict[str, Any]]
    births: list[dict[str, Any]]
    world_factors: list[dict[str, Any]]


# An outline on the map: its corners as [x, y].
Outline = list[Annotated[list[float], Field(min_length=2, max_length=2)]]


class BirthArea(Contract):
    id: str
    name: str
    outline: Outline | SkipJsonSchema[None] = None
    pois: list[Poi]


class BirthRegion(Contract):
    id: str
    name: str
    text: OptStr = None
    outline: Outline | SkipJsonSchema[None] = None
    areas: list[BirthArea]


class BirthMap(Contract):
    """The map a new save is born on, for picking the birthplace: regions with their outlines,
    their areas and places (a place without an area sits in an area named after its region).
    CreationInput.birthplace takes a region's, an area's and a place's id."""

    width: float
    height: float
    regions: list[BirthRegion]


class PlayAvailability(Contract):
    """Whether a save of the cultivation life can be created now; `reason` says why not (the
    main turn's model has not passed tool admission)."""

    available: bool
    reason: OptStr = None


class CreationOptions(Contract):
    config: CreationConfig
    rules: CreationRules
    custom: CustomOptions
    map: BirthMap
    play: PlayAvailability | SkipJsonSchema[None] = None


class DrawAnswer(Contract):
    """POST /creation/draw: six trait options, or a spirit root, and what the draw costs."""

    kind: Literal["traits", "root"]
    round: int
    cost: int
    traits: list[CreationTrait] | SkipJsonSchema[None] = None
    root: OptStr = None


class EvolutionSettings(Contract):
    """世界演化: the world's evolution, run every `frequency` turns."""

    enabled: bool
    frequency: int = Field(ge=1, le=50)


class PlotSettings(Contract):
    """剧情演化: the director moving the storyline on every `frequency` turns. Never chosen, it
    follows the director's default (on, every 5 turns, while the server runs it)."""

    enabled: bool
    frequency: int = Field(ge=1, le=1000)


class PaperSettings(Contract):
    """日报: a daily paper written after turns, every turn ('always'), every `rounds` turns
    ('rounds') or once a game day ('daily'), and whether its summary goes into the next turn's
    prompt."""

    enabled: bool
    frequency: Literal["always", "rounds", "daily"]
    rounds: int = Field(ge=1, le=100)
    into_prompt: bool


class MemorySettings(Contract):
    """记忆: archiving the story into memory every `frequency` turns, and recalling memories into
    each turn's prompt."""

    archive: bool
    frequency: int = Field(ge=1, le=100)
    recall: bool


class BiographySettings(Contract):
    """人物传记: keeping a biography of each person met, which the prompt then carries."""

    enabled: bool


class PlaySettings(Contract):
    """GET /settings answers every group; PUT changes only the groups it carries.

    `plot_runs` is only in answers: whether the server runs plot evolution at all, which it does
    while the evolution profile's model has passed tool admission; without it the plot switch is
    kept but has no effect. A PUT may carry it back; it changes nothing."""

    standing_note: OptStr = None
    evolution: EvolutionSettings | SkipJsonSchema[None] = None
    plot: PlotSettings | SkipJsonSchema[None] = None
    paper: PaperSettings | SkipJsonSchema[None] = None
    memory: MemorySettings | SkipJsonSchema[None] = None
    biographies: BiographySettings | SkipJsonSchema[None] = None
    plot_runs: bool | SkipJsonSchema[None] = None


class ErrorDetail(Contract):
    code: ErrorCode
    message: str


class ErrorBody(Contract):
    error: ErrorDetail


# ---------------------------------------------------------------- accounts (/api/play/account)

AuthMode = Literal["local", "accounts"]


class AccountOptions(Contract):
    """What the login page needs before anyone has signed in: whether the server has accounts
    at all ("local": no login, everyone is the built-in local player) and how new players
    register ("invite": with an invite code, "open": freely, "closed": only by an admin)."""

    mode: AuthMode
    registration: Literal["invite", "open", "closed"]
    email_login: OptBool = None
    email_registration: OptBool = None


class LoginRequest(Contract):
    username: str = Field(max_length=200)
    password: str = Field(max_length=1000)


class EmailCodeRequest(Contract):
    email: str = Field(min_length=3, max_length=320)


class EmailCodeSent(Contract):
    retry_after: int = Field(ge=1)
    expires_in: int = Field(ge=1)


class EmailLoginRequest(EmailCodeRequest):
    code: str = Field(pattern=r"^[0-9]{6}$", min_length=6, max_length=6)


class RegisterRequest(Contract):
    username: str = Field(max_length=200)
    password: str = Field(max_length=1000)
    invite: Annotated[str, Field(max_length=200)] | SkipJsonSchema[None] = None


class PasswordChange(Contract):
    old_password: str = Field(max_length=1000)
    new_password: str = Field(max_length=1000)


class AccountUser(Contract):
    id: str
    username: str
    role: Literal["admin", "player"]
    email: OptStr = None
    has_password: OptBool = None


class UsageTotals(Contract):
    """Model usage over a period: calls, tokens, the cost the model service reported (US
    dollars; costReported is false when some calls came without one) and main turns."""

    calls: int
    input_tokens: int
    output_tokens: int
    cost: float
    cost_reported: bool
    turns: int


class AccountLimits(Contract):
    """A player's limits; an absent field is no limit. cost and turns count the last 24
    hours, concurrentTurns the main turns at once; the rest is what may be kept."""

    cost: OptFloat = None
    turns: OptInt = None
    concurrent_turns: OptInt = None
    saves: OptInt = None
    save_bytes: OptInt = None
    image_bytes: OptInt = None


class Account(Contract):
    """GET /account: who is signed in, the usage of the last 24 hours and the limits.
    retryAt (ISO 8601, UTC) is there while a limit refuses new turns: when they may go again."""

    mode: AuthMode
    user: AccountUser
    usage: UsageTotals
    limits: AccountLimits
    retry_at: OptStr = None


class PurposeUsage(UsageTotals):
    purpose: str


class StoredView(Contract):
    saves: int
    image_bytes: int


class UsageReport(Contract):
    """GET /account/usage: the last 24 hours in all and by purpose, and what is stored."""

    since: str
    until: str
    total: UsageTotals
    by_purpose: list[PurposeUsage]
    stored: StoredView
    limits: AccountLimits


# ---------------------------------------------------------------- scene files

Vec3 = tuple[float, float, float]
Camera = tuple[float, float, float, float, float, float, float]
Rgb = tuple[float, float, float]


class Paint(Contract):
    order: OptFloat = None
    gain: OptFloat = None
    haze: OptFloat = None
    mist: OptFloat = None
    mist_lo: OptFloat = None
    mist_hi: OptFloat = None
    mist_gain: OptFloat = None
    mist_haze: OptFloat = None
    sink: tuple[float, float] | SkipJsonSchema[None] = None
    edge: OptFloat = None
    aura: OptFloat = None
    tint_night: Rgb | SkipJsonSchema[None] = None
    tint_day: Rgb | SkipJsonSchema[None] = None
    sat_day: OptFloat = None


class ArcLayer(Paint):
    type: Literal["arc"]
    file: str
    radius: float
    span: float
    azimuth: float
    aspect: float
    y: float
    flip: OptBool = None


class CardLayer(Paint):
    type: Literal["card"]
    file: str
    w: float
    h: float
    x: float
    y: float
    z: float
    face: OptBool = None
    flip: OptBool = None
    drift: OptFloat = None


class BankLayer(Paint):
    type: Literal["bank"]
    file: str
    rows: list[Vec3]
    aspect: float


Layer = Annotated[ArcLayer | CardLayer | BankLayer, Field(discriminator="type")]


class SkyRef(Contract):
    set: str
    azimuth: float
    horizon: float


class CameraPair(Contract):
    wide: Camera
    tall: Camera


class Cameras(Contract):
    idle: CameraPair
    read: CameraPair
    sheet: CameraPair
    cult: CameraPair
    close: CameraPair
    cine1: CameraPair
    cine2: CameraPair


class Anchors(Contract):
    player: Vec3
    aura: Vec3
    foe: Vec3 | SkipJsonSchema[None] = None


class HourTune(Contract):
    exposure: OptFloat = None
    fog: OptFloat = None
    mist: Rgb | SkipJsonSchema[None] = None
    key: Rgb | SkipJsonSchema[None] = None
    tint: Rgb | SkipJsonSchema[None] = None
    sat: OptFloat = None
    vignette: OptFloat = None


class Hours(Contract):
    night: HourTune | SkipJsonSchema[None] = None
    dawn: HourTune | SkipJsonSchema[None] = None
    day: HourTune | SkipJsonSchema[None] = None
    dusk: HourTune | SkipJsonSchema[None] = None


class Ambience(Contract):
    night: OptStr = None
    dawn: OptStr = None
    day: OptStr = None
    dusk: OptStr = None


class SceneFloor(Contract):
    """What lies at the scene's floor height (cloudFloor): a sea of cloud, a ground haze, or
    nothing. Without it a scene with a cloudFloor has a sea of cloud. `tint` multiplies the floor's
    colour at every hour; `strength` (default 1) is how thick it lies."""

    kind: Literal["clouds", "haze", "none"]
    tint: Rgb | SkipJsonSchema[None] = None
    strength: OptFloat = None


class SceneProtagonist(Contract):
    """The protagonist's back view at anchors.player: the pose it takes unless the page asks for
    another (default sit) and its size against the usual one (default 1)."""

    pose: Literal["sit", "stand"] | SkipJsonSchema[None] = None
    scale: OptFloat = None


class LightShaft(Contract):
    """Light falling through a window or an opening, from `from` to `to`, `width` wide where it
    enters and wider where it lands."""

    from_: Vec3 = Field(alias="from")
    to: Vec3
    width: float
    strength: OptFloat = None


class GroundFire(Contract):
    """Fire glowing through the floor around `at`, with embers rising."""

    at: Vec3
    radius: float
    strength: OptFloat = None


class RuneRing(Contract):
    """A ring of glowing runes centred on `at` in the plane of the painting there; `squash` is the
    ring's height over its width (1 a standing circle, small for one lying on painted ground)."""

    at: Vec3
    radius: float
    squash: OptFloat = None
    strength: OptFloat = None


class SceneEffects(Contract):
    shafts: list[LightShaft] | SkipJsonSchema[None] = None
    fire: list[GroundFire] | SkipJsonSchema[None] = None
    runes: list[RuneRing] | SkipJsonSchema[None] = None


SceneKind = Literal[
    "peak",
    "street",
    "cave",
    "gate",
    "hall",
    "town",
    "shop",
    "coast",
    "forest",
    "manor",
    "temple",
    "desert",
    "ice",
    "ruin",
    "abyss",
    "battle",
    "sky",
]


class SceneFile(Contract):
    id: str
    name: str
    kind: SceneKind
    indoor: bool
    key: str
    eye: tuple[float, float]
    cloud_floor: OptFloat = None
    sky: SkyRef
    layers: list[Layer]
    cameras: Cameras
    anchors: Anchors
    hours: Hours
    weather: list[Literal["clear", "cloud", "mist", "rain", "snow"]]
    ambience: Ambience
    mood: Literal["calm", "tense", "solemn"]
    floor: SceneFloor | SkipJsonSchema[None] = None
    # false: no formation is drawn here, not even while cultivating
    formation: OptBool = None
    protagonist: SceneProtagonist | SkipJsonSchema[None] = None
    effects: SceneEffects | SkipJsonSchema[None] = None


# ---------------------------------------------------------------- asset manifests


class SkyFiles(Contract):
    clear: str
    cloud: OptStr = None


class SkyManifest(Contract):
    night: SkyFiles
    dawn: SkyFiles
    day: SkyFiles
    dusk: SkyFiles


class IconEntry(Contract):
    file: str
    label: str


class IconManifest(Contract):
    icons: dict[str, IconEntry]
    defaults: dict[str, str]


class SpeciesEntry(Contract):
    file: str
    label: str
    element: OptStr = None
    size: float


class BestiaryManifest(Contract):
    species: dict[str, SpeciesEntry]
    fallback: str


class LedgerEntry(Contract):
    file: str
    kit: str
    job: str
    date: str
    license: str
    sha256: str


# Everything exported to the front end, in a stable order.
EXPORTED = [
    Block,
    Turn,
    TurnPage,
    TurnEvent,
    StateView,
    Change,
    SaveSummary,
    MapView,
    PeopleView,
    PersonDetail,
    EventsView,
    NewsView,
    TurnRequest,
    PreviewRequest,
    VerbPreview,
    CalendarView,
    NoticeBoard,
    ShopView,
    BookView,
    GateSheet,
    VersionRequest,
    UndoRequest,
    PanelAction,
    PanelResult,
    LifeView,
    UndoResult,
    DirectorView,
    GuidanceRequest,
    PlotSwitch,
    DirectorChange,
    CreationInput,
    CreationOptions,
    DrawRequest,
    DrawAnswer,
    PlaySettings,
    ErrorBody,
    SceneFile,
    SkyManifest,
    IconManifest,
    BestiaryManifest,
    LedgerEntry,
    AccountOptions,
    LoginRequest,
    EmailCodeRequest,
    EmailCodeSent,
    EmailLoginRequest,
    RegisterRequest,
    PasswordChange,
    Account,
    UsageReport,
]
