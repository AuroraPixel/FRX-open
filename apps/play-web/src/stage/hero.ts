import * as THREE from 'three';
import type { Recipe } from '../contracts';
import type { PortraitKit } from '../kit/kit';
import { approach } from './anim';
import type { Shared } from './env';
import type { Rgb } from './hours';
import { depthTwin } from './layers';
import { lightingFor } from './portraits';
import type { SceneDesc } from './scene-loader';
import { UV_VS } from './shaders/common.glsl';
import { CAST_FS, CONTACT_FS, HERO_FS, HERO_VS } from './shaders/hero.glsl';
import type { Pose, ProtagonistSpec } from './types';

// The protagonist's back view (执行计划第 39 项): one of four paintings in assets/protagonist/ (man or woman, seated on
// a cushion or standing), stood on the scene's player anchor, turned to the camera and lit like the painted layers.
// The robe is painted a middling blue-grey; the shader recolours it to the protagonist's own clothes.

interface PoseArt {
  file: string;
  w: number;
  h: number;
  // the row of the picture the figure stands on (the cushion's foot, the soles)
  ground: number;
}

interface Manifest {
  half: string;
  poses: Record<'m' | 'f', Record<Pose, PoseArt>>;
  // the main colour (sRGB 0..1) of every body picture of the portrait kit, by its file, measured as mainColour does
  // (stage-shots.mjs --set robes): the robe is coloured without downloading the body
  robes?: Record<string, [number, number, number]>;
}

// World height from the ground line to the top of the picture: seated like 观云台's old painted figure, standing as
// tall as a seated figure would stand up.
export const HERO_HEIGHT: Record<Pose, number> = { sit: 1.76, stand: 3.1 };
const WOMAN = 0.96;

// What the stage needs to draw one back view.
export interface HeroLook {
  sex: 'm' | 'f';
  pose: Pose;
  // the robe's colour in linear light, or null for the painted blue-grey
  robe: Rgb | null;
}

interface Painting {
  art: PoseArt;
  texture: THREE.Texture;
  // mean linear colour of the painted robe, measured once it has loaded
  robeMean: Rgb;
}

const LUM: Rgb = [0.2126, 0.7152, 0.0722];
const lin = (v: number) => Math.pow(v, 2.2);

// The shader's robe mask, in JavaScript: the painted cloth is blue-grey (blue over red) and not black.
function robeWeight(r: number, g: number, b: number): number {
  const l = r * LUM[0] + g * LUM[1] + b * LUM[2];
  const s = (x: number, a: number, z: number) => Math.min(1, Math.max(0, (x - a) / (z - a)));
  return s(b - r, 0.012, 0.045) * s(l, 0.03, 0.08);
}

function measureRobe(image: CanvasImageSource & { width: number; height: number }): Rgb {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = Math.max(1, Math.round((64 * image.height) / image.width));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return [0.15, 0.17, 0.24];
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const sum: Rgb = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 250) continue;
    const r = lin(d[i]! / 255);
    const gg = lin(d[i + 1]! / 255);
    const b = lin(d[i + 2]! / 255);
    const w = robeWeight(r, gg, b);
    sum[0] += r * w;
    sum[1] += gg * w;
    sum[2] += b * w;
    weight += w;
  }
  return weight > 0 ? [sum[0] / weight, sum[1] / weight, sum[2] / weight] : [0.15, 0.17, 0.24];
}

// The main colour of a picture of clothes, in sRGB 0..1: the most common hue and saturation among its opaque,
// not-too-dark pixels, averaged. Hands and trims are too small to win.
export function mainColour(image: CanvasImageSource & { width: number; height: number }): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = Math.max(1, Math.round((64 * image.height) / image.width));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return [0.45, 0.5, 0.6];
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 200) continue;
    const r = d[i]! / 255;
    const gg = d[i + 1]! / 255;
    const b = d[i + 2]! / 255;
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    if (max < 0.08) continue;
    const sat = max > 0 ? (max - min) / max : 0;
    let hue = 0;
    if (max > min) {
      if (max === r) hue = ((gg - b) / (max - min) + 6) % 6;
      else if (max === gg) hue = (b - r) / (max - min) + 2;
      else hue = (r - gg) / (max - min) + 4;
    }
    // greys share one bin whatever their hue
    const key = sat < 0.12 ? -1 : Math.floor(hue * 2) * 3 + Math.min(2, Math.floor(sat * 3));
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += gg;
    bin.b += b;
    bins.set(key, bin);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [0.45, 0.5, 0.6];
}

export function parseColour(value: string | [number, number, number]): Rgb | null {
  if (Array.isArray(value)) return value.length === 3 && value.every(Number.isFinite) ? [value[0], value[1], value[2]] : null;
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// The paintings, loaded once for the life of the stage and shared by every scene's back view.
export class HeroArt {
  private readonly root: string;
  private readonly narrow: boolean;
  private readonly anisotropy: number;
  private manifest: Promise<Manifest> | null = null;
  private readonly paintings = new Map<string, Promise<Painting>>();
  private readonly ready = new Map<string, Painting>();
  private readonly loader = new THREE.TextureLoader();

  constructor(assets: string, narrow: boolean, anisotropy: number) {
    this.root = `${assets}protagonist/`;
    this.narrow = narrow;
    this.anisotropy = anisotropy;
  }

  private loadManifest(): Promise<Manifest> {
    if (!this.manifest) {
      this.manifest = fetch(`${this.root}protagonist.json`).then(async (response) => {
        if (!response.ok) throw new Error(`stage: ${this.root}protagonist.json ${response.status}`);
        return (await response.json()) as Manifest;
      });
      this.manifest.catch(() => (this.manifest = null));
    }
    return this.manifest;
  }

  // The table of the kit's body colours (empty when the manifest has none or cannot be read).
  async robes(): Promise<Record<string, [number, number, number]>> {
    try {
      return (await this.loadManifest()).robes ?? {};
    } catch {
      return {};
    }
  }

  // A painting that has loaded, or null.
  get(sex: 'm' | 'f', pose: Pose): Painting | null {
    return this.ready.get(`${sex}-${pose}`) ?? null;
  }

  load(sex: 'm' | 'f', pose: Pose): Promise<Painting> {
    const key = `${sex}-${pose}`;
    let work = this.paintings.get(key);
    if (!work) {
      work = this.loadManifest().then(
        (manifest) =>
          new Promise<Painting>((resolve, reject) => {
            const art = manifest.poses[sex][pose];
            const url = `${this.root}${this.narrow ? manifest.half : ''}${art.file}`;
            const texture = this.loader.load(
              url,
              (loaded) => {
                const painting = { art, texture: loaded, robeMean: measureRobe(loaded.image as HTMLImageElement) };
                this.ready.set(key, painting);
                resolve(painting);
              },
              undefined,
              () => reject(new Error(`stage: missing picture ${url}`)),
            );
            texture.premultiplyAlpha = true;
            texture.generateMipmaps = true;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = this.anisotropy;
          }),
      );
      work.catch(() => this.paintings.delete(key));
      this.paintings.set(key, work);
    }
    return work;
  }

  dispose(): void {
    for (const painting of this.ready.values()) painting.texture.dispose();
    this.ready.clear();
    this.paintings.clear();
  }
}

// What a spec asks for, settled: the sex, the robe's linear colour and the light the robe takes. The robe's colour
// comes from the table of body colours when the body is in it, else from the body's picture.
export async function resolveSpec(
  spec: ProtagonistSpec,
  kit: () => Promise<PortraitKit>,
  robes: () => Promise<Record<string, [number, number, number]>> = async () => ({}),
): Promise<{ sex: 'm' | 'f'; robe: Rgb | null; pose: Pose | null }> {
  let sex = spec.sex ?? null;
  let robe = spec.robe !== undefined ? parseColour(spec.robe) : null;
  if (spec.recipe && (!sex || !robe)) {
    const k = await kit();
    const recipe: Recipe = spec.recipe;
    sex ??= k.base(recipe.base).sex;
    if (!robe) {
      const body = k.part(recipe.base, 'bodies', recipe.body);
      robe = (await robes())[body.file] ?? mainColour(await k.image(body.file));
    }
  }
  return { sex: sex ?? 'm', robe: robe ? [lin(robe[0]), lin(robe[1]), lin(robe[2])] : null, pose: spec.pose ?? null };
}

interface Figure {
  key: string;
  painting: Painting;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  shadowMat: THREE.ShaderMaterial;
  // the shadow a standing figure casts on a haze at its feet, away from the light (null: none)
  cast: THREE.Mesh | null;
  castMat: THREE.ShaderMaterial | null;
  twinMat: THREE.Material;
  alpha: number;
  alphaTo: number;
  height: number;
}

// One scene's back view: the figure standing on the anchor, and the one it replaces fading out.
export class Hero {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  private readonly ground = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // flat on the ground from its near edge at the origin out along -z (turned each frame to point away from the light)
  private readonly reach = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  private readonly shared: Shared;
  private readonly anchor: THREE.Vector3;
  private readonly scale: number;
  private readonly order: number;
  // whether the scene's ground haze lies at the protagonist's feet (a street, a courtyard), so a standing figure's
  // shadow falls on it
  private readonly onHaze: boolean;
  private figures: Figure[] = [];
  private readonly light = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();

  constructor(desc: SceneDesc, shared: Shared) {
    this.shared = shared;
    this.anchor = new THREE.Vector3(...desc.anchors.player);
    this.scale = desc.hero.scale;
    this.order = desc.hero.order;
    this.onHaze = desc.floor?.kind === 'haze' && this.anchor.y - desc.floor.y < 0.5;
  }

  // Show a look (null: nobody). A different painting fades in over the old one; the same one only recolours.
  show(look: HeroLook | null, painting: Painting | null, snap: boolean): void {
    const key = look ? `${look.sex}-${look.pose}` : '';
    const current = this.figures.find((f) => f.alphaTo > 0);
    if (current && current.key === key && look) {
      this.colour(current, look, painting ?? current.painting);
      return;
    }
    for (const f of this.figures) {
      f.alphaTo = 0;
      if (snap) f.alpha = 0;
    }
    if (!look || !painting) return;
    const figure = this.figures.find((f) => f.key === key) ?? this.make(key, look, painting);
    this.colour(figure, look, painting);
    figure.alphaTo = 1;
    if (snap) figure.alpha = 1;
  }

  private make(key: string, look: HeroLook, painting: Painting): Figure {
    const s = this.shared;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      uniforms: {
        ...s,
        tMap: { value: painting.texture },
        uRobe: { value: new THREE.Vector3(1, 1, 1) },
        uGainH: { value: 1 },
        uRimH: { value: 1 },
        uL: { value: new THREE.Vector2(0, 1) },
        uPxUv: { value: new THREE.Vector2(0.002, 0.002) },
        uA: { value: 0 },
        uFoot: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: HERO_VS,
      fragmentShader: HERO_FS,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = this.order;
    mesh.visible = false;
    // its depth, so rain and snow behind it are hidden (it goes with the figure, and fades with it)
    const twin = depthTwin(this.geometry, {
      tMap: material.uniforms.tMap!, uFade: material.uniforms.uA!, uUv: { value: new THREE.Vector4(0, 0, 1, 1) },
      uSink: { value: new THREE.Vector2(-1000, -999) }, uEdge: { value: 0.0001 },
    });
    mesh.add(twin);
    this.group.add(mesh);
    const height = HERO_HEIGHT[look.pose] * this.scale * (look.sex === 'f' ? WOMAN : 1);
    const art = painting.art;
    mesh.scale.set((height * art.w) / art.h, height, 1);
    // the ground line on the anchor
    mesh.position.copy(this.anchor);
    mesh.position.y -= ((art.h - art.ground) / art.h) * height;
    // the shadow it casts on the ground: an ellipse a little wider than a seated figure's cushion or a standing one's
    // feet, drawn just before it
    const shadowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uA: { value: 0 } }, vertexShader: UV_VS, fragmentShader: CONTACT_FS,
    });
    const shadow = new THREE.Mesh(this.ground, shadowMat);
    const across = look.pose === 'sit' ? mesh.scale.x * 1.15 : mesh.scale.x * 0.9;
    shadow.scale.set(across, 1, across * 0.55);
    shadow.position.copy(this.anchor);
    shadow.position.y += 0.005;
    shadow.renderOrder = this.order - 5e-6;
    shadow.frustumCulled = false;
    shadow.visible = false;
    this.group.add(shadow);
    let cast: THREE.Mesh | null = null;
    let castMat: THREE.ShaderMaterial | null = null;
    if (this.onHaze && look.pose === 'stand') {
      castMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { uA: { value: 0 } }, vertexShader: UV_VS, fragmentShader: CAST_FS,
      });
      cast = new THREE.Mesh(this.reach, castMat);
      cast.scale.set(mesh.scale.x * 1.3, 1, height * 1.1);
      cast.position.copy(shadow.position);
      cast.renderOrder = this.order - 6e-6;
      cast.frustumCulled = false;
      cast.visible = false;
      this.group.add(cast);
    }
    const figure: Figure = {
      key, painting, material, mesh, shadow, shadowMat, cast, castMat, twinMat: twin.material as THREE.Material, alpha: 0,
      alphaTo: 0, height,
    };
    // a standing figure's feet go into the ground's mist a little; a seated one sits on rock or a cushion
    (material.uniforms.uFoot!.value as THREE.Vector3).set(this.anchor.y - 0.15, look.pose === 'stand' ? 0.9 : 0.25, look.pose === 'stand' ? 0.55 : 0.2);
    this.figures.push(figure);
    return figure;
  }

  private colour(figure: Figure, look: HeroLook, painting: Painting): void {
    const u = figure.material.uniforms;
    const mean = painting.robeMean;
    const robe = look.robe;
    (u.uRobe!.value as THREE.Vector3).set(
      robe ? Math.min(6, robe[0] / Math.max(0.01, mean[0])) : 1,
      robe ? Math.min(6, robe[1] / Math.max(0.01, mean[1])) : 1,
      robe ? Math.min(6, robe[2] / Math.max(0.01, mean[2])) : 1,
    );
    // dark clothes take more light and a softer rim, as the portraits do
    const target = robe ?? mean;
    const l = Math.pow(target[0] * LUM[0] + target[1] * LUM[1] + target[2] * LUM[2], 1 / 2.2);
    const lighting = lightingFor(l);
    u.uGainH!.value = lighting.gain;
    u.uRimH!.value = lighting.rim;
  }

  update(dt: number, snap: boolean, camera: THREE.Camera, lightDir: THREE.Vector3, bufferHeight: number): void {
    const l = this.light.copy(camera.position).addScaledVector(lightDir, 1000).project(camera);
    for (const f of this.figures) {
      f.alpha = snap ? f.alphaTo : approach(f.alpha, f.alphaTo, 3, dt);
      f.mesh.visible = f.alpha > 0.004;
      f.shadow.visible = f.mesh.visible;
      if (f.cast && f.castMat) {
        f.cast.visible = f.mesh.visible;
        // away from the moon or the sun along the ground
        f.cast.rotation.y = Math.atan2(lightDir.x, lightDir.z);
        f.castMat.uniforms.uA!.value = f.alpha;
      }
      if (!f.mesh.visible) continue;
      f.shadowMat.uniforms.uA!.value = f.alpha;
      const m = f.mesh;
      m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
      // the figure on screen: its foot and top, for the light's direction and the rim's pixel steps
      const foot = this.foot.copy(m.position).project(camera);
      const top = this.top.copy(m.position).setY(m.position.y + f.height).project(camera);
      const hPx = Math.max(8, Math.abs(top.y - foot.y) * 0.5 * bufferHeight);
      const wPx = hPx * (m.scale.x / m.scale.y);
      const u = f.material.uniforms;
      (u.uPxUv!.value as THREE.Vector2).set(1 / wPx, 1 / hPx);
      const cx = (foot.x + top.x) * 0.5;
      const cy = foot.y + (top.y - foot.y) * 0.62;
      const onScreen = l.z < 1;
      // screen x is the same way round as the card's u, screen y as its v
      const dx = onScreen ? l.x - cx : -0.6;
      const dy = onScreen ? (l.y - cy) * (camera instanceof THREE.PerspectiveCamera ? 1 / camera.aspect : 1) : 0.8;
      const dl = Math.hypot(dx, dy) || 1;
      (u.uL!.value as THREE.Vector2).set(dx / dl, dy / dl);
      u.uA!.value = f.alpha;
    }
    // forget figures that have faded out (their painting stays with the stage for a quick return)
    if (this.figures.some((f) => f.alphaTo === 0 && f.alpha <= 0.004)) {
      const gone = this.figures.filter((f) => f.alphaTo === 0 && f.alpha <= 0.004);
      this.figures = this.figures.filter((f) => !gone.includes(f));
      for (const f of gone) {
        this.group.remove(f.mesh, f.shadow);
        if (f.cast) this.group.remove(f.cast);
        f.material.dispose();
        f.shadowMat.dispose();
        f.castMat?.dispose();
        f.twinMat.dispose();
      }
    }
  }

  dispose(): void {
    for (const f of this.figures) {
      f.material.dispose();
      f.shadowMat.dispose();
      f.castMat?.dispose();
      f.twinMat.dispose();
    }
    this.figures = [];
    this.geometry.dispose();
    this.ground.dispose();
    this.reach.dispose();
  }
}
