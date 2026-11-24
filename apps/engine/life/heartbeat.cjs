'use strict';
// Keep the date of the most recent scene, fight or personal event for the visit hint. Elapsed
// time alone does not open a scene. The calendar, pending events and local dangers have their
// own triggers.
const clock = require('./clock.cjs');
const pending = require('./pending.cjs');

function mark(env, day) {
  env.play.quiet = { since: clock.dateKey(day), scenes: Number(env.play.counters?.scene) || 0,
    fights: Number(env.play.counters?.fight) || 0 };
}

function install(verbs) {
  pending.hooks.fired = mark;
  const start = verbs.hooks.start;
  verbs.hooks.start = async (env, kind, plan) => {
    const today = clock.today(env);
    const last = env.play.quiet;
    if (today !== null && (!last || last.scenes !== (Number(env.play.counters?.scene) || 0)
        || last.fights !== (Number(env.play.counters?.fight) || 0))) mark(env, today);
    return start(env, kind, plan);
  };
}

module.exports = { install };
