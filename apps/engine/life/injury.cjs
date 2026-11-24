'use strict';
/* 内伤 (玩法设计第六节「战前和战后」; plan item 31): what a lost fight leaves. While it lasts the
 * player's blows in a fight are weaker (foes.json rules.statuses.内伤.attack) and cultivating waits; it
 * heals on its day. The numbers are content/life/foes.json `injury`.
 *
 * The injury is an own calendar entry of type "injury" (calendar.cjs, content/life/calendar.json):
 * its date is the day it is healed, so the calendar shows it and the month step clears it once past.
 *   active(env) → null, or { entry, until, left } while its day is still ahead: until the day it
 *                 heals ("0001-03-05"), left the days to go
 *   daysFor(tier) → the days a beating by a foe of that tier takes to heal: days × perTier^(tier − 1),
 *                 a tier below 1 counted as 1
 *   graced(env) → whether the life is in its first year's grace (injury.grace.within days from the
 *                 save's first day, an heir's from the day the one before died: frxPlay.lives): a fight
 *                 lost then leaves a light injury of grace.days, whatever the foe (plan item 50's fixes)
 *   register(env, { tier, commands, owns }) → { tier, days, until, pill?, light? }: puts the injury on
 *                 the calendar, keeping the later day when one is already there (light: the first
 *                 year's grace made it so). A matching pill in the
 *                 bag (pill.words in its name or effect) is taken at once: one less in its stack (a
 *                 command pushed onto `commands`, its id onto owns.items) and the days × pill.factor,
 *                 rounded up; pill is { id, name } then
 *   hold(env, kind) → why cultivating waits while injured (「内伤未愈，还要养十日」), else null: the
 *                 verbs' hold hook (install)
 *   healing(env) → whether the verb being planned (env.verbKind) is 养伤: one of injury.heal.verbs
 *                 (静候, 调息) done in place while injured. Nothing in the wild finds the player then:
 *                 interrupt.causesHere leaves out the causes that would be someone met (plan item
 *                 50's fixes: an injured 筑基 resting at 转潮山 was set upon ten times in eight months,
 *                 each blow another three months of 内伤)
 *   recovered(env, minutes) → { changes, commands }: what a 静候 of `minutes` brings back while
 *                 injured: heal.hours a day of content/combat.json's recovery of heal.kind, each stat
 *                 up to its max ([{ stat, before, after, max }] and their updateAttribute commands);
 *                 none when not injured
 *   unhurt(env, health) → the command that takes the lost fight's 重伤 (foes.json spared.status) off
 *                 the status column once 气血 stands full (`health`, the 血量 { after, max } a
 *                 静候 or 调息 leaves), else null
 *   install(verbs) chains hold onto verbs.hooks.hold, once; index.cjs calls it after perks.install,
 *                 which sets the hook it chains onto.
 */
const { plain } = require('../item-use.cjs');
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const { data } = require('./data.cjs');
const { list } = require('./play.cjs');

const FOES = data('foes');
const INJURY = FOES.injury;
const HEAL = INJURY.heal;
const J = JSON.stringify;
const TYPE = 'injury';
const DAY = clock.DAY_MINUTES;

function active(env) {
  const today = clock.today(env);
  if (today === null) return null;
  const entry = list(env.play?.calendar).find(each => each?.kind === 'own' && each.type === TYPE && (clock.dayOfDate(each.date) ?? -1) > today);
  return entry ? { entry, until: entry.date, left: clock.dayOfDate(entry.date) - today } : null;
}

const daysFor = tier => INJURY.days * INJURY.perTier ** (Math.max(1, Number(tier) || 0) - 1);

// The life's first year: the days since the save's first day (0001-01-01), or since the one before
// died for an heir (legacy.cjs's frxPlay.lives).
function graced(env) {
  const today = clock.today(env);
  if (!INJURY.grace || today === null) return false;
  const died = clock.dayOfDate(list(env.play?.lives).at(-1)?.died);
  return today - (died ?? 0) < INJURY.grace.within;
}

// The first pill in the bag that treats it: a thing used up when used, its name or effect naming it.
function pillIn(env) {
  const stored = env.ctx.storedItemIds(env.state);
  for (const [id, row] of Object.entries(env.state['1'] || {})) {
    if (!row || stored.has(id) || !rules.expendable(row['2'], true)) continue;
    const text = `${plain(row['1'])} ${plain(row['4'])}`;
    const count = env.ctx.itemStackCount(row['5']);
    if (Number.isSafeInteger(count) && count > 0 && INJURY.pill.words.some(word => text.includes(word))) {
      return { id, name: plain(row['1']).split('|')[0], count };
    }
  }
  return null;
}

function register(env, { tier, commands = [], owns = null } = {}) {
  const today = clock.today(env);
  const light = graced(env) && daysFor(tier) > INJURY.grace.days;
  let days = light ? INJURY.grace.days : daysFor(tier);
  const pill = pillIn(env);
  if (pill) {
    days = Math.ceil(days * INJURY.pill.factor);
    commands.push(pill.count > 1 ? `add(${JSON.stringify(pill.id)},{"5":"${pill.count - 1}"})` : `de(${JSON.stringify(pill.id)})`);
    owns?.items.push(pill.id);
  }
  const before = active(env);
  const day = Math.max(today + days, before ? clock.dayOfDate(before.until) : 0);
  const entry = calendar.register(env, TYPE, { date: clock.dateKey(day) });
  return { tier: Math.max(0, Number(tier) || 0), days, until: entry.date, ...(pill ? { pill: { id: pill.id, name: pill.name } } : {}),
    ...(light ? { light: true } : {}) };
}

function hold(env, kind) {
  if (kind !== 'cultivate') return null;
  const hurt = active(env);
  return hurt ? `内伤未愈，还要养${chronicle.spanText(hurt.left * DAY)}` : null;
}

// 养伤: a verb of heal.verbs done in place while injured (env.verbKind, the verb being planned).
function healing(env) {
  return Boolean(HEAL && list(HEAL.verbs).includes(env.verbKind) && active(env));
}

function recovered(env, minutes) {
  if (!HEAL || !active(env) || !(minutes > 0)) return { changes: [], commands: [] };
  const rates = mechanics.COMBAT.recovery?.[HEAL.kind] || {};
  const hours = HEAL.hours * minutes / DAY;
  const stats = mechanics.readStats(env, 'B1');
  const changes = [], commands = [];
  for (const [stat, percent] of Object.entries(rates)) {
    const before = mechanics.statValue(stats[stat]), max = mechanics.statValue(stats[stat], 'max');
    if (max <= 0 || before >= max) continue;
    const after = Math.min(max, before + Math.ceil(max * percent * hours / 100));
    changes.push({ stat, before, after, max });
    commands.push(`updateAttribute("B1",${J(stat)},{"current":${after},"max":${max}})`);
  }
  return { changes, commands };
}

function unhurt(env, health) {
  const word = FOES.spared?.status;
  if (!word || !health || !(health.max > 0) || health.after < health.max) return null;
  const parts = plain(env.state['0']?.B1?.['4']).split('，').map(part => part.trim()).filter(Boolean);
  if (!parts.includes(word)) return null;
  const kept = parts.filter(part => part !== word);
  return `add("B1",${J({ 4: kept.length ? kept.join('，') : '一切正常' })})`;
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  const before = verbs.hooks.hold;
  verbs.hooks.hold = (env, kind) => before(env, kind) || hold(env, kind);
}

module.exports = { HEAL, active, daysFor, graced, register, hold, healing, recovered, unhurt, install };
