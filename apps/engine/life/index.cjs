'use strict';
/* The cultivation-life play's engine entry (docs/gameplay-plan.md, 「设计」 and items 4, 14, 15, 17,
 * 19, 31, 33, 34, 41, 46, 47, 49): settle.cjs hands it every { mode: "life" } call. A save is in this play when data.state.frxPlay
 * has version 1 (lifeOf); settle.cjs answers any other save { error: "not_life" } without loading
 * this code.
 *
 * Input  { mode: "life", op, archive, seed?, args?, receipts? }
 *   op        a key of OPS (below)
 *   args      the op's object (below)
 *   seed      the request's seed, for the old rule functions that draw on it (mechanics.cjs,
 *             turn-rules.cjs); the life's own dice use the timeline seed, env.seedOf
 *   receipts  receipts already settled earlier in this turn: replayed first, so the op starts from
 *             the state and the frxPlay they left, and numbers its receipts after them
 * Output { receipts, chronicle, ...the op's own keys }
 *        receipts are the op's settled receipts (below); chronicle its chronicle lines, in date
 *        order, at most limits.linesPerOp of them with repeats merged (chronicle.cap), each
 *        { kind, date: { text, year, month, day }, text, line, count?, clock? } (count on a merged
 *        line; clock { name, size, value } on a line about a pressure clock: the clock as that
 *        move left it, for the annals block's pips)
 *   or   { error: "not_life" | "unknown_op" | "refused", reason? }: nothing is settled; reason is
 *        for the player
 *   or   { errors: [message] } when the engine itself failed, as in the other modes
 *
 * The ops:
 *   verb      args: the turn's verb, { kind: "wait", days?, until? } (verbs.cjs). Settles it; the
 *             months it crosses are settled too (clocks, then the calendar: month.cjs).
 *   view      no args → { view: { date, age, lifespan, mind, place, near, clocks, calendar, verbs,
 *             gate?, fight?, realm?, toxin, pills, gear, beasts, sect, next } }: what the state view's play shows; mind the 心境
 *             (mind.view: the number, the panel's line and the thresholds now and next); place where the player is
 *             (places.placeView: the map place, its kind, aura, danger in words and venues), near
 *             the 去处 list (travel.near: the nearest map places of the main region, with the days),
 *             clocks as clocks.view, calendar the nearest five entries (calendar.cjs), fight the
 *             contract's PlayFight while one is under way (fight.view; the server adds each belt
 *             thing's icon), realm the node map while in a secret realm (realm.view; no contract field
 *             yet); toxin 丹毒's bar and pills the bag's cultivation pills with what 耐药 leaves of
 *             them (poison.view, item 44), gear what is worn and what counts (gear.view: active [{ id, slot, role?, bonus }],
 *             inactive [{ id, slot, reason }], belt [belt.size × { itemId, name, quantity, type } |
 *             null], pieces { id: { name, slot, tier, quality?, attune: { done, need }, condition,
 *             damaged?, stolen?: { owner, faction }, traits, above? } } for the worn and the bagged,
 *             totals { stat: n } the player's totals with the active gear (gear.totals), for the
 *             panel; no contract field yet); beasts the spirit beasts (beasts.view: kept, cap, out,
 *             list [{ id, name, species, use?: { name, text }, temperament, act, level, tier, cap,
 *             aptitude: { grade, current, max }, hp, mp, favour, obeys, bound, out, injury?: { until,
 *             days }, feeds: { left, month }, foods: [{ itemId, name, tier, factor, same?, low, high,
 *             crit }] }], eggs [{ id, name, tier, due, days }]; no contract field yet); leads the
 *             storyline's open questions (leads.view, item 26), karma and knots the ledger and the heart
 *             knots (karma.view, item 40); next 接下来,
 *             at most three things to do now (hints.next: [{ text, kind, verb? }], PlayView.next;
 *             the main line from the plot progress mode is handed, env.plot); sect the player's sect
 *             (sect.view: name, status, contribution, earned, stipend, next?, duty, exchange,
 *             entered?, place?, here, contests; null for a loose cultivator; PlayView.sect); joining
 *             the ways into a sect for a loose cultivator (sect.joining: the sects, 开院会,
 *             听澜帖; null in a sect; PlayView.joining); legacy the lifespan's last
 *             ten years and its end (legacy.view, PlayView.legacy: twilight, or choosing the
 *             heir; null otherwise). Progress mode returns the same as `life`.
 *   calendar  no args → { calendar: [entry] }: every entry of the next three years (calendar.ahead),
 *             fixed, own and director, sorted, each with the days left.
 *   director  args: the director's WRITE_PLAN_LIFE additions { clocks?, dated?, pending?, leads?,
 *             chapter?, leadChapter?, leadTitle?, resolved? }
 *             (director.cjs) → { taken: { clocks, dated, pending }, dropped: [{ kind, name, reason }] };
 *             only what passes the engine's checks reaches frxPlay, and `dropped` is for the log.
 *   fight     args: { foes: [id | { id } | { name, realm, class? }], first?: player | foes,
 *             ambush?: player | foes } → { fight: view }: opens a fight (fight.open); refused when
 *             one is under way, a foe is unknown or down, or the player is down.
 *   move      args: the turn's move, { command: strike | skill | item | guard | flee | probe | talk |
 *             tame, skillId?, itemId?, targetId?, order?: attack | guard | harass } (snake_case also
 *             read) → { fight: view | null }: plays one round (probe: no round); null once the fight
 *             has ended (the receipt says how; a routine fight's, a hunt's or a beast's met in the
 *             wild, carries the engine's battle report, fight.report: report.cjs, batch 9). tame
 *             (降服) is a taming check on a beast below 30% of its 气血; order the one order to the
 *             spirit beast out (fight.cjs, beasts.cjs).
 *   encounter args { cause?, who?, tier? } → { encounter, cards }: someone met here, from the
 *             place's foe table (encounter.cjs, foes.json encounters): the beat's cards go into
 *             frxPlay.cards and are played with act; refused while one waits or a fight is on, or
 *             when nothing here fits. A stretch interrupted in the wild may start one by itself
 *             (the verb's receipt: interruption.encounter).
 *   cards, act, scene   the scene's cards, playing one, the scene itself (actions.cjs, scene.cjs)
 *   gate      args { aids? } → { gate: the next gate's preparation sheet } (gate.cjs); the view's
 *             gate is its summary. The verbs breakthrough and perk, and 打磨 at a full gate, are
 *             verbs.cjs plans that gate.cjs and perks.cjs install
 *   chance    args { reason } → { chance: { gate, name } }: a scene of the story gives the gate
 *             ahead its 机缘 (gate.cjs chanceOp; plan item 50's fixes), for the turns lane's tool
 *   calm      args { clock } → { clock: the change }: 守拙 turns a clock back a step (perks.cjs)
 *   lead      args { id, how? } → { lead }: the model's prove_lead, a lead proven in a scene that had
 *             a successful check (leads.cjs, plan item 26)
 *   karma     args { kind, who, what, back?, days? } | { done, how? } → { entry }: the model's
 *             note_karma (karma.cjs, plan item 40)
 *   book      args { no, text } → { volume }: the model's 卷末语 for a closed volume (book.cjs, item
 *             38); after an op that may do it (book.watches) book.settle takes the annals lines in,
 *             turns a volume on a great event's aftermath and comes out of a long stretch (出关见闻)
 *   knot      args { kind, who, what, name? } | { resolve, who, heir?, how? } → { knot }: the model's
 *             note_knot. After an op that may make a karma entry (karma.watches), karma.settle
 *             records the engine's own (a rescue, a loan, a taking, a promise past its day)
 *   thread    args { action: add, threads, from, followUp? } → { threads: { added, dropped } }: the
 *             story threads a beat left (<threads>) and the server's follow-ups, checked against the
 *             save as the story's commands left it (threads.cjs, batch 9). The verb follow takes
 *             one up; frxPlay.threads is the view's threads
 *   notices   no args → { notices: play_models.NoticeBoard }: the notices up here this half-year (jobs.cjs)
 *   shop      no args → { shop: play_models.ShopView }: what the shops here sell and take, at what
 *             price (trade.cjs). The verbs ask, job and trade are verbs.cjs plans that ask.cjs,
 *             jobs.cjs and trade.cjs install (plan item 35); after an op that may do a job taken from
 *             a notice (jobs.watches), jobs.settle pays it, or drops one past its day
 *   realm     args { action: enter | node | leave | view, realm?, node? } → { realm: view | null,
 *             fight? }: a secret realm's node map (realm.cjs, content/life/realms.json): enter it
 *             while it is open, take a node of the next layer, leave past the deepest; past its
 *             closing day the player is sent out. Standing verbs wait inside
 *   tie       args { id, kind | null } → { tie }: sets or ends the player's tie with a character
 *             (people.cjs; nine kinds). The people's month is a month step (people.month)
 *   legacy    args { action: view | choose, heir: <id> | new, name?, gender?, root?, words? }
 *             → { legacy }: the lifespan's end (legacy.cjs, content/life/legacy.json, plan item
 *             49). After every op that settles something, legacy.after keeps the record of the
 *             life (frxPlay.record, passed), puts on or takes off 大限将至 and, once the age
 *             reaches the lifespan with no fight, no scene and no move, settles the death of old
 *             age: extreme mode writes 寿元 0 for today's death flow; else the heir is to be chosen
 *             and every op but legacy.json's `open` is refused (here, in run). choose makes the
 *             heir (a 道侣 or 弟子 of the ties, or a new one with the server's root) B1
 *   The verbs gather and hunt are verbs.cjs plans that rewards.cjs installs (the view's list leaves
 *   them out until the contract takes them); rewards.loot is what a felled foe leaves (receipt kind
 *   "loot"), for the fight engine to call; rewards.fortune is a month step (月结的奇遇), and after an
 *   op that plays a card or closes a scene (rewards.watches) rewards.settle gives a 奇遇's scene
 *   that closed what the cell 奇遇 holds, by how its cards went (receipt kind "fortune")
 *   travel    args { to, reason? } → { travel }: the model's move_place, a journey to the map place
 *             `to` (travel.move), settled in a scene too; the verb travel is verbs.cjs's (travel.cjs)
 *   equip, unequip  args { itemId } → { gear: gear.view }: put on or take off a piece (gear.cjs;
 *             mechanics.equipItem and unequipItem, receipts equip_item and unequip_item), refused
 *             for a piece two tiers above the player's
 *   belt      args { items: [itemId] } → { belt: [{ itemId, name, quantity, type }] }: the belt,
 *             at most five talismans, pills and array flags from the bag (gear.cjs)
 *   gift      args { from } → { gift: { item, itemId, condition, traits } }: a person at 信赖 or
 *             more gives a fitting piece, once a year (gear.cjs)
 *   bag       args { from } → { bag: { from, items } }: the 储物袋 someone on the scene handed over
 *             in the story, opened as a felled person's would be, once per person (gear.cjs
 *             handover; the server runs it after the story, life_turns.bags_opened)
 *   The verbs array { name, item?, stones?, lure? } | { repair: true } (布阵, arrays.cjs, plan item 43)
 *   and home { action: buy | rent | claim | take | build | plant | harvest | leave, … } (洞府,
 *   home.cjs, item 45) are verbs.cjs plans too, not in the view's list; the view adds home (left
 *   out without one) and arrays (the arrays here and the teleport station); the fight op takes
 *   arrays [{ name, tier, charge? }] (the foes' arrays) and the move op the command break (破阵)
 *   while one stands; travel crosses main regions through a teleport array.
 *   pending   args { action: "fire" } → { fired: { origin, cause, event } | null }: the pending
 *             event that goes off now, for the scene the player's own words open (pending.cjs;
 *             the verbs give way to one, or are broken at their end by one, by themselves)
 *   The verbs refine { itemId, days? } (祭炼: attunement) and repair { itemId, smith? } (修补) are
 *   verbs.cjs plans that gear.cjs installs; like gather and hunt they are not in the view's list
 *   (the interface offers them on a piece)
 *   feed      args { beastId, itemId } → { fed, beasts }: feeds a spirit beast one thing from the
 *             bag (beasts.cjs): at most three a month, the gain by the food's tier and element; a
 *             save in this play feeds here, not through the old panel action
 *   sect      args { action: join | exchange | promote | enter | contest | view, sect?, by?: fair |
 *             token, id?, contest?: 小比 | 大比 } → { sect: sect.view } (sect.cjs, content/life/
 *             sects.json): 开院会 or 听澜帖, the exchange list, promotion, signing up for a contest
 *             and the contest itself (a string of engine bouts). The verb duty { id? } (宗门差事) is a
 *             verbs.cjs plan sect.cjs installs; the stipend and the yearly duty are a month step.
 *             World factors and difficulty (world.cjs, content/life/world.json) are hooks the rules
 *             read; a birth's start (content/life/births.json) is put into frxPlay by the server's
 *             new_life (frxPlay.birth, difficulty, sect, clues, clocks, perks, home, pending)
 *   beast     args { action: out | in | hatch | buy | gift | promote | view, beastId?, itemId?,
 *             name?, price?, tier?, species?, from? } → { beasts: beasts.view } (beasts.cjs). The
 *             verb bind { beastId } (认主, seven days) is a verbs.cjs plan beasts.cjs installs, not
 *             in the view's list; the beasts' month (eggs hatch, hurt beasts heal) is a month step
 * The receipt kinds the ops settle (each registered in play_blocks.RECEIPT_KINDS by the turns lane):
 *   wait      the verb wait (source verb): time row and age
 *   travel    the verb travel (source verb) and move_place (source tool): the time row, at the
 *             place where the journey ends, and age; travel { from, to, distance, walk, days, walked,
 *             arrived } (travel.cjs)
 *   calendar  the month step's rows of table 5 (source engine): one per advance, when an event
 *             worth a line opened where the player is
 *   director  the director op (source engine): no commands; it carries the new frxPlay
 *   fight     the fight's opening (source engine) and each move (source move): attack shaped as
 *             resolve_attack's (play_blocks.combat_blocks draws it), check as resolve_check's (遁 察
 *             和), fight { id, round, command?, target?, opened?, first?, foes: [{ id, name, did?,
 *             next?, out?, tags? }], self?, ticks?, perks?, end?: win | lose | flee | truce, loss?,
 *             injury?, probed?, loot?, bags?, damaged?, driven?, switched?, drank?, clocks? }
 *             (fight.cjs); a move with 物 settles the item's use_item receipt before it; an act
 *             whose card brings a fight settles the act first; an act's receipt carries damaged
 *             { id, name } when a 大失败 with a piece of gear damaged it
 *   encounter the encounter op (source engine, hidden: no block of its own): it carries the new
 *             frxPlay; an act on a beat card carries `encounter` (what the beat came to)
 *   gather    the verb gather (source verb): goods to the bag, stones to the purse, time row and
 *             age; gather { days, place, kind, tier, items } (rewards.cjs)
 *   hunt      the verb hunt (source verb): time row and age; hunt { tier, place, target, loot };
 *             the fight it opens settles its own receipt after it
 *   loot      what a felled foe leaves (source engine): loot { foe, from, items } (rewards.loot)
 *   realm     a secret realm's steps (source engine): action enter, node (the way to a node: time
 *             row), check (a 险, or a 宝's guard: check as resolve_check's), loot (a 宝 or the 守:
 *             items, empty?), close (the clock to the closing day), leave or shut (out: herbs sold,
 *             stones); a 战 or 守 opens a fight (its receipt), a 歇 settles a rest, a 秘 a scene
 *   people    the people's month (source engine, hidden): table 5 rows of what was worth writing,
 *             the realm and age of the people on the scene, the dead leaving it; one per advance
 *   tie       the tie op (source engine, hidden): it carries the new frxPlay
 *   refine    the verb refine (source verb): time row and age; refine { itemId, name, tier, days,
 *             done, need, full } (gear.cjs; frxPlay.gear keeps the days done)
 *   repair    the verb repair (source verb): by one's own hand a material from the bag, time row
 *             and age, repair { itemId, name, material?, days, done, need, mended }; with a smith
 *             the stones (no time), repair { itemId, name, smith: true, stones, until } and the
 *             calendar entry repair on the day it is ready
 *   belt      the belt op (source engine, hidden): belt [itemId]; it carries the new frxPlay
 *   gift      the gift op (source engine): the piece to the bag, gift { from, name, item,
 *             condition, traits }
 *   bag       the bag op (source engine): the bag's goods to the bag and its stones to the purse,
 *             bag { from, name, status }, items [{ id, name, class, tier, count, unit, price }]
 *   sect      the sect op, the verb duty and the sect's month (sect.cjs): sect { action, … }: join
 *             { name, status, by, issued? } (the issued weapon to the bag), exchange { id, hall,
 *             name, price, contribution: { before, after } }, promote { before, after }, enter
 *             { contest, date } (hidden), contest { contest, bouts: [{ foe, won, rounds, mine,
 *             theirs }], place, contribution, items }, duty { id, title, days, done, contribution }
 *             (source verb: time row and age; clocks when the 门规责罚 clock was cleared), stipend
 *             { name, status, months?, stones?, clocks? } (source engine, the advance's last month)
 *   array     the verb array (source verb): action lay, array { name, kind, tier, power, place,
 *             ground?, charge?, check, mastery? } (the tool and the stones out), or action repair, job
 *             (the station's errand, a quest row)
 *   home      the verb home (source verb), action buy | rent | claim | take | build | plant |
 *             harvest | leave, home { … }; the month's rent (source engine): action rent (the
 *             stones) or lost
 *   pending   a pending event that went off (source engine): pending { id, from, trigger }; in
 *             place of a verb it carries the verb's `interruption` (day 0), from the op it is
 *             hidden. It carries the new frxPlay
 *   thread    the thread op's (source engine, hidden): thread { added: [PlayThread], dropped:
 *             [{ text, why }] }; follow the verb follow's (source verb): thread { id, text,
 *             pending }, and its `interruption` (origin thread) when it was taken up
 *   beast     the feed and beast ops, the verb bind and the beasts' month (beasts.cjs): beast
 *             { action, … }: feed { id, name, item, factor, same?, change, crit?, before, after,
 *             evolved?, capped?, left } (source engine: the aptitude column, favour, the food); out,
 *             in (hidden); hatch { egg }; buy { id, name, price }; gift { id, name, from, by };
 *             promote { id, name, before, after, item }; bind { id, name, days, done, need, bound }
 *             (source verb: time row and age); month { born, healed } (hidden unless one is born).
 *             The fight receipt carries beast { id, name, act, order?, obeyed?, held?, at?,
 *             covered?, injury?, died? } or { …, joined } at the opening, and tamed { foe, id,
 *             name }; a tame's check is kind 驭兽
 *   legacy    the lifespan's end (legacy.cjs, source engine): legacy { action: twilight, age,
 *             lifespan, left, ends } (大限将至 put on; the status column), renewed (taken off,
 *             hidden), died { died, name, gender, realm, age, lifespan, place, heirs | extreme }
 *             (the status column 坐化, or 寿元 0 in extreme mode), inherit { heir, dead, words, left,
 *             clocks } with biography { key, title, row }, relations and took for the server
 *             (play_legacy.py: the biography, the relations of the biographies, the portraits)
 * Clock moves and calendar entries change only frxPlay, which rides on the op's last receipt.
 * Called by other ops rather than being ops (see each module's header): clocks.raiseFor,
 * clocks.clockStepsFor, clocks.bump, clocks.react, clocks.start (the act and cards ops);
 * calendar.register and calendar.remove (the breakthrough's cooldown, 内伤's day); fight.open and
 * fight.fromAct (the act op opens a fight after settling its own receipt: `await
 * fight.fromAct(env, { target, outcome })`, which is `fight.open(env, { foes: [target], ambush })`,
 * or with fight.storyFoe's new foe when the target names one the story never registered);
 * encounter.start, encounter.table and fight.tierOf (a hunt, plan item 30); fight.loot (the one
 * call point for item 30's rewards.loot). The verbs' hooks: injury.install and encounter.install
 * chain onto hold (内伤 keeps cultivating waiting, an encounter every verb) and set broken (an
 * interruption in the wild may be an encounter).
 *
 * A handler: async (env, args) => object | undefined
 *   It returns the output's own keys ({ view }, { cards } ...), or env.refuse(reason) to refuse, in
 *   which case nothing it settled is kept. Everything it changes goes through receipts.
 *   env is settle.cjs's engineEnv with the life's parts added, so the old rule functions
 *   (mechanics.cultivate, mechanics.rest, rules.resolveCheck ...) take it as it is:
 *     ctx         the card's table functions, in their vm: parseRemarksString, itemStackCount ...
 *     state       the draft card tables (currentState): "0" characters (B1 the player), "1" items,
 *                 "4" the time row, "5" world events, "6" quests, "8" skills. Read it freely;
 *                 change it only by settling a receipt
 *     archiveId, seed, progress (the frxProgress ledger), dailyUses, worldFactors, worldMap,
 *                 knownIds, biographies: as engineEnv gives them
 *     play        the working frxPlay (a copy): change it in place. When the op leaves it different,
 *                 the whole new value goes on its last ok receipt as `frxPlay`; an op that changes
 *                 it must settle at least one receipt to carry it
 *     clock()     mechanics.readClock(env.state): { minutes, text, timed, ... } or null; the clock
 *                 moves only through clock.advance
 *     data(name)  content/life/<name>.json, parsed
 *     seedOf(parts), random(parts)
 *                 the timeline seed of a roll (clock.cjs) and a seeded stream on it: .random() in [0, 1)
 *     settle(r)   settles receipt r: applies its commands to env.state (when r.ok), takes its
 *                 frxPlay as env.play when it carries one, numbers it (r.id = "R3", after the
 *                 turn's earlier receipts) and appends it to env.receipts. Settle a receipt once
 *                 its commands are final
 *     receipts    the receipts this op settled, in order
 *     chronicle   the chronicle lines this op wrote (chronicle.write)
 *     refuse(reason)  what a handler returns to refuse
 *
 * A receipt has the shape of every engine receipt, so settle.cjs and play_blocks take it as it is:
 *   { kind, ok, source, commands, owns, summary, time?, age?, frxPlay?, id }
 *   kind      what was settled (the kinds above); a new kind is also registered in RECEIPT_KINDS
 *   source    "verb" for a standing verb, "engine" for what the engine does by itself
 *   commands  the card's commands (set, add, de, updateAttribute, addWorldEvent ...), one per line
 *   owns      what it settled that the story's own commands may not change (turn-rules.cjs)
 *   time      { before, after, minutes } when it moved the clock, age { before, after } or null:
 *             advance writes both
 *   frxPlay   the whole new frxPlay; the whole-turn settle and applyReceipt take the last one, and
 *             card_store.apply_settlement keeps it in data.state as it keeps frxProgress
 *
 * Add an op with one line in OPS, its handler in its own module. Modules never require this file.
 */
const mechanics = require('../mechanics.cjs');
const { create } = require('../core/random.cjs');
const { data } = require('./data.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const clocks = require('./clocks.cjs');
const calendar = require('./calendar.cjs');
const director = require('./director.cjs');
const fight = require('./fight.cjs');
const verbs = require('./verbs.cjs');
const actions = require('./actions.cjs');
const scene = require('./scene.cjs');
const speed = require('./speed.cjs');
const gate = require('./gate.cjs');
const perks = require('./perks.cjs');
const injury = require('./injury.cjs');
const encounter = require('./encounter.cjs');
const rewards = require('./rewards.cjs');
const crafts = require('./crafts.cjs');
const poison = require('./poison.cjs');
const places = require('./places.cjs');
const travel = require('./travel.cjs');
const mind = require('./mind.cjs');
const trade = require('./trade.cjs');
const jobs = require('./jobs.cjs');
const ask = require('./ask.cjs');
const realm = require('./realm.cjs');
const people = require('./people.cjs');
const gear = require('./gear.cjs');
const beasts = require('./beasts.cjs');
const leads = require('./leads.cjs');
const karma = require('./karma.cjs');
const visit = require('./visit.cjs');
const book = require('./book.cjs');
const hints = require('./hints.cjs');
const sect = require('./sect.cjs');
const world = require('./world.cjs');
const interrupt = require('./interrupt.cjs');
const arrays = require('./arrays.cjs');
const home = require('./home.cjs');
const pending = require('./pending.cjs');
const heartbeat = require('./heartbeat.cjs');
const legacy = require('./legacy.cjs');
const report = require('./report.cjs');
const threads = require('./threads.cjs');

gate.install(verbs, speed);
travel.install(verbs);
trade.install(verbs);
jobs.install(verbs);
ask.install(verbs);
perks.install(verbs, speed);
rewards.install(verbs);
crafts.install(verbs, beasts);   // after rewards.install: it chains onto the list hook that one sets
visit.install(verbs);   // after crafts.install: it chains onto the list hook too
threads.install(verbs);
poison.install(speed);
// After perks.install: these chain onto the hold hook it sets.
injury.install(verbs);
encounter.install(verbs);
realm.install(verbs);
gear.install(verbs);
beasts.install(verbs);
sect.install(verbs);
world.install(speed);
// The 驭兽 mastery feeds taming through crafts.install (beasts.hooks.mastery and .tamed).
// After encounter.install: these chain onto the hold and broken hooks, and onto the fight's.
arrays.install(verbs, { fight, interrupt, clocks, travel });
home.install(verbs, { fight, beasts });
// A routine fight's battle report, the engine's (batch 9): it chains onto the fight's hooks.
report.install({ fight });
pending.install(verbs);
heartbeat.install(verbs);   // after pending.install: it chains onto the hooks that one sets
// Last, so its hold hook is asked first: while the heir is to be chosen nothing else is
// asked (plan item 49).
legacy.install(verbs);

function lifeOf(archive) {
  const play = archive?.data?.state?.frxPlay;
  return play && typeof play === 'object' && !Array.isArray(play) && play.version === 1 ? play : null;
}

// What the player sees of the life (the state view's play): the date, the age, the lifespan, the
// clocks, the nearest calendar entries and the standing verbs here and now (verbs.list). Takes any
// env with ctx, state and play (progress mode passes engineEnv's with the save's frxPlay).
// The place where the player is, with the entrance of a secret realm here (realm.entrance): which,
// open or not, until when, and whether it can be entered now.
function placed(env) {
  const door = realm.entrance(env);
  return { ...places.placeView(env), ...(door ? { realm: door } : {}) };
}

function view(env) {
  const now = mechanics.readClock(env.state);
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const fighting = fight.view(env);
  const next = gate.summary(env);
  const inside = realm.view(env);
  const worn = gear.view(env);
  const itemTiers = Object.fromEntries(Object.entries(env.state['1'] || {}).flatMap(([id, row]) => {
    const tier = gear.knownTier(env, row);
    return tier ? [[id, tier]] : [];
  }));
  const kept = beasts.view(env);
  const own = home.view(env);
  return { date: now ? clock.dateOf(now) : null, age: mechanics.numberIn(remarks['年龄']), lifespan: mechanics.numberIn(remarks['寿元']),
    mind: mind.view(env), place: placed(env), near: travel.near(env), clocks: clocks.view(env), calendar: calendar.upcoming(env, 5), verbs: verbs.list(env),
    ...(next ? { gate: next } : {}), ...(fighting ? { fight: fighting } : {}),
    ...(env.play.scene && !fighting ? { cards: actions.viewCards(env) } : {}),
    ...(inside ? { realm: inside } : {}), ...poison.view(env), gear: worn, itemTiers, beasts: kept,
    leads: leads.view(env), ...karma.view(env), threads: threads.view(env), sect: sect.view(env), joining: sect.joining(env), next: legacy.choosing(env) ? [] : hints.next(env),
    book: book.view(env), ...(own ? { home: own } : {}), arrays: arrays.view(env), legacy: legacy.view(env) };
}

const OPS = {
  calendar: async env => ({ calendar: calendar.ahead(env) }),
  director: director.director,
  fight: fight.openOp,
  move: fight.move,
  encounter: encounter.op,
  realm: realm.op,
  tie: people.tie,
  equip: gear.equip,
  unequip: gear.unequip,
  primary_technique: gear.primary,
  belt: gear.belt,
  gift: gear.gift,
  bag: gear.handover,
  feed: beasts.feed,
  beast: beasts.op,
  pending: pending.op,
  thread: threads.op,
  verb: verbs.verb,
  preview: verbs.preview,
  view: async env => ({ view: view(env) }),
  cards: actions.cards,
  act: actions.act,
  scene: scene.scene,
  gate: async (env, args) => ({ gate: gate.sheet(env, args) }),
  chance: gate.chanceOp,
  calm: perks.calmOp,
  travel: travel.move,
  scene_arrival: travel.sceneArrival,
  lead: leads.prove,
  karma: karma.karma,
  knot: karma.knot,
  book: book.words,
  sect: sect.op,
  legacy: legacy.op,
  notices: async env => ({ notices: jobs.board(env) }),
  shop: async env => ({ shop: trade.view(env) }),
};

// One op on env: settle.cjs's engineEnv with `play` set and the turn's earlier receipts (`earlier`
// of them) replayed. `apply(receipt)` is settle.cjs's applyReceipt on that env.
async function run(input, env, apply, earlier) {
  const op = String(input.op ?? '');
  if (!Object.hasOwn(OPS, op)) return { error: 'unknown_op', reason: `没有「${op.slice(0, 20)}」这个操作` };
  const args = input.args ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) return { error: 'refused', reason: '参数要是一个对象' };
  // While the heir is to be chosen only a few ops go (legacy.cjs, plan item 49).
  const held = legacy.holds(env, op);
  if (held) return { error: 'refused', reason: held };
  const before = JSON.stringify(env.play);
  const receipts = [], lines = [];
  Object.assign(env, {
    receipts, chronicle: lines, data,
    clock: () => mechanics.readClock(env.state),
    seedOf: parts => clock.seedOf(env, parts),
    random: parts => create(clock.seedOf(env, parts)),
    refuse: reason => ({ error: 'refused', reason }),
    async settle(receipt) {
      await apply(receipt);
      receipt.id = 'R' + (earlier + receipts.length + 1);
      receipts.push(receipt);
      return receipt;
    },
  });
  const result = (await OPS[op](env, args, input.receipts || [])) ?? {};
  // A 奇遇's scene that closed gives what its cell holds, as its cards went (rewards.cjs, item 50).
  if (!result.error && rewards.watches(op)) await rewards.settle(env);
  // A job its receipts did is paid, one past its day dropped (jobs.cjs, plan item 35).
  if (!result.error && jobs.watches(op)) await jobs.settle(env);
  // A rescue, a loan or a taking the receipts did, and a promise past its day (karma.cjs, item 40).
  if (!result.error && karma.watches(op)) await karma.settle(env);
  // The annals a volume's page picks, a great event's new volume, 出关见闻 (book.cjs, item 38).
  if (!result.error && book.watches(op)) await book.settle(env, op);
  // The life's record, then its end or its twilight (legacy.cjs, plan item 49).
  if (!result.error) await legacy.after(env, op);
  // A routine fight that ended in this move has the engine's battle report (report.cjs, batch 9).
  if (!result.error && op === 'move') report.settle(env);
  if (result.error) return { error: result.error, reason: result.reason };
  if (JSON.stringify(env.play) !== before) {
    const carrier = receipts.findLast(receipt => receipt.ok);
    if (!carrier) throw new Error(`「${op}」改了frxPlay，却没有结算回执来带它`);
    carrier.frxPlay = structuredClone(env.play);
  }
  return { receipts, chronicle: chronicle.cap(lines), ...result };
}

module.exports = { lifeOf, view, run, cultivationView: verbs.cultivationView };
