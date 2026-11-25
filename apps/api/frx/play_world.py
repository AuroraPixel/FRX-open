"""The other read views of a save: the map, the people, world events and the daily papers."""

import re
from html.parser import HTMLParser

from . import play_art as art
from . import play_models as M
from .domain import ROOT
from .life import life_of
from .play_places import known_world_map
from .play_sheet import js_get, js_round, js_trim, js_values, parse_nested_json, to_text
from .play_state import (
    Location,
    biography_row,
    character_fields,
    character_view,
    recipe_of,
    text_of,
)

DEFAULT_MAP = ROOT / "content/map.json"

# ---------------------------------------------------------------- the map


def world_map_of(save):
    """The save's map, or the card's default map when the save has none (as app.js 29863)."""
    return map_of_state(save.state)


def map_of_state(state):
    """The map a save's state carries, or the card's default map when it carries none."""
    life = life_of({"data": {"state": state}}) is not None
    return known_world_map((state or {}).get("worldMap"), life=life)


def find_poi(world_map, place_id):
    """A place by the id the map view gives it: the place's own id if it has one, else its name
    (the card's map names places and gives them no other identity)."""
    places = world_map.get("points_of_interest") or []
    return next((p for p in places if p.get("id") is not None and str(p["id"]) == place_id),
                None) or next((p for p in places if p.get("name") == place_id), None)


def map_view(save):
    """Regions, their areas and places. Ids are the names (the map has no other identity);
    a place without an area sits in an area named after its region."""
    world_map = world_map_of(save)
    location = save.location
    regions = {}
    for region in world_map.get("main_regions") or []:
        if isinstance(region, dict) and region.get("name"):
            regions.setdefault(region["name"], {})
    for area in world_map.get("sub_regions") or []:
        if isinstance(area, dict) and area.get("name"):
            regions.setdefault(str(area.get("main_region") or ""), {}).setdefault(area["name"], [])
    for poi in art.pois_of(world_map):
        region = str(poi.get("main_region") or "")
        area = str(poi.get("sub_region") or "") or region
        regions.setdefault(region, {}).setdefault(area, []).append(poi_view(poi, location.xy))
    here = art.named_poi(world_map, location.spot) or art.nearest_poi(world_map, location.xy)
    return M.MapView(
        regions=[
            M.Region(
                id=name,
                name=name,
                areas=[M.Area(id=area, name=area, pois=pois) for area, pois in areas.items()],
            )
            for name, areas in regions.items()
            if name
        ],
        here=M.Here(
            region_id=location.region,
            area_id=location.area or location.region,
            poi_id=here["name"] if here else None,
            x=float(location.xy[0]) if location.xy else 0.0,
            y=float(location.xy[1]) if location.xy else 0.0,
        ),
    )


def poi_view(poi, xy):
    scene = art.poi_scene(poi)
    x, y = float(poi.get("x") or 0), float(poi.get("y") or 0)
    distance = None
    if xy:
        # The map's travel distance (app.js 49714): map units are 10 km, rounded to a kilometre.
        distance = float(js_round(((xy[0] - x) ** 2 + (xy[1] - y) ** 2) ** 0.5 * 10))
    return M.Poi(
        id=poi["name"],
        name=poi["name"],
        kind=art.scene_names().get(scene, {}).get("kind", "peak"),
        x=x,
        y=y,
        text=text_of(poi.get("description")) or None,
        scene_id=scene,
        distance_km=distance,
    )


# ---------------------------------------------------------------- people


def predecessors(save):
    """The ids of the protagonists who died of old age and went on in an heir (gameplay plan
    item 49: frxPlay.lives); none for a save of the novel."""
    lives = (life_of(save.value) or {}).get("lives")
    return {str(life["id"]) for life in lives if isinstance(life, dict) and life.get("id")} \
        if isinstance(lives, list) else set()


def people_view(save, art_value):
    gone = predecessors(save)

    def shown(key, data, present):
        person = character_view(key, data, recipe_of(art_value, key), present)
        return person.model_copy(update={"dead": True}) if key in gone else person

    return M.PeopleView(
        present=[shown(k, d, True) for k, d in save.present().items()],
        known=[shown(k, d, False) for k, d in save.known().items()],
    )


def deeds_of(text):
    """The remarks' deeds: 「时间:事迹;时间:事迹」, split as the old page does (app.js 38949)."""
    deeds = []
    for deed in (part for part in to_text(text).split(";") if js_trim(part)):
        parts = deed.split(":")
        when, what = "未知时间", deed
        if len(parts) > 1 and (re.search(r"\d", parts[0]) or len(parts[0]) < 10):
            when, what = parts[0], ":".join(parts[1:])
        deeds.append(M.Deed(at=js_trim(when), text=js_trim(what)))
    return deeds


def person_detail(save, art_value, char_id):
    """One person (the player too, as B1), or None when the save has no such person. Someone
    who has left (Save.departed) stays readable: a turn's blocks may name them."""
    people = save.everyone()
    data = people.get(char_id)
    if data is None:
        data = save.departed(char_id)
    if data is None or recipe_of(art_value, char_id) is None:
        return None
    present = char_id == "B1" or char_id in save.sheet.scene
    return M.PersonDetail(
        **character_fields(char_id, data, recipe_of(art_value, char_id), present),
        dead=True if char_id in predecessors(save) else None,
        background=text_of(data.get("background")) or None,
        deeds=deeds_of(data.get("deeds") or ""),
        biography=text_of(data.get("35")) or None,
    )


def named_detail(save, art_value, char_id, name):
    """The person a turn named with this id and this name (GET …/people/{charId}?name=). The
    model gives an id to someone else over time, and the portraits are kept by id and by name
    (play_art.fill_portraits): whoever the id names now when the name is theirs; else whoever
    bears the name now under another id; else the one the id named then, as the latest turn
    that had them saw them, with the portrait kept for their name. None when nothing is known."""
    people = save.everyone()
    data = people.get(char_id) or save.departed(char_id)
    if data is None or art.same_name(art.plain_name(data.get("name")), name):
        return person_detail(save, art_value, char_id)
    now = next((key for key, person in people.items()
                if art.plain_name(person.get("name")) == name), None)
    if now is not None:
        return person_detail(save, art_value, now)
    then = save.departed(char_id, name)
    recipe = art.named_recipe(art_value, name)
    if then is None or recipe is None:
        return None
    return M.PersonDetail(
        **character_fields(char_id, then, recipe, False),
        background=text_of(then.get("background")) or None,
        deeds=deeds_of(then.get("deeds") or ""),
        biography=text_of(then.get("35")) or None,
    )


# ---------------------------------------------------------------- world events and archives


# A game time stamp as the events table writes it: 「0001年 01月 04日 21:10」, the hour optional.
GAME_TIME = re.compile(r"^\s*(\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?")


def game_time(text):
    """(year, month, day, hour, minute) of a game time stamp, numbers and not text (the model does
    not always pad them), or None when the text is not one."""
    found = GAME_TIME.match(text or "")
    return tuple(int(part or 0) for part in found.groups()) if found else None


def events_view(save):
    """World events newest first by the game's time (spec 七, 世界与见闻), and the biographies the
    old page keeps. The model mostly appends events as they happen, but not always (something
    that happened earlier, told later): the time decides. An event whose time cannot be read stays
    after the event before it in the table; of events at the same time, the later row comes
    first, as the old page listed the table backwards."""
    dated = []
    when = (0, 0, 0, 0, 0)
    for index, row in enumerate(js_values(js_get(save.sheet.tables, "5"))):
        if not isinstance(row, dict):
            continue
        at, what, where = (text_of(js_get(row, column)) for column in ("0", "2", "1"))
        when = game_time(at) or when
        if what:
            event = M.WorldEvent(at=at, text=what + (f"（{where}）" if where else ""))
            dated.append(((when, index), event))
    events = [event for _, event in sorted(dated, key=lambda pair: pair[0], reverse=True)]
    biographies = []
    for entry in save.state.get("worldBookEntries") or []:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "")
        person = entry.get("type") in (None, "", "人物")
        row = biography_row(entry) if person else None
        text = biography_text(row) if row else text_of(entry.get("content"))
        title = art.plain_name(entry.get("title")) or (
            art.plain_name(js_get(row, "1")).split("|")[0] if row else key
        )
        if title or text:
            charge = key if person and re.match(r"^[CG]", key) else None
            biographies.append(M.Biography(char_id=charge, title=title or key, text=text))
    return M.EventsView(events=events, biographies=biographies)


def biography_text(row):
    name, _, sex = to_text(js_get(row, "1")).partition("|")
    realm = to_text(js_get(row, "2")).replace("|", " · ")
    lines = [" · ".join(part for part in (js_trim(sex), js_trim(realm)) if part)]
    for label, column in (("性格", "3"), ("背景", "10"), ("生平", "35")):
        text = text_of(js_get(row, column))
        if text:
            lines.append(f"{label}：{text}")
    remarks = js_get(row, "9")
    deeds = re.search(r"deeds:([^|]*)", to_text(remarks)) if isinstance(remarks, str) else None
    if deeds and js_trim(deeds.group(1)):
        lines.append("事迹：" + js_trim(deeds.group(1)))
    return "\n".join(line for line in lines if line)


# ---------------------------------------------------------------- the daily papers

BLOCKS = set("p div h1 h2 h3 h4 h5 h6 li br tr td th hr table ul ol blockquote".split())
BLOCKS |= {"section", "article", "header", "footer"}
SKIPPED = set("script style template head title button select option svg noscript textarea".split())
VOID = set("area base br col embed hr img input link meta source track wbr".split())
JUNK = {"none", "null", "undefined", "...", "…", "……"}  # template slots the model left empty
ACTION_CALL = re.compile(
    r"(?:sendAction|handleTheaterAction)\(\s*(['\"`])((?:\\.|(?!\1).)*)\1", re.S
)


def hidden(tag, attrs):
    """Skipped: scripts, styles and controls, and hidden data blocks a paper's script would
    have turned into markup (a hidden view the paper's own buttons switch to is kept)."""
    style = re.sub(r"\s+", "", (attrs.get("style") or "").lower())
    classes = (attrs.get("class") or "").split()
    return tag in SKIPPED or ("display:none" in style and "view-content" not in classes)


class PaperReader(HTMLParser):
    """A daily paper's HTML (written by a model, run in a sandbox on the old page) read as
    paragraphs of text, its title and date, and the buttons that send an action."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paragraphs, self.actions, self.title, self.date = [], [], "", ""
        self.text, self.open, self.button, self.capture = [], [], None, None

    def flush(self):
        line = re.sub(r"\s+", " ", "".join(self.text)).strip()
        self.text = []
        if line and line.lower() not in JUNK:
            if self.capture == "title" and not self.title:
                self.title = line
            elif self.capture == "date" and not self.date:
                self.date = line
            else:
                self.paragraphs.append(line)
        self.capture = None

    def skipping(self):
        return any(skip for _, skip in self.open)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "button":
            calls = ACTION_CALL.findall(attrs.get("onclick") or "")
            self.button = {"call": calls[0][1] if calls else None, "text": []}
        if tag not in VOID:
            self.open.append((tag, hidden(tag, attrs)))
        if tag in BLOCKS and not self.skipping():
            self.flush()
            if tag == "h1":
                self.capture = "title"
            elif "date" in (attrs.get("class") or "").split():
                self.capture = "date"

    def handle_endtag(self, tag):
        if tag == "button" and self.button is not None:
            self.press(self.button)
            self.button = None
        if any(name == tag for name, _ in self.open):
            while self.open and self.open.pop()[0] != tag:
                pass
        if tag in BLOCKS and not self.skipping():
            self.flush()

    def press(self, button):
        label = re.sub(r"\s+", " ", "".join(button["text"])).strip()
        if button["call"]:
            message = re.sub(r"\\(.)", r"\1", button["call"]).strip()[:200]
            queue = M.QueueItem(kind="other", text=message or label[:200])
            self.actions.append(M.NewsAction(text=(label or message)[:200], queue=queue))

    def handle_data(self, data):
        if self.button is not None:
            self.button["text"].append(data)
        if not self.skipping():
            self.text.append(data)


def paper_html(stored):
    text = to_text(stored)
    fenced = re.search(r"```(?:html)?\s*([\s\S]*?)```", text)
    return fenced.group(1) if fenced else text


# The map position the paper's template prints for each of its events (「坐标: [3393, 1848]」):
# the map's to place them, nothing for the reader (实玩二).
COORDINATES = re.compile(
    r"[（(]?\s*坐标\s*[:：]\s*[\[［(（]?\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*[\]］)）]?"
    r"\s*[）)]?"
)


def readable(paragraphs):
    """A paper's paragraphs without the map coordinates; a paragraph that was only those goes."""
    kept = []
    for paragraph in paragraphs:
        text = COORDINATES.sub("", paragraph).strip(" ·|,，;；")
        if text:
            kept.append(text)
    return kept


def news_view(save):
    """The daily papers the old page stored with the turns (log.dailyPaperHtml), newest first,
    and the latest one the state keeps if no turn holds it any more. Each is numbered from the
    first and names the turn it came with: the model writes the same title and date for the
    issues of one game day (实玩二: six 「云汀湾修仙晨报」 of 01月17日)."""
    logs = save.data.get("logs") if isinstance(save.data.get("logs"), list) else []
    papers, turn = [], 0
    for log in logs:
        if not isinstance(log, dict):
            continue
        if log.get("type") == "ai" and not log.get("isGhost") and not log.get("isDeepSummary"):
            turn += 1
        if log.get("dailyPaperHtml"):
            papers.append((log, log["dailyPaperHtml"], turn or None))
    latest = save.state.get("latestDailyPaper")
    if latest and all(stored != latest for _, stored, _ in papers):
        papers.append(({"id": "latest"}, latest, None))
    issues = []
    for number, (log, stored, came) in reversed(list(enumerate(papers, 1))):
        reader = PaperReader()
        reader.feed(paper_html(stored))
        reader.close()
        reader.flush()
        issues.append(
            M.NewsIssue(
                id=str(log.get("id") or "latest"),
                no=number,
                turn=came,
                date=reader.date or log_date(log),
                title=reader.title or "日报",
                paragraphs=readable(reader.paragraphs),
                actions=reader.actions,
            )
        )
    return M.NewsView(issues=issues)


def log_date(log):
    """The game date of the turn a paper came with, from that turn's state snapshot."""
    tables = parse_nested_json(log.get("stateSnapshot"), {})
    rows = js_get(tables, "4")
    row = rows[0] if isinstance(rows, list) and rows else None
    return Location(to_text(js_get(row, "0")) if isinstance(row, dict) else "").moment.date
