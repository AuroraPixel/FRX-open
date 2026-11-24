from types import SimpleNamespace

from frx import play_blocks, play_turns
from frx.life import new_life
from frx.play_state import Save


def test_history_page_loads_only_its_requests_and_renders_its_turns(monkeypatch):
    logs = []
    for number in range(1, 5):
        logs.extend([
            {"id": f"u{number}", "type": "user", "content": "到山径上走走"},
            {"id": f"a{number}", "type": "ai", "content": f"<content>走到第{number}段山径。</content>",
             "frxRequestId": f"request-{number}", "frxKind": "interrupted",
             "frxChronicle": [{"date": f"正月初{number}", "text": "山间起风。"}]},
        ])
    value = {"data": {"archiveId": "mountain-path", "logs": logs, "state": {
        "currentState": {"0": {"B1": {"0": "B1", "1": "旅人"}}}, "frxPlay": new_life("0001-01"),
    }}}
    save = Save("山径", 9, value)
    full = play_blocks.history(save.name, value)
    assert full[-1]["blocks"][0]["now"] is True
    assert "now" not in full[1]["blocks"][0]

    fetched, rendered = [], []
    original = play_blocks.turn_blocks

    def fetch(records, name, ids):
        fetched.append(ids)
        return {}

    def format_turn(**kwargs):
        rendered.append(kwargs["story"])
        return original(**kwargs)

    monkeypatch.setattr(play_turns, "turn_requests", fetch)
    monkeypatch.setattr(play_turns, "places_of", lambda *args, **kwargs: {})
    monkeypatch.setattr(play_blocks, "turn_blocks", format_turn)
    desk = play_turns.TurnDesk(SimpleNamespace(profiles=None))
    ws = SimpleNamespace(records=object())
    assert desk.page(ws, save, before=3, limit=1) == {"turns": full[1:2], "more": True}
    assert desk.page(ws, save, limit=1) == {"turns": full[-1:], "more": True}
    assert desk.page(ws, save, limit=0) == {"turns": [], "more": True}
    assert fetched == [{"request-2"}, {"request-4"}]
    assert len(rendered) == 2
