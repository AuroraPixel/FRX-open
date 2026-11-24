// The breakthrough (plan item 59; spec 七 修炼与突破, 九 特效的时间表): black bars slide in and the page
// fades; the stage gathers, turns gold, raises the pillar and pulls back (its own timetable); at 2.6 s
// the realm stands up in tall brush with 「破境 · 筑基初期」 and the 道成 seal beside it — or 未竟 and
// 再来 when it failed; the formation opening (fx.formation, where the scene has one), a bell, then
// thunder. At 6.5 s it all goes and the receipt lands. 跳过 (or Esc)
// ends it at once. Weak motion keeps only fades; the stage's shakes stop by themselves.
import { type CSSProperties, useEffect, useRef } from 'react';
import { audio, type SoundHandle } from '../../audio';
import { Btn } from '../../ui/Btn';
import type { Director } from './director';
import { at, buzz, cue, showPin, useShowTime } from './showClock';
import { BREAK, type BreakthroughShow, type ShowLevel, breakthroughAt, breakthroughWords } from './shows';
import styles from './Shows.module.css';

export interface BreakthroughProps {
  show: BreakthroughShow;
  level: ShowLevel;
  director: Director | null;
  /** the scene shows the formation (scenes.hasFormation) */
  formation: boolean;
  /** the stage work this show waits for (screenshots wait for it to be drawn) */
  settled: (work: Promise<unknown>) => void;
  /** the receipt may land */
  onLand: () => void;
  onDone: () => void;
}

export function Breakthrough({ show, level, director, formation, settled, onLand, onDone }: BreakthroughProps) {
  const t = useShowTime();
  const words = breakthroughWords(show);
  const sounds = useRef<SoundHandle[]>([]);
  const ended = useRef(false);
  const calls = useRef({ onLand, onDone });
  calls.current = { onLand, onDone };
  const layer = useRef<HTMLDivElement>(null);

  const end = (skipped: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (skipped) {
      for (const sound of sounds.current) sound.stop();
      // the stage's timetable is cut: settle it where the breakthrough leaves it, and look back at the page
      void director?.fx(show.success ? 'settle' : 'reset', {});
      director?.refocus();
    }
    audio.setMoment(null);
    calls.current.onLand();
    calls.current.onDone();
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    const pinned = showPin();
    audio.setMoment('breakthrough');
    void director?.fx('breakthrough', { success: show.success, realm: show.realm, ...(pinned !== null ? { since: pinned } : {}) });
    // a still waits for the frame that shows it
    settled(Promise.resolve());
    // the formation opens with the gathering, from the first moment
    // a sound the still did not play is none to stop
    const keep = (sound: SoundHandle | null) => void (sound && sounds.current.push(sound));
    if (pinned === null && formation) keep(audio.play('fx.formation'));
    const stops = [
      show.success ? at(BREAK.bell, () => keep(cue('fx.bell'))) : () => {},
      at(BREAK.thunder, () => {
        keep(cue('fx.thunder'));
        buzz();
      }),
      at(BREAK.out, () => calls.current.onLand()),
      at(BREAK.end, () => endRef.current(false)),
    ];
    layer.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      for (const stop of stops) stop();
    };
    // one show, one timetable: it starts once, whatever changes around it
  }, []);

  // Escape skips; no other key reaches the page behind
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        endRef.current(true);
      }
      if (event.key !== 'Enter' && event.key !== ' ') event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const look = breakthroughAt(t, level);
  const bar = (from: number): CSSProperties => ({ transform: `translateY(${((1 - look.bars) * from).toFixed(1)}%)` });
  return (
    <div ref={layer} className={styles.layer} role="dialog" aria-modal="true" aria-label={`突破 · ${words.title}`}>
      <i className={styles.barTop} style={bar(-100)} aria-hidden="true" />
      <i className={styles.barBottom} style={bar(100)} aria-hidden="true" />
      <div className={styles.card} data-failed={show.success ? undefined : ''}>
        <h2
          className={styles.title}
          style={{
            opacity: look.title.opacity,
            transform: `translateY(${look.title.y.toFixed(1)}px) scale(${look.title.scale.toFixed(3)})`,
            filter: look.title.blur > 0.05 ? `blur(${look.title.blur.toFixed(1)}px)` : undefined,
          }}
        >
          {words.title}
        </h2>
        <div className={styles.side} style={{ opacity: look.side }}>
          <span className={styles.sub}>{words.side}</span>
          <span className={styles.seal} style={{ opacity: look.seal.opacity, transform: `scale(${look.seal.scale.toFixed(3)})` }}>
            {words.seal}
          </span>
        </div>
      </div>
      <Btn className={styles.skip} onClick={() => end(true)} aria-label="跳过突破的演出">
        跳过
      </Btn>
    </div>
  );
}
