// The words of a life's record (一生的年谱, gameplay plan item 49), the same on the page and on the picture.
import type { LifeView, LifeYear } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { MONTHS, lunarDay } from './gameTime';

/** 「0174-01-01」 → 「一百七十四年正月初一」 */
export function dayWithYear(key: string | undefined): string {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(key ?? '');
  if (!match) return key ?? '';
  return `${chineseNumber(Number(match[1]))}年${MONTHS[Number(match[2]) - 1] ?? ''}${lunarDay(Number(match[3]))}`;
}

/** The line under the name: the realm, the age, the end (or that the life goes on). */
export function lifeHead(life: LifeView): string {
  const parts = [life.realm ? `${life.realm}修士` : ''];
  if (life.alive) {
    if (life.age !== undefined) parts.push(`${chineseNumber(life.age)}岁`);
    if (life.lifespan !== undefined) parts.push(`寿元${chineseNumber(life.lifespan)}`);
    parts.push('尚在人世');
  } else {
    if (life.age !== undefined) parts.push(`享年${chineseNumber(life.age)}`);
    if (life.died) parts.push(`${dayWithYear(life.died)}坐化${life.place ? `于${life.place}` : ''}`);
  }
  return parts.filter(Boolean).join(' · ');
}

/** 「十五年 · 四十一岁」 */
export function yearHead(year: LifeYear): string {
  return `${chineseNumber(year.year)}年${year.age !== undefined ? ` · ${chineseNumber(year.age)}岁` : ''}`;
}

/** What was left behind, a row each: the home, the vault, the bag, the stones, the last word, the heir. */
export function lifeLeft(life: LifeView): { label: string; value: string }[] {
  const left = life.left;
  if (!left) return [];
  const rows = [
    left.home ? { label: '洞府', value: left.home } : null,
    { label: '仓库', value: left.vault.length ? left.vault.join('、') : '空着' },
    left.bag.length ? { label: '行囊', value: left.bag.join('、') } : null,
    { label: '灵石', value: left.stones ? `${left.stones === 2 ? '两' : chineseNumber(left.stones)}块` : '一块不剩' },
    left.words ? { label: '遗言', value: `「${left.words}」` } : null,
    left.heir ? { label: '传人', value: `${left.heir}${left.heirKind ? `（${left.heirKind}）` : ''}` } : null,
  ];
  return rows.filter((row): row is { label: string; value: string } => Boolean(row));
}
