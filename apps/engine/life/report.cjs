'use strict';
/* The engine's battle report for a routine fight (batch 9): a hunt's beast, or a beast met in the
 * wild, fought from the beat of meeting it (encounter.cjs). The model writes no report for it: the
 * move that ends the fight carries the report on its receipt (fight.report, a few lines in the
 * house voice: how it was met and who moved first, the blow that decided it, the end, what was got
 * or lost), and the server tells it as the turn's story and closes the scene (play_turns). A fight
 * with people, with a foe the story brought (a card aimed at it), in a scene of the story's or one
 * a clock, the calendar or the director opened is no routine one: the model reports it as ever.
 * The words are content/life/report.json. No model is called here.
 *
 * install({ fight }): the fight's hooks, chained (fight.hooks):
 *   opening  a fight opened with args.from { kind: hunt | encounter, class } of a class the file
 *            lists (classes) keeps fight.routine { kind, name, place, first, ambush } (the first
 *            foe's name, where it was, who moved first and whether it was an ambush)
 *   ended    the fight's last receipt carries routine (round.extra) for the report
 * settle(env): after a move op (index.cjs run): the receipt of the fight that ended in it, when the
 *   fight was routine, gets fight.report: [lines]. Nothing else changes.
 * write(receipt) → [lines]: the report of that receipt (its fight and attack), for tests.
 */
const { data } = require('./data.cjs');
const chronicle = require('./chronicle.cjs');
const clock = require('./clock.cjs');
const goods = require('./goods.cjs');

const REPORT = data('report');
const list = value => (Array.isArray(value) ? value : []);

// ---------------------------------------------------------------- the fight's hooks

function opening(env, fought, args) {
  const from = args?.from;
  if (!from || typeof from !== 'object' || !REPORT.classes.includes(from.class)) return;
  if (!['hunt', 'encounter'].includes(from.kind)) return;
  fought.routine = {
    kind: from.kind, name: String(fought.foes[0]?.name || from.name || ''),
    place: chronicle.placeName(env.state), first: fought.first,
    ambush: args.ambush === 'player' || args.ambush === 'foes' ? args.ambush : null,
  };
}

function ended(env, round) {
  if (round.fight?.routine) round.extra = { ...(round.extra || {}), routine: round.fight.routine };
}

let installed = false;
function install({ fight }) {
  if (installed) return;
  installed = true;
  const open = fight.hooks.opening, end = fight.hooks.ended;
  fight.hooks.opening = (env, fought, args, at) => { open(env, fought, args, at); opening(env, fought, args); };
  fight.hooks.ended = (env, at, how) => { end(env, at, how); ended(env, at, how); };
}

// ---------------------------------------------------------------- the report

const fill = (template, values) => chronicle.fill(template, values);

// The blow in words: the player's (or the spirit beast's) by its style, a foe's as a beast's.
function blowWords(struck, foe) {
  const words = foe ? REPORT.blow.foe : REPORT.blow[struck.style] || REPORT.blow['物理'];
  return struck.critical ? words.critical : words.hit;
}

// The items the fight's loot gave, as goods.listed says them.
function gotOf(fight) {
  const items = list(fight.loot).flatMap(entry => list(entry?.items));
  return items.length ? goods.listed(items) : '';
}

function decisive(fight, attack, names) {
  // 斗了两个回合 (a count, 两 for two), 斗到第二个回合 (an ordinal: 序)
  const played = Math.max(1, Number(fight.round) || 1);
  const rounds = chronicle.count(played), nth = chronicle.numeral(played);
  const strikes = list(attack?.strikes);
  const foeName = id => names[id] || fight.foes.find(entry => entry.id === id)?.name || fight.routine.name;
  const D = REPORT.decisive;
  if (fight.tamed) return fill(D.tamed, { 回合: rounds, 敌: fight.tamed.name || fight.routine.name });
  if (fight.end === 'win') {
    const felling = strikes.findLast(struck => struck.defeated && struck.at !== 'B1' && struck.at !== fight.beast?.id);
    if (!felling) return fill(D.winTick, { 回合: rounds, 敌: fight.routine.name });
    const values = { 回合: rounds, 敌: foeName(felling.at), 招: blowWords(felling, false) };
    return felling.by === 'B1' ? fill(D.win, values)
      : fill(D.winPet, { ...values, 宠: names[felling.by] || fight.beast?.name || '' });
  }
  if (fight.end === 'lose') {
    const downing = strikes.findLast(struck => struck.defeated && struck.at === 'B1');
    if (!downing) return fill(D.loseTick, { 序: nth });
    return fill(D.lose, { 序: nth, 敌: foeName(downing.by), 招: blowWords(downing, true) });
  }
  return fill(D[fight.end] || D.truce, { 回合: rounds });
}

function losses(fight) {
  const L = REPORT.losses, lines = [];
  if (fight.loss?.stones) lines.push(fill(L.stones, { 名: fight.loss.name, 石: fight.loss.stones }));
  else if (fight.loss?.name) lines.push(fill(L.loss, { 名: fight.loss.name }));
  if (fight.injury?.days) lines.push(fill(L.injury, { 养: chronicle.spanText(fight.injury.days * clock.DAY_MINUTES) }));
  if (fight.damaged?.name) lines.push(fill(L.damaged, { 器: fight.damaged.name }));
  // the spirit beast downed in the last round (beasts.hurt: its injury, or died in extreme mode)
  if (fight.beast?.died || fight.beast?.injury) lines.push(fill(fight.beast.died ? L.petDied : L.petDown, { 宠: fight.beast.name || '' }));
  return lines;
}

function write(receipt) {
  const fight = receipt?.fight;
  if (!fight?.end || !fight.routine) return [];
  const names = receipt.attack?.names || {};
  const routine = fight.routine;
  const met = fill(REPORT.opening[routine.kind] || REPORT.opening.encounter, { 地: routine.place, 敌: routine.name });
  const F = REPORT.first;
  const first = routine.ambush === 'player' ? F.ambush : routine.ambush === 'foes' ? F.foesAmbush
    : routine.first === 'player' ? F.player : F.foes;
  const lines = [met + fill(first, { 敌: routine.name }), decisive(fight, receipt.attack, names)];
  const got = fight.end === 'win' ? gotOf(fight) : '';
  if (got) lines.push(fill(REPORT.gains, { 物: got }));
  lines.push(...losses(fight));
  return lines;
}

// After a move op: the routine fight that ended in it gets its report on its receipt.
function settle(env) {
  const receipt = list(env.receipts).findLast(each => each?.kind === 'fight' && each.fight?.end);
  if (!receipt?.fight?.routine) return;
  const lines = write(receipt);
  if (lines.length) receipt.fight.report = lines;
}

module.exports = { REPORT, install, settle, write };
