import asyncio
from types import SimpleNamespace

import pytest
from frx import play_jobs
from frx.play_turns import TurnDesk, TurnError


def test_evolution_commit_allows_the_next_action_from_the_last_played_version(monkeypatch):
    records = SimpleNamespace(user_id="player")
    desk = TurnDesk(SimpleNamespace(profiles=None))

    async def commit(store, body):
        assert store is records and body["scope"]["archive"] == "trail"
        return {"version": 12}

    monkeypatch.setattr(play_jobs, "commit_evolution", commit)
    response = asyncio.run(desk.jobs.answerer(records)({
        "url": "http://example.test" + play_jobs.HOST + "/evolution/commit",
        "body": {"scope": {"archive": "trail"}},
    }))

    assert response["status"] == 200
    desk.check_version("player", SimpleNamespace(name="trail", version=12), 11)
    with pytest.raises(TurnError, match="存档已在别处变化"):
        desk.check_version("player", SimpleNamespace(name="trail", version=13), 11)
    with pytest.raises(TurnError, match="存档已在别处变化"):
        desk.check_version("another-player", SimpleNamespace(name="trail", version=12), 11)
