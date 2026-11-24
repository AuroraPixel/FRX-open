"""Extreme mode's death (the old page's checkPlayerDeath and handlePlayerDeath, app.js 47105).

After each turn the old page checks the protagonist of an extreme-mode save: he is dead when the
血量 of his detailed attributes (else the hp of his note) is 10 or less, or his 寿元 is used up.
The page says 「你已死亡，一切归零...」 and starts the save over from its opening: only the opening
log stays, its snapshot becomes the state (the tables a new save starts with, the protagonist's
row as the opening had it with one more death, the warehouse's items carried over), and the bonded
characters, the region maps and the people's pictures are cleared. apps/engine/death.cjs runs the
page's own two functions on the save its turn committed; recorded samples of the old page dying
are in tests/fixtures/parity/death.

The page checked on the state its turn had just settled; here the check runs on the save the
turn committed, before anything else is queued after it. A turn whose settlement waits (pending)
settled nothing and is not checked, and neither is a settlement finished later by a retry: as on
the old page, the next committed turn checks again.

What the old page did not have, and what death does to it:
- play_art: the people's portrait recipes go with the people, as the page's npcAvatars went; the
  protagonist keeps his. Whoever the save still knows gets a recipe again when it is next read.
- memories: left as they are, as the page left them. A memory follows the turns it came from
  (core/recall.cjs skips one whose turns are gone), so the past life is not recalled.
- turn requests: left as they are. The history reads the logs, so the fatal turn's request shows
  nowhere; the same request sent again after the desk has let its run go (60 s) is answered
  「这一回合没有完成」 (TurnDesk.known), since its turn is gone.
- the work after the fatal turn (memory archiving, summaries, the daily paper, world evolution,
  plot evolution) is not queued: the turn it would work on is gone.

A save of the cultivation life whose protagonist dies of old age (gameplay plan item 49) dies by
this same check in extreme mode (the engine writes his 寿元 0 in the dying turn). In any other
mode the life goes on in an heir: the dying turn ends with a notice to choose the heir rather than
a death, and once its blocks are out play_legacy draws a new heir's root and asks for the old
acquaintances' eulogies (`turn` gives it the model and the user; play_turns awaits its mourn).
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

from fastapi import HTTPException

from . import play_legacy
from .gateway import ModelFailure
from .play_art import ArtStore
from .play_prompt import run_script, settings_of
from .play_state import Save

logger = logging.getLogger(__name__)

ATTEMPTS = 3
# The page started nothing over and said no more (its opening snapshot has no tables).
UNREADABLE = "开局的存档快照读不出，没能从头再来。"


@dataclass
class Death:
    """A death after a turn. `written` is the save started over (its envelope), None when the
    page could not start over; `said` the page's alerts; `deaths` the protagonist's deaths."""

    said: list = field(default_factory=list)
    written: dict | None = None
    deaths: int = 1

    def block(self):
        """The turn's death block (without its id); when nothing started over (the page's own
        second alert, or no tables in the opening's snapshot), a notice that says so."""
        if self.written:
            return {"type": "death", "text": self.said[0], "deaths": self.deaths}
        why = self.said[1] if len(self.said) > 1 else UNREADABLE
        return {"type": "notice", "level": "error", "text": f"{self.said[0]}{why}"}


def extreme(value):
    """Whether the protagonist plays in extreme mode, as syncStateFromTables reads it."""
    return bool(Save("", 0, value).player.get("isExtreme"))


def forget_people(records, archive_id):
    """The people's portrait recipes go; the protagonist's stays."""

    def keep_player(value):
        portraits = value.get("portraits") or {}
        kept = {key: recipe for key, recipe in portraits.items() if key == "B1"}
        if kept == portraits:
            return False
        value["portraits"] = kept
        return True

    ArtStore(records, archive_id).update(keep_player)


async def check(records, value):
    """The page's check and start-over on a committed save: the engine's answer, None when it
    could not run (the next turn checks again)."""
    settings = await asyncio.to_thread(lambda: settings_of(records.list("settings")))
    try:
        return await run_script(
            "death.cjs",
            {"archive": value, "settings": settings, "seed": "death",
             "now": int(time.time() * 1000)},
            step="极限模式的死亡判定",
        )
    except ModelFailure as error:
        logger.warning("death_check_failed error=%s", error)
        return None


async def after_turn(records, name, committed, turn=None):
    """Check the protagonist after a committed turn of an extreme-mode save; start the save over
    when he died. Returns the Death, or None while he lives. With the turn (play_turns'), a
    death of old age in the cultivation life outside extreme mode is play_legacy's: its Passing."""
    if turn is not None and not extreme(committed["value"]):
        return play_legacy.passing(turn, records, name, committed)
    log_id = committed["value"]["data"]["logs"][-1].get("id")
    for _ in range(ATTEMPTS):
        value, version = committed["value"], committed["version"]
        if not extreme(value):
            return None
        result = await check(records, value)
        if not result or not result.get("dead"):
            return None
        death = Death(said=list(result.get("said") or []))
        if result.get("archive") is None:
            return death
        try:
            death.written = await asyncio.to_thread(
                records.write, "archives", name, result["archive"], version
            )
        except HTTPException as error:
            if error.status_code != 409:
                # The turn stands as committed; the next turn checks again.
                logger.warning("death_write_failed status=%s", error.status_code)
                return None
            # Something else wrote first: check the save as it is now, while its turn is there.
            committed = await asyncio.to_thread(records.get, "archives", name)
            logs = ((committed["value"] or {}).get("data") or {}).get("logs") or []
            if not any(log.get("id") == log_id for log in logs):
                return None
            continue
        death.deaths = int(result.get("deaths") or 1)
        archive_id = (death.written["value"].get("data") or {}).get("archiveId")
        if archive_id:
            try:
                await asyncio.to_thread(forget_people, records, archive_id)
            except Exception as error:  # the save has started over; the pictures are a nicety
                logger.warning("death_portraits_failed error=%s", type(error).__name__)
        return death
    return None
