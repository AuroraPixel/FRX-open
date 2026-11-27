"""Regression coverage for the playable late-human journey and its one-way crossing."""

import copy
import json
from pathlib import Path

from frx.life import regional_lore
from frx.play_places import known_world_map
from test_reported_issues import archive, engine


ROOT = Path(__file__).resolve().parents[1]
JOURNEY = json.loads((ROOT / 'content/life/human-journey.json').read_text())
REALMS = json.loads((ROOT / 'content/life/realms.json').read_text())['realms']
STAGES = {stage['id']: stage for stage in JOURNEY['stages']}
FROZEN_MAP = json.loads((ROOT / 'content/map.json').read_text())


def state_of(value):
    return value['data']['state']


def view(value):
    return engine(value, mode='progress')['life']


def locate(value, place, date='0040年 04月 05日'):
    state = state_of(value)
    found = next(p for p in known_world_map(state.get('worldMap'), life=True)['points_of_interest'] if p['name'] == place)
    region = found['main_region']
    area = found.get('sub_region') or region
    state['currentState']['4'][0]['0'] = f"{date} 07:20/{region}/{area}（{place}）{found['x']},{found['y']}"
    state['frxPlay']['month'] = date[:4] + '-' + date[6:8]


def prepared(rank='元婴初期'):
    value = archive()
    value['data']['archiveId'] = 'c4532b93-8ba1-4171-9657-3bccb2808322'
    state = state_of(value)
    # A copy of the old map as a live save would store it, without the journey overlay.
    state['worldMap'] = FROZEN_MAP
    player = state['currentState']['0']['B1']
    player['2'] = f'{rank}|散修'
    player['9'] = '年龄:110|寿元:1500|灵根:天灵根 水|修为进度:100%'
    player['11'] = json.dumps({
        key: {'max': 10000, 'current': 10000}
        for key in ('气运', '神识', '脚力', '法力', '血量', '法攻', '物攻')
    }, ensure_ascii=False)
    player['26'] = '10000'
    locate(value, STAGES['border']['jobs']['border-envoy']['board'])
    return value


def act(value, op='verb', **args):
    result = engine(value, mode='life', op=op, args=args, keep=True)
    assert not result.get('error') and not result.get('errors'), result
    state_of(value).update(result['kept'])
    return result


def journey(value):
    return view(value)['journey']


def complete_job(value, stage, job):
    spec = STAGES[stage]['jobs'][job]
    locate(value, spec['board'])
    chosen = next(row for row in journey(value)['choices'] if row['title'] == spec['title'])
    taken = act(value, **chosen['verb'])
    receipt = next(row for row in taken['receipts'] if row.get('action') == 'take')
    assert receipt['job']['kind'] == job
    assert not any(row.get('action') == 'done' for row in taken['receipts'])
    options = journey(value)['choices']
    assert len(options) == 1 and options[0]['title'] == spec['title']
    if spec['goal'] == 'travel':
        for _ in range(3):
            travel = act(value, kind='travel', to=spec['place'])
            done = next((row for row in travel['receipts'] if row.get('action') == 'done'), None)
            if done:
                return done
    else:
        locate(value, spec['place'])
        assert journey(value)['choices'][0]['verb'] == {'kind': 'gather', 'days': 3}
        taken = act(value, kind='gather', days=3)
        done = next((row for row in taken['receipts'] if row.get('action') == 'done'), None)
        if done:
            return done
    raise AssertionError(f'{job} did not settle')


def test_existing_saves_discover_the_journey_at_nascent_soul_with_two_legal_choices():
    old = prepared('结丹后期')
    assert 'journey' not in view(old)
    new = prepared()
    shown = journey(new)
    assert shown['stage']['id'] == 'border'
    assert len(shown['chapters']) == 10
    assert len(shown['choices']) == 2 and all(option['verb']['kind'] == 'job' for option in shown['choices'])
    assert STAGES['border']['title'] in regional_lore(new, director=True)
    assert not state_of(new)['frxPlay'].get('humanJourney')


def test_jobs_advance_distinct_stages_and_prepare_the_real_transformation_gate():
    value = prepared('元婴后期')
    state_of(value)['frxPlay']['mind'] = 350
    for stage, choice in [
        ('border', 'border-envoy'), ('rift', 'rift-rescue'), ('jin', 'jin-ledger'),
        ('kunwu', 'kunwu-seal'), ('north', 'north-survey'), ('seals', 'seal-shore'),
    ]:
        receipt = complete_job(value, stage, choice)
        assert receipt['journey']['id'] == stage and receipt['journey']['mind']['change'] > 0
    play = state_of(value)['frxPlay']
    assert play['humanJourney']['deeds']['border']['way'] == 'border-envoy'
    assert play['gates']['化神']['chance']['from'] == 'journey'
    assert journey(value)['stage']['id'] == 'spirit'
    tables = state_of(value)['currentState']
    method = next(item_id for item_id, row in tables['1'].items() if row['1'] == '太虚观元录')
    act(value, 'equip', itemId=method)
    gate = engine(value, mode='life', op='gate')['gate']
    assert gate['ready'], gate['requires']
    locate(value, STAGES['seals']['jobs']['seal-shore']['board'])
    board = engine(value, mode='life', op='notices')['notices']
    assert not any(row['kind'] == 'seal-shore' for row in board['notices'])


def test_entering_then_leaving_a_realm_does_not_count_as_beating_the_guardian():
    value = prepared()
    realm = REALMS['demon-valley']
    locate(value, realm['place'])
    entered = act(value, 'realm', action='enter', realm='demon-valley')
    assert entered['realm']['id'] == 'demon-valley'
    act(value, 'realm', action='leave')
    assert 'rift' not in (state_of(value)['frxPlay'].get('humanJourney') or {}).get('deeds', {})


def test_crossing_checks_realm_preparation_and_money_and_commits_once():
    value = prepared('化神初期')
    route = JOURNEY['crossing']
    locate(value, route['from'], date='0040年 09月 10日')
    move = dict(kind='travel', to=route['to'])
    assert not engine(value, mode='life', op='preview', args=move)['preview']['ok']
    play = state_of(value)['frxPlay']
    play['humanJourney'] = {'deeds': {
        stage: {'date': '0040-08-20', 'way': 'proved'}
        for stage in ('border', 'rift', 'jin', 'kunwu', 'north', 'seals', 'node')
    }}
    assert journey(value)['stage']['id'] == 'storm'
    act(value, 'realm', action='enter', realm='human-node')
    # Replay the next realm operation as the engine would see a defeated guardian on the board.
    state = state_of(value)
    trial = state['frxPlay']['realm']
    trial.update(at=trial['depth'], guard={'node': trial['layers'][-1][0]['id'], 'foe': 'C99'})
    retreated = copy.deepcopy(value)
    state_of(retreated)['frxPlay']['realm']['guard']['defeated'] = False
    act(retreated, 'realm', action='leave')
    assert journey(retreated)['stage']['id'] == 'storm'
    state['currentState']['0']['C99'] = {'0': 'C99', '1': '试炼守关', '4': '已死'}
    act(value, 'realm', action='leave')
    assert journey(value)['stage']['id'] == 'flight'
    snapshot = copy.deepcopy(state_of(value)['currentState']['1'])
    allowed = engine(value, mode='life', op='preview', args=move)['preview']
    assert allowed['ok'] and '飞升' in allowed['lines'][0]
    player = state_of(value)['currentState']['0']['B1']
    player['26'] = str(route['stones'] - 1)
    assert '灵石' in engine(value, mode='life', op='preview', args=move)['preview']['reason']
    player['26'] = '10000'
    result = act(value, **move)
    travel = next(row for row in result['receipts'] if row['kind'] == 'travel')
    assert travel['travel']['teleport']['ascension']
    assert travel['travel']['arrived'] and travel['travel']['to'] == route['to']
    assert result['receipts'][0]['interruption']['event']['from'] == 'humanJourney'
    assert state_of(value)['currentState']['0']['B1']['26'] == str(10000 - route['stones'])
    assert state_of(value)['currentState']['1'] == snapshot
    assert journey(value)['complete']
    assert not engine(value, mode='life', op='preview', args=move)['preview']['ok']
    assert not engine(value, mode='life', op='preview',
                      args={'kind': 'travel', 'to': route['from']})['preview']['ok']


def test_story_commands_cannot_move_a_player_into_the_spirit_region():
    value = prepared()
    landed = copy.deepcopy(value)
    locate(landed, JOURNEY['crossing']['to'])
    fake = state_of(landed)['currentState']['4'][0]['0']
    normal = state_of(value)['currentState']['4'][0]['0']
    settled = engine(value, commands='add("TIME_LOCATION_ROW",' + json.dumps({'0': fake}, ensure_ascii=False) + ')',
                     story='一道灵光在远处消散。', pilot={'receipts': []})
    assert settled['errors'] == []
    assert settled['state']['4'][0]['0'] == normal
