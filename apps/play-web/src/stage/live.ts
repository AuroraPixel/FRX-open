import * as THREE from 'three';
import type { Recipe } from '../contracts';
import { Timeline, approach } from './anim';
import { CameraRig } from './camera';
import { Clock } from './clock';
import { applyHours, makeShared, type Shared } from './env';
import { REST, Timetables, type FxControl, type FxKey } from './fx';
import { HeroArt, resolveSpec, type HeroLook } from './hero';
import { HOURS, HourState, type Rgb } from './hours';
import { Portraits, phoneLayout } from './portraits';
import { Post } from './post';
import { Resolution, makeRenderer } from './renderer';
import { Redraw } from './redraw';
import { loadScene } from './scene-loader';
import { halfSize, isPhone } from './sizes';
import { SWITCH, Transition } from './transition';
import {
  sceneIdOf, type FocusPreset, type FoeSpec, type FxName, type FxParams, type FxTiming, type Hour, type MotionLevel,
  type PortraitSlot, type Pose, type ProtagonistSpec, type SceneSettings, type SceneSpec, type Stage, type StageOptions,
  type VeilRect, type Weather,
} from './types';
import { World } from './world';

// How the weather leans on the light, and what falls: fog and exposure, rain or snow (a share of the particles),
// and how thick the mist lies over the floor. Changes ease in: the light at 1.1 per second, rain and snow at 0.6.
// `veil` is how much of the moon and the sun the weather hides.
const WEATHER: Record<Weather, { fog: number; exposure: number; rain: number; snow: number; thick: number; veil: number }> = {
  clear: { fog: 1, exposure: 1, rain: 0, snow: 0, thick: 0, veil: 0 },
  cloud: { fog: 1.15, exposure: 0.9, rain: 0, snow: 0, thick: 0.15, veil: 0.75 },
  mist: { fog: 1.8, exposure: 0.95, rain: 0, snow: 0, thick: 1, veil: 0.45 },
  rain: { fog: 1.5, exposure: 0.85, rain: 1, snow: 0, thick: 0.4, veil: 0.92 },
  snow: { fog: 1.4, exposure: 1, rain: 0, snow: 1, thick: 0.3, veil: 0.85 },
};
const PRECIPITATION_RATE = 0.6;

// The WebGL2 stage. One frame: advance the clock and the timetables, ease the light and the camera, draw the
// scene into a half-float buffer, soften it for a close-up, draw the portraits, then bloom and grade to the screen.
export class LiveStage implements Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assets: string;
  private readonly narrow: boolean;
  private readonly clock: Clock;
  private readonly shared: Shared = makeShared();
  private readonly post: Post;
  private readonly rig = new CameraRig();
  private readonly portraits: Portraits;
  private readonly heroArt: HeroArt;
  private readonly timeline = new Timeline<FxKey>({ ...REST });
  private readonly timetables = new Timetables(this.timeline);
  private readonly hours = new HourState(HOURS.night, HOURS.dawn);
  private readonly resolution: Resolution;
  private readonly onError: (error: Error) => void;
  private readonly onSlower: (steps: number) => void;
  private readonly lightDir = new THREE.Vector3();
  private readonly observer: ResizeObserver | null;
  private readonly transition = new Transition();
  // a still of a change shows it this many seconds in (deterministic mode only)
  private readonly transitionAt: number | null;
  private readonly systemReduced: boolean;
  private world: World | null = null;
  // a scene loaded for a still that stops before the swap
  private pending: World | null = null;
  private loading: Promise<void> | null = null;
  // which setScene call the shown world came from; a newer call means a switch is under way
  private sceneToken = 0;
  private worldToken = 0;
  private hour: Hour = 'night';
  private weather: Weather = 'clear';
  private fog = 1;
  private exposure = 1;
  private rain = 0;
  private snow = 0;
  private thick = 0;
  private veiled = 0;
  private soft = 0;
  private softTo = 0;
  private motionLevel: MotionLevel;
  private covered = false;
  // the protagonist: what the page asked for (null: nobody, as before the page's first call: a stranger in the painted
  // robe must not stand in for the player), what is drawn, and paintings on their way
  private heroWant: { sex: 'm' | 'f'; robe: Rgb | null; pose: Pose | null } | null = null;
  // what was last put on the stage: the request, whether it sat for cultivating, in which world
  private heroShown: { want: object | null; sit: boolean; world: World | null } | null = null;
  private heroAsked = '';
  private heroTicket = 0;
  private readonly heroWaiting = new Set<Promise<unknown>>();
  private width = 1;
  private height = 1;
  private bufferHeight = 1;
  private sized = false;
  private raf = 0;
  private last = 0;
  private frameWaiters: { frames: number; resolve: () => void }[] = [];
  private disposed = false;
  // the deterministic mode draws only when the picture may have changed (redraw.ts); calls still under way
  private readonly redraw = new Redraw();
  private inFlight = 0;
  // frames drawn so far (the lab's frame-rate check reads it)
  drawnFrames = 0;
  private readonly nightRain = new THREE.Color();
  private readonly litRain = new THREE.Color();
  private readonly key = new THREE.Color();

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.canvas = canvas;
    this.assets = opts.assets ?? '/play/assets/';
    this.onError = opts.onError ?? ((error) => console.error(error));
    this.onSlower = opts.onSlower ?? (() => undefined);
    this.systemReduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.motionLevel = opts.motion ?? 'full';
    this.clock = new Clock(opts.deterministic, this.systemReduced || this.motionLevel === 'off');
    this.transitionAt = opts.deterministic?.transitionAt ?? null;
    // the size of the pictures and the finest pixel ratio, by the canvas's size and the device's ratio (sizes.ts);
    // the picture quality setting decides instead when it is set: low the half-size pictures, high the full ones
    const cssWidth = canvas.clientWidth || innerWidth;
    const cssHeight = canvas.clientHeight || innerHeight;
    const phone = isPhone(cssWidth, cssHeight);
    const quality = opts.quality ?? 'auto';
    this.narrow =
      opts.narrow ?? (quality === 'low' ? true : quality === 'high' ? false : halfSize(cssWidth, cssHeight, devicePixelRatio));
    this.renderer = makeRenderer(canvas);
    this.post = new Post(this.renderer, this.shared);
    this.portraits = new Portraits(this.shared, `${this.assets}portrait-kit/manifest.json`, this.narrow ? 0.5 : 1);
    this.heroArt = new HeroArt(this.assets, this.narrow, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.resolution = new Resolution(devicePixelRatio, phone, this.clock.deterministic, quality);
    if (!this.clock.deterministic && !this.systemReduced && matchMedia('(pointer: fine)').matches) {
      addEventListener('pointermove', this.onPointer, { passive: true });
    }
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => (this.sized = false));
    this.observer?.observe(canvas);
    if (!this.observer) addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame(this.frame);
  }

  private get snap(): boolean {
    return this.clock.deterministic;
  }

  // reduced motion: from the system, or the settings at 'weak' or 'off'
  private get reduced(): boolean {
    return this.systemReduced || this.motionLevel !== 'full';
  }

  private readonly onPointer = (e: PointerEvent) => {
    if (this.reduced) return;
    this.rig.pointTo((e.clientX / Math.max(1, innerWidth)) * 2 - 1, (e.clientY / Math.max(1, innerHeight)) * 2 - 1);
  };

  private readonly onResize = () => {
    this.sized = false;
  };

  // ---------------------------------------------------------------- the actions

  setScene(scene: string | SceneSpec, settings: SceneSettings = {}): Promise<void> {
    const hour = settings.hour ?? this.hour;
    const weather = settings.weather ?? this.weather;
    if (this.world && this.world.desc.id === sceneIdOf(scene) && this.sceneToken === this.worldToken) {
      return this.track(this.changeLight(this.world, hour, weather));
    }
    const token = ++this.sceneToken;
    const work = this.track(this.switchTo(scene, hour, weather, token));
    this.loading = work;
    return work;
  }

  // A call whose work goes on after it returns: the deterministic mode draws while it does and once it is over.
  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight++;
    this.redraw.changed();
    return work.finally(() => {
      this.inFlight--;
      this.redraw.changed();
    });
  }

  // A change of scene (执行计划第 58 项): with motion the old scene darkens and the camera pushes in while the new one
  // loads, the new one is swapped in dark and comes up as the camera eases forward; with reduced motion the old
  // picture is kept and crossfaded into the new. The first scene simply appears; stills snap, unless the stage was
  // made to show changes `transitionAt` seconds in.
  private async switchTo(scene: string | SceneSpec, hour: Hour, weather: Weather, token: number): Promise<void> {
    const old = this.world;
    const still = this.snap && old && this.transitionAt !== null ? this.transitionAt : null;
    const smooth = !!old && !this.snap && !this.reduced;
    if (smooth) this.transition.out();
    let world: World | null = null;
    try {
      const desc = await loadScene(this.assets, scene, this.narrow);
      if (token !== this.sceneToken || this.disposed) return;
      const low = this.narrow || (!this.clock.deterministic && (navigator.hardwareConcurrency || 8) <= 4);
      const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      world = new World(desc, this.shared, this.timeline, (name) => this.clock.random(name), low, anisotropy, this.onError);
      const fitted = this.fitWeather(world, weather);
      world.sky.preload(hour, fitted);
      await Promise.all([world.textures.settled(), this.heroPaintingFor(world)]);
      world.sky.setHour(hour, fitted, true);
      if (smooth) await this.untilDark();
      if (token !== this.sceneToken || this.disposed) {
        world.dispose();
        return;
      }
      const crossfade = !!old && this.reduced && (!this.snap || still !== null);
      if (crossfade) this.post.snapshot();
      // a still of a darkening that has not reached the swap: the old scene stays on, darkening
      if (still !== null && !this.reduced && still < SWITCH.out) {
        this.pending?.dispose();
        this.pending = world;
        this.transition.out();
        this.transition.step(still);
        return;
      }
      this.pending?.dispose();
      this.pending = null;
      old?.dispose();
      this.world = world;
      this.worldToken = token;
      // which scene is up, for the page's checks (a composed place's id names the place)
      this.canvas.dataset.scene = desc.id;
      this.hour = hour;
      this.weather = fitted;
      this.rig.setCameras(desc.cameras, true);
      this.hours.target(hour, desc.looks, true);
      this.applyWeather(fitted, true);
      this.heroShown = null;
      this.heroTick(true);
      if (smooth) this.transition.in();
      else if (crossfade) {
        this.transition.crossfade();
        if (still !== null) this.transition.step(still);
      } else if (still !== null) {
        this.transition.in();
        this.transition.step(still - SWITCH.out);
      } else this.transition.finish();
    } catch (error) {
      world?.dispose();
      // a failed change brings the old scene back up
      if (smooth && token === this.sceneToken) this.transition.in(false);
      this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private untilDark(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.transition.dark || !this.transition.busy || this.disposed) resolve();
        else void this.afterFrames(1).then(check);
      };
      check();
    });
  }

  // A weather the scene does not have falls back to a clear sky, or to the scene's own first weather where it never
  // clears (the abyss).
  private fitWeather(world: World, weather: Weather): Weather {
    const allowed = world.desc.weather;
    if (allowed.includes(weather)) return weather;
    return allowed.includes('clear') ? 'clear' : (allowed[0] ?? 'clear');
  }

  private async changeLight(world: World, hour: Hour, weather: Weather): Promise<void> {
    const fitted = this.fitWeather(world, weather);
    world.sky.preload(hour, fitted);
    await world.textures.settled();
    if (this.world !== world) return;
    // a still of the change shows it transitionAt seconds in; otherwise stills snap and live it eases
    const still = this.snap ? this.transitionAt : null;
    const snap = this.snap && still === null;
    world.sky.setHour(hour, fitted, snap);
    this.hour = hour;
    this.weather = fitted;
    this.hours.target(hour, world.desc.looks, snap);
    this.applyWeather(fitted, snap);
    if (still !== null) {
      world.sky.advance(still);
      this.hours.step(still);
      this.easeWeather(still);
    }
  }

  private applyWeather(weather: Weather, snap: boolean): void {
    if (!snap) return;
    const w = WEATHER[weather];
    this.fog = w.fog;
    this.exposure = w.exposure;
    this.rain = w.rain;
    this.snow = w.snow;
    this.thick = w.thick;
    this.veiled = w.veil;
  }

  private easeWeather(dt: number): void {
    const w = WEATHER[this.weather];
    this.fog = approach(this.fog, w.fog, 1.1, dt);
    this.exposure = approach(this.exposure, w.exposure, 1.1, dt);
    this.rain = approach(this.rain, w.rain, PRECIPITATION_RATE, dt);
    this.snow = approach(this.snow, w.snow, PRECIPITATION_RATE, dt);
    this.thick = approach(this.thick, w.thick, 0.8, dt);
    this.veiled = approach(this.veiled, w.veil, 0.8, dt);
  }

  focus(preset: FocusPreset): void {
    this.redraw.changed();
    this.rig.focus(preset, this.snap);
    // the close-up's background goes soft (界面规范第六节)
    this.softTo = preset === 'close' ? 0.9 : 0;
    if (this.snap) this.soft = this.softTo;
  }

  portrait(slot: PortraitSlot, recipe: Recipe | null): Promise<void> {
    return this.track(this.portraits.set(slot, recipe, this.snap)).catch((error: unknown) => {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  veil(rect: VeilRect | null): void {
    this.redraw.changed();
    this.post.setVeil(rect, this.snap);
  }

  fx<N extends FxName>(name: N, params: FxParams[N] & FxTiming): Promise<void> {
    this.redraw.changed();
    const ctl: FxControl = { focus: (preset) => this.focus(preset), current: () => this.rig.preset };
    let done: Promise<void>;
    switch (name) {
      case 'cultivate':
        done = this.timetables.cultivate((params as FxParams['cultivate']).seconds, ctl);
        break;
      case 'breakthrough':
        done = this.timetables.breakthrough((params as FxParams['breakthrough']).success, ctl);
        break;
      case 'sword':
        done = this.timetables.swordLight();
        break;
      case 'check':
        done = this.timetables.check((params as FxParams['check']).outcome);
        break;
      case 'settle':
        this.timetables.settle();
        done = Promise.resolve();
        break;
      case 'reset':
        done = this.timetables.reset();
        break;
      case 'speaker':
        this.portraits.speak((params as FxParams['speaker']).slot);
        done = Promise.resolve();
        break;
      case 'strike': {
        const strike = params as FxParams['strike'];
        done = this.timetables.strike(strike.hit, strike.at ?? 'foe');
        break;
      }
      default:
        return Promise.reject(new Error(`stage: no effect ${String(name)}`));
    }
    // a still shows the effect t seconds in, or as many as the call says
    if (this.clock.deterministic) this.timeline.advance(params.since ?? this.clock.fixed);
    // cultivating sits the protagonist down
    this.heroTick(this.snap);
    return done;
  }

  still(amount: number): void {
    this.redraw.changed();
    this.rig.setStill(amount, this.snap);
  }

  async ready(): Promise<void> {
    for (;;) {
      const loading = this.loading;
      if (loading) await loading.catch(() => undefined);
      if (this.world) await this.world.textures.settled();
      await this.portraits.settled();
      while (this.heroWaiting.size) await Promise.allSettled([...this.heroWaiting]);
      if (loading === this.loading) break;
    }
    await this.afterFrames(2);
  }

  async protagonist(spec: ProtagonistSpec | null): Promise<void> {
    const ticket = ++this.heroTicket;
    this.redraw.changed();
    if (!spec) {
      this.heroWant = null;
      this.heroTick(this.snap);
      return;
    }
    const work = resolveSpec(spec, () => this.portraits.loadKit(), () => this.heroArt.robes());
    this.heroWaiting.add(work);
    try {
      const want = await work;
      if (ticket !== this.heroTicket || this.disposed) return;
      this.heroWant = want;
      if (this.world) await this.heroPaintingFor(this.world);
      if (ticket !== this.heroTicket || this.disposed) return;
      this.heroTick(this.snap);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.heroWaiting.delete(work);
    }
  }

  setCovered(covered: boolean): void {
    this.redraw.changed();
    this.covered = covered;
  }

  foe(spec: FoeSpec | null): Promise<void> {
    return this.track(this.portraits.setFoe(spec, this.snap)).catch((error: unknown) => {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  motion(level: MotionLevel): void {
    this.redraw.changed();
    this.motionLevel = level;
    this.clock.reduced = this.systemReduced || level === 'off';
    if (this.reduced) this.rig.pointTo(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('pointermove', this.onPointer);
    removeEventListener('resize', this.onResize);
    this.observer?.disconnect();
    this.timetables.dispose();
    this.world?.dispose();
    this.world = null;
    this.pending?.dispose();
    this.pending = null;
    this.portraits.dispose();
    this.heroArt.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    for (const waiter of this.frameWaiters) waiter.resolve();
    this.frameWaiters = [];
  }

  // ---------------------------------------------------------------- the protagonist

  private get cultivating(): boolean {
    const A = this.timeline.values;
    return A.ring > 0.01 || A.charge > 0.01;
  }

  // The look the protagonist should have in a world now: cultivating, it sits whatever it was doing.
  private heroLook(world: World): HeroLook | null {
    const want = this.heroWant;
    if (!want) return null;
    return { sex: want.sex, robe: want.robe, pose: this.cultivating ? 'sit' : (want.pose ?? world.desc.hero.pose) };
  }

  // Load the painting a world's protagonist needs now (the seated one is asked for when cultivating sits it down).
  private heroPaintingFor(world: World): Promise<unknown> {
    const look = this.heroLook(world);
    if (!look) return Promise.resolve();
    const work = this.heroArt.load(look.sex, look.pose).catch((error: unknown) =>
      this.onError(error instanceof Error ? error : new Error(String(error))),
    );
    this.heroWaiting.add(work);
    void work.finally(() => this.heroWaiting.delete(work));
    return work;
  }

  // Put the wanted look on the stage when the request, the cultivating or the world changed since it was drawn.
  private heroTick(snap: boolean): void {
    const world = this.world;
    if (!world) return;
    const sit = this.cultivating;
    const shown = this.heroShown;
    if (shown && shown.want === this.heroWant && shown.sit === sit && shown.world === world) return;
    const look = this.heroLook(world);
    const painting = look ? this.heroArt.get(look.sex, look.pose) : null;
    if (look && !painting) {
      // ask once; the next frames find it loaded
      const key = `${look.sex}-${look.pose}`;
      if (this.heroAsked !== key) {
        this.heroAsked = key;
        void this.heroPaintingFor(world);
      }
      return;
    }
    this.heroShown = { want: this.heroWant, sit, world };
    world.hero.show(look, painting, snap);
  }

  // ---------------------------------------------------------------- frames

  private afterFrames(frames: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.frameWaiters.push({ frames, resolve }));
  }

  private resize(): void {
    this.sized = true;
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(this.resolution.ratio);
    this.renderer.setSize(this.width, this.height, false);
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.resize(Math.round(buffer.x), Math.round(buffer.y));
    this.portraits.resize(this.width, this.height);
    this.rig.setAspect(this.width / this.height);
    this.shared.uPx.value = buffer.y / 900;
    this.bufferHeight = buffer.y;
  }

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden || this.disposed) {
      this.last = now;
      return;
    }
    // under a full-height panel: at most thirty frames a second
    if (this.covered && !this.snap && this.last && now - this.last < 1000 / 30 - 2) return;
    const raw = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    const snap = this.snap;
    const dt = snap ? 0 : Math.min(0.05, Math.max(0, raw));
    if (!this.sized) {
      this.resize();
      this.redraw.changed();
    }
    this.clock.advance(dt);
    this.timeline.step(dt);
    this.hours.step(dt, false);
    this.easeWeather(dt);
    this.transition.step(dt);
    this.soft = snap ? this.softTo : approach(this.soft, this.softTo, 2, dt);
    this.heroTick(snap);
    if (snap && !this.redraw.due(this.busy)) {
      this.tick();
      return;
    }
    const world = this.world;
    this.drawnFrames++;
    if (world) this.draw(world, dt, snap);
    else {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
    }
    if (!this.covered && this.resolution.frame(raw)) {
      this.resize();
      this.onSlower(this.resolution.drops);
    }
    this.tick();
  };

  // Something is still on its way to the picture, or someone waits for frames.
  private get busy(): boolean {
    return this.inFlight > 0 || this.heroWaiting.size > 0 || this.frameWaiters.length > 0 || !!this.world?.textures.busy;
  }

  private tick(): void {
    const due: (() => void)[] = [];
    this.frameWaiters = this.frameWaiters.filter((waiter) => {
      waiter.frames--;
      if (waiter.frames > 0) return true;
      due.push(waiter.resolve);
      return false;
    });
    for (const resolve of due) resolve();
  }

  private draw(world: World, dt: number, snap: boolean): void {
    const s = this.shared;
    const A = this.timeline.values;
    const time = this.clock.time;
    const desc = world.desc;
    applyHours(s, this.hours, this.fog, desc.floor?.kind === 'haze' ? desc.floor.tint : null);
    s.uTime.value = time;
    // additive flashes only brighten; a dimming flash is applied once, in the last pass
    s.uFlash.value = Math.max(0, A.flash);
    s.uAura.value = A.aura + Math.sin(time * 1.3) * 0.04;
    s.uCharge.value = A.charge;
    s.uGold.value = A.gold;
    s.uPillar.value = A.pillar;
    s.uBurst.value = A.burst;
    s.uBurstGain.value = A.burstGain;
    const ring = desc.formation ? A.ring : 0;
    s.uRing.value = ring;
    s.uThick.value = this.thick;
    s.uMoonDir.value.copy(world.sky.light.moonDir);
    s.uSunDir.value.copy(world.sky.light.sunDir);
    this.lightDir.copy(world.sky.light.moonDir).lerp(world.sky.light.sunDir, this.hours.day).normalize();
    s.uLightDir.value.copy(this.lightDir);

    const reduced = this.reduced;
    const sway = !snap && !reduced;
    this.rig.push = this.transition.push;
    this.rig.update(dt, time, sway, reduced ? 0 : A.shake, A.yaw, snap);
    const camera = this.rig.camera;
    const day = this.hours.day;
    const n = this.hours.night;
    const l = this.hours.lit;
    this.key.setRGB(n.key[0] + (l.key[0] - n.key[0]) * day, n.key[1] + (l.key[1] - n.key[1]) * day, n.key[2] + (l.key[2] - n.key[2]) * day);
    world.effects.update(time, camera, ring);
    world.sky.update(camera, time, dt, this.hours, this.rig.isTall, this.veiled);
    world.layers.update(camera, time);
    world.hero.update(dt, snap, camera, this.lightDir, this.bufferHeight);
    world.scenery.update(time, this.key, day, s.uFireLight.value, s.uFireAt.value);
    // rain and snow catch a little of the moonlight at night and the sky's light by day
    this.nightRain.setRGB(n.key[0] * 0.22 + 0.03, n.key[1] * 0.22 + 0.04, n.key[2] * 0.22 + 0.06);
    this.litRain.setRGB(l.horizon[0] * 0.42, l.horizon[1] * 0.42, l.horizon[2] * 0.42);
    world.precipitation.update(camera, { rain: this.rain, snow: this.snow }, this.nightRain, this.litRain, day, this.bufferHeight);
    // with a portrait standing, what falls nearer than it is drawn after it (below), the rest with the scene
    const front = world.precipitation.falling ? this.portraits.nearest(this.rig.preset, this.width, this.height, camera.fov) : 0;
    world.precipitation.behind(front);

    const r = this.renderer;
    r.setRenderTarget(this.post.scene);
    r.render(world.scene, camera);
    this.post.depthOfField(this.soft);
    const bufferScale = this.post.scene.width / this.width;
    const life = reduced ? 0 : 1;
    // a fight's opponent steps aside from a miss and reels from a hit; with reduced motion only half as far
    const foe = { shift: (A.dodge * 0.06 + A.reel * 0.024) * this.width * (reduced ? 0.5 : 1), fade: 1 - 0.2 * A.dodge };
    if (this.portraits.update(dt, snap, this.rig.preset, camera, this.lightDir, this.width, this.height, bufferScale, life, foe)) {
      r.autoClear = false;
      r.setRenderTarget(this.post.scene);
      r.render(this.portraits.scene, this.portraits.camera);
      r.autoClear = true;
    }
    if (front > 0) {
      // the rain and snow between the portraits and the camera, still behind the near paintings (the depth is kept)
      world.precipitation.front(front);
      r.autoClear = false;
      r.setRenderTarget(this.post.scene);
      r.render(world.precipitation.group, camera);
      r.autoClear = true;
    }
    this.post.finish(
      dt,
      snap,
      {
        exposure: this.hours.mix('exposure') * this.exposure,
        vignette: this.hours.mix('vignette'),
        ui: this.hours.ui,
        fade: this.transition.fade,
        flash: A.flash,
        cross: this.transition.cross,
        covered: this.covered,
      },
      this.width,
      this.height,
      phoneLayout(this.width, this.height),
    );
  }
}
