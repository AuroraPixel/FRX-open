// A fight (plan item 60; spec 七, 交锋): the opponent walks onto the stage on the right — a beast in its
// bestiary picture, a person in their portrait — with its name and health above it. Every exchange is
// a card landing in the book with its seal, and on the stage a flash and a shake for a hit, the foe
// stepping aside for a miss. The last card of a finished fight takes a big 胜 or 负; the foe fades.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../../audio';
import type { CombatBlock, StateView } from '../../contracts';
import { Bar } from '../../ui/Bar';
import type { Director } from './director';
import { type Opponent, foeSpecOf, isPlayer, opponentOf } from './foe';
import { FoeIntent } from './NamePlate';
import { ASSETS } from './scenes';
import { at, cue, showPin, useShowTime } from './showClock';
import { type CombatShow, type ShowLevel, fightPlan, healthAlong, keyOf } from './shows';
import styles from './Shows.module.css';

export interface FightProps {
  show: CombatShow;
  level: ShowLevel;
  director: Director | null;
  view: StateView;
  saveId: string;
  phone: boolean;
  settled: (work: Promise<unknown>) => void;
  /** an exchange's card lands in the book */
  onLand: (key: string) => void;
  /** the big 胜 or 负 is pressed onto the last card */
  onVerdict: (key: string) => void;
  onDone: () => void;
  /** the cultivation life (gameplay plan item 21): a tap skips a fight's exchanges longer than 1.2 s */
  skippable?: boolean;
}

/** How long a fight's exchanges may play before a tap is allowed to skip them. */
export const SKIP_AFTER_SECONDS = 1.2;

const STRIKE_SECONDS = 1.5;

/** What the opponent is, beside their name over their health bar: their role and their realm. */
function roleOf(opponent: Opponent, view: StateView): string[] {
  const person = opponent.charId ? view.people.find((p) => p.id === opponent.charId) : undefined;
  return person ? [person.role, person.realm].filter((part): part is string => Boolean(part)) : [];
}

export function Fight({ show, level, director, view, saveId, phone, settled, onLand, onVerdict, onDone, skippable = false }: FightProps) {
  const t = useShowTime();
  const player = { id: view.player.id, name: view.player.name };
  // the opponent is whoever the first exchange is with
  const firstId = show.blocks[0]?.id;
  const opponent = useMemo(() => opponentOf(show.blocks, player), [firstId]);
  const plan = fightPlan(show.blocks, level);
  const [landed, setLanded] = useState(0);
  const [gone, setGone] = useState(false);
  const calls = useRef({ onLand, onVerdict, onDone });
  calls.current = { onLand, onVerdict, onDone };
  const scheduled = useRef(new Set<string>());
  const timers = useRef<(() => void)[]>([]);
  // the verdict, the leaving and the end, as scheduled now (a skip cancels them)
  const ending = useRef<(() => void)[]>([]);
  useEffect(
    () => () => {
      for (const stop of timers.current) stop();
    },
    [],
  );

  // the opponent walks on, and the music turns tense until the fight is over; its leaving waits for its
  // entrance (the picture may still be loading when a short or stood-still fight sends it away)
  const entrance = useRef<Promise<unknown>>(Promise.resolve());
  const leave = useCallback(() => {
    const gone = entrance.current.then(() => director?.foe(null));
    entrance.current = gone;
    return gone;
  }, [director]);
  useEffect(() => {
    audio.setMoment('combat');
    if (opponent && director) {
      entrance.current = foeSpecOf(opponent, view, saveId, ASSETS, phone).then((spec) => director.foe(spec));
      settled(entrance.current);
    }
    return () => {
      audio.setMoment(null);
      void leave();
    };
    // one fight, one opponent: it walks on once
  }, [opponent?.name, director]);

  // every exchange at its time, as the cards arrive (they may still be arriving when the first lands)
  useEffect(() => {
    const pinned = showPin();
    plan.cards.forEach((card, index) => {
      if (scheduled.current.has(card.id)) return;
      scheduled.current.add(card.id);
      const block = show.blocks[index] as CombatBlock;
      timers.current.push(
        at(card.at, () => {
          setLanded((n) => Math.max(n, index + 1));
          calls.current.onLand(keyOf(show.turn, block.id));
          if (pinned !== null && pinned - card.at >= STRIKE_SECONDS) return;
          cue('ui.seal');
          const atFoe = !isPlayer(block.defender, player);
          if (atFoe && block.hit) cue('fx.sword');
          const since = pinned !== null ? { since: pinned - card.at } : {};
          void director?.fx('strike', { hit: block.hit, at: atFoe ? 'foe' : 'player', ...since });
          if (pinned !== null) settled(Promise.resolve());
        }),
      );
    });
    // a card already scheduled keeps its time when more arrive; leaving the screen drops what is left
  }, [plan.cards.length]);

  // the verdict, the opponent's leaving, the end
  useEffect(() => {
    const last = show.blocks[show.blocks.length - 1];
    const stops = [
      plan.stamp !== null && last
        ? at(plan.stamp, () => {
            cue('ui.seal');
            calls.current.onVerdict(keyOf(show.turn, last.id));
          })
        : () => {},
      at(plan.leave, () => {
        setGone(true);
        settled(leave());
      }),
      at(plan.end, () => calls.current.onDone()),
    ];
    ending.current = stops;
    return () => {
      for (const stop of stops) stop();
    };
  }, [plan.stamp, plan.leave, plan.end]);

  // the cultivation life: a tap anywhere lands every exchange and its verdict at once and ends the show,
  // so the next command can be pressed (the tap goes on to what it pressed)
  useEffect(() => {
    if (!skippable || plan.end <= SKIP_AFTER_SECONDS) return;
    const skip = () => {
      for (const stop of [...timers.current, ...ending.current]) stop();
      timers.current = [];
      ending.current = [];
      for (const block of show.blocks) calls.current.onLand(keyOf(show.turn, block.id));
      setLanded(show.blocks.length);
      const last = show.blocks[show.blocks.length - 1];
      if (plan.stamp !== null && last) calls.current.onVerdict(keyOf(show.turn, last.id));
      setGone(true);
      settled(leave());
      calls.current.onDone();
    };
    document.addEventListener('pointerdown', skip, { capture: true, once: true });
    return () => document.removeEventListener('pointerdown', skip, { capture: true });
  }, [skippable, plan.end, plan.stamp, show.blocks, show.turn, leave, settled]);

  if (!opponent) return null;
  const health = healthAlong(show.blocks, (side) => !isPlayer(side, player))[landed] ?? null;
  const foe = view.play?.fight?.foes.find((each) => each.charId === opponent.charId || each.name === opponent.name);
  const role = roleOf(opponent, view);
  const enter = level === 'full' ? Math.min(1, t / 0.5) : 1;
  const fade = gone ? 0 : enter;
  return (
    <div className={styles.foe} style={{ opacity: fade }} role="group" aria-label={`交锋 · ${opponent.name}`}>
      <p className={styles.foeName}>
        {role.length > 0 && (
          // each part whole (「炼气十二层」 never splits); a line too long breaks at the 「·」
          <span className={styles.foeRole}>
            {role.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && ' · '}
                <span>{part}</span>
              </Fragment>
            ))}
          </span>
        )}
        <strong>{opponent.name}</strong>
      </p>
      {health && <Bar className={styles.foeBar} label="气血" current={health.current} max={health.max} tone="hp" />}
      {foe && <FoeIntent intent={foe.intent} tags={foe.tags} className={styles.foeIntent} />}
    </div>
  );
}
