import * as THREE from 'three';
import type { Recipe } from '../contracts';
import { PortraitKit } from '../kit/kit';
import { approach } from './anim';
import type { Shared } from './env';
import { PORTRAIT_FS, PORTRAIT_VS } from './shaders/post.glsl';
import type { FocusPreset, FoeSpec, PortraitSlot } from './types';

// Where a portrait stands, in CSS pixels: centre x, the height of its foot above the bottom edge (negative: below
// the edge), its height, and how much of it fades into the mist at the foot. From 界面规范第六节 and 第十一节.
export interface Placement {
  cx: number;
  bottom: number;
  h: number;
  foot: number;
}

const PHONE_BELOW = 760;
// a phone on its side (wider than 13 : 10) takes the desktop's compact layout (界面规范第四节、第十一节)
const PHONE_ASPECT = 1.3;

/** The phone's own layout: narrower than 760 px and held upright, as the page's PHONE query. */
export function phoneLayout(width: number, height: number): boolean {
  return width < PHONE_BELOW && width <= height * PHONE_ASPECT;
}
// how much brighter the one speaking is when two stand on the stage
const SPEAKER_LIFT = 0.06;
const NARROW_BELOW = 1100;
// On a phone the book's top edge rests at 41% of the height and the portrait's feet are hidden 150 px below it.
const PHONE_BOOK_TOP = 0.41;

// The close-up's foot sits higher than the spec's 52-60% below the edge: those numbers were measured on the
// prototype's own pictures, which had less headroom than the kit's template; -45% puts the head where the
// prototype's close-up still has it (top of the head at about 16% of the height).
export function placePortrait(slot: PortraitSlot, preset: FocusPreset, width: number, height: number): Placement {
  const phone = phoneLayout(width, height);
  if (preset === 'close') {
    return phone
      ? { cx: width * 0.5, bottom: -height * 0.22, h: height * 1.1, foot: 0.1 }
      : { cx: width * 0.69, bottom: -height * 0.45, h: height * 1.5, foot: 0.1 };
  }
  if (phone) {
    const bottom = height - height * PHONE_BOOK_TOP - 150;
    return slot === 'main'
      ? { cx: width * 0.7, bottom, h: 400, foot: 0.26 }
      : { cx: width * 0.36, bottom, h: 360, foot: 0.26 };
  }
  const main = width < NARROW_BELOW
    ? { cx: width * 0.8, bottom: -height * 0.12, h: height * 0.86, foot: 0.22 }
    : { cx: width * 0.85, bottom: -height * 0.15, h: height * 0.965, foot: 0.22 };
  return slot === 'main' ? main : { ...main, cx: main.cx - width * 0.23, h: main.h * 0.9 };
}

// A fight's opponent: a person stands where the one speaking would; a beast's picture stands lower and further in,
// as big as its kind is next to a wolf (the bestiary's size, 0.5 to 1.8), its feet just in sight. On a phone it
// stands on the book's top edge, under the status bar.
export function placeFoe(beast: number | null, preset: FocusPreset, width: number, height: number): Placement {
  if (beast === null) return placePortrait('main', preset, width, height);
  const grow = 0.75 + 0.25 * beast;
  if (phoneLayout(width, height)) return { cx: width * 0.6, bottom: height * (1 - PHONE_BOOK_TOP) + 6, h: 170 * grow, foot: 0.14 };
  const narrow = width < NARROW_BELOW;
  return { cx: width * (narrow ? 0.73 : 0.75), bottom: height * 0.05, h: height * (narrow ? 0.4 : 0.46) * grow, foot: 0.14 };
}

// How the opponent moves this frame: across in px (a step aside, a recoil, a lunge) and how faint it is.
export interface FoeMotion {
  shift: number;
  fade: number;
}

// How far from the camera a portrait seems to stand, in world units: a person as tall as the protagonist's standing
// picture (3.1 units) filling the placement's height h (of a view `height` high) under a vertical field of view.
const PERSON = 3.1;
export function portraitDepth(h: number, height: number, fov: number): number {
  return (PERSON * height) / (Math.max(1, h) * 2 * Math.tan((fov * Math.PI) / 360));
}

// Dark clothes take more light and a softer rim (gain 1.35, rim 0.8), light ones less (1.0, 1.0); a recipe may say.
// The kit's bodies run from 0.16 (a black robe) to 0.66 (a moon-white one) in mean luminance.
export function lightingFor(luminance: number): { gain: number; rim: number } {
  const k = Math.min(1, Math.max(0, (luminance - 0.2) / (0.5 - 0.2)));
  return { gain: 1.35 + (1.0 - 1.35) * k, rim: 0.8 + (1.0 - 0.8) * k };
}

// mean luminance of the opaque pixels of a picture, in display (sRGB) terms
function meanLuminance(picture: CanvasImageSource, w: number, h: number): number {
  const small = document.createElement('canvas');
  small.width = 48;
  small.height = Math.max(1, Math.round((48 * h) / w));
  const g = small.getContext('2d', { willReadFrequently: true });
  if (!g) return 0.3;
  g.drawImage(picture, 0, 0, small.width, small.height);
  const d = g.getImageData(0, 0, small.width, small.height).data;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    sum += ((0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255) * a;
    weight += a;
  }
  return weight > 0 ? sum / weight : 0.3;
}

// where a figure stands: one of the two portrait places, or the opponent's
type Place = PortraitSlot | 'foe';

function loadPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`stage: missing picture ${url}`));
    image.src = url;
  });
}

interface Figure {
  slot: Place;
  key: string;
  texture: THREE.CanvasTexture | null;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  aspect: number;
  tw: number;
  th: number;
  // the figure's own bottom on the canvas, as a fraction of its height (children end above the bottom edge)
  floor: number;
  display: number;
  gain: number;
  rim: number;
  alpha: number;
  alphaTo: number;
  dim: number;
  // a beast's size next to a wolf; null for a person
  beast: number | null;
}

// Portraits are drawn into the scene buffer after the scene (and after its soft copy for depth of field), before
// the bloom and the grade, placed in screen pixels by an orthographic camera.
export class Portraits {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly slots = new Map<Place, Figure>();
  // figures replaced in their slot, fading out
  private leaving: Figure[] = [];
  // the latest request per slot; an older composition that finishes late is dropped
  private readonly asked = new Map<Place, number>();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly shared: Shared;
  private readonly kitUrl: string;
  private readonly scale: number;
  private kit: Promise<PortraitKit> | null = null;
  private speaker: PortraitSlot = 'main';
  private readonly waiting = new Set<Promise<unknown>>();
  private readonly light = new THREE.Vector3();
  private seeds = 0;

  constructor(shared: Shared, kitUrl: string, scale: number) {
    this.shared = shared;
    this.kitUrl = kitUrl;
    this.scale = scale;
  }

  loadKit(): Promise<PortraitKit> {
    if (!this.kit) {
      this.kit = PortraitKit.load(this.kitUrl);
      this.kit.catch(() => (this.kit = null));
    }
    return this.kit;
  }

  async set(slot: PortraitSlot, recipe: Recipe | null, snap: boolean): Promise<void> {
    const ticket = (this.asked.get(slot) ?? 0) + 1;
    this.asked.set(slot, ticket);
    const current = this.slots.get(slot);
    if (!recipe) {
      if (current) current.alphaTo = 0;
      return;
    }
    const key = JSON.stringify(recipe);
    if (current && current.key === key) {
      current.alphaTo = 1;
      if (snap) current.alpha = 1;
      return;
    }
    const work = this.compose(recipe);
    this.waiting.add(work);
    try {
      const made = await work;
      if (this.asked.get(slot) !== ticket) return;
      const figure = this.figure(slot, key, made, snap);
      figure.alphaTo = 1;
      if (snap) figure.alpha = 1;
    } finally {
      this.waiting.delete(work);
    }
  }

  // The opponent of a fight: composed from a recipe like the portraits, or a beast's picture as it is.
  async setFoe(spec: FoeSpec | null, snap: boolean): Promise<void> {
    const ticket = (this.asked.get('foe') ?? 0) + 1;
    this.asked.set('foe', ticket);
    const current = this.slots.get('foe');
    if (!spec || (!spec.recipe && !spec.picture)) {
      if (current) {
        current.alphaTo = 0;
        if (snap) current.alpha = 0;
      }
      return;
    }
    const beast = spec.picture ? Math.min(1.8, Math.max(0.5, spec.size ?? 1)) : null;
    const key = spec.picture ? `picture:${spec.picture}:${beast}` : JSON.stringify(spec.recipe);
    if (current && current.key === key) {
      current.alphaTo = 1;
      if (snap) current.alpha = 1;
      return;
    }
    const work = spec.picture ? this.picture(spec.picture) : this.compose(spec.recipe!);
    this.waiting.add(work);
    try {
      const made = await work;
      if (this.asked.get('foe') !== ticket) return;
      const figure = this.figure('foe', key, made, snap);
      figure.beast = beast;
      figure.alphaTo = 1;
      if (snap) figure.alpha = 1;
    } finally {
      this.waiting.delete(work);
    }
  }

  private async picture(url: string) {
    const image = await loadPicture(url);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    const lighting = lightingFor(meanLuminance(image, image.naturalWidth, image.naturalHeight));
    return { canvas, floor: 1, display: 1, gain: lighting.gain, rim: lighting.rim };
  }

  private async compose(recipe: Recipe) {
    const kit = await this.loadKit();
    const canvas = await kit.compose(recipe, this.scale);
    const base = kit.base(recipe.base);
    const body = kit.part(recipe.base, 'bodies', recipe.body);
    let lighting = { gain: 1, rim: 1 };
    if (recipe.gain === undefined || recipe.rim === undefined) {
      lighting = lightingFor(meanLuminance(await kit.image(body.file), body.w, body.h));
    }
    return {
      canvas,
      floor: Math.min(1, base.geometry.bottom / kit.manifest.size[1]),
      display: base.display || 1,
      gain: recipe.gain ?? lighting.gain,
      rim: recipe.rim ?? lighting.rim,
    };
  }

  private figure(slot: Place, key: string, made: Awaited<ReturnType<Portraits['compose']>>, snap: boolean): Figure {
    const old = this.slots.get(slot);
    if (old) {
      // the old figure fades out while the new one fades in in its place
      old.alphaTo = 0;
      if (snap) old.alpha = 0;
      this.leaving.push(old);
    }
    const texture = new THREE.CanvasTexture(made.canvas);
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const s = this.shared;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        tMap: { value: texture },
        uTexel: { value: new THREE.Vector2(0.001, 0.001) },
        uL: { value: new THREE.Vector2(-0.6, 0.8) },
        uA: { value: 0 },
        uFoot: { value: 0.3 },
        uFlip: { value: 0 },
        uGain: { value: made.gain },
        uRim: { value: made.rim },
        uDim: { value: 1 },
        uTime: s.uTime,
        uLife: { value: 0 },
        uSeed: { value: (this.seeds++ * 2.39) % 6.28 },
        uPxUv: { value: new THREE.Vector2(0.001, 0.001) },
        uDay: s.uDay,
        uFlash: s.uFlash,
        uKeyNight: s.uKeyNight,
        uKeyLit: s.uKeyLit,
        uAmbLit: s.uAmbLit,
        uFootLit: s.uFootLit,
      },
      vertexShader: PORTRAIT_VS,
      fragmentShader: PORTRAIT_FS,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    // the second person stands a step behind the one speaking; an opponent stands in front of both
    mesh.renderOrder = slot === 'foe' ? 2 : slot === 'main' ? 1 : 0;
    this.scene.add(mesh);
    const figure: Figure = {
      slot, key, texture, material, mesh, aspect: made.canvas.width / made.canvas.height, tw: made.canvas.width,
      th: made.canvas.height, floor: made.floor, display: made.display, gain: made.gain, rim: made.rim,
      alpha: 0, alphaTo: 1, dim: slot === this.speaker || slot === 'foe' ? 1 : 0.8, beast: null,
    };
    this.slots.set(slot, figure);
    return figure;
  }

  speak(slot: PortraitSlot): void {
    this.speaker = slot;
  }

  // How far from the camera the nearest portrait on the stage stands (as last drawn, at least a third faded in), or
  // 0 when none does: rain and snow nearer than that fall in front of it.
  nearest(preset: FocusPreset, width: number, height: number, fov: number): number {
    if (preset === 'cine1' || preset === 'cine2') return 0;
    let best = 0;
    for (const f of [...this.slots.values(), ...this.leaving]) {
      if (!f.mesh.visible || f.alpha < 0.3 || (preset === 'close' && f.slot !== 'main')) continue;
      const place = f.slot === 'foe' ? placeFoe(f.beast, preset, width, height) : placePortrait(f.slot, preset, width, height);
      const depth = portraitDepth(place.h * f.display, height, fov);
      if (!best || depth < best) best = depth;
    }
    return best;
  }

  async settled(): Promise<void> {
    while (this.waiting.size) await Promise.allSettled([...this.waiting]);
  }

  resize(width: number, height: number): void {
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  // Place and light every portrait for this frame; returns whether any is visible. `life` (0..1) is how much they
  // breathe and stir: none with reduced motion. `foe` moves a fight's opponent.
  update(
    dt: number, snap: boolean, preset: FocusPreset, sceneCamera: THREE.Camera, lightDir: THREE.Vector3, width: number,
    height: number, bufferScale: number, life = 0, foe: FoeMotion = { shift: 0, fade: 1 },
  ): boolean {
    // the light comes from wherever the moon or the sun sits on screen
    const l = this.light.copy(sceneCamera.position).addScaledVector(lightDir, 1000).project(sceneCamera);
    const lx = (l.x * 0.5 + 0.5) * width;
    const ly = (l.y * 0.5 + 0.5) * height;
    const onScreen = l.z < 1;
    // nobody stands beside the close-up, and the breakthrough's shots are the cultivator's alone
    const hidden = preset === 'cine1' || preset === 'cine2';
    // with two on stage the one speaking is a little brighter still (执行计划第 62 项)
    let shown = 0;
    for (const f of this.slots.values()) if (f.slot !== 'foe' && f.alphaTo > 0 && f.alpha > 0.5) shown++;
    const lift = shown > 1 ? SPEAKER_LIFT : 0;
    let any = false;
    for (const f of [...this.slots.values(), ...this.leaving]) {
      const slot = f.slot;
      const target = hidden || (preset === 'close' && slot !== 'main') ? 0 : f.alphaTo;
      f.alpha = snap ? target : approach(f.alpha, target, 3, dt);
      const dimTo = slot === 'foe' ? 1 : slot === this.speaker ? 1 + lift : 0.8;
      f.dim = snap ? dimTo : approach(f.dim, dimTo, 3, dt);
      f.mesh.visible = f.alpha > 0.004;
      if (!f.mesh.visible) continue;
      any = true;
      const p = slot === 'foe' ? placeFoe(f.beast, preset, width, height) : placePortrait(slot, preset, width, height);
      if (slot === 'foe') p.cx += foe.shift;
      const h = p.h * f.display;
      const w = h * f.aspect;
      // children's figures end above the canvas's bottom edge; stand the figure, not the canvas, on the placement
      const bottom = p.bottom - h * (1 - f.floor);
      const u = f.material.uniforms;
      const mag = Math.max(1, (h * bufferScale) / f.th);
      (u.uTexel!.value as THREE.Vector2).set(1 / f.tw / mag, 1 / f.th / mag);
      f.mesh.scale.set(w, h, 1);
      f.mesh.position.set(p.cx, bottom + h / 2, 0);
      const cy = bottom + h * 0.62;
      const dx = onScreen ? lx - p.cx : -0.6;
      const dy = onScreen ? ly - cy : 0.8;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      (u.uL!.value as THREE.Vector2).set(dx / dl, dy / dl);
      u.uA!.value = slot === 'foe' ? f.alpha * foe.fade : f.alpha;
      u.uFoot!.value = 1 - f.floor + p.foot * f.floor;
      u.uDim!.value = f.dim;
      u.uLife!.value = life;
      (u.uPxUv!.value as THREE.Vector2).set(1 / Math.max(1, w * bufferScale), 1 / Math.max(1, h * bufferScale));
    }
    this.sweep();
    return any;
  }

  // drop the figures that have finished fading out of a slot they were replaced in
  private sweep(): void {
    const gone = this.leaving.filter((f) => f.alpha <= 0.004);
    if (!gone.length) return;
    this.leaving = this.leaving.filter((f) => f.alpha > 0.004);
    for (const f of gone) this.release(f);
  }

  private release(f: Figure): void {
    this.scene.remove(f.mesh);
    f.material.dispose();
    f.texture?.dispose();
  }

  dispose(): void {
    for (const f of [...this.slots.values(), ...this.leaving]) this.release(f);
    this.slots.clear();
    this.leaving = [];
    this.geometry.dispose();
  }
}
