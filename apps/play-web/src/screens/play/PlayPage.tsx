// The play page (plan items 27–30): the painted stage under the book page, the status bar and the hour,
// the name plate of whoever stands on the stage, the navigation and the panels, the first-meeting
// close-up, the performances, and every state a turn can be in. Phones get their own layout (spec 十一):
// the page docks half or fully open, options follow the text, a bottom bar follows the keyboard. What the
// player does is in useActing, the performances in usePerformances, the close-ups in useCloseUp. A save
// of the cultivation life adds its own (life.tsx): action cards, annals lines, the standing commands in
// the bottom bar (on desktops at the book's foot) and their panels.
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { NoticeBlock, PlayVerb, StateView, Verb } from '../../contracts';
import { pins } from '../../lib/params';
import { useReady } from '../../lib/ready';
import { chipText, optionsOf } from '../../lib/story';
import { useQueueStore } from '../../store/queue';
import { useSettingsStore } from '../../store/settings';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { type SheetName, useUiStore } from '../../store/ui';
import { Acts, oddsWords } from '../../ui/Acts';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { Opts } from '../../ui/Opts';
import { Own } from '../../ui/Own';
import { Toast } from '../../ui/Toast';
import { VerbNotes, Verbs, verbLabel } from '../../ui/Verbs';
import { useDock } from '../../ui/useDock';
import { useKeyboardInset } from '../../ui/useKeyboardInset';
import { FINGER, PHONE, SHORT, useMedia } from '../../ui/useMedia';
import { Book } from './Book';
import { Breakthrough } from './Breakthrough';
import { type Cast, NOBODY, step } from './cast';
import { Clocks } from './Clocks';
import { FightBar, type FightSkillChoice } from './FightBar';
import { CloseUp } from './CloseUp';
import { Cultivation } from './Cultivation';
import { endsInDeath } from './DeathCard';
import { Fight } from './Fight';
import { LifeContext, LifePerks, type LifeReading, actsOf, annalRuns, annalTurn, lifeWords, perksOf } from './life';
import { LegacyCard } from './LegacyCard';
import { MainlineCard, mainlineLabel } from './MainlineCard';
import { NextGate, nextGateLabel } from './NextGate';
import { followLead, leadActionLabel } from './commands';
import { NextLine, NextSteps, nextOf } from './NextSteps';
import { gateMoved, mainlineMoved } from './moved';
import { isFollow } from './threads';
import { VerbChoices } from './VerbChoices';
import { RealmMap } from './Realm';
import { RealmGate, realmHere } from './RealmGate';
import { Meetings } from './meetings';
import { NamePlate, plateFor } from './NamePlate';
import { PANELS, Rail } from './Nav';
import { Passage } from './Passage';
import { useHead, useRecipe } from './people';
import { PhoneBar } from './PhoneBar';
import { hasFormation } from './scenes';
import { SheetHost, preloadPanels } from './SheetHost';
import { SHEET_KEYS } from '../sheets';
import { aimSheet } from '../sheets/aim';
import { DAYS_VERBS } from '../sheets/Cultivate';
import { useShowLevel, useSteady } from './showClock';
import { cardsOf } from './shows';
import { useCastAtRest, useSafeTop, useStageSettled, useStanding, useVeilUnder, useViewportTick } from './stagehand';
import { Place, Status } from './Status';
import { ReadingContext } from './TurnView';
import { TurnSection } from './TurnSection';
import { LiveState, PendingCard, TurnDialogs, noticeAction } from './TurnStates';
import { useActing } from './useActing';
import { useAnnounce } from './useAnnounce';
import { useCloseUp } from './useCloseUp';
import { useDirector } from './useDirector';
import { useFollow } from './useFollow';
import { jumpTarget, useJumpStore } from './jump';
import { useLiveShow } from './useLiveShow';
import { usePerformances } from './usePerformances';
import { sceneryOf, useScenery } from './useScenery';
import bookStyles from './Book.module.css';
import styles from './PlayScreen.module.css';

export function PlayPage({ saveId, view }: { saveId: string; view: StateView }) {
  const turns = useTurnsStore((s) => s.turns);
  const live = useTurnsStore((s) => s.live);
  const more = useTurnsStore((s) => s.more);
  const loading = useTurnsStore((s) => s.loading);
  const reconnecting = useTurnsStore((s) => s.reconnecting);
  const conflict = useTurnsStore((s) => s.conflict);
  const checked = useTurnsStore((s) => s.checked);
  const sheet = useUiStore((s) => s.sheet);
  // the view before the turn or panel action just done, to tell what it moved (the cards at the days' end)
  const stateBefore = useStateStore((s) => s.before);
  const openSheet = useUiStore((s) => s.openSheet);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const dock = useUiStore((s) => s.dock);
  const setDock = useUiStore((s) => s.setDock);
  const openForLine = useUiStore((s) => s.openForLine);
  const dockAfterSending = useUiStore((s) => s.dockAfterSending);
  const draft = useUiStore((s) => s.draft);
  const setDraft = useUiStore((s) => s.setDraft);
  const notify = useUiStore((s) => s.notify);
  const chips = useQueueStore((s) => s.items);
  const removeChip = useQueueStore((s) => s.remove);
  const motion = useSettingsStore((s) => s.motion);
  const phone = useMedia(PHONE);
  // options follow the turn's text on phones and on short screens (a phone on its side): in a foot of
  // their own they would leave the story a sliver of the page
  const inlineOptions = useMedia(SHORT) || phone;
  const finger = useMedia(FINGER);
  const keyboard = useKeyboardInset();

  const [stageHost, setStageHost] = useState<HTMLDivElement | null>(null);
  // the reconnect attempt whose notice the player put away: the next attempt says so again
  const [quietAttempt, setQuietAttempt] = useState(0);
  // a connection back again: the attempts of the next break say so again, the first included (the documents
  // pass, #16: an attempt put away stayed away in every later break with that number)
  useEffect(() => {
    if (reconnecting === 0) setQuietAttempt(0);
  }, [reconnecting]);
  // the keyboard's height on the root too, for the page's notices over it (app.tsx)
  useEffect(() => {
    const root = document.documentElement;
    if (keyboard > 0) root.style.setProperty('--kb', `${keyboard}px`);
    else root.style.removeProperty('--kb');
    return () => {
      root.style.removeProperty('--kb');
    };
  }, [keyboard]);
  const bookRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const [typing, setTyping] = useState(false);
  const [cast, setCast] = useState<Cast>(NOBODY);
  const [choicesHidden, setChoicesHidden] = useState(false);
  const level = useShowLevel();
  const safeTop = useSafeTop(probeRef);
  const fullTop = view.play ? 140 : 96;
  const tick = useViewportTick();

  // ---------------------------------------------------------------- the save

  useEffect(() => preloadPanels(), []);

  // a panel named in the address opens with the page (screenshots of panels in place)
  useEffect(() => {
    const pinned = pins().sheet;
    if (pinned === 'nav' || PANELS.some((p) => p.name === pinned) || (SHEET_KEYS as readonly string[]).includes(pinned ?? '')) {
      openSheet(pinned as SheetName);
    }
  }, [openSheet]);

  const meetings = useMemo(() => new Meetings(saveId), [saveId]);
  useEffect(() => meetings.learn(turns), [meetings, turns]);

  // ---------------------------------------------------------------- the stage

  const director = useDirector(stageHost, styles.canvas ?? '');
  const { settled, ready: stageReady } = useStageSettled(director);
  // the performances (plan 演出): staged one after another; their cards land in the book as they play
  const { shows, staged, onShow, onRestart, onDrop, land, showDone, verdict, settleShow, heldByTurn, verdictsByTurn } =
    usePerformances(live, turns, level, settled);

  const scenery = useMemo(() => sceneryOf(view, live?.blocks), [view, live?.blocks]);
  // where the player was before the turn being written: its state may arrive before its scene does
  const placeAtRest = useRef(view.place.text);
  if (!live) placeAtRest.current = view.place.text;
  // a journey's passage is ink: the night's colours from the moment the turn moves the player until
  // the passage gives way to the new place
  const travelling =
    shows[0]?.kind === 'travel' ||
    (level !== 'off' && Boolean(live?.blocks.some((b) => b.type === 'scene' && b.place !== placeAtRest.current)));
  const sceneShown = useScenery(scenery, director, settled, travelling ? 'night' : null);

  // the player's back view, the panel covering the picture on phones, the motion setting
  const playerLook = JSON.stringify(view.player.portrait);
  useEffect(() => {
    director?.protagonist(view.player.portrait);
    // the look stands for the recipe
  }, [director, playerLook]);
  useEffect(() => director?.cover(phone && sheet !== null), [director, phone, sheet]);
  useEffect(() => director?.motion(motion), [director, motion]);

  // a first meeting waits while a performance is on; once begun, it keeps the stage
  const { meeting, cine, onMeet, endMeeting, meetingGone } = useCloseUp(meetings, shows.length > 0, setCast);
  const preset = cine ? 'close' : sheet ? 'sheet' : 'read';
  useEffect(() => {
    director?.focus(preset);
    director?.still(1);
  }, [director, preset]);

  // who stands on the stage: the cast at rest follows the last turn and who is present
  useCastAtRest(view, turns, live, setCast);
  const lastTurn = turns[turns.length - 1];

  const onActor = useCallback((id: string) => setCast((before) => step(before, id)), []);
  const waits = useLiveShow(live, lastTurn, director, meetings, placeAtRest.current, level, { onActor, onMeet, onShow, settled, onRestart, onDrop });

  // one performance at a time: a close-up waits for the show on stage, a show for a close-up begun
  const show = meeting ? null : (shows[0] ?? null);
  const staging = show !== null && (show.kind === 'breakthrough' || show.kind === 'travel');
  const fighting = show?.kind === 'combat';
  useEffect(() => {
    if (staging) closeSheet();
  }, [staging, closeSheet]);

  // the close-up has the main place to itself; a fight, the opponent; a fully open phone page shows no
  // one (a small head instead)
  const standing: Cast =
    cine && meeting ? { main: meeting.charId, side: null, speaker: 'main' } : fighting || staging || (phone && dock === 'full') ? NOBODY : cast;
  useStanding(director, saveId, view, standing, settled, cine ? meeting : null);
  const light = useUiStore((s) => s.light);
  useVeilUnder(director, bookRef, { cine, bare: staging, sheet: sheet !== null, phone, dock, safeTop, fullTop, light, hour: scenery.hour, tick });

  // ---------------------------------------------------------------- the phone's page

  const dockDrag = useDock(bookRef, scrollRef, { enabled: phone, dock, onDock: setDock, safeTop, fullTop });

  // ---------------------------------------------------------------- turns, scrolling

  const writing = live?.status === 'streaming';
  const lastSaved = turns.at(-1);
  const pendingId = live?.status === 'pending' ? live.id : !live && lastSaved?.status === 'pending' ? lastSaved.id : undefined;
  const pending = Boolean(pendingId);
  const choicesAtRest = !live || live.status === 'cancelled' || live.status === 'failed';
  const shown = live ? turns.filter((t) => t.no !== live.no) : turns;
  const lastShown = shown[shown.length - 1];
  const current = live ? live.no : (lastShown?.no ?? null);
  // the options stand until a turn is sent; a cancelled turn gives them back
  const options = (!live || live.status === 'cancelled') && !pending && lastShown ? optionsOf(lastShown.blocks) : undefined;
  // the cultivation life's action cards take the options' place, at the end of the turn being read
  const historyCards = choicesAtRest && !pending && lastShown ? actsOf(lastShown.blocks) : undefined;
  const currentCards = view.play?.cards;
  const historyMatches = historyCards && lastShown?.no === view.turnNo &&
    (!currentCards || (currentCards.length === historyCards.items.length && currentCards.every((card, i) =>
      card.index === historyCards.items[i]?.index && card.title === historyCards.items[i]?.title &&
      card.sub === historyCards.items[i]?.sub)));
  const fallbackCards = choicesAtRest && !pending && currentCards?.length && !historyMatches ? currentCards : undefined;
  const cards = fallbackCards ? { items: fallbackCards } : historyCards;
  const perksUp = (!live || live.status === 'cancelled') && !pending && lastShown ? perksOf(lastShown.blocks) : undefined;
  const cardList = useCallback(() => scrollRef.current?.querySelector<HTMLElement>('ol[aria-label="抉择"]') ?? null, []);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const smooth = motion === 'full' && !reduced && pins().t === undefined;
  const loadEarlier = useCallback(() => void useTurnsStore.getState().loadEarlier(), []);
  const follow = useFollow(scrollRef, {
    current,
    writing,
    first: shown[0]?.no ?? null,
    canLoadEarlier: more && !loading,
    loadEarlier,
    smooth,
  });

  // a turn the contents asked for (目录, item 38): the pages before are fetched until it is there, then
  // its top is brought up to the top of the text, where the reader stays (the end is not followed)
  const jumpTo = useJumpStore((s) => s.to);
  const { toTurn } = follow;
  useEffect(() => {
    if (jumpTo === null) return;
    const target = jumpTarget(shown, jumpTo, more);
    if (target === undefined) {
      if (!loading) loadEarlier();
      return;
    }
    useJumpStore.getState().done();
    if (target !== null) toTurn(target, 'auto', false);
  }, [jumpTo, shown, more, loading, loadEarlier, toTurn]);

  // options (or cards) in the text: 「抉择 · 3 ↓」 while they are out of view
  useEffect(() => {
    const target = optionsRef.current ?? (cards ? cardList() : null);
    const scroller = scrollRef.current;
    if (!inlineOptions || !target || !scroller || typeof IntersectionObserver !== 'function') {
      setChoicesHidden(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setChoicesHidden(!entry?.isIntersecting), { root: scroller, threshold: 0.2 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [inlineOptions, options, cards, cardList, typing]);

  // ---------------------------------------------------------------- acting

  // after a death the save started over on the server: nothing is sent, nothing gone back to, until it is read again
  const lifeEnded = !live && endsInDeath(lastShown);
  const inputLocked = writing || pending || conflict || lifeEnded;

  const { send, pick, act, command, elaborate, fight, realm, rewrite, onMenu, confirmUndo, menuFor, setMenuFor, undoAsk, keepTurns } = useActing({
    locked: inputLocked,
    phone,
    inputRef,
    live,
    shown,
    held: cine || staging || conflict,
    book: Boolean(view.play?.book),
  });

  // what a screen reader hears of the turn being written (spec 十二)
  const said = useAnnounce(live, lastShown, heldByTurn);

  // ---------------------------------------------------------------- the name plate and the head

  const mainId = standing.main;
  const mainPerson = mainId ? view.people.find((p) => p.id === mainId) : undefined;
  // phones, fully open: the one who would stand in the main place, as a small head in the book's head
  const faceId = phone && dock === 'full' ? (cast.main ?? undefined) : undefined;
  const face = useHead(useRecipe(saveId, view, faceId));
  const faceName = faceId ? (view.people.find((p) => p.id === faceId)?.name ?? '') : '';
  const foeHere = mainId ? view.play?.fight?.foes.find((foe) => foe.charId === mainId) : undefined;
  const platePlain = mainId && !cine && !(phone && dock === 'full') ? plateFor(mainId, mainPerson, live?.blocks ?? lastTurn?.blocks) : null;
  // a foe of the fight under way: its intent and tags under its plate (item 21)
  const plate = platePlain && foeHere ? { ...platePlain, fight: { ...(foeHere.intent ? { intent: foeHere.intent } : {}), tags: foeHere.tags } } : platePlain;

  // ---------------------------------------------------------------- ready for the screenshot tool

  const reading = useMemo(
    () => ({ saveId, view, onNotice: (action: 'retry' | 'resume' | 'reload') => noticeAction(action) }),
    [saveId, view],
  );

  // a performance is ready for its picture once its first stage work is drawn
  const showStaged = !show || show.kind === 'travel' || staged === show.key;
  // a turn being settled has all its words: its picture can be taken
  useReady(useSteady(checked && (!writing || reconnecting > 0 || meeting !== null || Boolean(live?.settling)) && (stageReady || !director) && showStaged));

  const hotkeys = !sheet && !cine && !staging && !undoAsk && !conflict;

  // ---------------------------------------------------------------- the cultivation life

  const play = view.play;
  // outside a scene and a fight the bar is the standing commands (a fight's own commands are item 21's)
  const verbsHere = Boolean(play) && !play?.scene && !play?.fight && !view.inCombat;
  // 自写: the line in the commands' place, until it is sent or the commands are asked for again
  const [ownLine, setOwnLine] = useState(false);
  useEffect(() => {
    if (!verbsHere) setOwnLine(false);
  }, [verbsHere]);
  const takeLine = () => {
    // drawn at once, so the line is focused within the tap and a phone's keyboard comes up
    flushSync(() => setOwnLine(true));
    inputRef.current?.focus();
  };
  // a command with choices (狩猎's tiers) asks for one first
  const [choosing, setChoosing] = useState<PlayVerb | null>(null);
  // a finger on a desktop layout (a phone on its side, a tablet held upright): where an open panel or a
  // command's choices cover part of the book, the whole book waits behind them, faded and not pressable,
  // until they close, so nothing in it (the foot's commands, 写一段, the volume, a card) is pressed half
  // covered; where the panel stands clear of the book (a tablet on its side) the book stays as it is
  const panelOpen = sheet !== null || choosing !== null;
  const lifeSave = Boolean(play);
  const [held, setHeld] = useState(false);
  useLayoutEffect(() => {
    if (phone || !finger || !panelOpen || !lifeSave) {
      setHeld(false);
      return undefined;
    }
    const measure = () => {
      const panel = document.querySelector<HTMLElement>('section[role="dialog"]');
      const book = bookRef.current;
      setHeld(Boolean(panel && book && panel.offsetLeft < book.getBoundingClientRect().right - 0.5));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone, finger, panelOpen, lifeSave, sheet, choosing]);
  const onVerb = (verb: PlayVerb) => {
    if (verb.off) {
      notify(verbLabel(verb));
      return;
    }
    // 修炼, 调息, 静候 open their panel; 差事, 买卖 and 炼制 the board, the shop and the recipes; 写一段 and
    // 悟得 have their own places
    if ((DAYS_VERBS as readonly string[]).includes(verb.kind)) openSheet(verb.kind as SheetName);
    else if (verb.kind === 'job') openSheet('notices');
    else if (verb.kind === 'trade') openSheet('shop');
    else if (verb.kind === 'craft') openSheet('craft');
    else if (verb.options?.length) setChoosing(verb);
    else if (verb.kind !== 'elaborate' && verb.kind !== 'perk') command({ kind: verb.kind });
  };
  // a thing to do of 接下来 goes as it is when it is whole (静候 until the injury heals, 修炼 until full,
  // a notice by its id, a good to sell); one the engine leaves open opens its panel (差事 and 买卖
  // without an id, 修炼 without how long); a journey opens the map at that place (the route and 动身
  // there), a gate its preparation (the pills are chosen there)
  const followStep = (verb: Verb) => {
    const listed = play?.verbs.find((each) => each.kind === verb.kind);
    const long = verb.days !== undefined || verb.until !== undefined || verb.full !== undefined || verb.hours !== undefined;
    if ((DAYS_VERBS as readonly string[]).includes(verb.kind) && !long) openSheet(verb.kind as SheetName);
    else if (verb.kind === 'travel') {
      aimSheet({ sheet: 'map', ...(verb.to ? { pick: verb.to } : {}) });
      openSheet('map');
    } else if (isFollow(verb)) {
      // 接着办: the thread's own sheet, with what taking it up would do and the button that sends it
      aimSheet({ sheet: 'thread', pick: verb.id });
      openSheet('thread');
    } else if (verb.kind === 'breakthrough') openSheet('gate');
    else if (verb.kind === 'job' && !verb.id) openSheet('notices');
    else if (verb.kind === 'trade' && !verb.id) openSheet('shop');
    else if (verb.kind === 'craft' && !verb.recipe) openSheet('craft');
    else if (verb.kind === 'hunt' && !verb.tier && listed?.options?.length) setChoosing(listed);
    else command(verb);
  };
  const verbTurn = useTurnsStore((s) => Boolean(s.request?.verb && s.request.verb.kind !== 'elaborate'));
  // where each turn of days stands in its run (the turn being written too, a command's before its line came)
  const runs = play
    ? annalRuns([
        ...shown.map((turn) => ({ no: turn.no, annal: annalTurn(turn.blocks) })),
        ...(live ? [{ no: live.no, annal: annalTurn(live.blocks) || (live.blocks.length === 0 && verbTurn) }] : []),
      ])
    : null;
  const lifeReading: LifeReading | null = useMemo(
    () =>
      play
        ? {
            actsFor: choicesAtRest && !pending && !fallbackCards ? (lastShown?.no ?? null) : null,
            onAct: act,
            locked: inputLocked,
            hotkeys,
            onElaborate: play.scene ? undefined : elaborate,
            onPerk: (index: number) => void command({ kind: 'perk', index }),
          }
        : null,
    [play, choicesAtRest, pending, fallbackCards, lastShown?.no, act, inputLocked, hotkeys, elaborate, command],
  );
  // a fight under way (gameplay plan item 21): its commands take the bar on phones and the foot on desktops
  const fightNow = play?.fight;
  const skillChoices: FightSkillChoice[] =
    fightNow?.skills ??
    view.skills
      .filter((skill) => skill.kind !== 'technique')
      .map((skill) => ({ skillId: skill.id, name: skill.name, ...(skill.cost ? { cost: skill.cost } : {}) }));
  const fightBar = (phoneBar: boolean) =>
    fightNow ? (
      <FightBar
        fight={fightNow}
        skills={skillChoices}
        onMove={fight}
        disabled={inputLocked}
        beastSpecies={play?.beasts?.beasts.find((each) => each.id === fightNow.beast?.id)?.species}
        {...(phoneBar ? { onPanels: () => openSheet('nav'), panelsOpen: sheet === 'nav', spread: true } : { caption: true })}
      />
    ) : null;
  // 去处 (item 28): the map panel's 近处, when the engine lists places to set out for
  const places = play?.near?.length ? () => openSheet('map') : undefined;
  // the next gate, at the end of the days (not under a beat's cards or the 悟得 on offer)
  // 主线 (the first playtest): the chapter, its conditions and the next chapter, at the end of the days
  // and under a scene's close card; 接下来 after it: what the engine suggests doing next. Neither inside a
  // secret realm, where the node map is what to do
  const daysEnd = Boolean(play && !play.scene && !play.fight && !play.realm && !cards && !perksUp);
  // 传承 (item 49): the protagonist died of old age; the heir is chosen before anything else goes on
  const heirToChoose = play?.legacy?.state === 'choosing';
  const legacyCard = daysEnd && heirToChoose && play?.legacy ? <LegacyCard legacy={play.legacy} onOpen={() => openSheet('legacy')} /> : null;
  // the main line's and the next gate's cards show whole only when the turn (or panel action) just done moved
  // them: a chapter turned or a condition met, the odds changed or a new lack; otherwise each folds to a line
  // under 接下来, which leads from the 回目 (the owner's second playtest)
  const mainlineHere = daysEnd && !heirToChoose ? view.mainline : undefined;
  const mainlineWhole = Boolean(mainlineHere) && mainlineMoved(stateBefore, view);
  const mainlineCard = mainlineHere && mainlineWhole ? <MainlineCard line={mainlineHere} onOpen={() => openSheet('quests')} /> : null;
  const mainlineLine =
    mainlineHere && !mainlineWhole ? (
      <NextLine
        key="main"
        kind="main"
        glyph="主"
        text={`主线 · ${mainlineHere.chapter}`}
        tail={mainlineHere.clues.length ? `${mainlineHere.clues.filter((clue) => clue.done).length}/${mainlineHere.clues.length}` : undefined}
        label={mainlineLabel(mainlineHere)}
        onOpen={() => openSheet('quests')}
      />
    ) : null;
  const steps = daysEnd ? nextOf(play) : [];
  // the gate still wants 修为 and something keeps 修炼 waiting (an injury): that holds the way up, and
  // the card says it
  const growthHeld = play?.gate?.missing.some((miss) => miss.startsWith('修为'))
    ? play.verbs.find((verb) => verb.kind === 'cultivate' && verb.off)?.note
    : undefined;
  const gateHere = play?.gate && verbsHere && !cards && !perksUp && !play.realm && !heirToChoose ? play.gate : undefined;
  const gateWhole = Boolean(gateHere) && gateMoved(stateBefore, view);
  const nextGate = gateHere && gateWhole ? <NextGate gate={gateHere} onOpen={() => openSheet('gate')} blocked={growthHeld} /> : null;
  const gateLine =
    gateHere && !gateWhole ? (
      <NextLine
        key="gate"
        kind="gate"
        glyph="关"
        text={`下一关 · ${gateHere.name}`}
        tail={`成算${oddsWords(gateHere.odds)}`}
        label={nextGateLabel(gateHere, growthHeld)}
        onOpen={() => openSheet('gate')}
      />
    ) : null;
  const openLeads = play?.leads?.filter((lead) => !lead.proven && lead.action) ?? [];
  const lead = openLeads.find((item) => item.action === 'investigate')
    ?? (daysEnd ? openLeads.find((item) => item.action === 'travel') : undefined)
    ?? openLeads.find((item) => item.action === 'ask');
  const leadLine = lead && choicesAtRest && !inputLocked ? (
    <NextLine key="lead" kind="lead" glyph="疑" text={`${leadActionLabel(lead)} · ${lead.where || lead.text}`}
      label={`${leadActionLabel(lead)}：${lead.where || lead.text}`} onOpen={() => followLead(lead)} />
  ) : null;
  const folded = [leadLine, mainlineLine, gateLine].filter((line) => line !== null);
  // the first three scenes of a life that close say how to go on from them (the server's first-time note
  // close, kept in frxPlay.seen): a quiet line under 接下来, not in the turn
  const closeNote = daysEnd
    ? lastShown?.blocks.find((block): block is NoticeBlock => block.type === 'notice' && block.note === 'close')?.text
    : undefined;
  const nextSteps =
    steps.length || folded.length || closeNote ? (
      <NextSteps steps={steps} verbs={play?.verbs} onStep={followStep} disabled={inputLocked} lines={folded} note={closeNote} />
    ) : null;
  // 入秘境: where the place is a secret realm's entrance (play.place.realm), at the end of the days (item 32):
  // open, closed till its next opening, or barred with the engine's reason; not while an heir is chosen
  const realmAtHand = daysEnd && !heirToChoose ? realmHere(play) : null;
  const realmGate = realmAtHand ? (
    <RealmGate
      realm={realmAtHand}
      today={play?.date}
      onEnter={() => realm({ action: 'enter', realm: realmAtHand.id })}
      disabled={inputLocked}
    />
  ) : null;
  // a secret realm's map at the end of the days while inside (item 32), not under a beat's cards or a fight
  const realmMap =
    play?.realm && !cards && !perksUp && !play.fight && !play.scene ? (
      <RealmMap realm={play.realm} onStep={realm} disabled={inputLocked} />
    ) : null;
  const verbRow =
    play && verbsHere && !ownLine ? (
      <Verbs
        verbs={play.verbs}
        onVerb={onVerb}
        onPlaces={places}
        onCalendar={() => openSheet('calendar')}
        onOwn={takeLine}
        onPanels={() => openSheet('nav')}
        panelsOpen={sheet === 'nav'}
        disabled={inputLocked}
        spread
      />
    ) : undefined;
  const chipRow = chips.length > 0 && (
    <div className={phone ? styles.chipRow : bookStyles.chips}>
      {chips.map((item, index) => (
        <Chip key={`${item.kind}-${item.text}`} text={chipText(item, view.people)} onRemove={() => removeChip(index)} />
      ))}
    </div>
  );
  const own = (
    <Own
      id="own-action"
      value={draft}
      onChange={setDraft}
      onSend={(text) => {
        send(text);
        setOwnLine(false);
      }}
      disabled={inputLocked}
      allowEmpty={chips.length > 0}
      // 「或者」 answers the options above the line; with none (a new save's empty book) there is nothing to answer
      placeholder={phone || !(options?.items.length || cards?.items.length) ? '写下你的行动……' : '或者，写下你自己的行动……'}
      inputRef={inputRef}
      className={phone ? styles.own : undefined}
      onFocus={() => {
        if (!phone) return;
        setTyping(true);
        openForLine();
      }}
      onBlur={() => setTyping(false)}
    />
  );
  const [abandon, setAbandon] = useState<string | null>(null);
  const pendingCard = pendingId && (
    <PendingCard error={live?.error?.message} retryAt={live?.error?.retryAt} onSettle={() => void useTurnsStore.getState().settle()}
      onAbandon={() => setAbandon(pendingId)} />
  );
  const confirmAbandon = async () => {
    if (!abandon) return;
    const accepted = await useTurnsStore.getState().undo(undefined, abandon);
    setAbandon(null);
    if (!accepted) notify(useTurnsStore.getState().error?.message ?? '回合状态已变化，请重新载入。');
  };
  const optionList = options && !typing && (
    <Opts items={options.items} onPick={pick} hotkeys={hotkeys} disabled={inputLocked} className={inlineOptions ? bookStyles.inline : undefined} />
  );

  const liveExtras = live && (
    <>
      <LiveState
        live={live}
        onCancel={() => void useTurnsStore.getState().cancel()}
        onRetry={() => void useTurnsStore.getState().retry()}
        onRewrite={rewrite}
      />
      {inlineOptions && optionList && <div ref={optionsRef}>{optionList}</div>}
    </>
  );

  const sections = shown.map((turn) => {
    const last = turn.no === lastShown?.no && !live;
    const isCurrent = turn.no === current;
    return (
      <TurnSection
        key={turn.no}
        no={turn.no}
        blocks={turn.blocks}
        cancelled={turn.status === 'cancelled'}
        current={isCurrent}
        held={heldByTurn.get(turn.no)}
        verdicts={verdictsByTurn.get(turn.no)}
        annal={runs?.get(turn.no)}
        book={Boolean(play?.book)}
        menu={{
          last,
          busy: writing || pending,
          ended: lifeEnded,
          open: menuFor === turn.no,
          onOpen: () => setMenuFor(turn.no),
          onClose: () => setMenuFor((open) => (open === turn.no ? null : open)),
          onPick: (action) => onMenu(turn.no, action),
        }}
      >
        {isCurrent && !live && inlineOptions && optionList && <div ref={optionsRef}>{optionList}</div>}
        {isCurrent && !live && legacyCard}
        {isCurrent && !live && nextSteps}
        {isCurrent && !live && mainlineCard}
        {isCurrent && !live && nextGate}
        {isCurrent && !live && realmGate}
        {isCurrent && !live && realmMap}
      </TurnSection>
    );
  });

  return (
    <main
      className={styles.screen}
      aria-label="游玩"
      data-dock={phone ? dock : undefined}
      data-cine={cine || staging ? '' : undefined}
      // the cultivation life's page: what it alone does (the short screen's 16 px story, Book.module.css)
      data-life={play ? '' : undefined}
      style={{ '--kb': `${keyboard}px`, '--book-full-top': `${fullTop}px` } as CSSProperties}
    >
      <div ref={setStageHost} className={styles.stage} aria-hidden="true" />
      <i ref={probeRef} className={styles.safeTop} aria-hidden="true" />
      <div className={styles.shade} aria-hidden="true" />
      {/* under a close-up or a staged performance the page's own layer is faded out: nothing in it may be
          pressed or focused (the performance has the page), and only the live region below still speaks */}
      <div className={styles.ui} inert={cine || staging ? true : undefined}>
        <Status view={view} onOpen={() => openSheet('character')} />
        <Place
          hourName={scenery.hourName}
          place={scenery.place}
          short={scenery.title}
          date={scenery.date}
          weather={scenery.weatherText}
          life={play ? { date: play.date?.text, ...lifeWords(play.age, play.lifespan) } : undefined}
        />
        {play && play.clocks.length > 0 && <Clocks clocks={play.clocks} />}
        {plate && <NamePlate key={mainId} {...plate} />}
        <ReadingContext.Provider value={reading}>
          <Book
            ref={bookRef}
            head={{
              no: current ?? view.turnNo,
              ...(play?.book ? { book: { ...play.book, onContents: () => openSheet('contents') } } : {}),
              title: scenery.title,
              when: `${scenery.date} · ${scenery.hourName}`,
              ...(face && faceId ? { face: { src: face, name: faceName } } : {}),
            }}
            dock={phone ? { handlers: dockDrag, toggle: () => setDock(dock === 'full' ? 'half' : 'full') } : undefined}
            scrollRef={scrollRef}
            loadingEarlier={loading && turns.length > 0}
            behind={follow.behind}
            held={held}
            onToEnd={() => follow.toEnd(smooth ? 'smooth' : 'auto')}
            choices={
              inlineOptions && (options || cards) && choicesHidden && !typing
                ? {
                    count: options?.items.length ?? cards?.items.length ?? 0,
                    onShow: () => (optionsRef.current ?? cardList())?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }),
                  }
                : null
            }
            foot={
              phone ? undefined : (
                <>
                  {pendingCard || (inlineOptions ? null : optionList)}
                  {play && verbsHere && (
                    <Verbs
                      verbs={play.verbs}
                      onVerb={onVerb}
                      onPlaces={places}
                      onCalendar={() => openSheet('calendar')}
                      disabled={inputLocked}
                    />
                  )}
                  {play && verbsHere && <VerbNotes verbs={play.verbs} />}
                  {fightBar(false)}
                  {!fightNow && chipRow}
                  {!fightNow && own}
                </>
              )
            }
          >
            <LifeContext.Provider value={lifeReading && { ...lifeReading, onPerk: undefined }}>
              {sections}
              {fallbackCards && <Acts items={fallbackCards} onPick={act} disabled={inputLocked} hotkeys={hotkeys && !inputLocked} />}
              {live && (
                <TurnSection
                  key={live.no}
                  no={live.no}
                  blocks={live.blocks}
                  open={live.open}
                  cancelled={live.status === 'cancelled'}
                  current
                  delays={waits}
                  held={heldByTurn.get(live.no)}
                  verdicts={verdictsByTurn.get(live.no)}
                  annal={runs?.get(live.no)}
                  book={Boolean(play?.book)}
                >
                  {liveExtras}
                </TurnSection>
              )}
            </LifeContext.Provider>
          </Book>
        </ReadingContext.Provider>
        {!phone && <Rail open={sheet} onOpen={openSheet} onBook={closeSheet} life={Boolean(play)} />}
        {phone && (
          <PhoneBar
            bookRef={bookRef}
            pending={pendingCard}
            chips={chipRow}
            own={own}
            navOpen={sheet === 'nav'}
            onNav={() => openSheet('nav')}
            verbs={fightBar(true) ?? verbRow}
            notes={!fightNow && verbRow && play ? <VerbNotes verbs={play.verbs} className={styles.barNotes} /> : null}
            onVerbs={
              verbsHere && ownLine
                ? () => {
                    // the line given up unsent: its words stay, the page goes back where it was
                    setOwnLine(false);
                    dockAfterSending();
                  }
                : undefined
            }
          />
        )}
        {reconnecting > 0 && reconnecting !== quietAttempt && (
          <div className={styles.notice} data-toasts="">
            <Toast text={`连接中断，正在重连……（第 ${reconnecting} 次）`} onClose={() => setQuietAttempt(reconnecting)} />
          </div>
        )}
        {show?.kind === 'combat' && (
          <Fight
            key={show.key}
            show={show}
            level={level}
            director={director}
            view={view}
            saveId={saveId}
            phone={phone}
            settled={settleShow(show.key)}
            onLand={(key) => land([key])}
            onVerdict={verdict}
            onDone={() => showDone(show)}
            skippable={Boolean(view.play)}
          />
        )}
      </div>
      <Dialog open={abandon !== null} className={styles.solid} title="放弃待结算回合"
        confirmLabel="放弃本回合" danger onConfirm={() => void confirmAbandon()} onCancel={() => setAbandon(null)}>
        <p>将撤掉这一回合，回到行动前。此前已完成的回合会保留。</p>
      </Dialog>
      <div className="visually-hidden" aria-live="polite" data-announce="">
        {said.map((line) => (
          <p key={line.key}>{line.text}</p>
        ))}
      </div>
      {perksUp && lastShown && !sheet && (
        <div className={styles.insights}>
          <LifeContext.Provider value={lifeReading}>
            <LifePerks block={perksUp} no={lastShown.no} />
          </LifeContext.Provider>
        </div>
      )}
      <SheetHost saveId={saveId} />
      {choosing && (
        <VerbChoices
          verb={choosing}
          onClose={() => setChoosing(null)}
          onPick={(verb) => {
            setChoosing(null);
            command(verb);
          }}
        />
      )}
      {show?.kind === 'cultivate' && (
        <Cultivation
          key={show.key}
          show={show}
          director={director}
          formation={hasFormation(sceneShown)}
          settled={settleShow(show.key)}
          onLand={() => land(cardsOf(show))}
          onDone={() => showDone(show)}
        />
      )}
      {show?.kind === 'breakthrough' && (
        <Breakthrough
          key={show.key}
          show={show}
          level={level}
          director={director}
          formation={hasFormation(sceneShown)}
          settled={settleShow(show.key)}
          onLand={() => land(cardsOf(show))}
          onDone={() => showDone(show)}
        />
      )}
      {show?.kind === 'travel' && (
        <Passage key={show.key} show={show} level={level} sceneUp={stageReady} onDone={() => showDone(show)} />
      )}
      {meeting && (
        <CloseUp
          key={meeting.id + meeting.charId}
          entry={meeting}
          where={`${scenery.place} · ${scenery.hourName}`}
          inFight={Boolean(fightNow)}
          onLeave={endMeeting}
          onGone={meetingGone}
        />
      )}
      <TurnDialogs
        conflict={conflict}
        onReload={() => void useTurnsStore.getState().reload()}
        undo={undoAsk}
        onUndo={() => void confirmUndo()}
        onKeep={keepTurns}
        book={Boolean(view.play?.book)}
      />
    </main>
  );
}
