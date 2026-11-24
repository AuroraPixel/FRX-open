// Panel actions in sample-data mode (?fixture=<name>): the server's POST /saves/{id}/actions played
// out on a copy of the sample's state, so equipping, tidying and bonds can be tried, screenshot and
// tested without a server; in the cultivation life the sect's four actions and choosing the heir
// (inherit) too, in their plain outline: what the panel shows of them changes, nothing else. Later GETs of the state answer from the same copy, and the people's from
// the sample's with the bonds made since (withBonds). The rules follow the engine's
// equipItem/unequipItem (apps/engine/mechanics.cjs) closely enough for the interface: an item goes
// into the slot asked for or the first free one of its kind (the first slot when all six are taken),
// whatever it pushes out goes back into the bag, and the attribute bonuses are worked out again from
// the effects of what is worn ("物攻+5，法防+2").
import type { Attribute, Change, Character, Item, PanelAction, PeopleView, StateView } from '../contracts';
import { beltable } from '../lib/belt';
import { type EquipKind, parseSlot } from './actions';

const KIND_OF: Partial<Record<Item['type'], EquipKind>> = {
  武器: 'weapon',
  护甲: 'armor',
  功法: 'technique',
  法宝: 'treasure',
};
const KIND_LABEL: Record<EquipKind, string> = { weapon: '兵器', armor: '防具', technique: '功法', treasure: '法宝' };
const TYPE_ORDER: Item['type'][] = ['武器', '护甲', '功法', '法宝', '消耗品', '材料', '重要物品', '其他物品'];

const copies = new Map<string, StateView>();
/** per sample set: the people marked as bonded (true) or no longer (false) since the sample */
const bonds = new Map<string, Map<string, boolean>>();

/** The state as the sample's actions have left it, if any were taken. */
export function simulatedState(set: string): StateView | undefined {
  return copies.get(set);
}

/** Forgets every simulated change (tests start from the sample again). */
export function resetSimulation(): void {
  copies.clear();
  bonds.clear();
}

function bondedAs<T extends Character>(person: T, marks: Map<string, boolean> | undefined): T {
  const mark = marks?.get(person.id);
  if (mark === undefined) return person;
  const { bonded: _, ...rest } = person;
  return (mark ? { ...rest, bonded: true } : rest) as T;
}

/** A sample's people, or one person, with the bonds the simulated actions made. */
export function withBonds<T extends PeopleView | Character>(set: string, answer: T): T {
  const marks = bonds.get(set);
  if (!marks) return answer;
  if ('present' in answer && 'known' in answer && Array.isArray(answer.present)) {
    const people = answer as PeopleView;
    return { ...people, present: people.present.map((p) => bondedAs(p, marks)), known: people.known.map((p) => bondedAs(p, marks)) } as T;
  }
  return bondedAs(answer as Character, marks) as T;
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function refuse(status: number, code: string, message: string): Response {
  return answer({ error: { code, message } }, status);
}

/** The bonuses an item's effect text gives: 「物攻+5，法防+2」 → 物攻 5, 法防 2. */
export function effectBonuses(effect: string | undefined): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  for (const match of (effect ?? '').matchAll(/([一-鿿]{1,4})\s*([+＋\-－])\s*(\d+)/g)) {
    const sign = match[2] === '+' || match[2] === '＋' ? 1 : -1;
    out.push({ label: match[1]!, value: sign * Number(match[3]) });
  }
  return out;
}

function worn(state: StateView): Item[] {
  return Object.values(state.equipment).flatMap((slots: (Item | null)[]) =>
    slots.filter((item): item is Item => item !== null),
  );
}

/** Works the attribute bonuses out again: sources from gear are replaced, other sources stay. */
function rebonus(state: StateView, gearNames: Set<string>): Change[] {
  const changes: Change[] = [];
  const fromGear = new Map<string, { from: string; value: number }[]>();
  for (const item of worn(state)) {
    for (const { label, value } of effectBonuses(item.effect)) {
      fromGear.set(label, [...(fromGear.get(label) ?? []), { from: item.name, value }]);
    }
  }
  state.player.attributes = state.player.attributes.map((attribute: Attribute) => {
    const kept = attribute.sources.filter((source) => !gearNames.has(source.from));
    const sources = [...(fromGear.get(attribute.label) ?? []), ...kept];
    const bonus = sources.reduce((sum, source) => sum + source.value, 0);
    const total = attribute.base + bonus;
    if (total !== attribute.total) {
      changes.push({
        path: `player.attributes.${attribute.key}`,
        label: attribute.label,
        from: String(attribute.total),
        to: String(total),
      });
    }
    return { ...attribute, sources, bonus, total };
  });
  return changes;
}

function slotChange(kind: EquipKind, index: number, from: Item | null, to: Item | null): Change {
  return {
    path: `equipment.${kind}.${index}`,
    label: KIND_LABEL[kind],
    ...(from ? { from: from.name } : {}),
    ...(to ? { to: to.name } : {}),
  };
}

/** The sect's actions and inherit on the sample's play (item 46, 49); a refusal's words, or null. */
function lifeAction(next: StateView, body: PanelAction, changes: Change[]): string | null {
  const play = next.play;
  if (!play) return '这个存档不是修仙人生';
  const sect = play.sect;
  if (body.action === 'sect_join') {
    const joining = play.joining;
    const chosen = joining?.sects.find((each) => each.name === body.sect);
    if (!joining || !chosen) return sect ? `已是${sect.name}的人` : '没有这个宗门';
    if (body.by === 'token' ? !joining.token.have : !joining.fair.open || joining.fair.why) {
      return body.by === 'token' ? `行囊里没有${joining.token.name}` : (joining.fair.why ?? `${joining.fair.name}眼下没有开`);
    }
    play.sect = {
      name: chosen.name, status: '外门', contribution: 0, earned: 0, stipend: 3,
      ...(chosen.place ? { place: chosen.place } : {}), here: false,
      duty: { done: 0, need: 1 }, exchange: [], contests: [],
    };
    delete play.joining;
    changes.push({ path: 'play.sect', label: '宗门', to: chosen.name });
    return null;
  }
  if (body.action === 'inherit') {
    const legacy = play.legacy;
    if (legacy?.state !== 'choosing') return '主角还在世，谈不上传承';
    const heir = body.heir === 'new' ? body.name : legacy.heirs?.find((each) => each.id === body.heir)?.name;
    if (!heir) return '传人只能从道侣、弟子里选，或者另立一个后人';
    changes.push({ path: 'play.legacy', label: '传承', from: legacy.name ?? next.player.name, to: heir });
    next.player = { ...next.player, name: heir };
    delete play.legacy;
    play.verbs = play.verbs.map(({ off: _off, note: _note, ...verb }) => verb);
    return null;
  }
  if (!sect) return '不在宗门里';
  if (body.action === 'sect_exchange') {
    const offer = sect.exchange.find((each) => each.id === body.offerId);
    if (!offer) return '兑换的单子上没有这一样';
    if (offer.off) return offer.note ?? '眼下换不了';
    changes.push({ path: 'play.sect.contribution', label: '贡献', from: String(sect.contribution), to: String(sect.contribution - offer.price) });
    sect.contribution -= offer.price;
    sect.exchange = sect.exchange.map((each) => (each.price > sect.contribution && !each.off ? { ...each, off: true, note: `贡献不够：要${each.price}，只有${sect.contribution}` } : each));
    return null;
  }
  if (body.action === 'sect_promote') {
    if (!sect.next?.met) return sect.next ? `升${sect.next.status}要${sect.next.realm}，历来贡献${sect.next.earned}` : '已到最高的一阶';
    changes.push({ path: 'play.sect.status', label: '身份', from: sect.status, to: sect.next.status });
    sect.status = sect.next.status;
    delete sect.next;
    return null;
  }
  if (body.action === 'sect_enter') {
    const contest = sect.contests?.find((each) => each.name === body.contest);
    if (!contest) return '没有这场比试';
    if (sect.entered) return `已报了${sect.entered.contest}`;
    sect.entered = { contest: contest.name, date: contest.date };
    sect.contests = sect.contests?.map((each) => (each === contest ? { ...each, entered: true } : each));
    changes.push({ path: 'play.sect.entered', label: '报名', to: contest.name });
    return null;
  }
  return '没有这项操作。';
}

/** Answers one POST /saves/{id}/actions for a sample set. */
export async function simulateAction(
  set: string,
  rawBody: unknown,
  loadState: () => Promise<unknown>,
  loadPeople: () => Promise<unknown> = async () => undefined,
): Promise<Response> {
  let body: PanelAction;
  try {
    body = JSON.parse(String(rawBody)) as PanelAction;
  } catch {
    return refuse(400, 'bad_response', '请求读不懂。');
  }
  let state = copies.get(set);
  if (!state) {
    const sample = await loadState();
    if (!sample) return refuse(404, 'not_found', '样例数据里没有状态。');
    state = JSON.parse(JSON.stringify(sample)) as StateView;
  }
  // a turn may have moved the page's version past the copy's; an older version is a real conflict
  if (typeof body.version !== 'number' || body.version < state.version) {
    return refuse(409, 'version_conflict', '这个存档在别处被改过，重新载入后再继续。');
  }
  const next = JSON.parse(JSON.stringify(state)) as StateView;
  const gearNames = new Set(
    [...worn(next), ...next.bag].filter((item) => item.equippable || KIND_OF[item.type]).map((item) => item.name),
  );
  const changes: Change[] = [];

  if (body.action === 'equip') {
    const at = next.bag.findIndex((item) => item.id === body.itemId);
    const item = next.bag[at];
    const kind = item && KIND_OF[item.type];
    if (!item || !kind || !item.equippable) return refuse(422, 'refused', '储物袋里没有这件能装备的东西。');
    const slots = next.equipment[kind];
    const asked = parseSlot(body.slot);
    const free = slots.findIndex((slot) => slot === null);
    const index = asked && asked.kind === kind ? asked.index : free >= 0 ? free : 0;
    const out = slots[index] ?? null;
    next.bag.splice(at, 1);
    if (out) next.bag.push(out);
    slots[index] = item;
    changes.push(slotChange(kind, index, out, item));
  } else if (body.action === 'unequip') {
    const asked = parseSlot(body.slot);
    const places = (Object.keys(next.equipment) as EquipKind[]).flatMap((kind) =>
      next.equipment[kind].map((item, index) => ({ kind, index, item })),
    );
    const found = places.find(
      ({ kind, index, item }) => item?.id === body.itemId && (!asked || (asked.kind === kind && asked.index === index)),
    );
    if (!found?.item) return refuse(422, 'refused', '身上没有这件装备。');
    next.equipment[found.kind][found.index] = null;
    next.bag.push(found.item);
    changes.push(slotChange(found.kind, found.index, found.item, null));
  } else if (body.action === 'tidy') {
    next.bag = next.bag
      .map((item, index) => ({ item, index }))
      .sort((a, b) => TYPE_ORDER.indexOf(a.item.type) - TYPE_ORDER.indexOf(b.item.type) || a.index - b.index)
      .map(({ item }) => item);
    changes.push({ path: 'bag', label: '储物袋', to: '已整理' });
  } else if (body.action === 'bond' || body.action === 'unbond') {
    // the old page's list: the people here, and the bonded ones who left
    const listed = (withBonds(set, ((await loadPeople()) as PeopleView | undefined) ?? { present: next.people, known: [] }));
    const person = [...listed.present, ...listed.known.filter((p) => p.bonded)].find((p) => p.id === body.charId);
    if (!person) return refuse(422, 'refused', '找不到这个人物');
    const wanted = body.action === 'bond';
    if (Boolean(person.bonded) === wanted) {
      return refuse(422, 'refused', wanted ? `「${person.name}」已是羁绊人物` : `「${person.name}」不是羁绊人物`);
    }
    const marks = bonds.get(set) ?? new Map<string, boolean>();
    marks.set(person.id, wanted);
    bonds.set(set, marks);
    next.people = next.people.map((p) => bondedAs(p, marks));
    changes.push({ path: `people.${person.id}.bonded`, label: person.name, ...(wanted ? { to: '羁绊' } : { from: '羁绊' }) });
  } else if (body.action.startsWith('sect_') || body.action === 'inherit') {
    const said = lifeAction(next, body, changes);
    if (said) return refuse(422, 'refused', said);
  } else if (body.action === 'belt' && next.play?.gear) {
    // the cultivation life's belt: at most five beltable things from the bag, in the order given
    const ids = body.items ?? [];
    const things = ids.map((id) => next.bag.find((item) => item.id === id));
    if (ids.length > 5 || things.some((item) => !item || !beltable(item))) return refuse(422, 'refused', '腰带只放储物袋里的丹药、符箓和符宝，至多五样。');
    const words = (belt: typeof next.play.gear.belt) => belt.filter(Boolean).map((thing) => thing!.name).join('、') || '空';
    const before = words(next.play.gear.belt);
    next.play.gear.belt = Array.from({ length: 5 }, (_, at) => {
      const item = things[at];
      return item ? { itemId: item.id, name: item.name, quantity: item.quantity, type: item.type } : null;
    });
    changes.push({ path: 'play.belt', label: '腰带', from: before, to: words(next.play.gear.belt) });
  } else if (['feed', 'out', 'in', 'hatch', 'promote'].includes(body.action) && next.play?.beasts) {
    // the cultivation life's spirit beasts, as the engine's beasts.cjs answers them, played on the copy
    const den = next.play.beasts;
    const beast = den.beasts.find((each) => each.id === body.beastId);
    if (body.action === 'out' || body.action === 'in') {
      if (!beast) return refuse(422, 'refused', '没有这只灵兽');
      if (body.action === 'out' && !beast.bound) return refuse(422, 'refused', `「${beast.name}」还没认主，不肯随你出战`);
      if (body.action === 'out' && beast.hurtDays) return refuse(422, 'refused', `「${beast.name}」伤重，还要养些日子`);
      for (const each of den.beasts) each.out = body.action === 'out' && each.id === beast.id;
      if (body.action === 'out') den.out = beast.id;
      else delete den.out;
      changes.push({ path: 'play.beasts.out', label: '出战', ...(body.action === 'out' ? { to: beast.name } : { from: beast.name }) });
    } else if (body.action === 'feed') {
      const food = beast?.foods.find((each) => each.itemId === body.itemId);
      const item = next.bag.find((each) => each.id === body.itemId);
      if (!beast || !food || !item) return refuse(422, 'refused', '储物袋里没有这件东西');
      if (beast.feeds.used >= beast.feeds.of) return refuse(422, 'refused', `「${beast.name}」这个月已经喂过${beast.feeds.of}回了`);
      beast.feeds.used += 1;
      beast.favour += 1;
      beast.aptitude.current = Math.min(beast.aptitude.max, beast.aptitude.current + Math.round((food.low + food.high) / 2));
      item.quantity -= 1;
      if (item.quantity <= 0) next.bag = next.bag.filter((each) => each.id !== item.id);
      changes.push({ path: `play.beasts.${beast.id}.aptitude`, label: `${beast.name}的资质`, to: String(beast.aptitude.current) });
    } else if (body.action === 'hatch') {
      const item = next.bag.find((each) => each.id === body.itemId);
      if (!item) return refuse(422, 'refused', '储物袋里没有这件东西');
      if (!['兽卵', '卵', '蛋'].some((word) => item.name.includes(word))) return refuse(422, 'refused', `「${item.name}」不是兽卵`);
      if (den.kept >= den.cap) return refuse(422, 'refused', `最多养${den.cap}只，养满了`);
      item.quantity -= 1;
      if (item.quantity <= 0) next.bag = next.bag.filter((each) => each.id !== item.id);
      den.eggs.push({ id: `E${den.eggs.length + 1}`, name: item.name.replace(/兽卵|卵|蛋/g, ''), tier: '一阶', days: 90 });
      den.kept += 1;
      changes.push({ path: 'play.beasts.eggs', label: '兽卵', to: item.name });
    } else {
      if (!beast) return refuse(422, 'refused', '没有这只灵兽');
      // the samples' beasts are all of the lowest grade: their tier stops where it is
      return refuse(422, 'refused', `「${beast.name}」资质是${beast.aptitude.grade}，等阶到一阶为止`);
    }
  } else {
    return refuse(400, 'bad_response', '没有这项操作。');
  }

  changes.push(...rebonus(next, gearNames));
  next.version = Math.max(body.version, state.version) + 1;
  copies.set(set, next);
  return answer({ state: next, changes });
}
