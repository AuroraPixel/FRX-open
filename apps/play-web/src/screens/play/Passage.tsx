// A journey's passage (plan item 58; 演出: 换地点时旧场景暗下去、新场景亮起来): while the stage darkens the
// old scene and loads the new one, the page goes to ink and the player's own words for the journey
// rise in it, then the place's name in brush, with the hour and the weather under it. It gives way
// to the page once the scene is ready or the loading allowance expires. Weak motion keeps plain fades.
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { weatherWords } from '../../lib/weather';
import { showPin, useShowTime } from './showClock';
import { PASSAGE, type ShowLevel, type TravelShow, passageAt } from './shows';
import styles from './Shows.module.css';

const SCENE_WAIT_SECONDS = 8;

export interface PassageProps {
  show: TravelShow;
  level: ShowLevel;
  /** the stage has drawn the new scene */
  sceneUp: boolean;
  onDone: () => void;
}

export function Passage({ show, level, sceneUp, onDone }: PassageProps) {
  const t = useShowTime();
  const p = level === 'full' ? PASSAGE.full : PASSAGE.weak;
  // when it began to go; a still never ends, it shows the passage as it stands at the pinned moment
  const [leaving, setLeaving] = useState<number | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (showPin() !== null) return;
    if (leaving === null && t >= p.hold && (sceneUp || t >= SCENE_WAIT_SECONDS)) setLeaving(t);
    if (leaving !== null && t >= leaving + p.out) done.current();
  }, [t, sceneUp, leaving, p]);

  // a still takes the new scene to be up by the time the passage may go
  const pinned = showPin() !== null;
  const look = passageAt(t, level, pinned ? (t >= p.hold ? p.hold : null) : leaving);
  const name = show.scene.place.split('·').pop()?.trim() || show.scene.place;
  const rise = (opacity: number): CSSProperties => ({ opacity, transform: `translateY(${look.rise.toFixed(1)}px)` });
  return (
    <div
      className={styles.passage}
      style={{ '--ink': look.veil.toFixed(3) } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={`赶路 · ${name}`}
    >
      {show.line && (
        <p className={styles.journey} style={{ opacity: look.line }}>
          {show.line}
        </p>
      )}
      <h2 className={styles.placeName} style={rise(look.name)}>
        {name}
      </h2>
      <p className={styles.where} style={rise(look.name)}>
        {[show.scene.place, show.scene.hourName, weatherWords(show.scene.weather)].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}
