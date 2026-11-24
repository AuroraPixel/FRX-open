"""Start the public demo world against a throwaway store and a local fake provider."""

import json

from fastapi.testclient import TestClient
from frx.gateway import ModelSettings
from frx.main import create_app
from frx.storage import Store
from mock_provider import provider

PLAY = "/api/play"


def test_new_character_opens_and_advances_in_the_sample_world(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_AUTH", "off")
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FRX_EVOLUTION_MODEL", "disabled-for-testing")
    for key in ("FRX_API_BASE", "FRX_MODEL", "FRX_API_KEY", "FRX_MODEL_PROFILES"):
        monkeypatch.delenv(key, raising=False)
    (tmp_path / "tool-admission.json").write_text(
        json.dumps({"models": {"mock-model": {"passed": True}}})
    )
    store = Store(f"sqlite:///{tmp_path}/demo.db")
    store.initialize()
    try:
        with provider(card=True) as mock:
            settings = ModelSettings(tmp_path / "model.json")
            settings.path.write_text(json.dumps({
                "base_url": f"http://127.0.0.1:{mock.server_port}/v1",
                "model": "mock-model",
                "api_key": "test",
            }))
            app = create_app(store=store, settings=settings)
            with TestClient(app, headers={"X-FRX-Client": "local"}) as client:
                assert client.get("/api/health").json()["ok"]
                options = client.get(f"{PLAY}/creation").json()
                assert options["play"]["available"] is True
                assert options["map"]["regions"][0]["id"] == "潮岚道"

                seed = "demo-character-seed"
                drawn = client.post(f"{PLAY}/creation/draw", json={"seed": seed, "kind": "root"})
                assert drawn.status_code == 200, drawn.text
                created = client.post(f"{PLAY}/saves", json={
                    "name": "试舟",
                    "difficulty": "普通",
                    "birth": "凡人",
                    "sex": "m",
                    "race": "人族",
                    "attributes": {},
                    "seed": seed,
                    "traits": [],
                    "root": drawn.json()["root"],
                    "birthplace": {"regionId": "潮岚道", "areaId": "云汀湾", "poiId": "回潮渡"},
                    "portrait": {
                        "base": "m-young", "face": "face-1-1",
                        "hair": "hair-1-1", "body": "body-a",
                    },
                })
                assert created.status_code == 201, created.text
                archive = f'{PLAY}/saves/{created.json()["id"]}'
                before = client.get(f"{archive}/state").json()
                assert "回潮渡" in json.dumps(before, ensure_ascii=False)
                opening_id = before["openingRequestId"]
                played = client.post(f"{archive}/turns", json={
                    "requestId": opening_id, "version": before["version"], "input": "开始修行",
                })
                assert played.status_code == 200, played.text
                events = [
                    json.loads(line.removeprefix("data: "))
                    for line in played.text.splitlines()
                    if line.startswith("data: ")
                ]
                assert events[-1]["event"] == "done", events[-1]
                assert any(
                    row["event"] in {"open", "block"} and row["block"]["type"] == "narration"
                    for row in events
                )
                assert mock.calls
                after = client.get(f"{archive}/state").json()
                assert after["version"] > before["version"]
                assert not after.get("openingRequestId")
                turns = client.get(f"{archive}/turns").json()
                assert turns["turns"]
                assert opening_id in json.dumps(turns)
    finally:
        store.engine.dispose()
