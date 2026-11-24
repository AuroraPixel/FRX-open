import type { Recipe, SceneFile } from '../contracts';
import { PortraitKit } from '../kit/kit';
import { TALL_BELOW } from './camera';
import { phoneLayout, placeFoe, placePortrait } from './portraits';
import { loadScene } from './scene-loader';
import { halfSize } from './sizes';
import { drawStill } from './still';
import {
  sceneIdOf, type FocusPreset, type FoeSpec, type FxName, type FxParams, type Hour, type MotionLevel, type PortraitSlot,
  type ProtagonistSpec, type SceneSettings, type SceneSpec, type Stage, type StageOptions, type VeilRect,
} from './types';

// A scene without its stills (a new scene not yet rendered) shows its night-painted key picture with the hour as a
// filter instead.
const HOUR_FILTER: Record<Hour, string> = {
  night: 'none',
  dawn: 'sepia(0.4) saturate(0.85) brightness(1.2) hue-rotate(-12deg)',
  day: 'saturate(0.7) brightness(1.35) contrast(0.9)',
  dusk: 'sepia(0.55) saturate(1.25) brightness(1.05) hue-rotate(-24deg)',
};
const VEIL_NIGHT: [number, number, number] = [3, 6, 11];
const VEIL_DAY: [number, number, number] = [246, 236, 215];
// a change of scene or hour crossfades over this long; the close-up softens the picture behind the portrait
const FADE_MS = 700;
const CLOSE_BLUR = 10;

// What is shown: a picture and the filter it is drawn through.
interface Picture {
  image: HTMLImageElement | HTMLCanvasElement;
  filter: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`stage: missing picture ${url}`));
    img.src = url;
  });
}

// Without WebGL2 (执行计划第 70 项) the stage is a still of the scene at the hour, rendered beforehand from the same
// painted layers by the live stage itself from the reading camera (tools/stage-shots.mjs --set stills): a wide one
// (still-<hour>.webp, 1600 x 900, half/ at 800 x 450 for small screens) or a tall one for phones held upright
// (still-tall-<hour>.webp, 780 x 1688). A scene handed over whole (a place composed on the page) has no stills: it is
// drawn here in 2D from its own recipe, the reading camera's view of its cards (still.ts). The portraits are laid on top as plain pictures, a close-up softens the still
// behind them, the veil under the text is flat, and a change of scene or hour crossfades. Effects, the camera's moves
// and sway, the protagonist and the motion level do nothing; the page works the same.
export class FallbackStage implements Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly assets: string;
  private readonly narrow: boolean;
  private readonly onError: (error: Error) => void;
  private readonly observer: ResizeObserver | null;
  private readonly figures = new Map<PortraitSlot, HTMLCanvasElement>();
  // a fight's opponent: its picture, and its size next to a wolf (null: a person)
  private opponent: { figure: CanvasImageSource & { width: number; height: number }; beast: number | null } | null = null;
  private opponentTicket = 0;
  private readonly waiting = new Set<Promise<unknown>>();
  private kit: Promise<PortraitKit> | null = null;
  // the picture shown, the one it is crossfading from and when that began
  private picture: Picture | null = null;
  private previous: Picture | null = null;
  private fadeFrom = 0;
  private raf = 0;
  // whoever waits for the crossfade under way: every caller of ready() (the page asks after each piece of stage
  // work, so several wait through one crossfade)
  private fading: (() => void)[] = [];
  // which still is wanted (scene and hour), so a late load of an older one is dropped
  private asked = '';
  private hour: Hour = 'night';
  private preset: FocusPreset = 'idle';
  private veilRect: VeilRect | null = null;
  // screenshots: a change snaps, or with transitionAt is shown that many seconds into its crossfade
  private readonly snap: boolean;
  private readonly fixedAt: number | null;
  private fixed: number | null = null;

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.assets = opts.assets ?? '/play/assets/';
    this.narrow = opts.narrow ?? halfSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, devicePixelRatio);
    this.onError = opts.onError ?? ((error) => console.error(error));
    this.snap = !!opts.deterministic;
    this.fixedAt = opts.deterministic?.transitionAt ?? null;
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.paint());
    this.observer?.observe(canvas);
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.waiting.add(work);
    const done = () => this.waiting.delete(work);
    work.then(done, done);
    return work;
  }

  private report(error: unknown): void {
    this.onError(error instanceof Error ? error : new Error(String(error)));
  }

  async setScene(scene: string | SceneSpec, settings: SceneSettings = {}): Promise<void> {
    const hour = settings.hour ?? this.hour;
    const wanted = `${sceneIdOf(scene)}/${hour}`;
    if (wanted === this.asked) return;
    this.asked = wanted;
    this.hour = hour;
    const work = (async () => {
      const picture = typeof scene === 'string' ? await this.load(scene, hour) : await this.compose(scene, hour);
      if (this.asked !== wanted) return;
      this.show(picture);
      this.canvas.dataset.scene = sceneIdOf(scene);
    })();
    await this.track(work).catch((error: unknown) => {
      // a later call for the same scene and hour tries again
      if (this.asked === wanted) this.asked = '';
      this.report(error);
    });
  }

  // The scene's still at the hour, of the shape and size the canvas wants; its key picture filtered for the hour when
  // it has no stills.
  private async load(id: string, hour: Hour): Promise<Picture> {
    const folder = `${this.assets}scenes/${encodeURIComponent(id)}/`;
    const W = Math.max(1, this.canvas.clientWidth || innerWidth);
    const H = Math.max(1, this.canvas.clientHeight || innerHeight);
    const still = W / H < TALL_BELOW ? `still-tall-${hour}.webp` : `${this.narrow ? 'half/' : ''}still-${hour}.webp`;
    try {
      return { image: await loadImage(folder + still), filter: 'none' };
    } catch {
      const response = await fetch(`${folder}scene.json`);
      if (!response.ok) throw new Error(`stage: ${folder}scene.json ${response.status}`);
      const scene = (await response.json()) as SceneFile;
      return { image: await loadImage(`${folder}${this.narrow ? 'half/' : ''}${scene.key}`), filter: HOUR_FILTER[hour] };
    }
  }

  // A scene handed over whole, drawn in 2D at the canvas's shape (at most 1600 pixels across).
  private async compose(spec: SceneSpec, hour: Hour): Promise<Picture> {
    const desc = await loadScene(this.assets, spec, this.narrow);
    const W = Math.max(1, this.canvas.clientWidth || innerWidth);
    const H = Math.max(1, this.canvas.clientHeight || innerHeight);
    const k = Math.min(1, 1600 / Math.max(W, H));
    const image = await drawStill(desc, {
      hour, width: Math.round(W * k), height: Math.round(H * k), tall: W / H < TALL_BELOW, filter: HOUR_FILTER[hour], load: loadImage,
    });
    return { image, filter: 'none' };
  }

  // Show a picture, crossfading from the one before (a crossfade is not a movement: reduced motion keeps it), unless
  // there was none or a screenshot snaps.
  private show(picture: Picture): void {
    const before = this.picture;
    this.picture = picture;
    this.fixed = before && this.fixedAt !== null ? Math.min(1, (this.fixedAt * 1000) / FADE_MS) : null;
    this.previous = before && (!this.snap || this.fixed !== null) ? before : null;
    this.fadeFrom = performance.now();
    if (this.previous && this.fixed === null) this.animate();
    this.paint();
  }

  // How far the crossfade has gone (1: none, or over; the picture before is then let go).
  private progress(): number {
    const t = this.previous ? (this.fixed ?? Math.min(1, (performance.now() - this.fadeFrom) / FADE_MS)) : 1;
    if (this.previous && t >= 1) this.previous = null;
    return t;
  }

  private animate(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.progress();
      this.paint();
      if (this.previous) this.raf = requestAnimationFrame(tick);
      else this.faded();
    };
    this.raf = requestAnimationFrame(tick);
  }

  focus(preset: FocusPreset): void {
    this.preset = preset;
    this.paint();
  }

  async portrait(slot: PortraitSlot, recipe: Recipe | null): Promise<void> {
    if (!recipe) {
      this.figures.delete(slot);
      this.paint();
      return;
    }
    const work = (async () => {
      this.kit ??= PortraitKit.load(`${this.assets}portrait-kit/manifest.json`);
      const kit = await this.kit;
      this.figures.set(slot, await kit.compose(recipe, this.narrow ? 0.5 : 1));
      this.paint();
    })();
    await this.track(work).catch((error: unknown) => this.report(error));
  }

  veil(rect: VeilRect | null): void {
    this.veilRect = rect;
    this.paint();
  }

  fx<N extends FxName>(_name: N, _params: FxParams[N]): Promise<void> {
    return Promise.resolve();
  }

  still(_amount: number): void {}

  // the stills have no protagonist to show or hide, and nothing moves to slow down
  protagonist(_spec: ProtagonistSpec | null): Promise<void> {
    return Promise.resolve();
  }

  setCovered(_covered: boolean): void {}

  async foe(spec: FoeSpec | null): Promise<void> {
    const ticket = ++this.opponentTicket;
    if (!spec || (!spec.recipe && !spec.picture)) {
      this.opponent = null;
      this.paint();
      return;
    }
    const work = (async () => {
      if (spec.picture) {
        const figure = await loadImage(spec.picture);
        if (ticket === this.opponentTicket) this.opponent = { figure, beast: Math.min(1.8, Math.max(0.5, spec.size ?? 1)) };
      } else if (spec.recipe) {
        this.kit ??= PortraitKit.load(`${this.assets}portrait-kit/manifest.json`);
        const figure = await (await this.kit).compose(spec.recipe, this.narrow ? 0.5 : 1);
        if (ticket === this.opponentTicket) this.opponent = { figure, beast: null };
      }
      this.paint();
    })();
    await this.track(work).catch((error: unknown) => this.report(error));
  }

  motion(_level: MotionLevel): void {}

  async ready(): Promise<void> {
    while (this.waiting.size) await Promise.allSettled([...this.waiting]);
    // and any crossfade under way
    if (this.previous && this.fixed === null) await new Promise<void>((resolve) => this.fading.push(resolve));
  }

  // The crossfade is over (or the stage is gone): everyone waiting for it goes on.
  private faded(): void {
    for (const resolve of this.fading.splice(0)) resolve();
  }

  dispose(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.raf);
    this.faded();
    this.figures.clear();
    this.opponent = null;
    this.picture = null;
    this.previous = null;
  }

  private paint(): void {
    const g = this.g;
    if (!g) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, this.canvas.clientWidth);
    const H = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(W * ratio) || this.canvas.height !== Math.round(H * ratio)) {
      this.canvas.width = Math.round(W * ratio);
      this.canvas.height = Math.round(H * ratio);
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = '#04070d';
    g.fillRect(0, 0, W, H);
    // the crossfade: the picture before underneath, the new one coming up over it
    const t = this.progress();
    if (this.previous) this.cover(g, this.previous, W, H, 1);
    if (this.picture) this.cover(g, this.picture, W, H, this.previous ? t * t * (3 - 2 * t) : 1);
    for (const [slot, figure] of this.figures) {
      if (this.preset === 'close' && slot !== 'main') continue;
      const p = placePortrait(slot, this.preset, W, H);
      const w = p.h * (figure.width / figure.height);
      const top = H - p.bottom - p.h;
      const faded = this.footFade(figure, p.foot);
      g.drawImage(faded, p.cx - w / 2, top, w, p.h);
    }
    if (this.opponent && this.preset !== 'close') {
      const { figure, beast } = this.opponent;
      const p = placeFoe(beast, this.preset, W, H);
      const w = p.h * (figure.width / figure.height);
      g.drawImage(this.footFade(figure, p.foot), p.cx - w / 2, H - p.bottom - p.h, w, p.h);
    }
    if (this.veilRect) this.paintVeil(g, this.veilRect, W, H);
  }

  // A picture covering the canvas (centred, cropped to fill), softened behind a close-up.
  private cover(g: CanvasRenderingContext2D, picture: Picture, W: number, H: number, alpha: number): void {
    const { image } = picture;
    const k = Math.max(W / image.width, H / image.height);
    const w = image.width * k;
    const h = image.height * k;
    const close = this.preset === 'close';
    g.save();
    g.globalAlpha = alpha;
    const filters = [picture.filter === 'none' ? '' : picture.filter, close ? `blur(${CLOSE_BLUR}px) brightness(0.85)` : ''];
    g.filter = filters.filter(Boolean).join(' ') || 'none';
    // softened, it is drawn a little larger so the blur leaves no edge
    const grow = close ? CLOSE_BLUR * 2 : 0;
    g.drawImage(image, (W - w) / 2 - grow, (H - h) / 2 - grow, w + grow * 2, h + grow * 2);
    g.restore();
  }

  // the portrait's foot fades out
  private footFade(figure: CanvasImageSource & { width: number; height: number }, foot: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = figure.width;
    c.height = figure.height;
    const g = c.getContext('2d');
    if (!g) return c;
    g.drawImage(figure, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, c.height * (1 - foot), 0, c.height);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // A flat veil with feathered edges wherever an edge of it lies on screen.
  private paintVeil(g: CanvasRenderingContext2D, r: VeilRect, W: number, H: number): void {
    const phone = phoneLayout(W, H);
    const feather = r.feather ?? (phone ? 90 : 150);
    const day = this.hour === 'dawn' || this.hour === 'day';
    const amount = r.amount ?? (phone ? (day ? 0.74 : 0.76) : 0.7);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const v = c.getContext('2d');
    if (!v) return;
    const [r0, g0, b0] = day ? VEIL_DAY : VEIL_NIGHT;
    v.fillStyle = `rgb(${r0}, ${g0}, ${b0})`;
    v.fillRect(r.x - feather, r.y - feather, r.w + feather * 2, r.h + feather * 2);
    v.globalCompositeOperation = 'destination-in';
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const ramp = v.createLinearGradient(x0, y0, x1, y1);
      ramp.addColorStop(0, 'rgba(0,0,0,1)');
      ramp.addColorStop(1, 'rgba(0,0,0,0)');
      v.fillStyle = ramp;
      v.fillRect(0, 0, W, H);
    };
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    if (r.x > 0) edge(r.x + feather * 0.4, 0, r.x - feather, 0);
    if (right < W) edge(right - feather * 0.4, 0, right + feather, 0);
    if (r.y > 0) edge(0, r.y + feather * 0.4, 0, r.y - feather);
    if (bottom < H) edge(0, bottom - feather * 0.4, 0, bottom + feather);
    g.globalAlpha = amount;
    g.drawImage(c, 0, 0, W, H);
    g.globalAlpha = 1;
  }
}
