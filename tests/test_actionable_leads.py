"""A lead can be followed from the UI without sealing an unrelated or failed check."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient
from frx.auth import LOCAL_USER_ID
from frx.card_store import CardStore
from frx.main import create_app
from frx.storage import Store

from test_reported_issues import archive, engine


def investigation_save():
    value = archive()
    state = value['data']['state']
    state['worldMap'] = {'points_of_interest': [
        {'name': '明水府', 'x': 120, 'y': 200, 'main_region': '南地', 'sub_region': '临川'},
        {'name': '旧驿', 'x': 200, 'y': 240, 'main_region': '南地', 'sub_region': '临川'},
    ]}
    state['currentState']['4'][0]['0'] += '/南地/临川（明水府·暗室）120,200'
    state['frxPlay'].update(scene={'id': 'S1', 'title': '暗室', 'beats': 1, 'won': True}, leads=[
        {'id': 'F1', 'line': '值夜法盘留有陌生回纹', 'where': '问明水府巡查执事', 'chapter': 'c1'},
        {'id': 'F2', 'line': '古驿门前多了一重暗记', 'where': '去旧驿查看', 'chapter': 'c2'},
        {'id': 'F3', 'line': '残躯灵核藏着血纹', 'where': '查验破损战傀构件', 'chapter': 'c3'},
    ])
    return value


def test_lead_routes_a_current_scene_a_distant_destination_and_an_unplaced_clue():
    value = investigation_save()
    shown = engine(value, mode='life', op='view')['view']['leads']
    assert [(row['id'], row['action'], row.get('place')) for row in shown] == [
        ('F1', 'investigate', None), ('F2', 'travel', '旧驿'), ('F3', 'ask', None),
    ]
    distant = engine(value, mode='life', op='act', args={'lead': 'F2'}, keep=True)
    assert distant['error'] == 'refused' and '旧驿' in distant['reason'] and 'kept' not in distant
    armed = engine(value, mode='life', op='lead', args={'id': 'F2', 'how': '无关的旧成功'})
    assert armed['error'] == 'refused' and '旧驿' in armed['reason']


def test_selected_lead_writes_proof_only_when_its_own_check_succeeds():
    value = investigation_save()
    results = {}
    for nth in range(1, 23):
        result = engine(value, mode='life', op='act', args={'lead': 'F1', 'nth': nth}, keep=True)
        results.setdefault(result['outcome'].endswith('失败'), result)
        if len(results) == 2:
            break
    failed, good = results[True], results[False]
    before = failed['kept']['frxPlay']
    assert 'proven' not in before['leads'][0]
    assert not before['pending']
    # A previously won check in the same scene cannot override this turn's failure.
    call = {'id': 'bad-proof', 'name': 'prove_lead', 'arguments': json.dumps({'id': 'F1'})}
    reply = engine(value, mode='tools', calls=[call], receipts=failed['receipts'])
    assert reply['results'][0]['receipt']['ok'] is False

    after = good['kept']['frxPlay']
    assert after['leads'][0]['proven']['by'] == 'check'
    assert 'proven' not in after['leads'][1]
    assert len([event for event in after['pending'] if event['from'] == 'leads']) == 1
    assert any(row.get('lead', {}).get('id') == 'F1' for row in good['receipts'])
    value['data']['state'].update(good['kept'])
    shown = {row['id']: row for row in engine(value, mode='progress')['life']['leads']}
    assert shown['F1']['proven'] and 'action' not in shown['F1']
    again = engine(value, mode='life', op='act', args={'lead': 'F1'})
    assert again['error'] == 'refused'


def test_unknown_location_is_a_search_and_does_not_prove_the_clue():
    value = investigation_save()
    result = engine(value, mode='life', op='act', args={'lead': 'F3'}, keep=True)
    assert result['card']['kind'] == '交涉' and result['card']['title'].startswith('打听疑点的去处')
    assert not any(row['kind'] == 'lead' for row in result['receipts'])
    assert 'proven' not in result['kept']['frxPlay']['leads'][2]


def test_unavailable_lead_is_refused_before_a_turn_is_reserved(tmp_path, monkeypatch):
    monkeypatch.setenv('FRX_AUTH', 'off')
    monkeypatch.setenv('FRX_DATA_DIR', str(tmp_path))
    store = Store(f'sqlite:///{tmp_path}/leads.db')
    store.initialize()
    value = investigation_save()
    records = CardStore(LOCAL_USER_ID, store.sessions)
    saved = records.write('archives', value['name'], value, 0)
    rid = str(uuid4())
    url = f'/api/play/saves/{value["data"]["archiveId"]}/turns'
    with TestClient(create_app(store=store), headers={'X-FRX-Client': 'local'}) as client:
        response = client.post(url, json={'requestId': rid, 'version': saved['version'],
                                          'input': '', 'lead': 'F999'})
        assert response.status_code == 422
        assert '疑点' in response.json()['error']['message']
        conflict = client.post(url, json={'requestId': rid, 'version': saved['version'],
                                          'input': '', 'lead': 'F1', 'act': 1})
        assert conflict.status_code == 422
    with records.sessions() as session:
        assert records.attempt(session, rid) is None
    store.engine.dispose()
