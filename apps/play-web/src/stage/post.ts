import * as THREE from 'three';
import { approach } from './anim';
import type { Shared } from './env';
import { BLUR_FS, BRIGHT_FS, COPY_FS, FINAL_FS, POST_VS } from './shaders/post.glsl';
import type { VeilRect } from './types';

// The veil's colours: night pushes the picture under the text towards ink, day towards paper (界面规范第九节).
const VEIL_NIGHT = new THREE.Color(0.012, 0.022, 0.045);
const VEIL_DAY = new THREE.Color(0.965, 0.925, 0.845);

interface Veil {
  rect: VeilRect;
  a: number;
  to: number;
}

// Bloom, depth of field, the veil and the final grade. The scene is drawn into a half-float target (8-bit where
// float targets are missing, with a lower bloom threshold), without antialiasing. For a crossfade between scenes the
// last finished picture is kept (snapshot) and laid over the new one.
export class Post {
  readonly hdr: boolean;
  scene!: THREE.WebGLRenderTarget;
  private prev!: THREE.WebGLRenderTarget;
  private a!: THREE.WebGLRenderTarget;
  private b!: THREE.WebGLRenderTarget;
  private c!: THREE.WebGLRenderTarget;
  private d!: THREE.WebGLRenderTarget;
  private e!: THREE.WebGLRenderTarget;
  private f!: THREE.WebGLRenderTarget;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly bright: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  readonly final: THREE.ShaderMaterial;
  private readonly veilState: Veil = { rect: { x: 0, y: 0, w: 1, h: 1 }, a: 0, to: 0 };
  private width = 1;

  constructor(renderer: THREE.WebGLRenderer, shared: Shared) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, transparent = false) =>
      new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, transparent, uniforms, vertexShader: POST_VS, fragmentShader });
    this.bright = pass(BRIGHT_FS, { tDiffuse: { value: null }, uCut: { value: this.hdr ? 0.85 : 0.7 } });
    this.blur = pass(BLUR_FS, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.copy = pass(COPY_FS, { tDiffuse: { value: null }, uA: { value: 1 } }, true);
    this.final = pass(FINAL_FS, {
      tScene: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, tSoft: { value: null },
      uTime: shared.uTime, uDay: shared.uDay, uFlash: { value: 0 }, uExposure: { value: 1.7 }, uVignette: { value: 0.6 },
      uFade: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uVeil: { value: new THREE.Vector4(0, 0, 1, 1) },
      uVeilFeather: { value: 60 }, uVeilAmt: { value: 0 }, uVeilBlur: { value: 0 }, uVeilCol: { value: new THREE.Color() },
      tPrev: { value: null }, uCross: { value: 0 },
    });
  }

  private target(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      stencilBuffer: false,
    });
  }

  // width and height are the drawing buffer's, in device pixels
  resize(width: number, height: number): void {
    for (const t of [this.scene, this.a, this.b, this.c, this.d, this.e, this.f, this.prev]) t?.dispose();
    this.width = width;
    this.scene = this.target(width, height, true);
    this.prev = new THREE.WebGLRenderTarget(Math.max(2, width), Math.max(2, height), { depthBuffer: false, stencilBuffer: false });
    this.final.uniforms.tPrev!.value = this.prev.texture;
    this.a = this.target(width >> 1, height >> 1);
    this.b = this.target(width >> 1, height >> 1);
    this.c = this.target(width >> 2, height >> 2);
    this.d = this.target(width >> 2, height >> 2);
    this.e = this.target(width >> 2, height >> 2);
    this.f = this.target(width >> 2, height >> 2);
    (this.final.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  // A wide, soft copy of the scene buffer at a quarter size, left in f: four blur rounds of growing step.
  private soften(): void {
    let src = this.scene;
    for (const step of [1.2, 2.2, 3.4, 4.6]) {
      this.blur.uniforms.tDiffuse!.value = src.texture;
      (this.blur.uniforms.uDir!.value as THREE.Vector2).set(step / this.e.width, 0);
      this.pass(this.blur, this.e);
      this.blur.uniforms.tDiffuse!.value = this.e.texture;
      (this.blur.uniforms.uDir!.value as THREE.Vector2).set(0, step / this.e.height);
      this.pass(this.blur, this.f);
      src = this.f;
    }
  }

  // Depth of field for close-ups: the scene goes soft before the portraits are drawn, so they stay sharp.
  depthOfField(amount: number): void {
    if (amount <= 0.002) return;
    this.soften();
    this.copy.uniforms.tDiffuse!.value = this.f.texture;
    this.copy.uniforms.uA!.value = amount;
    this.renderer.autoClear = false;
    this.pass(this.copy, this.scene);
    this.renderer.autoClear = true;
  }

  setVeil(rect: VeilRect | null, snap: boolean): void {
    if (!rect) this.veilState.to = 0;
    else {
      this.veilState.rect = { ...rect };
      this.veilState.to = 1;
    }
    if (snap) this.veilState.a = this.veilState.to;
  }

  // Keep the picture last finished, to crossfade from (run it after a frame has been drawn).
  snapshot(): void {
    const u = this.final.uniforms;
    u.uCross!.value = 0;
    // the pass must not read the target it draws into
    u.tPrev!.value = null;
    this.pass(this.final, this.prev);
    u.tPrev!.value = this.prev.texture;
  }

  // The last steps, to the screen. cssWidth/cssHeight are the canvas's size in CSS pixels; ui is the page's colour
  // scheme (0 night, 1 day), phone selects the phone veil's defaults; cross is how much of the snapshot shows over
  // the new picture; covered skips the veil's blur (a panel is over the picture).
  // flash may be negative here (a failure dims the picture); the scene's own materials only ever see it brighten.
  finish(dt: number, snap: boolean, look: { exposure: number; vignette: number; ui: number; fade: number; flash: number; cross?: number; covered?: boolean }, cssWidth: number, cssHeight: number, phone: boolean): void {
    const v = this.veilState;
    v.a = snap ? v.to : approach(v.a, v.to, 3, dt);
    const u = this.final.uniforms;
    const bs = this.width / cssWidth;
    const r = v.rect;
    (u.uVeil!.value as THREE.Vector4).set((r.x + r.w / 2) * bs, (cssHeight - r.y - r.h / 2) * bs, (r.w / 2) * bs, (r.h / 2) * bs);
    const feather = r.feather ?? (phone ? 90 : 150);
    const amount = r.amount ?? (phone ? 0.76 + (0.74 - 0.76) * look.ui : 0.7);
    u.uVeilFeather!.value = feather * bs;
    u.uVeilAmt!.value = amount * v.a;
    u.uVeilBlur!.value = look.covered ? 0 : v.a;
    u.uCross!.value = look.cross ?? 0;
    (u.uVeilCol!.value as THREE.Color).copy(VEIL_NIGHT).lerp(VEIL_DAY, look.ui);
    u.uExposure!.value = look.exposure;
    u.uVignette!.value = look.vignette;
    u.uFade!.value = look.fade;
    u.uFlash!.value = Math.max(-0.9, look.flash);
    // the soft copy under the text includes the portraits
    if (v.a > 0.002 && !look.covered) this.soften();
    u.tSoft!.value = this.f.texture;

    this.bright.uniforms.tDiffuse!.value = this.scene.texture;
    this.pass(this.bright, this.a);
    const blurTo = (src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, x: number, y: number) => {
      this.blur.uniforms.tDiffuse!.value = src.texture;
      (this.blur.uniforms.uDir!.value as THREE.Vector2).set(x, y);
      this.pass(this.blur, dst);
    };
    blurTo(this.a, this.b, 1 / this.a.width, 0);
    blurTo(this.b, this.a, 0, 1 / this.a.height);
    blurTo(this.a, this.d, 1.6 / this.c.width, 0);
    blurTo(this.d, this.c, 0, 1.6 / this.c.height);
    u.tScene!.value = this.scene.texture;
    u.tBloom1!.value = this.a.texture;
    u.tBloom2!.value = this.c.texture;
    this.pass(this.final, null);
  }

  dispose(): void {
    for (const t of [this.scene, this.a, this.b, this.c, this.d, this.e, this.f, this.prev]) t?.dispose();
    for (const m of [this.bright, this.blur, this.copy, this.final]) m.dispose();
    this.quad.geometry.dispose();
  }
}
