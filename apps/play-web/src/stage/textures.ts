import * as THREE from 'three';
import type { PlaqueSpec } from './compose/compose';
import { brushReady, writePlaque } from './compose/plaque';

// Loads a scene's pictures once each and keeps count of what is still on its way.
export class Textures {
  private readonly loader = new THREE.TextureLoader();
  private readonly byUrl = new Map<string, THREE.Texture>();
  private readonly waiting = new Set<Promise<void>>();
  private readonly anisotropy: number;
  private readonly onError: (error: Error) => void;

  constructor(anisotropy: number, onError: (error: Error) => void) {
    this.anisotropy = anisotropy;
    this.onError = onError;
  }

  // Painted cut-outs are premultiplied on upload (the shaders divide it back out); opaque pictures are not.
  // An optional picture that is missing is simply not drawn.
  get(url: string, opaque = false, optional = false): THREE.Texture {
    const known = this.byUrl.get(url);
    if (known) return known;
    let settle: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (settle = resolve));
    this.waiting.add(done);
    const finish = () => {
      this.waiting.delete(done);
      settle();
    };
    const texture = this.loader.load(url, finish, undefined, () => {
      if (!optional) this.onError(new Error(`stage: missing picture ${url}`));
      finish();
    });
    texture.premultiplyAlpha = !opaque;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.anisotropy;
    this.byUrl.set(url, texture);
    return texture;
  }

  // A picture with the place's name written on its plaque before it is shown (compose/plaque.ts); the picture as
  // painted, its plaque blank, when the brush font cannot be had. The address's #fragment only tells it apart from
  // the plain picture (it is not sent).
  written(url: string, spec: PlaqueSpec): THREE.Texture {
    const known = this.byUrl.get(url);
    if (known) return known;
    const texture = new THREE.Texture();
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.anisotropy;
    const done: Promise<void> = (async () => {
      const image = await new THREE.ImageLoader().loadAsync(url);
      let picture: HTMLImageElement | HTMLCanvasElement = image;
      try {
        if (await brushReady(spec.text)) picture = writePlaque(image, spec);
      } catch {
        // the plaque stays blank
      }
      texture.image = picture;
      texture.needsUpdate = true;
    })()
      .catch(() => this.onError(new Error(`stage: missing picture ${url}`)))
      .finally(() => this.waiting.delete(done));
    this.waiting.add(done);
    this.byUrl.set(url, texture);
    return texture;
  }

  // Whether a picture is still on its way.
  get busy(): boolean {
    return this.waiting.size > 0;
  }

  // Resolves when everything asked for so far has loaded or failed.
  async settled(): Promise<void> {
    while (this.waiting.size) await Promise.all([...this.waiting]);
  }

  dispose(): void {
    for (const texture of this.byUrl.values()) texture.dispose();
    this.byUrl.clear();
  }
}
