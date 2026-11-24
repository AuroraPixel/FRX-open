// The live sound engine. Browsers refuse sound until the player has clicked, tapped or pressed a
// key, so the audio context is only created on such a gesture; until then every call just records
// what should be playing. The engine also stops when the page is hidden and resumes when it returns.
import type { AmbienceName } from './ambience';
import { kitFor } from './kit';
import { createMixer, type Mixer } from './mixer';
import type { Mood } from './music';
import { CrossfadeSlot, LOOKAHEAD, Player } from './player';
import { seeded } from './random';
import type { SoundParams, SoundRegistry } from './registry';
import type { SfxName } from './sounds';
import { copyBuses, loadBuses, saveBuses, withChange, type BusName, type BusSetting, type BusSettings } from './settings';

/** Story moments that borrow a mood for a while, then hand back to the scene's own. */
export type Moment = 'combat' | 'breakthrough';
export const MOMENT_MOODS: Readonly<Record<Moment, Mood>> = { combat: 'tense', breakthrough: 'solemn' };

/** Seconds a change of ambience or music takes. */
export const CROSSFADE = 2;
/** The scheduler wakes this often (milliseconds) and books LOOKAHEAD seconds of notes ahead. */
export const WAKE_MS = 200;

export type AudioStatus = 'locked' | 'running' | 'suspended' | 'unsupported';

export interface SoundHandle {
  /** Fades the sound out; loops use their own release when no length is given. */
  stop(fade?: number): void;
}

const SILENT: SoundHandle = { stop: () => undefined };

// Events that count as a user gesture for autoplay in Chrome, Firefox and Safari (iOS wants touchend).
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

type ContextClass = new (options?: AudioContextOptions) => AudioContext;

function contextClass(): ContextClass | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: ContextClass };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Whether this event lets the page start sound. A swipe that scrolls fires the same events as a tap
 * but grants no activation, and starting sound then only fills the console with warnings. Browsers
 * without navigator.userActivation are trusted to ignore what does not count.
 */
function activated(): boolean {
  const scope = globalThis as typeof globalThis & { navigator?: { userActivation?: { isActive: boolean } } };
  return scope.navigator?.userActivation?.isActive ?? true;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private player: Player | null = null;
  private ambience: CrossfadeSlot | null = null;
  private music: CrossfadeSlot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private settings: BusSettings = loadBuses();
  private wantedAmbience: string | null = null;
  private sceneMood: Mood | null = null;
  private moment: Moment | null = null;
  private unsupported = false;
  private readonly listeners = new Set<(settings: BusSettings) => void>();
  private readonly warned = new Set<string>();

  constructor(readonly registry: SoundRegistry) {}

  status(): AudioStatus {
    if (this.unsupported) return 'unsupported';
    if (!this.ctx) return 'locked';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  /** Creates or resumes the audio context. Only works inside a user gesture's handler. */
  unlock(): void {
    const ctx = this.ctx ?? this.create();
    if (ctx && ctx.state !== 'running' && !pageHidden()) void ctx.resume().catch(() => undefined);
  }

  /**
   * Unlocks on the player's gestures. It keeps listening while the context is not running, which
   * also brings sound back after a phone call or another app took the audio away.
   */
  listenForGestures(target: EventTarget = window): () => void {
    const handler = (): void => {
      if (this.ctx?.state !== 'running' && activated()) this.unlock();
    };
    for (const type of GESTURES) target.addEventListener(type, handler, { capture: true, passive: true });
    return () => {
      for (const type of GESTURES) target.removeEventListener(type, handler, { capture: true });
    };
  }

  /** Plays a named sound now. Before the first gesture, or with the page hidden, nothing plays. */
  play(name: SfxName | (string & {}), params?: SoundParams): SoundHandle {
    const { ctx, player } = this;
    if (!ctx || !player || pageHidden()) return SILENT;
    const voice = player.start(name, params, ctx.currentTime);
    if (!voice) {
      this.warn(name);
      return SILENT;
    }
    this.wake();
    return { stop: (fade) => voice.fadeOut(ctx.currentTime, fade) };
  }

  /** The scene's ambience (a name such as "amb.wind"), or null for none; changes crossfade. */
  setAmbience(name: AmbienceName | (string & {}) | null): void {
    if (name !== null && !this.registry.has(name)) {
      this.warn(name);
      this.wantedAmbience = null;
    } else {
      this.wantedAmbience = name;
    }
    this.applyAmbience();
  }

  /** The scene's music mood, or null for no music. */
  setMood(mood: Mood | null): void {
    this.sceneMood = mood;
    this.applyMusic();
  }

  /** Combat and breakthrough borrow a mood until set back to null. */
  setMoment(moment: Moment | null): void {
    this.moment = moment;
    this.applyMusic();
  }

  /** The mood that should be playing now. */
  get mood(): Mood | null {
    return this.moment ? MOMENT_MOODS[this.moment] : this.sceneMood;
  }

  get ambienceName(): string | null {
    return this.wantedAmbience;
  }

  buses(): BusSettings {
    return copyBuses(this.settings);
  }

  setBus(name: BusName, change: Partial<BusSetting>): void {
    this.settings = withChange(this.settings, name, change);
    saveBuses(this.settings);
    this.mixer?.apply(this.settings);
    for (const listener of this.listeners) listener(this.buses());
  }

  onBusesChange(listener: (settings: BusSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Shuts the context down; the engine can be unlocked again afterwards. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.mixer = null;
    this.player = null;
    this.ambience = null;
    this.music = null;
  }

  private create(): AudioContext | null {
    const Context = contextClass();
    let ctx: AudioContext;
    try {
      if (!Context) throw new Error('no Web Audio');
      ctx = new Context({ latencyHint: 'interactive' });
    } catch {
      this.unsupported = true;
      return null;
    }
    this.ctx = ctx;
    this.mixer = createMixer(ctx, this.settings, kitFor(ctx).impulse);
    this.player = new Player(this.mixer, this.registry, seeded(Math.floor(Math.random() * 2 ** 32)));
    this.ambience = new CrossfadeSlot(this.player);
    this.music = new CrossfadeSlot(this.player);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.applyAmbience();
    this.applyMusic();
    return ctx;
  }

  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (pageHidden()) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };

  private applyAmbience(): void {
    if (!this.ctx || !this.ambience) return;
    this.ambience.switchTo(this.wantedAmbience, this.ctx.currentTime, CROSSFADE);
    this.wake();
  }

  private applyMusic(): void {
    if (!this.ctx || !this.music) return;
    const mood = this.mood;
    this.music.switchTo(mood ? `music.${mood}` : null, this.ctx.currentTime, CROSSFADE);
    this.wake();
  }

  /** Schedules what is due now and keeps the timer running while anything is playing. */
  private wake(): void {
    this.tick();
    if (!this.timer && this.player && this.player.live.size > 0) {
      this.timer = setInterval(() => this.tick(), WAKE_MS);
    }
  }

  private tick(): void {
    const { ctx, player } = this;
    if (!ctx || !player) return;
    player.pump(ctx.currentTime + LOOKAHEAD);
    player.sweep(ctx.currentTime);
    if (player.live.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private warn(name: string): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    console.warn(`[audio] no sound named "${name}"`);
  }
}
