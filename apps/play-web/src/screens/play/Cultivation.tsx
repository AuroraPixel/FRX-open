// Cultivation (plan item 59; spec 七 修炼与突破, 九 特效的时间表): the camera goes to the cultivator, the qi
// gathers for as long as the settlement says and the formation glows (fx.formation as it opens, where
// the scene has one), a low wind of qi sounds the whole time; at the end the receipt lands with its
// note. The page stays readable throughout.
import { useEffect, useRef } from 'react';
import { audio, type SoundHandle } from '../../audio';
import type { Director } from './director';
import { at, cue, showPin } from './showClock';
import { type CultivateShow, cultivateEnd } from './shows';

export interface CultivationProps {
  show: CultivateShow;
  director: Director | null;
  /** the scene shows the formation (scenes.hasFormation) */
  formation: boolean;
  settled: (work: Promise<unknown>) => void;
  onLand: () => void;
  onDone: () => void;
}

export function Cultivation({ show, director, formation, settled, onLand, onDone }: CultivationProps) {
  const calls = useRef({ onLand, onDone });
  calls.current = { onLand, onDone };

  useEffect(() => {
    const pinned = showPin();
    const seconds = cultivateEnd(show.seconds);
    void director?.fx('cultivate', { seconds: show.seconds, ...(pinned !== null ? { since: pinned } : {}) });
    settled(Promise.resolve());
    // the formation opens as the qi starts to gather
    const opened = pinned === null && formation ? audio.play('fx.formation') : null;
    let gather: SoundHandle | null = pinned === null ? audio.play('fx.gather') : null;
    const stop = at(seconds, () => {
      gather?.stop();
      gather = null;
      cue('ui.receipt');
      calls.current.onLand();
      calls.current.onDone();
    });
    return () => {
      stop();
      opened?.stop();
      gather?.stop();
    };
    // one show, one timetable: it starts once, whatever changes around it
  }, []);
  return null;
}
