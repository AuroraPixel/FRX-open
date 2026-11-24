// The clock of a performance, and how fully performances play. Live, a show's time runs from when
// it started; for screenshots (a pinned clock, ?t=) every show stands still `?at=` seconds in, and
// the stage is asked to show its effects at the same moment (FxTiming.since).
import { useEffect, useRef, useState } from 'react';
import { audio, type SoundHandle } from '../../audio';
import { pins, readParams } from '../../lib/params';
import { showLevel, useSettingsStore } from '../../store/settings';
import { useMedia } from '../../ui/useMedia';
import type { ShowLevel } from './shows';

let pinnedAt: number | null | undefined;

/** Seconds into every show when the page's clock is pinned and the address says ?at=; otherwise null. */
export function showPin(): number | null {
  if (pinnedAt === undefined) {
    const at = Number(readParams(globalThis.location?.href ?? 'http://local/').get('at'));
    pinnedAt = pins().t !== undefined && Number.isFinite(at) && at >= 0 ? at : null;
  }
  return pinnedAt;
}

/**
 * A performance's sound, when it runs live: a show standing still (?at=, a screenshot) plays none, not even
 * of what it has passed by its moment, which `at` acts at once (the documents pass, #21: a paused shot still
 * rang its bell, its thunder, its seals and its swords).
 */
export function cue(name: Parameters<typeof audio.play>[0]): SoundHandle | null {
  return showPin() === null ? audio.play(name) : null;
}

/** Tests pin shows without touching the address. */
export function setShowPinForTest(at: number | null | undefined): void {
  pinnedAt = at;
}

/** A short buzz with a seal or a breakthrough, where the phone allows it and the player wants it. */
export function buzz(): void {
  if (!useSettingsStore.getState().haptics) return;
  if (typeof navigator.vibrate !== 'function' || typeof matchMedia !== 'function') return;
  if (matchMedia('(pointer: coarse)').matches) navigator.vibrate(10);
}

/**
 * True once `ready` has held for two frames: a page that becomes busy again within the same moment
 * (a performance asking the stage for its first frame) never looks ready to the screenshot tool.
 */
export function useSteady(ready: boolean): boolean {
  const [steady, setSteady] = useState(false);
  useEffect(() => {
    if (!ready) {
      setSteady(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSteady(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready && steady;
}

/**
 * How fully performances play now: the setting, the system's reduced motion making full weak. A page
 * with a pinned clock and no ?at= plays none: its picture is the turn as it stands once all is over.
 */
export function useShowLevel(): ShowLevel {
  const motion = useSettingsStore((s) => s.motion);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  if (pins().t !== undefined && showPin() === null) return 'off';
  return showLevel(motion, reduced);
}

/**
 * Seconds since the show started, re-rendering every frame while `running`; with a pinned clock the
 * pinned moment, which never moves.
 */
export function useShowTime(running = true): number {
  const at = showPin();
  const start = useRef<number | null>(null);
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (at !== null || !running) return;
    start.current ??= performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setTime((now - (start.current ?? now)) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [at, running]);
  return at ?? time;
}

/**
 * Runs `act` once `seconds` into the show: live after that long, pinned at once when the pinned
 * moment is past it. Returns a canceller.
 */
export function at(seconds: number, act: () => void): () => void {
  const pinned = showPin();
  if (pinned !== null) {
    if (pinned >= seconds) act();
    return () => {};
  }
  const timer = setTimeout(act, Math.max(0, seconds * 1000));
  return () => clearTimeout(timer);
}
