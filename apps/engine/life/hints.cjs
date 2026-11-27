'use strict';
/* 接下来 (the life view's `next`; a playtest fix): at most `most` short, concrete things to do now,
 * read from the save's real state with no model asked. The rules and the words are
 * content/life/next.json. Read only: it takes any env with ctx, state and play (progress mode's
 * engineEnv serves); env.plot is the storyline the server hands progress mode (its input.plot,
 * card_director.plot_payload: the chapters with their goals and conditions), which the main line
 * reads; without it there is no main line.
 *
 * next(env) → [{ text, kind, verb? }], none while a scene, a fight or an encounter is under way (it
 *   says itself what to do): kind where it comes from, verb a standing verb the interface can send
 *   as it is or open (job without an id opens the notices, trade without one the shop;
 *   play_models.Verb). Down at 0 气血 (mechanics.isFallen), 调息 first (kind injury, verb rest the
 *   most hours); with 内伤 not healed, due then gate (its injury hint: resting it out) before
 *   earning and the notices, unless the main line's day is near: a 静候 while injured is 养伤
 *   (injury.cjs, plan item 50's fixes). The sources, in this order, each giving at most its caps
 *   (the main line first
 *   when its day is near, mainSoon; the gate before earning and the notices taken when the trip to
 *   the auction with its pill or method is due and a notice taken cannot be done before one must
 *   set out, gateSoon: that notice is put off, and lapses at its day as any late one does):
 *   earn      the purse is short (fewer stones than next.json earn.below; or something wanted
 *             sells here for more than it holds: a 持有 of the main line, the gate's aid pill
 *             missing from its sheet) and the main line does not lead with 灵石 itself: a way to
 *             earn here first: a notice taken already, done (as job says); else
 *             selling what the shop here takes from the bag, the best-paid notice here (for the
 *             days it takes; only one that can be done in its days, inTime), carrying what the bag holds to the nearest shop that takes it, a sect
 *             duty for a member at the sect's place, gathering here what a shop here or near buys,
 *             hunting here when beast parts sell here or near (a cultivator's: a mortal takes no
 *             notice to hunt and hunts nothing; and only where the beasts here are no higher than
 *             the player's own tier, fight.tierOf); else the nearest place with notices (one the
 *             player may go into, as every place a hint sends them to: below). A hunt's
 *             verb carries its tier as 狩猎 sends it (the option's value, "1"). Every hunt (hunting
 *             for stones, a hunt notice to take here, on the main line or at a board elsewhere,
 *             one taken) only when its fight is likely won: huntOdds at least guide.huntWin; a
 *             notice taken that is not is said with no verb (jobHuntHard) and earning goes on
 * *   main      the director's current chapter (the first not done, mechanics.plotView judging its
 *             conditions): each condition not met turned into what this place allows, the first
 *             hint with 「主线·章名」 and every condition's progress (灵石 5/20). 灵石: the best-paid
 *             notice here (verb job with its id), selling what the shop here takes from the bag
 *             (verb trade sell), gathering here (verb gather), the nearest place to gather at (verb
 *             travel); 到达: the journey (and the day the calendar's event there opens); 境界:
 *             cultivating as far as it (verb cultivate days: the days a step of the player's own
 *             realm takes here; the next realm's, until full; injured, wait until healed first); with 修为 full
 *             the gate instead (verb breakthrough when it can be tried now; else nothing here, the
 *             gate's own hints say what blocks it; cultivating stays where the player is: the
 *             chapter has its day and its place, unlike the gate's own cultivating, retreat); 持有: the shop
 *             here selling it (verb trade); else the chapter's goal. All met: that it is ready
 *   job       each notice taken (frxPlay.jobs) and how it is done: go to its place (verb travel), there
 *             gather (verb gather), hunt (verb hunt, the lowest tier here, when likely won) or have a scene close
 *             (a visit where someone can be visited, else the player's own action)
 *   due       a pressure clock that is full (kind clock: what happens, its `full`); a pending event
 *             whose trigger has come (kind event: now, a date today or past, the place or region
 *             the player is in, a clock full, a realm reached, the person on the scene), one a full
 *             clock put there not said twice
 *   gate      injury: 内伤 not healed, 「内伤未愈，静候到正月廿六」, verb wait until that day;
 *             cultivate: the next gate's 修为 not full, unless injured (cultivating waits for the
 *             injury then), verb cultivate full; at a dangerous place whose foes may be above the
 *             player (encounter.warning), the journey first to the nearest place within guide.reach
 *             the player may go into that is not dangerous (unsafe, plan item 50's fixes: a 引灯司巡查使
 *             born on 猕洲 cultivated among 三阶 to 五阶 beasts and lost every fight of the first
 *             year); at a place thinner than one within guide.reach
 *             the player may go into, when the realm's top is more than guide.retreat times the
 *             journey off at the rate here, the journey there instead (retreat: the richest, the
 *             least dangerous, the nearest); mind: the gate's 心境 short, the nearest map place
 *             not yet visited (frxPlay.minded.places), verb travel; method: no method worn, the one
 *             in the bag to put on, else none at all; or, at the realm's top step, the method worn
 *             cannot reach the gate (its cap, gate.cjs): the nearest source of one that can, of the
 *             root's element first (methods.cjs: in the bag, put it on in place of the worn one; a
 *             shop, verb travel there or trade buy it here, when the purse holds its price; the
 *             sect's exchange; the auction's day; else the story's 机缘);
 *             gate: nothing above and an attempt can be made now. While its odds are below
 *             guide.odds and something within reach still raises them, the steps instead (guide:
 *             the gate's pill and where it is: at an auction while the years last, pillsUntil;
 *             a 浓 place within guide.reach days that the player
 *             may go into (places.mayEnter), someone whose tie is all that keeps them from standing
 *             guard, the 心结, 压境 still counting), each with what it adds, those that can be
 *             taken first with their verbs (an auction: go there once it is the journey and
 *             guide.early days off, wait there for its day, buy; paid for and further off, 压境
 *             while it counts, then wait until the day to set out, waitFor); within reach means the pill or
 *             the place: with neither, or the lifespan's last guide.short of the realm's, verb
 *             breakthrough with the pills in the bag. Short of stones for the method or the pill
 *             the guide wants, the earning hints lead (short, gateWants)
 *   hook      a pending event of the director's tied to another map place within `reach` days:
 *             known (the player's clue of it, ask.cjs) go there (verb travel); not known and asking
 *             around here (the verb ask open) 打探 (verb ask)
 *   venue     notices up here not yet taken (jobs.board; verb job), a shop here (verb trade)
 *   calendar  the nearest fixed event of the calendar: here, or reached before it opens (verb travel)
 * A hint the same as one already given (its text, or a journey to the same place) is not repeated.
 *
 * Who may go where (places.mayEnter, by the place's access in places.json): no hint sends the
 * player to a place they may not go into: the notices (the boards post none there, jobs.cjs), a
 * notice taken before they stopped, the board to go to, the shop to sell or carry to, the place to
 * gather at, the places to cultivate or try the gate at (unsafe, retreat, the home's vein, the
 * gate's aura place), the place not yet visited, the calendar's event (its place open on its day to
 * those it asks for: 沉钟泽 to the 诸院's 炼气 disciples), the sources of a method or a pill, the
 * main line's 到达 (its goal is said instead) and a director's hook once known (these two are the
 * story's own trips: a place a calendar opens counts as open for them, its status and realm held).
 * The player's own home is theirs, whatever its place's access. Nothing else is stopped: a player
 * who walks in is not sent out, and 接下来 there reads the place as any other (cultivating there,
 * its gate, its notices). A 散修 sent to 石匣岭 on a 矿役 notice cultivated there for decades
 * (the replayed 伪灵根 of docs/review/gameplay/playtest-2.md).
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const fight = require('./fight.cjs');
const gate = require('./gate.cjs');
const injury = require('./injury.cjs');
const jobs = require('./jobs.cjs');
const places = require('./places.cjs');
const trade = require('./trade.cjs');
const goods = require('./goods.cjs');
const travel = require('./travel.cjs');
const starSea = require('./star-sea.cjs');
const humanJourney = require('./human-journey.cjs');
const verbs = require('./verbs.cjs');
const methods = require('./methods.cjs');
const speed = require('./speed.cjs');
const home = require('./home.cjs');
const gear = require('./gear.cjs');
const perks = require('./perks.cjs');
const beasts = require('./beasts.cjs');
const actions = require('./actions.cjs');
const rules = require('../turn-rules.cjs');
const { create } = require('../core/random.cjs');
const threads = require('./threads.cjs');
const { favourTier } = require('./actions.cjs');
const { data } = require('./data.cjs');
const { list } = require('./play.cjs');

const RULES = data('next');
const SECTS = data('sects');
const REST_HOURS = data('verbs').rest.hours.max;
const TIERS = data('actions').favour.tiers.map(tier => tier.name);
const ORDER = mechanics.COMBAT.realms.order;
const T = RULES.texts;
const DAY = clock.DAY_MINUTES;
const fill = (template, values) => chronicle.fill(template, values);
const numeral = n => chronicle.numeral(Math.max(0, Math.round(n)));
const dayText = key => clock.dateOf(clock.dayOfDate(key) * DAY).text;
const clip = text => {
  const chars = [...plain(text)];
  return chars.length > RULES.clip ? `${chars.slice(0, RULES.clip - 1).join('')}…` : chars.join('');
};
// One call of next reads the gate's sheet, the verbs and each source list once (memo, kept only
// while the call runs: everything here is synchronous and read only).
let memo = null;
const sheetOf = env => (memo ? (memo.sheet ??= gate.sheet(env)) : gate.sheet(env));
const verbList = env => (memo ? (memo.verbs ??= verbs.list(env)) : verbs.list(env));
const needOf = env => (memo ? (memo.need === undefined ? (memo.need = methods.need(env, sheetOf(env))) : memo.need) : methods.need(env));
// The sources of a method or a pill (methods.sources) at places the player may go into: shops are
// in towns and markets, the auctions in 泊灯城 and 白苇集 and the sect's exchange the player's own, all
// open to them now; a shop or a sale put where it is not would not be sent to.
function sourcesOf(env, names, until = null) {
  const found = () => methods.sources(env, names, { until })
    .filter(source => source.kind === 'bag' || source.kind === 'sect' || !source.place || places.mayEnter(env, source.place));
  if (!memo) return found();
  const key = `${names.join('|')}:${until}`;
  return (memo.sources[key] ??= found());
}
// The last day the guide waits for a gate's pill: until the lifespan's last guide.short of the
// realm's (an auction further off than the next few still counts while the years last: a simulated
// 天灵根 tried 结婴 ten times at a tenth while the 结婴丹 came at the sixth auction).
function pillsUntil(env, c) {
  const left = yearsLeft(c) - RULES.guide.short * realmLife(c);
  return clock.today(env) + Math.max(0, Math.floor(left * clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear));
}
const listed = (env, kind) => verbList(env).some(verb => verb.kind === kind && !verb.off);

// The days to a map place from here: null when it cannot be reached (or is here), or past `most`.
function reach(env, place, most = Infinity) {
  const route = travel.route(env, place);
  return route.refused || route.days > most ? null : route.days;
}

// The map places of the region within `days` of here (travel.near's days, nearest first; Infinity:
// the whole region), once a call. travel.near takes a count of places (its default the nearest
// twelve): the guide's reach (thirty days) read as the nearest thirty places left a 洞府 twenty-one
// days off out of reach and a 伪灵根 tried 结丹 without its vein (round three's lives); a buyer or
// a board within next.json reach was looked for only among the nearest twelve.
function within(env, days) {
  const all = memo ? (memo.near ??= travel.near(env, Infinity)) : travel.near(env, Infinity);
  return all.filter(place => place.days <= days);
}

// What a place yields to gathering (its 产什么): the classes, 灵草 first.
function yieldsOf(facts) {
  const classes = [...new Set(list(facts.trade?.produces).map(text => String(text).split('·')[0]))];
  return classes.sort((a, b) => (a === '灵草' ? -1 : b === '灵草' ? 1 : 0));
}

// ---------------------------------------------------------------- the main line

function chapterOf(env) {
  if (!env.plot || !Array.isArray(env.plot.chapters)) return null;
  const view = mechanics.plotView(env, env.plot);
  if (view.currentIndex === null) return null;
  const chapter = env.plot.chapters[view.currentIndex] || {};
  return { title: plain(chapter.title), goal: plain(chapter.goal), conditions: view.chapters[view.currentIndex].conditions, met: view.allMet };
}

function progressOf(env, condition) {
  const { kind, value } = condition;
  if (kind === '灵石') {
    const want = condition.count ?? mechanics.numberIn(value);
    return `灵石 ${mechanics.stonesOf(env.state['0']?.B1) ?? 0}/${want ?? '?'}`;
  }
  if (kind === '持有') return `${value} ${Number(/共(\d+)件/.exec(condition.detail)?.[1]) || 0}/${condition.count ?? 1}`;
  if (kind === '到达') return `到${value}`;
  return value ? `${kind}${value}` : kind;
}

// What earns spirit stones here, best first.
// Whether a notice can be done in the days it gives: the journey to its place and the work there
// (a gathering's days, the wait for a scene: jobs.json work, as the boards count it) within them.
// The boards once posted some that could not (往转潮山采药, forty-five days away, on a notice of
// forty-three; a long playtest took one, batch 5); now they post only those that can at the
// slowest walk.
const WORK_DAYS = jobs.RULES.work;
function inTime(env, notice) {
  const journey = notice.place === hereName(env) ? 0 : reach(env, notice.place);
  return journey !== null && journey + (WORK_DAYS[notice.goal] ?? 0) <= notice.days;
}

function earning(env) {
  const ways = [];
  const board = jobs.board(env);
  const free = list(board.notices).filter(notice => !notice.taken && inTime(env, notice) && !tooHard(env, notice));
  if (board.open && free.length) {
    const best = free.reduce((top, notice) => (notice.pay > top.pay ? notice : top));
    ways.push({ text: fill(T.job, { 差: best.title, 酬: numeral(best.pay) }), verb: { kind: 'job', id: best.id } });
  }
  const shop = trade.view(env);
  if (shop.open && shop.buys.length) {
    const best = shop.buys.reduce((top, thing) => (thing.price * thing.count > top.price * top.count ? thing : top));
    ways.push({ text: fill(T.sell, { 物: best.name, 价: numeral(best.price * best.count) }), verb: { kind: 'trade', side: 'sell', id: best.id, count: best.count } });
  }
  const here = places.placeFacts(env);
  if (listed(env, 'gather') && yieldsOf(here).length) {
    ways.push({ text: fill(T.gatherHere, { 日: numeral(RULES.gatherDays), 物: yieldsOf(here)[0] }), verb: { kind: 'gather', days: RULES.gatherDays } });
  } else {
    // the nearest place in the region that yields something (no reach: the chapter wants it) and
    // that the player may go into (石匣岭 yields stones, and is the 诸院's)
    const there = within(env, Infinity).find(place => {
      const facts = places.factsOf(place.name, env.worldMap);
      return yieldsOf(facts).length && places.mayEnter(env, place.name, { facts });
    });
    if (there) {
      ways.push({ text: fill(T.gatherThere, { 地: there.name, 物: yieldsOf(places.factsOf(there.name, env.worldMap))[0], 日: numeral(there.days) }),
        verb: { kind: 'travel', to: there.name } });
    }
  }
  return ways;
}

// 修炼 as far as a realm the main line asks for. A step of the realm the player is in (炼气七层 for a
// 炼气三层) is the days its steps take at the rate here (a plan of one day's 修炼 gives the rate:
// place, root, method, 心境, the pool); `full` alone went on to the top of the realm (a 炼气三层 sat
// nine months to 炼气十二层, past the chapter's own day; batch 5). Another realm's (筑基) is the top
// first, then the gate: until full.
function cultivateTo(env, value) {
  const target = mechanics.parseRealm(value);
  const c = mechanics.cultivator(env);
  const need = (mechanics.stepOf(target) - c.step) * 100 - c.progress;
  if (target.unknown || target.major !== c.major || need <= 0) return { kind: 'cultivate', full: true };
  const plan = verbs.VERBS.cultivate(env, { kind: 'cultivate', days: 1 });
  const perDay = plan.refused ? 0 : Number(plan.receipt?.cultivation?.perDay) || 0;
  return perDay > 0 ? { kind: 'cultivate', days: Math.ceil(need / perDay) } : { kind: 'cultivate', full: true };
}

function waysFor(env, condition, soon = null) {
  const { kind, value } = condition;
  if (kind === '灵石') return earning(env);
  if (kind === '到达') {
    // not to a place the player may not go into (the chapter's goal is said instead): its status and
    // realm held, whatever day its calendar opens it (沉钟泽: the 诸院's 炼气 disciples)
    if (value && !places.mayEnter(env, value, { open: true })) return [];
    const days = value ? reach(env, value) : null;
    if (days === null) {
      const next = value ? starSea.hintTo(env, value) : null;
      return next ? [next] : [];
    }
    const event = calendar.upcoming(env, 5).find(entry => entry.kind === 'fixed' && entry.place === value);
    // the main line's own day near: by when to be there
    const text = soon ? fill(T.arriveBy, { 期: soon.date.text, 地: value, 日: numeral(days) })
      : event ? fill(T.arriveEvent, { 事: event.title, 开: event.date.text, 地: value, 日: numeral(days) }) : fill(T.arrive, { 地: value, 日: numeral(days) });
    return [{ text, verb: { kind: 'travel', to: value } }];
  }
  if (kind === '境界') {
    const hurt = injury.active(env);
    if (hurt) return [{ text: fill(T.realmHurt, { 日: dayText(hurt.until) }), verb: { kind: 'wait', until: hurt.until } }];
    // 修为 full: more cultivating takes the realm no further (压境 only steadies the base, and is
    // refused once that is full); the gate does
    const sheet = sheetOf(env);
    if (!sheet.beyond && !sheet.requires.some(each => each.key === 'full' && !each.met)) {
      if (!sheet.ready) return [];
      // the gate's own steps while its odds are low (guide), else the gate with the pills in the bag
      const steps = guide(env, sheet, mechanics.cultivator(env));
      return steps.length ? steps : [{ text: fill(T.realmGate, { 关: sheet.name, 成: `${sheet.odds}%` }), verb: attemptVerb(env) }];
    }
    return [{ text: fill(T.realm, { 境: value }), verb: cultivateTo(env, value) }];
  }
  if (kind === '持有') {
    // the cheapest that counts here, else at the nearest shop within reach; short of its price,
    // earning leads (short) and this step has no button
    const found = heldFor(env, value);
    if (!found) return [];
    const paid = found.price <= stonesHeld(env);
    if (!found.days) {
      return [{ text: fill(T.buyHeld, { 物: found.good.name, 价: numeral(found.price) }),
        ...(paid ? { verb: { kind: 'trade', side: 'buy', id: found.good.id, count: 1 } } : {}) }];
    }
    return [{ text: fill(T.buyHeldThere, { 地: found.place, 物: found.good.name, 价: numeral(found.price), 日: numeral(found.days) }),
      ...(paid ? { verb: { kind: 'travel', to: found.place } } : {}) }];
  }
  return [];
}

// What a main line's 持有 can be had with: a thing of that kind (法宝, 丹药 …: the catalogue's
// type, mechanics.heldMatch) or name, the cheapest the shop here sells, else the cheapest at the
// nearest shop within next.json reach. { good, price, place, days } (days 0 here) or null. The
// shop's goods were matched by name: 「持有法宝」 found nothing at 白苇集 with 113 stones in the
// purse (the owner's turn 73).
// Goods whose uses mark them shunned (next.json heldShun: 邪 …) come only when nothing ordinary is
// within reach: 旧渡城's 阴魂幡, 「邪修的邪器，正道修士见了要起疑」, was the turn-73 answer.
function heldFor(env, value) {
  const match = mechanics.heldMatch(value);
  const fits = good => good && match(good.name, good.type || goods.CLASSES[good.class]?.type);
  const shunned = good => RULES.heldShun.some(word => String(good.uses || '').includes(word));
  const cheapest = list => list.reduce((best, each) => (!best || each.price < best.price ? each : best), null);
  let fallback = null;
  // the places nearest first (here, then within reach), at each the cheapest ordinary one
  const shop = trade.view(env);
  const stops = [{ name: hereName(env), days: 0, sells: shop.open ? shop.sells.map(each => ({ good: goods.byId(each.id), price: each.price })) : [] },
    ...within(env, RULES.reach).filter(place => trade.openAt(env, place.name)).map(place => ({ ...place, sells: null }))];
  for (const stop of stops) {
    const sells = stop.sells || trade.shopOf(env, stop.name).goods.filter(good => !good.lot).map(good => ({ good, price: trade.each(env, good, 'buy', false, stop.name) }));
    const found = sells.filter(each => fits(each.good));
    const ordinary = cheapest(found.filter(each => !shunned(each.good)));
    if (ordinary) return { ...ordinary, place: stop.name, days: stop.days };
    const odd = cheapest(found.filter(each => shunned(each.good)));
    if (odd && !fallback) fallback = { ...odd, place: stop.name, days: stop.days };
  }
  return fallback;
}

// The main line's day drawing near (calendar.mainDay): no further off than the journey to the
// chapter's place (none when the player is there or it names none) and next.json mainAhead days
// more. 接下来 then leads with the main line, ahead of earning, and the journey comes first among
// its steps: both dated events of a long playtest went by while it earned stones and sat in
// seclusion (batch 5). { day, date, title, place?, left, journey } or null.
function mainSoon(env) {
  const main = calendar.mainDay(env);
  if (!main) return null;
  const left = main.day - clock.today(env);
  const journey = main.place && !hereName(env).includes(main.place) && !main.place.includes(hereName(env) || '\u0000')
    ? reach(env, main.place) ?? 0 : 0;
  return left <= journey + RULES.mainAhead ? { ...main, left, journey } : null;
}

function mainHints(env) {
  const chapter = chapterOf(env);
  if (!chapter) return [];
  const progress = chapter.conditions.map(condition => progressOf(env, condition)).join('，');
  const head = way => (progress ? fill(T.main, { 章: chapter.title, 进度: progress, 办法: way }) : fill(T.mainPlain, { 章: chapter.title, 办法: way }));
  if (chapter.met) return [{ text: fill(T.mainMet, { 章: chapter.title }), kind: 'main' }];
  const soon = mainSoon(env);
  const unmet = chapter.conditions.filter(condition => condition.met === false);
  const ordered = soon ? [...unmet.filter(each => each.kind === '到达'), ...unmet.filter(each => each.kind !== '到达')] : unmet;
  const ways = ordered.flatMap(condition => waysFor(env, condition, soon));
  // nothing to do for it now: it says when it opens, and goes below what can be done (hintsOf)
  if (!ways.length) {
    const opens = mainOpens(env, chapter);
    return [{ text: head(clip(chapter.goal) || chapter.title) + (opens ? `；${opens}` : ''), kind: 'main' }];
  }
  return ways.map((way, i) => ({ text: i ? way.text : head(way.text), kind: 'main', ...(way.verb ? { verb: way.verb } : {}) }));
}

// When a main line with nothing to do now opens: the calendar's fixed event its chapter names (the
// 春汀集 of 「在春汀集中采买法器」), else its own day (calendar.mainDay); '' when neither.
function mainOpens(env, chapter) {
  const words = `${chapter.title || ''}${chapter.goal || ''}`;
  const event = calendar.ahead(env).find(entry => entry.kind === 'fixed' && entry.title && entry.days > 0 && words.includes(entry.title));
  if (event) return fill(T.mainOpens, { 事: event.title, 期: event.date.text, 久: about(event.days) });
  const main = calendar.mainDay(env);
  return main ? fill(T.mainBy, { 期: main.date.text, 久: about(main.day - clock.today(env)) }) : '';
}
// A stretch of days in round words: 二十日, 四个多月, 一年多.
function about(days) {
  const month = clock.CALENDAR.daysPerMonth, year = month * clock.CALENDAR.monthsPerYear;
  if (days < month) return `${numeral(Math.max(1, days))}日`;
  if (days < year) return `${numeral(Math.floor(days / month))}个${days % month ? '多' : ''}月`;
  return `${numeral(Math.floor(days / year))}年${days % year ? '多' : ''}`;
}

// ---------------------------------------------------------------- notices taken, and earning when short

const stonesHeld = env => mechanics.stonesOf(env.state['0']?.B1) ?? 0;
const hereName = env => places.placeFacts(env).place || '';
// Whether the shop at a map place takes a class of goods (its 收什么, and a shop there).
const buysAt = (env, place, cls) => trade.openAt(env, place)
  && list(places.factsOf(place, env.worldMap).trade?.buys).some(text => String(text).split('·')[0] === cls);
// Where a class of goods sells: here, else the nearest place within reach the player may go into
// whose shop takes it.
function soldAt(env, cls) {
  const here = hereName(env);
  if (here && buysAt(env, here, cls)) return { here: true };
  const there = within(env, RULES.reach).find(place => buysAt(env, place.name, cls) && places.mayEnter(env, place.name));
  return there ? { place: there.name, days: there.days } : null;
}
const soldText = sold => (sold.here ? T.soldHere : fill(T.soldThere, { 地: sold.place, 日: numeral(sold.days) }));
// The lowest tier of beast here as 狩猎 sends it: its first option's value, a string ("1"; the
// view's verb list, rewards.listed). A number there failed the state view's contract (batch 5).
const lowestTier = env => String(list(verbList(env).find(verb => verb.kind === 'hunt')?.options)[0]?.value ?? '1');
// The tier of beast the player counts as (fight.tierOf: 炼气一层 is 一阶's, 筑基 三阶's).
const ownTier = env => fight.tierOf(mechanics.parseRealm(env.state['0']?.B1?.['2']));

// The chance of winning a hunt's fight against a beast of `tier` (1 一阶 …), estimated with the
// fight engine's rules (fight.cjs; the engine lane's own helper is to replace it): guide.huntTrials
// fights as the hunt fights them. Who spots whom is the encounter's check (the player's 探查 with
// the gear worn and the perks against the beast's 潜行 by its tier's baseline, 1d10 each, the player
// on a tie): spotted first, 抢先手 is a blow with the ambush and no reply; spotted, 迎战 lets the
// beast's ambush land first. Then the rounds in that order: the player strikes (×内伤's attack while
// injured), the beast acts on its class's intents (foes.json: 扑咬, 蓄势 doubling its next blow,
// 游走; below hpBelow it flees as often as it fights on, and a beast that got away was no hunt
// won). Blows are mechanics.strike's, the player at the 气血 now. A fight still on after
// guide.huntRounds counts as lost. 接下来 sent players hunting day after day who lost the fight
// (the coordinator's first-year findings): it sends no one hunting below guide.huntWin. Kept per
// player state and tier (a bounded cache). Against forty hunts fought through the engine the
// estimate came within a tenth (tests/test_life_next.py).
const FOES = data('foes');
const HUNT_ODDS = new Map();
function huntSpot(env, beast) {
  const stats = gear.panelOf(env);
  const look = actions.CHECKS['探查'], hide = actions.CHECKS['潜行'];
  const band = (value, check) => Math.floor(rules.modifierFor(value) * (check.modifierFactor ?? 1));
  const mine = band(mechanics.statValue(stats[look.attribute]), look)
    + perks.checkBonus([...perks.owned(env), ...beasts.useNames(env)], '探查').value;
  const hidden = band(mechanics.statValue(beast.stats[hide.attribute]), hide);
  const die = rules.RULES.die;
  let first = 0;
  for (let a = 1; a <= die; a += 1) for (let b = 1; b <= die; b += 1) if (a + mine >= b + hidden) first += 1;
  return first / (die * die);
}
function huntFight(env, player, realm, seed, weak) {
  const random = create(seed);
  const kind = FOES.classes.beast, status = FOES.rules.statuses;
  const me = { ...player, stats: { ...player.stats } };
  const beast = { id: 'H1', name: '妖兽', realm, stats: mechanics.baselineStats(realm, seed) };
  const share = fighter => (100 * mechanics.statValue(fighter.stats['血量'])) / Math.max(1, mechanics.statValue(fighter.stats['血量'], 'max'));
  let blows = 0, charged = false;
  const hit = (attacker, defender, { ambush = false, factor = 1 } = {}) => {
    blows += 1;
    const struck = mechanics.strike({ ...env, seed: `${seed}:${blows}` }, attacker, defender, { style: '物理', ambush, totals: gear.totals }, 0, 0);
    const damage = struck.hit ? Math.max(1, Math.floor(struck.damage * factor)) : 0;
    const after = Math.max(0, struck.hp.before - damage);
    defender.stats = { ...defender.stats, 血量: { current: after, max: struck.hp.max } };
    return after <= 0;
  };
  const intent = () => {
    const group = kind.intents.find(each => !each.when || share(beast) < each.when.hpBelow) || kind.intents.at(-1);
    const open = group.pick.filter(each => !(charged && each.act === 'charge'));
    const pool = open.length ? open : group.pick;
    let left = random.random() * pool.reduce((sum, each) => sum + each.weight, 0);
    return (pool.find(each => (left -= each.weight) < 0) || pool.at(-1)).act;
  };
  const first = random.random() < huntSpot(env, beast);
  if (first ? hit(me, beast, { ambush: true, factor: weak }) : hit(beast, me, { ambush: true })) return first;
  for (let round = 0; round < RULES.guide.huntRounds; round += 1) {
    const act = intent();
    for (const side of first ? ['me', 'beast'] : ['beast', 'me']) {
      if (side === 'me') {
        if (hit(me, beast, { factor: weak })) return true;
      } else if (act === 'flee') {
        return false;
      } else if (act === 'charge') {
        charged = true;
      } else if (act !== 'wait') {
        const down = hit(beast, me, { factor: charged ? status['蓄势'].damage : 1 });
        charged = false;
        if (down) return false;
      }
    }
  }
  return false;
}
function huntOdds(env, tier) {
  if (!env.state['0']?.B1) return 0;
  const player = mechanics.fighter(env, 'B1', '', '', '你', []);
  if (player.error || mechanics.statValue(player.stats['血量']) <= 0) return 0;
  // what the fight reads: the realm, the 气血 now, the totals with the gear worn, an injury, the
  // perks and the spirit beasts that add to 探查
  const hurt = injury.active(env);
  const key = [env.archiveId, tier, player.realm?.text, mechanics.statValue(player.stats['血量']),
    JSON.stringify(gear.totals(env, 'B1', player.stats)), JSON.stringify(gear.panelOf(env)['神识'] ?? null), hurt ? 1 : 0,
    perks.owned(env).join('、'), beasts.useNames(env).join('、')].join('|');
  if (HUNT_ODDS.has(key)) return HUNT_ODDS.get(key);
  if (HUNT_ODDS.size >= 5000) HUNT_ODDS.clear();
  const realm = mechanics.parseRealm(fight.realmOfTier(Number(tier) || 1, false));
  const weak = hurt ? FOES.rules.statuses['内伤'].attack : 1;
  let won = 0;
  for (let n = 0; n < RULES.guide.huntTrials; n += 1) {
    if (huntFight(env, player, realm, `${env.archiveId || ''}:猎:${tier}:${n}`, weak)) won += 1;
  }
  const odds = won / RULES.guide.huntTrials;
  HUNT_ODDS.set(key, odds);
  return odds;
}
// Whether a hunt of `tier` is likely won (guide.huntWin).
const huntable = (env, tier) => huntOdds(env, tier) >= RULES.guide.huntWin;
// The tier a notice's hunt meets at its place: the lowest of the beasts here when it is here, else
// the tier of the place's region (places.tierAt; 一阶 is 1).
const noticeTier = (env, notice) => (notice.place === hereName(env) ? Number(lowestTier(env)) || 1
  : Math.max(1, tierIndex(places.tierAt(notice.place, env.worldMap)) + 1));
// A notice that is a fight the player is not likely to win (a hunt below guide.huntWin).
const tooHard = (env, notice) => notice.goal === 'hunt' && !huntable(env, noticeTier(env, notice));

// How a notice taken is done from here.
function doing(env, job) {
  const here = hereName(env);
  const days = clock.dayOfDate(job.due) === null ? null : clock.dayOfDate(job.due) - clock.today(env);
  const values = { 差: job.title, 地: job.place, 酬: numeral(job.pay), 期: days === null ? '' : numeral(Math.max(0, days)) };
  if (job.place !== here) {
    // not to a place the player may not go into: the boards post no such notice now, and one taken
    // before (a 散修's 矿役 at 石匣岭) is left to its day
    const far = places.mayEnter(env, job.place) ? reach(env, job.place) : null;
    return far === null ? null : { text: fill(T.jobGo, { ...values, 日: numeral(far) }), kind: 'job', verb: { kind: 'travel', to: job.place } };
  }
  if (job.goal === 'gather' && listed(env, 'gather')) return { text: fill(T.jobGather, values), kind: 'job', verb: { kind: 'gather', days: RULES.gatherDays } };
  if (job.goal === 'hunt' && listed(env, 'hunt')) {
    const tier = lowestTier(env);
    return huntable(env, tier) ? { text: fill(T.jobHunt, values), kind: 'job', verb: { kind: 'hunt', tier } }
      : { text: fill(T.jobHuntHard, { ...values, 阶: tierWord(Number(tier) || 1) }), kind: 'job' };
  }
  if (job.goal === 'scene') {
    // Carry out the job with a local contact or the player's own action.
    const visit = verbList(env).find(verb => verb.kind === 'visit' && !verb.off && list(verb.options).length);
    return visit ? { text: fill(T.jobVisit, { ...values, 人: visit.options[0].label }), kind: 'job', verb: { kind: 'visit', id: visit.options[0].value } }
      : { text: fill(T.jobAct, values), kind: 'job' };
  }
  return null;
}

function jobHints(env) {
  return list(env.play?.jobs).filter(job => job && job.place).map(job => doing(env, job)).filter(Boolean);
}

// Whether the purse is short: fewer stones than earn.below; or something wanted sells here for more
// than the purse holds: a 持有 the main line wants, the aid pill the gate's sheet misses.
function short(env, chapter) {
  const stones = stonesHeld(env);
  if (stones < RULES.earn.below) return true;
  // a 坊市's 洞府 with a vein worth having for the years of this realm, not yet paid for (veinOption)
  const vein = veinOption(env, mechanics.cultivator(env));
  if (vein && stones < vein.want) return true;
  // the home's rent due within guide.rentAhead days and the purse short of it: else it is lost
  const rent = env.play?.home?.rent;
  const due = rent?.due ? clock.dayOfDate(rent.due) : null;
  if (due !== null && due - clock.today(env) <= RULES.guide.rentAhead && stones < (Number(rent.yearly) || 0)) return true;
  // the method or the gate's pill the gate wants, at its nearest price in stones
  const wants = gateWants(env);
  if (wants !== null && wants > stones) return true;
  // the main line's 持有 (by kind or by name) dearer than the purse, here or near (heldFor)
  const held = chapter?.conditions.find(condition => condition.met === false && condition.kind === '持有');
  const found = held ? heldFor(env, held.value) : null;
  if (found && found.price > stones) return true;
  const shop = trade.view(env);
  if (!shop.open) return false;
  const wanted = [];
  const sheet = sheetOf(env);
  const aids = !sheet.beyond && sheet.prepares.find(each => each.key === 'aids' && each.state === 'miss');
  if (aids) wanted.push(...String(aids.label).split('、'));
  return wanted.some(name => name && shop.sells.some(each => each.name.includes(name) && each.price > stones));
}

// Where the pay suits the player: notices pay by the tier of the region they are done in (jobs.json
// pay), and a board near a border posts errands on both sides. When the region here pays below the
// player's own tier (fight.tierOf), the board within guide.reach whose best free notice pays more
// than guide.board times the best here, the best paid for the journey first. { name, days, pay } or null.
const TIER_NAMES = Object.keys(data('goods').tiers);
const tierIndex = name => TIER_NAMES.indexOf(name);
// A board's best pay this half-year (the notices change every jobs.json every months: drawn once a
// half and kept; the player's own taken ones are few enough not to matter; what a board posts
// follows who may go where, places.accessKey): a bounded cache.
const BOARDS = new Map();
function bestPay(env, place) {
  const half = Math.floor(clock.monthOf(mechanics.readClock(env.state).minutes) / jobs.RULES.every);
  const key = `${env.archiveId}|${place}|${half}|${places.accessKey(env)}`;
  if (BOARDS.has(key)) return payOf(env, BOARDS.get(key));
  if (BOARDS.size >= 20000) BOARDS.clear();
  const board = jobs.board(env, place);
  const free = list(board.open ? board.notices : []).filter(notice => !notice.taken)
    .map(notice => ({ pay: Number(notice.pay) || 0, goal: notice.goal, place: notice.place }));
  BOARDS.set(key, free);
  return payOf(env, free);
}
// The best pay of free notices, none a fight the player is not likely to win (tooHard).
const payOf = (env, free) => Math.max(0, ...free.filter(notice => !tooHard(env, notice)).map(notice => notice.pay));
function betterBoard(env) {
  const here = hereName(env);
  const low = here ? TIER_NAMES.indexOf(places.tierAt(here, env.worldMap)) : -1;
  if (low < 0 || ownTier(env) - 1 <= low) return null;
  const local = bestPay(env, here);
  let found = null;
  for (const place of within(env, RULES.guide.reach)) {
    // a board at a place the player may not go into (a sect's 执事堂) is not one to go to
    if (!places.mayEnter(env, place.name)) continue;
    const pay = bestPay(env, place.name);
    if (pay <= local * RULES.guide.board) continue;
    const worth = pay / (1 + place.days);
    if (!found || worth > found.worth) found = { name: place.name, days: place.days, pay, worth };
  }
  return found;
}

function earnHints(env) {
  const chapter = chapterOf(env);
  // the main line leads with earning itself when it wants stones (its 灵石 condition)
  if (!short(env, chapter) || chapter?.conditions.some(condition => condition.met === false && condition.kind === '灵石')) return [];
  // a notice taken is done first; one that is a fight not likely won is said by the job source,
  // and the other ways to earn come here
  const taken = jobHints(env);
  if (taken.some(hint => hint.verb)) return taken;
  const out = [];
  // what the gate wants is more than the purse holds and the pay here is below the player: where
  // it suits them first (a 结丹 散修 ran 云汀湾's errands for a dozen stones each; batch 12's simulator)
  const wants = gateWants(env);
  const away = wants !== null && wants > stonesHeld(env) ? betterBoard(env) : null;
  if (away) {
    out.push({ text: fill(T.earnAway, { ...purseWords(env), 地: away.name, 酬: numeral(away.pay), 日: numeral(away.days) }), kind: 'earn',
      verb: { kind: 'travel', to: away.name } });
  }
  const shop = trade.view(env);
  if (shop.open && shop.buys.length) {
    const best = shop.buys.reduce((top, thing) => (thing.price * thing.count > top.price * top.count ? thing : top));
    out.push({ text: fill(T.earnSell, { ...purseWords(env), 物: best.name, 价: numeral(best.price * best.count) }), kind: 'earn',
      verb: { kind: 'trade', side: 'sell', id: best.id, count: best.count } });
  }
  // the notice that pays best for the days it takes to get there
  const board = jobs.board(env);
  const worth = notice => notice.pay / (1 + (notice.place === hereName(env) ? 0 : reach(env, notice.place)));
  // a mortal hunts no 妖兽: no notice to hunt one, no hunting to sell its parts
  const mortal = mechanics.cultivator(env).major < 1;
  const free = list(board.open ? board.notices : [])
    .filter(notice => !notice.taken && !(mortal && notice.goal === 'hunt') && !tooHard(env, notice) && inTime(env, notice));
  if (board.open && free.length) {
    const best = free.reduce((top, notice) => (worth(notice) > worth(top) ? notice : top));
    out.push({ text: fill(T.earnJob, { ...purseWords(env), 差: best.title, 酬: numeral(best.pay) }), kind: 'earn', verb: { kind: 'job', id: best.id } });
  }
  // what the bag holds that a shop near takes (none here): carry it there
  const carry = shop.open ? null : carried(env);
  if (carry) out.push({ text: fill(T.earnCarry, { ...purseWords(env), 物: carry.names, 地: carry.place, 日: numeral(carry.days) }), kind: 'earn',
    verb: { kind: 'travel', to: carry.place } });
  // a sect's duty at its place (the stipend comes with the standing; the duty keeps it): duty
  const sect = env.play?.sect && typeof env.play.sect === 'object' ? env.play.sect : null;
  const sectHome = sect ? SECTS.sects?.[sect.name]?.place : null;
  if (sect && (!sectHome || hereName(env) === sectHome)) out.push({ text: fill(T.earnDuty, { ...purseWords(env), 宗: sect.name }), kind: 'earn', verb: { kind: 'duty' } });
  const facts = places.placeFacts(env);
  const yields = yieldsOf(facts);
  const herbs = yields.length && listed(env, 'gather') ? soldAt(env, yields[0]) : null;
  if (herbs) out.push({ text: fill(T.earnGather, { ...purseWords(env), 日: numeral(RULES.gatherDays), 物: yields[0], 卖: soldText(herbs) }), kind: 'earn', verb: { kind: 'gather', days: RULES.gatherDays } });
  // hunting for stones only where the beasts are no higher than the player (a 炼气一层 was sent to
  // hunt 三阶 beasts, 筑基's match, at 南磷岭; batch 5)
  if (listed(env, 'hunt') && !mortal && Number(lowestTier(env)) <= ownTier(env) && huntable(env, lowestTier(env))) {
    const parts = soldAt(env, RULES.earn.huntClass);
    const tier = lowestTier(env);
    if (parts) out.push({ text: fill(T.earnHunt, { ...purseWords(env), 阶: tierWord(Number(tier) || 1), 卖: soldText(parts) }), kind: 'earn', verb: { kind: 'hunt', tier } });
  }
  if (!out.length) {
    // the nearest board within reach, else anywhere in the region, at a place the player may go
    // into (岩汀门's 执事堂 is its disciples'): a gate short of its method by thirty-one stones
    // offered nothing to press (the turns lane's real-model run, decision 298)
    const open = place => places.mayEnter(env, place.name) && jobs.board(env, place.name).open;
    const there = within(env, RULES.reach).find(open) || within(env, Infinity).find(open);
    if (there) out.push({ text: fill(T.earnGo, { ...purseWords(env), 地: there.name, 日: numeral(there.days) }), kind: 'earn', verb: { kind: 'travel', to: there.name } });
  }
  return out;
}

const tierWord = tier => `${chronicle.numeral(tier)}阶`;

// The nearest shop within reach, at a place the player may go into, that takes something the bag
// holds: { place, days, names }, or null.
function carried(env) {
  const stored = env.ctx.storedItemIds(env.state);
  const held = Object.entries(env.state['1'] || {}).flatMap(([id, row]) => {
    const good = row && !stored.has(id) ? goods.lookup(row['1']) : null;
    return good && good.class !== '灵石' ? [good] : [];
  });
  if (!held.length) return null;
  for (const place of within(env, RULES.reach)) {
    if (!trade.openAt(env, place.name) || !places.mayEnter(env, place.name)) continue;
    const buys = list(places.factsOf(place.name, env.worldMap).trade?.buys);
    const taken = [...new Set(held.filter(good => trade.named(good, buys)).map(good => good.name))];
    if (taken.length) return { place: place.name, days: place.days, names: taken.slice(0, 2).join('、') + (taken.length > 2 ? '等' : '') };
  }
  return null;
}
// How the purse stands, at the head of an earning hint: 「囊中没有灵石」, 「囊中只有五块灵石」.
const purseWords = env => ({ 囊: stonesHeld(env) ? fill(T.purseSome, { 数: numeral(stonesHeld(env)) }) : T.purseNone });

// ---------------------------------------------------------------- what is due

// The names the place the player is in goes by: the map place, its regions, the time row's words.
function whereNames(env) {
  const poi = places.poiHere(env);
  const read = places.readWhere(mechanics.placeOf(env.state));
  return new Set([poi?.name, poi?.sub_region, poi?.main_region, read.region, read.area, read.spot].filter(Boolean));
}

function dueHints(env) {
  const clocks = list(env.play?.clocks);
  const full = clocks.filter(found => Number(found.value) >= Number(found.size));
  const said = new Set(full.flatMap(found => [found.id, found.name]));
  const out = full.map(found => ({ text: clip(found.full) || fill(T.clock, { 钟: found.name }), kind: 'clock' }));
  const today = clock.today(env);
  const here = whereNames(env);
  const c = mechanics.cultivator(env);
  for (const event of list(env.play?.pending)) {
    const trigger = event?.trigger;
    if (!trigger || !event.seed || require('./pending.cjs').lapsedBy(event, today)) continue;
    const value = plain(trigger.value);
    let due = false;
    if (trigger.kind === 'now') due = !said.has(value);
    else if (trigger.kind === 'date') due = today !== null && (clock.dayOfDate(value) ?? Infinity) <= today;
    else if (trigger.kind === 'place') due = here.has(value);
    else if (trigger.kind === 'clock') due = !said.has(value) && clocks.some(found => (found.id === value || found.name === value) && Number(found.value) >= Number(found.size));
    else if (trigger.kind === 'realm') {
      const target = mechanics.parseRealm(value);
      due = !target.unknown && (c.major > target.major || (c.major === target.major && (c.realm.minor || 0) >= (target.minor || 0)));
    } else if (trigger.kind === 'person') {
      due = Object.entries(env.state['0'] || {}).some(([id, row]) => id !== 'B1' && row && (id === value || plain(row['1']).split('|')[0] === value));
    }
    if (due) out.push({ text: clip(event.seed), kind: 'event' });
  }
  return out;
}

// ---------------------------------------------------------------- what blocks the next gate

// The nearest map place not visited yet (心境 grows on a first visit) that the player may go into.
function unvisited(env) {
  const seen = new Set(list(env.play?.minded?.places));
  // the nearest in the region not yet been to, however far (travel.near's default is the nearest
  // twelve places, all of them seen in a long life)
  return within(env, Infinity).find(place => !seen.has(place.name) && places.mayEnter(env, place.name)) || null;
}

function gateHints(env) {
  const out = [];
  const hurt = injury.active(env);
  if (hurt) out.push({ text: fill(T.injury, { 日: dayText(hurt.until) }), kind: 'injury', verb: { kind: 'wait', until: hurt.until } });
  const sheet = sheetOf(env);
  if (sheet.beyond) return out;
  const unmet = key => sheet.requires.find(each => each.key === key && !each.met) || null;
  const full = unmet('full');
  if (full && !hurt) {
    // a 坊市's 洞府 with a vein when the years are long and the purse holds it (veinHome); else a
    // richer place within reach when the realm's top is far off (retreat); else here
    const now = mechanics.cultivator(env);
    // first out of a place whose foes outclass the player (unsafe)
    const safe = saferPlace(env);
    const vein = safe ? null : veinHome(env, now);
    const away = safe || vein ? null : retreat(env, now);
    out.push(safe ? { text: fill(T.unsafe, { 况: full.text, 地: safe.name, 日: numeral(safe.days) }), kind: 'cultivate',
      verb: { kind: 'travel', to: safe.name } }
      : vein ? { text: veinText(env, vein, full.text), kind: 'cultivate',
      verb: vein.days ? { kind: 'travel', to: vein.name } : { kind: 'home', action: vein.action } }
      : away ? { text: retreatText(env, away, full.text), kind: 'cultivate', verb: { kind: 'travel', to: away.name } }
        : { text: fill(T.cultivate, { 况: full.text }), kind: 'cultivate', verb: { kind: 'cultivate', full: true } });
  }
  const short = unmet('mind');
  if (short) {
    const place = unvisited(env);
    const gap = mechanics.numberIn(String(short.text).split('差')[1]) ?? 0;
    out.push({ text: fill(T.mind, { 差: numeral(gap), 地: place?.name, 日: place ? numeral(place.days) : '' }),
      kind: 'mind', ...(place ? { verb: { kind: 'travel', to: place.name } } : {}) });
  }
  if (unmet('technique')) {
    const shelved = mechanics.cultivator(env).technique.unequipped;
    out.push({ text: shelved ? fill(T.methodBag, { 功: shelved }) : T.methodNone, kind: 'method' });
  }
  // the cap that stops the gate, once the realm's top step is reached (before it, cultivating comes first)
  const capped = unmet('cap');
  const c = mechanics.cultivator(env);
  if (capped && c.top) out.push(...methodHints(env, c, capped, sheet));
  if (!out.length && sheet.ready) {
    const steps = guide(env, sheet, c);
    out.push(...(steps.length ? steps : [{ text: fill(T.gate, { 关: sheet.name, 成: `${sheet.odds}%` }), kind: 'gate', verb: attemptVerb(env), ready: true }]));
  }
  return out;
}

// The attempt as 接下来 sends it: with the gate's pills in the bag, as many as count (the sheet's
// odds count them; an attempt sent without them would not).
function attemptVerb(env) {
  const c = mechanics.cultivator(env);
  const names = mechanics.gateOf(c)?.aids || [];
  const stored = env.ctx.storedItemIds(env.state);
  const aids = [];
  for (const [id, row] of Object.entries(env.state['1'] || {})) {
    if (!row || stored.has(id) || !names.some(name => plain(row['1']).split('|')[0].includes(name))) continue;
    const count = Number(env.ctx.itemStackCount(row['5'])) || 0;
    for (let n = 0; n < count && aids.length < mechanics.CULTIVATION.breakthrough.aidMax; n += 1) aids.push(id);
  }
  return aids.length ? { kind: 'breakthrough', aids } : { kind: 'breakthrough' };
}

// ---------------------------------------------------------------- what a gate wants, and where it is

const yearsLeft = c => (mechanics.numberIn(c.remarks['寿元']) ?? 0) - (mechanics.numberIn(c.remarks['年龄']) ?? 0);
const realmLife = c => mechanics.CULTIVATION.lifespan[ORDER[c.major]] ?? mechanics.CULTIVATION.lifespan[ORDER[1]];

// An auction's day as 接下来 says it: 十一月十五, 明年十一月十五, 后年十一月十五, 三年后的十一月十五.
function auctionDay(env, key) {
  const text = dayText(key);
  const later = clock.dateOf(clock.dayOfDate(key) * DAY).year - clock.dateOf(clock.today(env) * DAY).year;
  if (later <= 0) return text;
  return later === 1 ? fill(T.yearNext, { 日: text }) : later === 2 ? fill(T.yearAfter, { 日: text }) : fill(T.yearsLater, { 数: numeral(later), 日: text });
}

// A source (methods.sources) as 接下来 says it, with what the purse still lacks; bare without the
// good's name (the pill's step names it already: pillShop, pillSect, pillAuction).
function sourceText(env, source, bare = false) {
  const lack = source.price ? Math.max(0, source.price - stonesHeld(env)) : 0;
  const values = { 地: source.place, 物: source.good.name, 价: numeral(source.price ?? 0), 日: source.days ? numeral(source.days) : '', 差: lack ? numeral(lack) : '' };
  if (source.kind === 'sect') return fill(bare ? T.pillSect : T.sourceSect, { ...values, 处: source.hall, 贡: numeral(source.contribution) });
  if (source.kind === 'auction') return fill(bare ? T.pillAuction : T.sourceAuction, { ...values, 会: source.event, 期: auctionDay(env, source.date) });
  return fill(bare ? T.pillShop : T.sourceShop, values);
}

// The verb that gets a source's good: buy it here, or go where it is; at an auction's place before
// it opens, wait for its day. None while the purse cannot pay (the earning hints lead then), at a
// sect (its panel exchanges), or for an auction further off than the journey and guide.early days.
function sourceVerb(env, source) {
  const here = hereName(env);
  if (source.kind === 'sect') return source.place && source.place !== here ? { kind: 'travel', to: source.place } : null;
  if (source.price > stonesHeld(env)) return null;
  if (source.kind === 'auction' && !source.open) {
    const way = source.place === here ? 0 : reach(env, source.place);
    if (way === null || source.days > way + RULES.guide.early) return null;
    if (source.place === here) return { kind: 'wait', until: source.date };
  }
  if (source.place === here) return { kind: 'trade', side: 'buy', id: source.good.id, count: 1 };
  return { kind: 'travel', to: source.place };
}

// The method that can reach the gate: in the bag (put it on in place of the worn one), else the
// nearest source of one of the root's element first.
function methodHints(env, c, capped, sheet) {
  const needed = needOf(env);
  const head = { 功: c.technique.name, 况: capped.text, 境: sheet.gate };
  if (!needed) return [{ text: fill(T.methodCap, { ...head, 处: '' }), kind: 'method' }];
  // in the bag first; else a method of the root's elements wherever it is (another element
  // cultivates at verbs.json affinity.mismatch for the whole realm), else the nearest
  const fit = methods.fitting(env, needed.tier);
  const found = sourcesOf(env, fit.map(good => good.name));
  const root = new Set(methods.matching(env, needed.tier).map(good => good.name));
  const best = found.find(source => source.kind === 'bag') || found.find(source => root.has(source.good.name)) || found[0];
  if (!best) return [{ text: fill(T.methodCap, { ...head, 处: T.methodStory }), kind: 'method' }];
  if (best.kind === 'bag') return [{ text: fill(T.methodSwap, { 新: best.good.name, 旧: c.technique.name, 境: sheet.gate }), kind: 'method' }];
  const verb = sourceVerb(env, best);
  const hint = { text: fill(T.methodCap, { ...head, 处: sourceText(env, best) }), kind: 'method', ...(verb ? { verb } : {}), ...tripOf(env, best, verb) };
  const wait = waitFor(env, best, verb);
  return wait ? [hint, wait] : [hint];
}

// An auction's trip that has a verb (go there, wait there for its day, buy): soon, with the days
// before one must set out (slack: the days to its opening less the journey), for the order of the
// sources (gateSoon). {} for any other source.
function tripOf(env, source, verb) {
  if (source.kind !== 'auction' || !verb) return {};
  const way = source.place === hereName(env) ? 0 : reach(env, source.place) ?? 0;
  return { soon: { slack: Math.max(0, source.days - way) } };
}

// Paid for (the purse holds `count` of it: the gate's pills still missing) and the auction far off:
// wait until the day to set out (its opening less the journey and guide.early), rather than earn
// what is already there; null when there is no such wait.
// The gate's pills still missing: as many as count (aidMax), less those in the bag.
const pillsMissing = pills => (pills ? mechanics.CULTIVATION.breakthrough.aidMax - pills.odds / gate.GATES.odds.pill.bonus : 0);

function waitFor(env, source, verb, count = 1) {
  if (source.kind !== 'auction' || verb || source.open || !(source.price * count <= stonesHeld(env))) return null;
  const way = source.place === hereName(env) ? 0 : reach(env, source.place);
  const opens = clock.dayOfDate(source.date);
  if (way === null || opens === null) return null;
  const setOut = opens - way - RULES.guide.early;
  if (setOut <= clock.today(env)) return null;
  const key = clock.dateKey(setOut);
  return { text: fill(T.guideWait, { 会: source.event, 期: auctionDay(env, source.date), 日: dayText(key) }), kind: 'gate', verb: { kind: 'wait', until: key } };
}

// The nearest place to try the gate at with its aura (gates.json odds.aura.tier): the player's own
// home of that aura within guide.homeReach (a 坊市's 洞府 with a vein; worth the longer journey, as
// for seclusion), or a place within guide.reach the player may go into (places.mayEnter).
// { name, days, home? } or null.
function richNear(env) {
  const tier = gate.GATES.odds.aura.tier;
  const own = env.play?.home && typeof env.play.home === 'object' && env.play.home.aura === tier
    && env.play.home.place !== hereName(env) ? env.play.home.place : null;
  const homeWay = own ? reach(env, own, RULES.guide.homeReach) : null;
  const rich = within(env, RULES.guide.reach).find(place => {
    if (place.name === own) return false;
    const facts = places.factsOf(place.name, env.worldMap);
    return auraAt(env, place.name, facts) === tier && places.mayEnter(env, place.name, { facts });
  }) || null;
  if (homeWay !== null && (!rich || homeWay <= rich.days)) return { name: own, days: homeWay, home: true };
  return rich;
}

// No such place and no home: the nearest 坊市 within guide.homeReach whose 洞府 has the gate's aura
// (home.cjs homeAura, the vein), to rent for the attempt: { name, days, price } or null. Not while a
// home is had: a new one gives up the old.
function veinGate(env) {
  if (env.play?.home) return null;
  const tier = gate.GATES.odds.aura.tier, way = home.RULES.ways.rent;
  const price = way.yearly?.[tier];
  if (!Number.isFinite(price)) return null;
  const here = hereName(env);
  for (const stop of [...(here ? [{ name: here, days: 0 }] : []), ...within(env, RULES.guide.homeReach)]) {
    const facts = stop.days ? places.factsOf(stop.name, env.worldMap) : places.placeFacts(env);
    if (!way.kinds.includes(facts.kind) || home.homeAura(facts) !== tier || !places.mayEnter(env, stop.name, { facts })) continue;
    const days = stop.days ? reach(env, stop.name, RULES.guide.homeReach) : 0;
    if (days !== null) return { name: stop.name, days, price };
  }
  return null;
}

// A map place's aura for the player: the home's where the player's home is (a 坊市's 洞府 has a
// vein, home.cjs), else the place's own.
function auraAt(env, name, facts = places.factsOf(name, env.worldMap)) {
  const home = env.play?.home && typeof env.play.home === 'object' ? env.play.home : null;
  return home && home.place === name && home.aura ? home.aura : facts.aura;
}
const auraHere = env => auraAt(env, hereName(env), places.placeFacts(env));

// The rate of 修为 a day here, unrounded (a day's gain at 结丹 rounds to nothing): the rule's rate at
// an ordinary place (cultivationView), at the life's pace, times the aura here (auraHere) over the
// ordinary; and what is left to the realm's top, in 修为.
function rateHere(env, c) {
  const CULTIVATION = mechanics.CULTIVATION;
  return mechanics.cultivationView(env).perDay * (CULTIVATION.stepDays[ORDER[c.major]] ?? CULTIVATION.stepDays.higher)
    / speed.stepDaysOf(c.major) * auraFactor(auraHere(env)) / auraFactor(ENVIRONMENT.default);
}
const leftOf = c => (mechanics.stepsIn(c.major) - c.step) * 100 + (100 - c.progress);

// Out of a place whose foes may be above the player (encounter.warning: a dangerous place, its
// table's top above the player's own tier): the nearest place within guide.reach the player may
// go into whose danger is below foes.json encounters.cap.dangerous, { name, days }; null here
// when it is safe enough, or with nowhere to go.
const DANGEROUS = data('foes').encounters.cap.dangerous;
function saferPlace(env) {
  if (!require('./encounter.cjs').warning(env)) return null;
  for (const place of within(env, RULES.guide.reach)) {
    const facts = places.factsOf(place.name, env.worldMap);
    if ((Number(facts.danger) || 0) < DANGEROUS && places.mayEnter(env, place.name, { facts })) return { name: place.name, days: place.days };
  }
  return null;
}

// Where to go into seclusion (闭关): of the places within guide.reach that the player may go into
// (places.mayEnter), and the player's home within guide.homeReach (its own aura, auraAt), the richest in
// aura (cultivation.json environment), the least dangerous of those, the
// nearest; only when it is richer than here and the realm's top is further off at the rate here
// than guide.retreat times the journey. { name, days, aura } or null.
const ENVIRONMENT = mechanics.CULTIVATION.environment;
// Whether one rank ([a, b, c]) comes before another: the first place they differ decides.
const ahead = (rank, than) => { const i = rank.findIndex((value, at) => value !== than[at]); return i >= 0 && rank[i] > than[i]; };
const auraFactor = aura => ENVIRONMENT.aura[aura] ?? ENVIRONMENT.aura[ENVIRONMENT.default];
function retreat(env, c) {
  if (c.major < 1) return null;
  let best = null;
  // the places within guide.reach, and the player's own home within guide.homeReach
  const own = env.play?.home?.place && env.play.home.place !== hereName(env) ? env.play.home.place : null;
  const homeWay = own ? reach(env, own, RULES.guide.homeReach) : null;
  const stops = [...within(env, RULES.guide.reach).filter(place => place.name !== own),
    ...(homeWay !== null ? [{ name: own, days: homeWay }] : [])];
  for (const place of stops) {
    const facts = places.factsOf(place.name, env.worldMap);
    if (!places.mayEnter(env, place.name, { facts })) continue;
    const aura = auraAt(env, place.name, facts);
    const rank = [auraFactor(aura), -(Number(facts.danger) || 0), -place.days];
    if (!best || ahead(rank, best.rank)) best = { name: place.name, days: place.days, aura, rank };
  }
  if (!best || auraFactor(best.aura) <= auraFactor(auraHere(env))) return null;
  const rate = rateHere(env, c);
  return rate <= 0 || leftOf(c) / rate > RULES.guide.retreat * best.days ? best : null;
}
const auraWords = aura => ENVIRONMENT.labels[aura] ?? ENVIRONMENT.labels[ENVIRONMENT.default];
const retreatText = (env, away, how) => fill(T.retreat, { 况: how, 此: auraWords(auraHere(env)), 地: away.name, 彼: auraWords(away.aura), 日: numeral(away.days) });

// A 坊市's 洞府 with a vein (home.cjs homeAura) for a cultivator from 筑基 on with long years before
// the realm's top: the nearest place within guide.homeReach (here first) whose home would be richer than here and
// than anywhere the player may go within reach (retreat), while the realm's top is more than
// guide.home years off at the rate here. Bought when those years of rent would cost more than
// buying, else rented; want is what the purse must hold for it: the price, or guide.rent years of
// the rent. { name, days, aura, action, price, want } or null (veinOption, once a call); veinHome
// the same once the purse holds it. While the purse does not, earning leads (short).
function veinOption(env, c) {
  if (memo && memo.vein !== undefined) return memo.vein;
  const found = veinOf(env, c);
  if (memo) memo.vein = found;
  return found;
}
function veinOf(env, c) {
  // from 筑基 on (炼气 is a few years at most), with a method worn (without one the years mislead)
  if (c.major < 2 || !c.technique.name) return null;
  const rate = rateHere(env, c);
  const years = rate > 0 ? leftOf(c) / rate / (clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear) : Infinity;
  if (years < RULES.guide.home) return null;
  const HOME = home.RULES;
  const best = Math.max(auraFactor(auraHere(env)), auraFactor(retreat(env, c)?.aura));
  const here = hereName(env);
  // a realm's long years are worth a long journey: within guide.homeReach
  const stops = [...(here ? [{ name: here, days: 0 }] : []), ...within(env, RULES.guide.homeReach)];
  for (const stop of stops) {
    const facts = stop.days ? places.factsOf(stop.name, env.worldMap) : places.placeFacts(env);
    if (!HOME.ways.buy.kinds.includes(facts.kind) || !places.mayEnter(env, stop.name, { facts })) continue;
    const aura = home.homeAura(facts);
    if (auraFactor(aura) <= best || env.play?.home?.place === stop.name) continue;
    const price = HOME.ways.buy.price[aura], yearly = HOME.ways.rent.yearly[aura];
    if (!Number.isFinite(price) || !Number.isFinite(yearly)) return null;
    // the years at the vein's rate: renting all of them against buying once
    const there = years * auraFactor(auraHere(env)) / auraFactor(aura);
    return there * yearly > price ? { name: stop.name, days: stop.days, aura, action: 'buy', price, want: price }
      : { name: stop.name, days: stop.days, aura, action: 'rent', price: yearly, want: yearly * RULES.guide.rent };
  }
  return null;
}
function veinHome(env, c) {
  const vein = veinOption(env, c);
  return vein && vein.want <= stonesHeld(env) ? vein : null;
}
function veinText(env, vein, how) {
  const 法 = fill(vein.action === 'buy' ? T.veinBuy : T.veinRent, { 价: numeral(vein.price) });
  return fill(T.vein, { 况: how, 地: vein.name, 法, 彼: auraWords(vein.aura), 日: vein.days ? numeral(vein.days) : '' });
}

// Someone who could stand guard but for the tie (the protector's favour): in the character table,
// alive, a realm not below the player's, the favour short of it; the closest to it.
function tieNear(env, c) {
  const want = TIERS.indexOf(gate.GATES.odds.protector.favour);
  let best = null;
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (!/^[CG]/.test(id) || !row || mechanics.isFallen(env.ctx, row)) continue;
    const realm = mechanics.parseRealm(row['2']);
    if (realm.unknown || realm.major < c.major || (realm.major === c.major && (realm.minor || 0) < (c.realm.minor || 0))) continue;
    const rank = TIERS.indexOf(favourTier(plain(row['15'])));
    if (rank < want && (!best || rank > best.rank)) best = { name: plain(row['1']).split('|')[0], rank };
  }
  return best;
}

// The gate's steps while its odds are low (guide): what each adds, the first that can be taken with
// its verb. None when the odds are reasonable, the lifespan runs short, or nothing that raises them
// is within reach (then the gate itself).
function guide(env, sheet, c) {
  const rule = RULES.guide;
  if (sheet.odds >= rule.odds || yearsLeft(c) <= rule.short * realmLife(c)) return [];
  const odds = [], others = [];
  // what a step adds, in percent: the odds with it less the odds now (the die is not linear at its ends)
  const adds = more => `${Math.max(0, gate.oddsWith(env, more) - sheet.odds)}%`;
  const ODDS = gate.GATES.odds;
  let waiting = null;
  const pills = sheet.prepares.find(each => each.key === 'aids');
  const aids = mechanics.gateOf(c)?.aids || [];
  if (pills && aids.length && pills.odds < mechanics.CULTIVATION.breakthrough.aidMax * gate.GATES.odds.pill.bonus) {
    const [best] = sourcesOf(env, aids, pillsUntil(env, c)).filter(source => source.kind !== 'bag');
    if (best) {
      const verb = sourceVerb(env, best);
      // the first pill also clears the bottleneck of the failures at the gate; what the pills still
      // missing add together (one alone may add nothing at the die's end: 伪灵根 at 结丹)
      const stuck = pills.odds ? 0 : gate.bottleneckOf(env, sheet.gate, 0).penalty;
      const missing = pillsMissing(pills);
      odds.push({ text: fill(T.guidePill, { 物: best.good.name, 数: missing === 2 ? '两' : numeral(missing), 加: adds(ODDS.pill.bonus * missing - stuck),
        处: sourceText(env, best, true) }), kind: 'gate',
        ...(verb ? { verb } : {}), ...tripOf(env, best, verb), reach: true, pill: true });
      waiting = waitFor(env, best, verb, pillsMissing(pills));
    }
  }
  const guard = sheet.prepares.find(each => each.key === 'protector');
  const tie = guard && guard.state !== 'have' ? tieNear(env, c) : null;
  if (tie) others.push({ text: fill(T.guideTie, { 人: tie.name, 好: ODDS.protector.favour, 加: adds(ODDS.protector.bonus) }), kind: 'gate' });
  // the aura: the home of that aura, a place of it near, else a 坊市's vein to rent; with every pill
  // in hand this trip is the last step (ready: the gate before earning, gateSoon). Five 伪灵根
  // tries at 结丹 were made at the sale's place, the vein home three days off (round three)
  const complete = !pills || !aids.length || pillsMissing(pills) <= 0;
  const aura = sheet.prepares.find(each => each.key === 'aura');
  if (aura && aura.state !== 'have') {
    const rich = richNear(env);
    const vein = rich ? null : veinGate(env);
    if (rich) {
      odds.push({ text: fill(rich.home ? T.guideHome : T.guideAura, { 地: rich.name, 日: numeral(rich.days), 加: adds(ODDS.aura.bonus) }), kind: 'gate',
        verb: { kind: 'travel', to: rich.name }, reach: true, ...(complete ? { ready: true } : {}) });
    } else if (vein && complete) {
      // the vein only for the attempt itself: its rent is not paid through the years of waiting for
      // a sale; short of the year's rent, earning leads (gateWants)
      const paid = vein.price <= stonesHeld(env);
      odds.push({ text: fill(T.guideVein, { 地: vein.name, 价: numeral(vein.price), 日: vein.days ? numeral(vein.days) : '', 加: adds(ODDS.aura.bonus) }),
        kind: 'gate', ...(paid ? { verb: vein.days ? { kind: 'travel', to: vein.name } : { kind: 'home', action: 'rent' } } : {}), reach: true,
        ...(paid ? { ready: true } : {}) });
    }
  }
  const knots = sheet.prepares.find(each => each.key === 'knots');
  if (knots && knots.state === 'miss') others.push({ text: fill(T.guideKnot, { 加: adds(-ODDS.knots.each) }), kind: 'gate' });
  const polish = sheet.prepares.find(each => each.key === 'polish');
  const polishing = polish && polish.state === 'can'
    ? { text: fill(T.guidePolish, { 况: polish.text }), kind: 'gate', verb: { kind: 'cultivate', full: true } } : null;
  // the pill's sale far off, the purse holding the pills still missing and nothing else to take now:
  // the pill's own step carries what can be done meanwhile, 压境 while it counts, else the wait to
  // set out (short of the pills, earning leads with its own). Everything ready but a 筑基丹 eighteen
  // months off left nothing to press (the turns lane's real-model run, decision 322)
  const step = odds.find(each => each.pill && !each.verb);
  const covered = step && gateWants(env) !== null && gateWants(env) <= stonesHeld(env);
  const meanwhile = covered && !odds.some(each => each.verb) ? polishing || waiting : null;
  if (meanwhile) {
    step.text = `${step.text}；${meanwhile.text}`;
    step.verb = meanwhile.verb;
  }
  if (polishing && meanwhile !== polishing) others.push(polishing);
  // the pill paid for, its auction far off: 压境 first while it counts, then wait to set out
  if (waiting && meanwhile !== waiting) others.push(waiting);
  if (!odds.length) return [];
  // what raises the odds first, then the rest; in each, the steps that can be taken now (a verb) first
  const now = steps => steps.sort((a, b) => (b.verb ? 1 : 0) - (a.verb ? 1 : 0));
  return [...now(odds), ...now(others)].map(({ reach: _reach, pill: _pill, ...hint }) => hint);
}

// The stones the gate wants now, at its full top step: the cheapest priced source of a method that
// reaches it (none while one is in the bag), else, while the guide leads (odds below guide.odds, the
// lifespan not short) and fewer of its pills than count are in the bag, the pills still missing at
// the cheapest; null when it wants none.
function gateWants(env) {
  const c = mechanics.cultivator(env);
  if (!(c.top && c.progress >= 100)) return null;
  const sheet = sheetOf(env);
  if (sheet.beyond) return null;
  const needed = needOf(env);
  let names = [];
  let count = 1;
  if (needed) names = methods.fitting(env, needed.tier).map(good => good.name);
  else if (sheet.odds < RULES.guide.odds && yearsLeft(c) > RULES.guide.short * realmLife(c)) {
    const pills = sheet.prepares.find(each => each.key === 'aids');
    count = pillsMissing(pills);
    if (count > 0) names = mechanics.gateOf(c)?.aids || [];
    else {
      // every pill in hand: the year's rent of the vein to try the gate at, when nothing of the
      // gate's aura is near (veinGate)
      const aura = sheet.prepares.find(each => each.key === 'aura');
      const vein = aura && aura.state !== 'have' && !richNear(env) ? veinGate(env) : null;
      if (vein) return vein.price;
    }
  }
  if (!names.length) return null;
  const found = sourcesOf(env, names, needed ? null : pillsUntil(env, c));
  if (needed && found.some(source => source.kind === 'bag')) return null;
  const priced = found.filter(source => source.kind !== 'bag' && Number.isFinite(source.price));
  // the pills still missing, each at the cheapest price found (the purse covers what the gate
  // needs only when it covers all of them)
  return priced.length ? Math.min(...priced.map(source => source.price)) * count : null;
}

// ---------------------------------------------------------------- hooks elsewhere, the place, the calendar

function hookHints(env) {
  const out = [];
  const here = places.placeFacts(env);
  const now = whereNames(env);
  const known = new Set(list(env.play?.clues).map(clue => clue.key));
  const asking = listed(env, 'ask');
  for (const event of list(env.play?.pending)) {
    if (event?.from !== 'director' || event.trigger?.kind !== 'place' || !event.seed) continue;
    const place = plain(event.trigger.value);
    if (!place || now.has(place)) continue;
    const days = reach(env, place, RULES.reach);
    if (days === null) continue;
    if (known.has(`pending:${event.id}`)) {
      // known, it is followed only to a place the player may go into (the story's trip: its status
      // and realm held, whatever day its calendar opens it)
      if (!places.mayEnter(env, place, { open: true })) continue;
      out.push({ text: fill(T.go, { 地: place, 日: numeral(days), 事: clip(event.seed) }), kind: 'hook', verb: { kind: 'travel', to: place } });
    } else if (asking) {
      const venue = here.venues.find(each => each === '茶肆') || here.kind;
      out.push({ text: fill(T.rumour, { 处: venue, 地: place }), kind: 'hook', verb: { kind: 'ask' } });
    }
  }
  return out;
}

function venueHints(env) {
  const out = [];
  const here = places.placeFacts(env).place || '此地';
  if (listed(env, 'job')) {
    const free = list(jobs.board(env).notices).filter(notice => !notice.taken);
    if (free.length) out.push({ text: fill(T.notice, { 地: here, 数: numeral(free.length) }), kind: 'notice', verb: { kind: 'job' } });
  }
  if (listed(env, 'trade')) out.push({ text: fill(T.shop, { 地: here }), kind: 'shop', verb: { kind: 'trade' } });
  return out;
}

// The calendar's fixed event an entry of calendar.upcoming is (its id is the event's and its year).
const eventOf = entry => String(entry.id).replace(/-\d+$/, '');

function calendarHints(env) {
  const here = places.placeFacts(env);
  for (const entry of calendar.upcoming(env, 5)) {
    if (entry.kind !== 'fixed' || !entry.place) continue;
    if (entry.place === here.place) return [{ text: fill(T.calendarHere, { 事: entry.title, 日: entry.open ? '' : entry.date.text }), kind: 'calendar' }];
    // not to a place the player may not go into on the event's day (沉钟泽 opens to the 诸院's
    // 炼气 disciples, 宗门小比 at 听澜院 is its own disciples')
    if (!places.mayEnter(env, entry.place, { open: eventOf(entry) })) continue;
    const days = reach(env, entry.place);
    if (days !== null && (entry.open || days <= entry.days)) {
      return [{ text: fill(T.calendarGo, { 事: entry.title, 日: entry.date.text, 地: entry.place, 程: numeral(days) }), kind: 'calendar',
        verb: { kind: 'travel', to: entry.place } }];
    }
  }
  return [];
}

const SOURCES = [['thread', threadHints], ['humanJourney', humanJourney.hints], ['starSea', starSea.hints], ['earn', earnHints], ['main', mainHints], ['job', jobHints], ['duty', dutyHints],
  ['due', dueHints], ['gate', env => gateOnce(env)],
  ['hook', hookHints], ['venue', venueHints], ['calendar', calendarHints],
  ['talk', env => [...threadHints(env, true), ...talkHints(env)]]];

// Talking on: the story moved today (a scene closed: frxPlay.counters past frxPlay.quiet, or quiet
// written today, heartbeat.cjs) and someone of the scene's table is still at this place and may be
// visited (visit.cjs, its options): 「接着和{名}说话」 with the visit verb, the first such one. It goes
// once the player leaves the place (the visit's options are this place's) or a day passes. The
// owner's turn 73: a scene with 齐管事 closed, and nothing followed the story.
// Story threads (线头, frxPlay.threads, threads.cjs; batch 9): what a scene left open, nearest to
// run out first, each the first thing to do. A time, at its place and in its window: 赴约 with
// follow; at its place before its window, within guide.reach days: 静候 until it opens (调息 the
// hours of the same day, else the wait to its day); elsewhere: the journey there; one that needs a
// thing the bag does not hold says where it is had (heldFor). Without a time, at its place: follow
// until it runs out. The owner's turn 73: 齐管事's 闭门小易 at 子时 that night was not in 接下来.
function threadHints(env, followUp = false) {
  const now = mechanics.readClock(env.state)?.minutes;
  if (!Number.isFinite(now)) return [];
  const here = hereName(env);
  const time = minutes => Number.isSafeInteger(minutes) && minutes >= 0;
  const out = [];
  // a thread under way in a scene (taken, threads.cjs) is the scene's, not a next step
  for (const thread of list(env.play?.threads).filter(each => each?.id && !each.taken && !each.completed
    && Boolean(each.followUp) === followUp && plain(each.text) && threads.deadline(each) > now)
    .sort((a, b) => threads.deadline(a) - threads.deadline(b))) {
    const text = clip(plain(thread.text)), place = plain(thread.place);
    const when = thread.when && time(thread.when.from) && time(thread.when.to) ? thread.when : null;
    if (when && now > when.to) continue;
    const item = plain(thread.item);
    if (item && !hasItem(env, item)) {
      const found = heldFor(env, item);
      const paid = found && found.price <= stonesHeld(env);
      out.push({ text: fill(T.threadItem, { 事: text, 物: item, 处: found ? (found.days ? fill(T.buyHeldThere, { 地: found.place, 物: found.good.name,
        价: numeral(found.price), 日: numeral(found.days) }) : fill(T.buyHeld, { 物: found.good.name, 价: numeral(found.price) })) : '' }), kind: 'thread',
      ...(paid ? { verb: found.days ? { kind: 'travel', to: found.place } : { kind: 'trade', side: 'buy', id: found.good.id, count: 1 } } : {}) });
      continue;
    }
    const there = place && here && (here === place || here.includes(place) || place.includes(here));
    if (!there) {
      const days = place ? reach(env, place) : null;
      out.push(days === null ? { text, kind: 'thread' } : { text: fill(T.threadGo, { 事: text, 地: place, 日: numeral(days) }), kind: 'thread', verb: { kind: 'travel', to: place } });
      continue;
    }
    if (!when || now >= when.from) {
      out.push({ text: when ? fill(T.threadFollow, { 事: text }) : text, kind: 'thread', verb: { kind: 'follow', id: thread.id } });
      continue;
    }
    const opens = threads.hourText(when.from);
    const day = Math.floor(now / DAY), from = Math.floor(when.from / DAY);
    if (from - day > RULES.guide.reach) {
      out.push({ text: fill(T.threadLater, { 事: text, 时: opens }), kind: 'thread' });
      continue;
    }
    const hours = Math.ceil((when.from - now) / 60);
    const rest = from === day && listed(env, 'rest') ? Math.min(REST_HOURS, Math.max(1, hours)) : 0;
    out.push({ text: fill(T.threadWait, { 事: text, 时: opens }), kind: 'thread',
      verb: rest ? { kind: 'rest', hours: rest } : { kind: 'wait', until: clock.dateKey(from) } });
  }
  return out;
}
// Whether the bag (or what is worn) holds a thread's thing, by name or kind (mechanics.heldMatch).
function hasItem(env, item) {
  const match = mechanics.heldMatch(item);
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {}).some(([id, row]) => row && !stored.has(id) && match(plain(row['1']).split('|')[0], row['2']))
    || env.ctx.equippedItemRows(env.state['0']?.B1).some(row => row && match(plain(row.name ?? row['1']).split('|')[0], row.type ?? row['2']));
}

// A sect's duty due (sect.cjs: fewer than sects.json duty.perYear done in the year from duty.since):
// at the sect's place the verb duty (its assigned task, else the first), elsewhere the journey there.
// The documents pass: the duty hint waited on a 'duty' row of the verb list that nothing lists, so a
// disciple was never told.
function dutyHints(env) {
  const sect = env.play?.sect && typeof env.play.sect === 'object' ? env.play.sect : null;
  if (!sect?.name) return [];
  const rules = SECTS.duty || {};
  if ((Number(sect.duty?.done) || 0) >= (Number(rules.perYear) || 0)) return [];
  const task = list(SECTS.duties).find(each => each.id === sect.assigned) || list(SECTS.duties)[0];
  if (!task) return [];
  const home = SECTS.sects?.[sect.name]?.place || null;
  const values = { 宗: sect.name, 事: task.title, 日: numeral(task.days), 贡: numeral(task.contribution) };
  if (!home || hereName(env) === home) return [{ text: fill(T.dutyHere, values), kind: 'job', verb: { kind: 'duty' } }];
  const days = reach(env, home);
  return days === null ? [] : [{ text: fill(T.dutyGo, { ...values, 地: home, 路: numeral(days) }), kind: 'job', verb: { kind: 'travel', to: home } }];
}

function talkHints(env) {
  const today = clock.today(env);
  const seen = env.play?.quiet;
  const counters = env.play?.counters || {};
  // without the record (a save from before the heartbeat) nothing says when the last scene was
  if (!seen) return [];
  const moved = (Number(seen.scenes) || 0) !== (Number(counters.scene) || 0) || (Number(seen.fights) || 0) !== (Number(counters.fight) || 0)
    || clock.dayOfDate(seen.since) === today;
  if (!moved) return [];
  const visit = verbList(env).find(verb => verb.kind === 'visit' && !verb.off);
  const scene = env.state['0'] || {};
  // someone of the scene's table, not a foe the fight registered (its realm column says 敌对)
  // no one a thread names: a scene closed with someone still on it is the turns lane's thread now
  // (「接着和{名}说话」, follow), and this is only its stand-in while the save has none for them
  const named = new Set(list(env.play?.threads).map(thread => thread?.who?.id).filter(Boolean));
  const person = list(visit?.options).find(option => option.value !== 'B1' && scene[option.value] && !named.has(option.value)
    && !String(scene[option.value]['2'] ?? '').includes('敌对'));
  return person ? [{ text: fill(T.talkOn, { 名: person.label }), kind: 'hook', verb: { kind: 'visit', id: person.value } }] : [];
}

const sameAs = (a, b) => a.text === b.text || (a.verb?.kind === 'travel' && b.verb?.kind === 'travel' && a.verb.to === b.verb.to)
  || (a.verb?.kind && a.verb.kind === b.verb?.kind && ['job', 'trade', 'duty'].includes(a.verb.kind));

function next(env) {
  // A scene, a fight or an encounter under way says itself what to do (its cards, its commands); so
  // does a secret realm, whose node map takes the steps (realm.cjs holds the standing verbs there)
  if (!mechanics.readClock(env.state) || env.play?.scene || env.play?.fight || env.play?.encounter || env.play?.realm) return [];
  // a 悟得 waiting holds every verb but its choice: the ones on offer, each with its verb (the
  // documents pass: 接下来 offered verbs that were all refused)
  const offered = list(env.play?.offer).filter(entry => entry && Number.isInteger(entry.index) && entry.name);
  if (offered.length) {
    return offered.map(entry => ({ text: fill(T.perkPick, { 名: entry.name, 效: clip(plain(entry.text)) }), kind: 'gate',
      verb: { kind: 'perk', index: entry.index } }));
  }
  memo = { sources: {} };
  try {
    return hintsOf(env);
  } finally {
    memo = null;
  }
}

function hintsOf(env) {
  const out = [];
  // Down at 0 气血 (a fight lost), nothing but 调息 can be done: cultivating, gathering, hunting and
  // the gate are refused until the player is up (a simulated player who follows these hints walked
  // from notice to notice for seventy years at 0 气血, offered a gate it could not try)
  const player = env.state['0']?.B1;
  if (player && mechanics.isFallen(env.ctx, player) && listed(env, 'rest')) {
    out.push({ text: T.down, kind: 'injury', verb: { kind: 'rest', hours: REST_HOURS } });
  }
  // the main line's day near: the main line before earning (mainSoon); the trip to the auction
  // with the gate's pill or method due: the gate before earning and the notices taken (gateSoon);
  // the gate ready (its attempt, or the last trip before it): the gate before earning, the main
  // line still first (its chapter may name the same gate)
  const ready = gateReady(env), soon = mainSoon(env);
  // 内伤 not healed: what is due, then resting it out (the gate's injury hint), before earning and
  // the notices, unless the main line's day is near. A 静候 while injured is 养伤: nothing in the
  // wild finds the player and 气血 comes back (injury.cjs). Sent earning first, an injured 筑基 at a
  // tenth of her 气血 took notices on the roads and the hills (the places lane's run L replayed
  // after round three, plan item 50's fixes).
  const hurt = !soon && injury.active(env);
  // Concrete unfinished events lead; optional generic conversations only fill spare space after
  // cultivation, resources and scheduled obligations, including older saves' followUp threads.
  const first = [...new Set(['humanJourney', 'thread', ...(soon || ready ? ['main'] : []), ...(ready || gateSoon(env) ? ['gate'] : []),
    ...(hurt ? ['due', 'gate'] : []), 'starSea'])];
  const order = [...first.map(name => SOURCES.find(([key]) => key === name)), ...SOURCES.filter(([name]) => !first.includes(name))];
  for (const [name, source] of order) {
    if (out.length >= RULES.most) break;
    for (const { soon: _soon, ready: _ready, ...hint } of source(env).slice(0, RULES.caps[name])) {
      if (out.length < RULES.most && !out.some(each => sameAs(each, hint))) out.push(hint);
    }
  }
  keepRecovery(env, out, soon);
  // something to press, always: the first hint with a verb that the caps or the three left out,
  // else to cultivate, else to wait a month, in place of the last (clocks and events that are only
  // words, and a gate waiting on what is not in reach, filled all three in the real-model run)
  if (!out.some(hint => hint.verb)) {
    const spare = spareHint(env, order, out);
    if (spare) {
      if (out.length >= RULES.most) out.pop();
      out.push(spare);
    }
  }
  // what can be done first: no hint without a button above one with (the owner's turn 73: the main
  // line led with nothing to press, its fair four months off)
  return [...out.filter(hint => hint.verb), ...out.filter(hint => !hint.verb)];
}

// Two distant promises must not use up the space needed to recover from an injury. Keep the
// first concrete continuation, imminent promises, due events and a nearby main-line deadline;
// replace a second deferrable promise or an ordinary growth/resource suggestion instead.
function keepRecovery(env, out, mainNear) {
  if (out.some(hint => hint.kind === 'injury')) return; // Includes mandatory rest when fallen.
  const recovery = gateOnce(env).find(hint => hint.kind === 'injury');
  if (!recovery) return;
  if (out.length < RULES.most) { out.push(recovery); return; }
  const healed = (clock.dayOfDate(recovery.verb.until) + 1) * DAY;
  const concrete = out.map((hint, index) => ({ hint, index })).filter(({ hint }) => hint.kind === 'thread');
  const later = concrete.slice(1).reverse().find(({ hint }) => {
    if (hint.verb?.kind !== 'follow') return false;
    const thread = list(env.play?.threads).find(each => each.id === hint.verb.id);
    return thread && (thread.when?.from ?? threads.deadline(thread)) > healed;
  });
  const ordinary = out.findLastIndex(hint => ['earn', 'cultivate', 'mind', 'method', 'notice', 'shop', 'hook'].includes(hint.kind)
    || (hint.kind === 'main' && !mainNear));
  const index = later?.index ?? ordinary;
  if (index >= 0) out[index] = recovery;
}

function spareHint(env, order, out) {
  for (const [, source] of order) {
    for (const { soon: _soon, ready: _ready, ...hint } of source(env)) {
      if (hint.verb && !out.some(each => sameAs(each, hint))) return hint;
    }
  }
  // cultivating while it still adds (修为 short of the top, or 压境 that counts), else a month's wait
  const c = mechanics.cultivator(env);
  const polish = list(sheetOf(env).prepares).find(each => each.key === 'polish');
  const grows = !(c.top && c.progress >= 100) || polish?.state === 'can';
  if (grows && listed(env, 'cultivate')) return { text: T.idleCultivate, kind: 'cultivate', verb: { kind: 'cultivate', full: true } };
  if (listed(env, 'wait')) return { text: T.idleWait, kind: 'cultivate', verb: { kind: 'wait', days: RULES.idleDays } };
  return null;
}

// Whether the gate's auction trip is due (a hint of the gate with soon: its verb goes there, waits
// there or buys) and a notice taken stands in its way: one that cannot be done (the journey there
// and back and its work, jobs.json work) in the days before one must set out. Such a notice is put
// off, not dropped: its hint comes after the trip, and if its days run out first it lapses as every
// late notice does (作罢: no pay, its row of table 6 已失败, nothing more). With no notice taken,
// the trip still comes before earning.
function gateSoon(env) {
  const trip = gateOnce(env).find(hint => hint.soon);
  if (!trip) return false;
  const jobs = list(env.play?.jobs).filter(job => job && job.place);
  return !jobs.length || jobs.some(job => {
    const way = job.place === hereName(env) ? 0 : reach(env, job.place);
    return way === null || 2 * way + (WORK_DAYS[job.goal] ?? 0) > trip.soon.slack;
  });
}
// Whether the gate is ready: its attempt, or the last step before it (home, the vein, every pill
// in hand). It needs no stones, so it comes before earning: a 伪灵根 with its two pills went on an
// errand nine days off with the attempt three days away, and tried it there without the vein.
const gateReady = env => gateOnce(env).some(hint => hint.ready);
// The gate's hints once a call (gateSoon reads them before the order is set).
const gateOnce = env => (memo ? (memo.gate ??= gateHints(env)) : gateHints(env));

module.exports = { RULES, next, huntOdds };
