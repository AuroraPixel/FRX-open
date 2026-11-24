/* The stand-in's picture of a scene handed over whole (a place composed on the page), for browsers without WebGL2:
   drawn once per hour in 2D from the same recipe the live stage draws, through the reading camera. The shared sky's
   panorama for the hour, turned as the scene turns it; below the horizon the colour it fades to; then every card from
   the farthest in, each sunk at its foot and faded at its ends as the live stage does, its colour eased towards the
   horizon's with distance and into it at its foot, the place's name on its plaques. The cards were painted for the
   night: another hour takes the stand-in's filter for that hour (fallback.ts), the sky its own picture. The arcs, the
   cloud sea's motion, the protagonist and the effects are left out. */
import { ray, screenOf, type Cam } from './compose/geometry';
import { brushReady, writePlaque } from './compose/plaque';
import type { CardPiece, SceneDesc } from './scene-loader';
import type { Hour } from './types';

// sky.ts: the panorama spans 100 degrees round the scene's turn, its picture reaching from the horizon up to where
// its height (a third of its width, on a radius of 900) ends
const SKY_SPAN = 100;
const SKY_UP = (900 * ((SKY_SPAN * Math.PI) / 180)) / 3 / 900;
const STRIPS = 32;

type Rgb = [number, number, number];

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const css = (c: Rgb, a = 1) => `rgba(${c.map((v) => Math.round(v)).join(', ')}, ${a})`;
// a card's own canvas is never larger than this on a side (a near tree may reach well past the frame)
const LARGEST = 4096;

// The average colour of a strip of a picture (its bottom rows: where the sky meets the horizon).
function averageOf(image: HTMLImageElement, y0: number, y1: number): Rgb {
  const c = canvasOf(32, 4);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return [40, 52, 70];
  g.drawImage(image, 0, y0 * image.height, image.width, Math.max(1, (y1 - y0) * image.height), 0, 0, 32, 4);
  const data = g.getImageData(0, 0, 32, 4).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k] = sum[k]! + data[i + k]!;
  return sum.map((v) => v / (data.length / 4)) as Rgb;
}

export interface StillOptions {
  hour: Hour;
  width: number;
  height: number;
  // the reading camera's shape: the tall one for a phone held upright
  tall: boolean;
  // the canvas filter that gives the night-painted cards the hour's light ('none' at night)
  filter: string;
  load: (url: string) => Promise<HTMLImageElement>;
}

export async function drawStill(desc: SceneDesc, opts: StillOptions): Promise<HTMLCanvasElement> {
  const { width: W, height: H, hour } = opts;
  const out = canvasOf(W, H);
  const g = out.getContext('2d');
  if (!g) return out;
  const cam = desc.cameras.read[opts.tall ? 'tall' : 'wide'] as Cam;
  const aspect = W / H;
  const eye: [number, number, number] = [cam[0], cam[1], cam[2]];
  const far = (d: [number, number, number]) => screenOf(cam, aspect, [eye[0] + d[0] * 1000, eye[1] + d[1] * 1000, eye[2] + d[2] * 1000]);

  // the sky
  const sky = await opts.load(`${desc.skyFolder}${desc.sky.files[hour].clear}`);
  const horizonColour = averageOf(sky, 0.9, 1);
  const az = desc.sky.azimuth;
  const level = (sy: number) => {
    // where a horizontal ray through the middle of the screen meets the screen: the horizon
    const d = ray(cam, aspect, 0.5, sy);
    return d[1];
  };
  let horizon = 0.5;
  for (let lo = -1, hi = 2, i = 0; i < 40; i++) {
    horizon = (lo + hi) / 2;
    if (level(horizon) > 0) lo = horizon;
    else hi = horizon;
  }
  g.fillStyle = css(horizonColour);
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < STRIPS; i++) {
    const sx0 = i / STRIPS;
    const sx1 = (i + 1) / STRIPS;
    const d0 = ray(cam, aspect, sx0, horizon);
    const d1 = ray(cam, aspect, sx1, horizon);
    const yaw0 = (Math.atan2(d0[0], -d0[2]) * 180) / Math.PI;
    const yaw1 = (Math.atan2(d1[0], -d1[2]) * 180) / Math.PI;
    const u0 = (yaw0 - (az - SKY_SPAN / 2)) / SKY_SPAN;
    const u1 = (yaw1 - (az - SKY_SPAN / 2)) / SKY_SPAN;
    // the picture's top edge on the screen at this strip, and its bottom (the horizon)
    const mid = (yaw0 + yaw1) / 2;
    const dir = (up: number): [number, number, number] => {
      const a = (mid * Math.PI) / 180;
      return [Math.sin(a), up, -Math.cos(a)];
    };
    const top = far(dir(SKY_UP));
    const bottom = far(dir(0));
    if (!top || !bottom) continue;
    const x = sx0 * W;
    const w = (sx1 - sx0) * W + 1;
    const yTop = top[1] * H;
    const yBottom = bottom[1] * H;
    g.drawImage(sky, Math.max(0, u0) * sky.width, 0, Math.max(1, (Math.min(1, u1) - Math.max(0, u0)) * sky.width), sky.height, x, yTop, w, yBottom - yTop);
    // above the picture its top row carries on, as on the live stage
    if (yTop > 0) g.drawImage(sky, Math.max(0, u0) * sky.width, 0, Math.max(1, (Math.min(1, u1) - Math.max(0, u0)) * sky.width), 1, x, 0, w, yTop + 1);
  }
  // the horizon softens into the colour distance fades to, and below it the floor's haze
  const hy = horizon * H;
  const soft = g.createLinearGradient(0, hy - H * 0.08, 0, hy + 1);
  soft.addColorStop(0, css(horizonColour, 0));
  soft.addColorStop(1, css(horizonColour, 1));
  g.fillStyle = soft;
  g.fillRect(0, hy - H * 0.08, W, H * 0.08 + 1);
  const floor = g.createLinearGradient(0, hy, 0, H);
  floor.addColorStop(0, css(horizonColour));
  floor.addColorStop(1, css(horizonColour.map((v) => v * (desc.floor?.kind === 'clouds' ? 0.85 : 0.55)) as Rgb));
  g.fillStyle = floor;
  g.fillRect(0, hy, W, H - hy);

  // the cards, the farthest first
  const fog = desc.looks[hour].fog;
  const cards = desc.pieces.filter((p): p is CardPiece => p.kind === 'card').sort((a, b) => a.renderOrder - b.renderOrder);
  const pictures = new Map<string, Promise<HTMLImageElement | HTMLCanvasElement | null>>();
  const pictureOf = (file: string) => {
    let found = pictures.get(file);
    if (!found) {
      const plaque = desc.written[file];
      found = opts.load(desc.folder + file.split('#')[0]).then(async (image) => {
        if (plaque && (await brushReady(plaque.text))) {
          try {
            return writePlaque(image, plaque);
          } catch {
            return image;
          }
        }
        return image;
      }).catch(() => null);
      pictures.set(file, found);
    }
    return found;
  };
  const loaded = await Promise.all(cards.map((card) => pictureOf(card.file)));
  cards.forEach((card, i) => {
    const picture = loaded[i];
    if (!picture) return;
    const a = screenOf(cam, aspect, [card.x - card.w / 2, card.y, card.z]);
    const b = screenOf(cam, aspect, [card.x + card.w / 2, card.y + card.h, card.z]);
    if (!a || !b) return;
    const x0 = Math.min(a[0], b[0]) * W;
    const x1 = Math.max(a[0], b[0]) * W;
    const y0 = Math.min(a[1], b[1]) * H;
    const y1 = Math.max(a[1], b[1]) * H;
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H || x1 - x0 < 1 || y1 - y0 < 1) return;
    drawCard(g, card, picture, [x0, y0, x1 - x0, y1 - y0], {
      filter: opts.filter, haze: horizonColour,
      distance: Math.hypot(card.x - eye[0], card.y + card.h / 2 - eye[1], card.z - eye[2]), fog,
    });
  });
  return out;
}

// One card: drawn in its own canvas, then faded and hazed there, then laid onto the picture.
function drawCard(
  g: CanvasRenderingContext2D, card: CardPiece, picture: CanvasImageSource, [x, y, w, h]: [number, number, number, number],
  look: { filter: string; haze: Rgb; distance: number; fog: number },
): void {
  const c = canvasOf(Math.min(LARGEST, w), Math.min(LARGEST, h));
  const t = c.getContext('2d');
  if (!t) return;
  const p = card.paint;
  const bright = Math.pow(Math.max(0.05, p.gain / 0.5), 1 / 2.2);
  t.filter = [look.filter !== 'none' ? look.filter : '', bright !== 1 ? `brightness(${bright.toFixed(3)})` : ''].join(' ').trim() || 'none';
  if (card.flip) {
    t.translate(c.width, 0);
    t.scale(-1, 1);
  }
  t.drawImage(picture, 0, 0, c.width, c.height);
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.filter = 'none';
  // the row of the card's canvas at a world height
  const rowOf = (wy: number) => (1 - (wy - card.y) / card.h) * c.height;
  // distance haze and the mist at its foot, towards the colour the horizon fades to
  t.globalCompositeOperation = 'source-atop';
  const fa = (1 - Math.exp(-look.distance * look.fog)) * p.haze;
  if (fa > 0.004) {
    t.fillStyle = css(look.haze, Math.min(1, fa));
    t.fillRect(0, 0, c.width, c.height);
  }
  if (p.mist > 0) {
    const lo = rowOf(p.mistHi);
    const hi = rowOf(p.mistLo);
    if (hi > 0 && lo < c.height) {
      const ramp = t.createLinearGradient(0, lo, 0, Math.max(lo + 1, hi));
      ramp.addColorStop(0, css(look.haze, 0));
      ramp.addColorStop(1, css(look.haze, Math.min(1, p.mist)));
      t.fillStyle = ramp;
      t.fillRect(0, lo, c.width, c.height - lo);
    }
  }
  // sunk into the floor by world height, and faded at both ends
  t.globalCompositeOperation = 'destination-in';
  if (p.sink) {
    const top = rowOf(p.sink[1]);
    const bottom = rowOf(p.sink[0]);
    const ramp = t.createLinearGradient(0, top, 0, Math.max(top + 1, bottom));
    ramp.addColorStop(0, 'rgba(0,0,0,1)');
    ramp.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = ramp;
    t.fillRect(0, 0, c.width, c.height);
  }
  if (p.edge > 0.001) {
    const ramp = t.createLinearGradient(0, 0, c.width, 0);
    const e = Math.min(0.5, p.edge);
    ramp.addColorStop(0, 'rgba(0,0,0,0)');
    ramp.addColorStop(e, 'rgba(0,0,0,1)');
    ramp.addColorStop(1 - e, 'rgba(0,0,0,1)');
    ramp.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = ramp;
    t.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(c, x, y, w, h);
}

