// The book's own words in the cultivation life (章回, gameplay plan item 38): a scene is one 回 and a
// stretch of the life one volume (卷). The 回 and the volume as the page writes them, and the days a
// volume or a stretch of years spans.
import type { PlayDate } from '../contracts';
import { chapterTitle, chineseNumber } from './numerals';

/** The 回: 12 → 第十二回; before the first scene of the life, 楔子. */
export function chapterWords(chapter: number): string {
  return chapter > 0 ? `第${chineseNumber(chapter)}回` : '楔子';
}

/**
 * A turn by its number: in the life's book a scene is one 回, so a turn is a 回合 (39 → 第三十九个回合);
 * elsewhere each turn is a 回 (39 → 第三十九回).
 */
export function turnWords(no: number, book: boolean): string {
  return book ? `第${chineseNumber(no)}个回合` : chapterTitle(no);
}

/** A volume: 2 → 卷二. */
export function volumeWords(no: number): string {
  return `卷${chineseNumber(no)}`;
}

/** A day with its year: 二十四年正月初三. */
export function dayWords(date: Pick<PlayDate, 'text' | 'year'>): string {
  return `${chineseNumber(date.year)}年${date.text}`;
}

/**
 * The days something spans: 「二十四年正月初三 至 二十九年正月初三」; within one year the end leaves its
 * year out (「一年正月初五 至 三月初九」); one day is that day; with no end, 「二十四年正月初三起」.
 */
export function spanWords(since?: PlayDate, until?: PlayDate): string {
  if (!since) return until ? `至${dayWords(until)}` : '';
  if (!until) return `${dayWords(since)}起`;
  if (since.year === until.year && since.month === until.month && since.day === until.day) return dayWords(since);
  return `${dayWords(since)} 至 ${since.year === until.year ? until.text : dayWords(until)}`;
}

/** A 回目's two lines (apart by a space, full-width or not), or the engine's own one line. */
export function coupletLines(couplet: string): string[] {
  return couplet.split(/[\s　]+/u).filter(Boolean);
}

/** A line without the stop at its end, to tell the same line written twice. */
export function bareLine(text: string): string {
  return text.trim().replace(/[。！？；，、\s]+$/u, '');
}
