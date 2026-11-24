// 一生的年谱 as a picture (gameplay plan item 49): the life's record drawn on a canvas 1080 px wide, as a
// page of the book on paper, in the page's own fonts (the brush for the names and headings, the serif for
// the lines), and given to the player: the system's share sheet on phones that have one, else a download.
import type { LifeView } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { lifeHead, lifeLeft, yearHead } from './lifeWords';

export const WIDTH = 1080;
const MARGIN = 96;
const MOST = 15000;
const PAPER = '#f2e9d6';
const EDGE = '#b89a5e';
const INK = '#2a2118';
const SOFT = '#7a6a55';
const GOLD = '#8a6522';
const CIN = '#a8402c';

interface Fonts {
  brush: string;
  serif: string;
}

/** The page's own font families (tokens.css), loaded for the words about to be drawn. */
export async function pageFonts(text: string): Promise<Fonts> {
  const root = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const brush = root?.getPropertyValue('--f-brush').trim() || 'serif';
  const serif = root?.getPropertyValue('--f-serif').trim() || 'serif';
  if (typeof document !== 'undefined' && document.fonts?.load) {
    await Promise.all([document.fonts.load(`48px ${brush}`, text), document.fonts.load(`28px ${serif}`, text)]).catch(() => undefined);
  }
  return { brush, serif };
}

type Op =
  | { kind: 'text'; text: string; x: number; y: number; font: string; color: string; align?: CanvasTextAlign }
  | { kind: 'rule'; x: number; y: number; w: number; color: string };

/** Lines of `text` no wider than `width` (Chinese breaks anywhere). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

/** Lays the page out top to bottom: the ops to draw and the height they take. */
function layout(ctx: CanvasRenderingContext2D, life: LifeView, fonts: Fonts): { ops: Op[]; height: number } {
  const ops: Op[] = [];
  const inner = WIDTH - MARGIN * 2;
  let y = MARGIN + 40;
  const text = (words: string, font: string, color: string, size: number, x = MARGIN, width = inner) => {
    ctx.font = font;
    for (const line of wrap(ctx, words, width)) {
      y += size;
      if (y > MOST) return;
      ops.push({ kind: 'text', text: line, x, y, font, color });
      y += Math.round(size * 0.55);
    }
  };
  const heading = (words: string) => {
    y += 36;
    const font = `400 44px ${fonts.brush}`;
    ops.push({ kind: 'text', text: words, x: MARGIN, y: y + 44, font, color: GOLD });
    ops.push({ kind: 'rule', x: MARGIN + 44 * words.length + 24, y: y + 28, w: inner - 44 * words.length - 24, color: EDGE });
    y += 44 + 28;
  };
  const head = lifeHead(life);
  ops.push({ kind: 'text', text: life.name, x: MARGIN, y: y + 104, font: `400 104px ${fonts.brush}`, color: INK });
  ops.push({ kind: 'text', text: '一生', x: WIDTH - MARGIN, y: y + 104, font: `400 56px ${fonts.brush}`, color: CIN, align: 'right' });
  y += 104 + 40;
  text(head, `400 30px ${fonts.serif}`, SOFT, 30);
  if (life.years.length) {
    heading('年谱');
    for (const year of life.years) {
      text(yearHead(year), `700 30px ${fonts.serif}`, INK, 30);
      for (const line of year.lines) text(`${line.date}　${line.text}`, `400 28px ${fonts.serif}`, INK, 28, MARGIN + 40, inner - 40);
      y += 8;
    }
  }
  if (life.gates.length) {
    heading('过关');
    for (const gate of life.gates) {
      const age = gate.age !== undefined ? `${chineseNumber(gate.age)}岁 · ` : '';
      text(`${age}冲破${gate.name ?? gate.gate ?? '一关'}，至${gate.to}${gate.foundation ? `，根基${gate.foundation}` : ''}`, `400 28px ${fonts.serif}`, INK, 28);
    }
  }
  if (life.volumes.some((volume) => volume.until)) {
    heading('卷');
    for (const volume of life.volumes.filter((each) => each.until)) {
      text(`第${chineseNumber(volume.no)}卷${volume.name ? `　${volume.name}` : ''}`, `700 30px ${fonts.serif}`, INK, 30);
      if (volume.text) text(volume.text, `400 28px ${fonts.serif}`, SOFT, 28, MARGIN + 40, inner - 40);
    }
  }
  const left = lifeLeft(life);
  if (left.length) {
    heading('留下');
    for (const row of left) text(`${row.label}　${row.value}`, `400 28px ${fonts.serif}`, INK, 28);
  }
  if (life.eulogies.length) {
    heading('故人');
    for (const said of life.eulogies) {
      text(`「${said.text}」`, `400 28px ${fonts.serif}`, INK, 28);
      text(`—— ${said.name}${said.kind ? `（${said.kind}）` : ''}`, `400 26px ${fonts.serif}`, SOFT, 26, MARGIN + 300, inner - 300);
    }
  }
  return { ops, height: Math.min(MOST, y) + MARGIN };
}

/** The life's record painted on a canvas WIDTH px wide (null where the page cannot draw). */
export async function paintLife(life: LifeView): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) return null;
  const words = [life.name, lifeHead(life), ...life.years.flatMap((year) => year.lines.map((line) => line.text)), ...life.eulogies.map((said) => said.text), '一生年谱过关卷留下故人'].join('');
  const fonts = await pageFonts(words);
  const { ops, height } = layout(probe, life, fonts);
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, height);
  // the page's frame: a double line in faded gold
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, WIDTH - 72, height - 72);
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, WIDTH - 96, height - 96);
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op.kind === 'rule') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, Math.max(0, op.w), 2);
      continue;
    }
    ctx.font = op.font;
    ctx.fillStyle = op.color;
    ctx.textAlign = op.align ?? 'left';
    ctx.fillText(op.text, op.x, op.y);
  }
  return canvas;
}

/** How much of the picture is not bare paper (0 to 1), from a grid of samples: a blank page is 0. */
export function inked(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let marked = 0;
  let seen = 0;
  for (let i = 0; i < data.length; i += 4 * 97) {
    seen += 1;
    if (Math.abs((data[i] ?? 0) - 0xf2) + Math.abs((data[i + 1] ?? 0) - 0xe9) + Math.abs((data[i + 2] ?? 0) - 0xd6) > 30) marked += 1;
  }
  return seen ? marked / seen : 0;
}

/** Gives the picture to the player: the share sheet where the system has one for files, else a download. */
export async function givePicture(canvas: HTMLCanvasElement, name: string): Promise<'shared' | 'saved' | 'failed'> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], `${name}的一生.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: `${name}的一生` });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'failed';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}
