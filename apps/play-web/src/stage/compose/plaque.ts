/* The place's name on the painted blank plaque (browser only): the picture that carries the plaque, with the name
   written into the plaque's field in the brush font (Ma Shan Zheng, assets/fonts/fonts.css), as a canvas.

   Gold leaf on dark lacquer: a warm gold, shaded from top to bottom, with a dark cast shadow below it. Dark ink cut
   into pale stone: blue-black strokes with a pale lip below and right, as a carved groove shows. Either way the
   plaque's own grain is multiplied back into the strokes, so the writing takes the painting's light and brushwork
   and the stage lights it with the rest of the picture. Left to right, top to bottom on an upright plaque. */
import type { PlaqueSpec } from './compose';

export const BRUSH = 'Ma Shan Zheng';

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Loads the brush font's slices for these characters; false if the font cannot be had (the plaque then stays blank).
export async function brushReady(text: string, px = 64): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  try {
    await document.fonts.load(`${px}px "${BRUSH}"`, text);
    return document.fonts.check(`${px}px "${BRUSH}"`, text);
  } catch {
    return false;
  }
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
}

// Where each character goes in the field: as large as the field allows (a long name smaller), spread a little wider
// than touching when the name is short, centred.
export function layout(text: string, w: number, h: number, vertical: boolean): { size: number; glyphs: Glyph[] } {
  const chars = Array.from(text);
  const n = Math.max(1, chars.length);
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  let size = Math.min(across * 0.86, along / (n + 0.12 * (n - 1)));
  // a short name keeps to the middle with room between the characters, as a written plaque does
  const gap = Math.min(size * 0.55, (along - n * size) / Math.max(1, n - 1 + 1.6));
  size = Math.max(4, size);
  const total = n * size + (n - 1) * gap;
  const start = (along - total) / 2 + size / 2;
  return {
    size,
    glyphs: chars.map((ch, i) => {
      const t = start + i * (size + gap);
      return vertical ? { ch, x: w / 2, y: t } : { ch, x: t, y: h / 2 };
    }),
  };
}

function strokes(g: CanvasRenderingContext2D, glyphs: Glyph[], dx: number, dy: number): void {
  for (const glyph of glyphs) g.fillText(glyph.ch, glyph.x + dx, glyph.y + dy);
}

// The picture with the name written on its plaque. `picture` is the plaque's picture at the size the stage will load.
export function writePlaque(picture: CanvasImageSource & { width: number; height: number }, spec: PlaqueSpec): HTMLCanvasElement {
  const W = picture.width;
  const H = picture.height;
  const out = canvas(W, H);
  const g = out.getContext('2d')!;
  g.drawImage(picture, 0, 0, W, H);
  const [bx0, by0, bx1, by1] = spec.box;
  const fx = bx0 * W;
  const fy = by0 * H;
  const fw = (bx1 - bx0) * W;
  const fh = (by1 - by0) * H;
  // keep off the frame
  const mx = (spec.vertical ? 0.16 : 0.07) * fw;
  const my = (spec.vertical ? 0.06 : 0.12) * fh;
  const { size, glyphs } = layout(spec.text, fw - 2 * mx, fh - 2 * my, spec.vertical);

  // the strokes, in their own canvas the size of the field
  const field = canvas(fw, fh);
  const t = field.getContext('2d')!;
  t.translate(mx, my);
  t.font = `${size}px "${BRUSH}"`;
  t.textAlign = 'center';
  t.textBaseline = 'middle';
  if (spec.ink === 'gold') {
    const grad = t.createLinearGradient(0, -size / 2, 0, fh);
    grad.addColorStop(0, '#e8cd8c');
    grad.addColorStop(0.55, '#c9a45c');
    grad.addColorStop(1, '#9c7b3f');
    t.fillStyle = grad;
  } else {
    t.fillStyle = 'rgba(30, 37, 49, 0.9)';
  }
  strokes(t, glyphs, 0, 0);
  // the plaque's grain multiplied back into the strokes only
  const mask = canvas(fw, fh);
  mask.getContext('2d')!.drawImage(field, 0, 0);
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'multiply';
  t.globalAlpha = spec.ink === 'gold' ? 0.55 : 0.4;
  t.drawImage(picture, fx, fy, fw, fh, 0, 0, fw, fh);
  t.globalAlpha = 1;
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(mask, 0, 0);

  // the shadow or the carved lip under the strokes, then the strokes
  g.save();
  g.translate(fx + mx, fy + my);
  g.font = `${size}px "${BRUSH}"`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (spec.ink === 'gold') {
    g.fillStyle = 'rgba(14, 9, 5, 0.7)';
    g.filter = `blur(${Math.max(0.5, size * 0.02)}px)`;
    strokes(g, glyphs, size * 0.035, size * 0.05);
  } else {
    g.fillStyle = 'rgba(235, 240, 248, 0.32)';
    g.filter = `blur(${Math.max(0.4, size * 0.012)}px)`;
    strokes(g, glyphs, size * 0.025, size * 0.03);
  }
  g.restore();
  g.drawImage(field, fx, fy);
  return out;
}

export function toBlob(c: HTMLCanvasElement, type = 'image/webp', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('compose: cannot encode the plaque'))), type, quality));
}
