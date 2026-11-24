// The play screen's hold on the stage: it turns what the page wants shown (a scene at an hour, a
// camera, the veil under the book, who stands where and who speaks, an effect) into the stage's six
// calls, and only calls when something changed, so the page may say the same thing every render.
import type { Recipe } from '../../contracts';
import type {
  FocusPreset, FoeSpec, FxName, FxParams, FxTiming, Hour, PortraitSlot, SceneSpec, Stage, VeilRect, Weather,
} from '../../stage';

/** The stage calls the director makes; the real stage and the tests' stand-in both have them. */
export type StageCalls = Pick<Stage, 'setScene' | 'focus' | 'portrait' | 'veil' | 'fx' | 'still' | 'ready' | 'dispose'>;

/**
 * Calls the stage line adds (the protagonist's back view, the covered picture, the motion level): made
 * when the stage has them, so the page needs no change when they arrive.
 */
interface LaterCalls {
  protagonist?: (spec: { recipe?: Recipe } | null) => Promise<void>;
  setCovered?: (covered: boolean) => void;
  motion?: (level: 'full' | 'weak' | 'off') => void;
  foe?: (spec: FoeSpec | null) => Promise<void>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Director {
  private scene: { id: string; hour: Hour; weather: Weather } | null = null;
  private preset: FocusPreset | null = null;
  private veilRect: VeilRect | null | undefined = undefined;
  private readonly standing: Record<PortraitSlot, Recipe | null> = { main: null, side: null };
  private speaker: PortraitSlot | null = null;
  private stillness: number | null = null;
  private player: Recipe | null = null;
  private covered: boolean | null = null;
  private level: 'full' | 'weak' | 'off' | null = null;
  private opponent: FoeSpec | null = null;
  // the last change of scene asked for: the next one waits until it is shown
  private changing: Promise<void> = Promise.resolve();

  constructor(private readonly stage: StageCalls) {}

  private get later(): LaterCalls {
    return this.stage as StageCalls & LaterCalls;
  }

  /**
   * Changes the scene, by id or handed over whole (a composed place); a change asked for while the
   * last one is still loading waits for it, so the stage always has a scene to change from (a
   * journey's first turn arrives as the save opens).
   */
  setScene(scene: string | SceneSpec, hour: Hour, weather: Weather): Promise<void> {
    const next = { id: typeof scene === 'string' ? scene : scene.file.id, hour, weather };
    if (same(next, this.scene)) return this.changing;
    this.scene = next;
    this.changing = this.changing.then(() => this.stage.setScene(scene, { hour, weather }).catch(() => undefined));
    return this.changing;
  }

  focus(preset: FocusPreset): void {
    if (preset === this.preset) return;
    this.preset = preset;
    this.stage.focus(preset);
  }

  /** Sends the camera back to the page's preset after an effect that moved it was cut short. */
  refocus(): void {
    if (this.preset) this.stage.focus(this.preset);
  }

  still(amount: number): void {
    if (amount === this.stillness) return;
    this.stillness = amount;
    this.stage.still(amount);
  }

  veil(rect: VeilRect | null): void {
    if (this.veilRect !== undefined && same(rect, this.veilRect)) return;
    this.veilRect = rect;
    this.stage.veil(rect);
  }

  /** Who stands in a place; null takes them off. */
  stand(slot: PortraitSlot, recipe: Recipe | null): Promise<void> {
    if (same(recipe, this.standing[slot])) return Promise.resolve();
    this.standing[slot] = recipe;
    return this.stage.portrait(slot, recipe);
  }

  /** The one speaking is a little brighter; the other dims a fifth. */
  speak(slot: PortraitSlot): void {
    if (slot === this.speaker) return;
    this.speaker = slot;
    void this.stage.fx('speaker', { slot });
  }

  /** The player's back view in the scene, dressed and sexed after their portrait; null takes it away. */
  protagonist(recipe: Recipe | null): void {
    if (same(recipe, this.player)) return;
    this.player = recipe;
    void this.later.protagonist?.(recipe ? { recipe } : null)?.catch(() => undefined);
  }

  /** A full-height panel covers the picture: the stage may draw less often. */
  cover(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    this.later.setCovered?.(covered);
  }

  /** The motion level of the settings. */
  motion(level: 'full' | 'weak' | 'off'): void {
    if (level === this.level) return;
    this.level = level;
    this.later.motion?.(level);
  }

  fx<N extends FxName>(name: N, params: FxParams[N] & FxTiming): Promise<void> {
    return this.stage.fx(name, params).catch(() => undefined);
  }

  /** A fight's opponent on the stage, or none. */
  foe(spec: FoeSpec | null): Promise<void> {
    if (same(spec, this.opponent)) return Promise.resolve();
    this.opponent = spec;
    return this.later.foe?.(spec)?.catch(() => undefined) ?? Promise.resolve();
  }

  ready(): Promise<void> {
    return this.stage.ready();
  }

  dispose(): void {
    this.stage.dispose();
  }
}
