// The game's own time stamps (「0001年 01月 04日 21:10」, the time-and-place table's form) said the
// way the interface says time (spec 八): the lunar day and the double hour, 「正月初四 · 亥时」.

/** The months of the game's calendar (content/life/chronicle.json writes them so too). */
export const MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const HOURS = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const GAME_TIME = /^\s*(\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/;

/** 1 → 初一, 15 → 十五, 20 → 二十, 23 → 廿三, 30 → 三十. */
export function lunarDay(day: number): string {
  if (day <= 10) return `初${DIGITS[day] ?? ''}`;
  if (day < 20) return `十${DIGITS[day - 10] ?? ''}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${DIGITS[day - 20] ?? ''}`;
  return '三十';
}

/** 23:00–0:59 is 子时, 1:00–2:59 丑时 … 21:00–22:59 亥时. */
export function doubleHour(hour: number): string {
  return `${HOURS[Math.floor(((hour + 1) % 24) / 2)] ?? '子'}时`;
}

/** 「0001年 01月 04日 21:10」 → 「正月初四 · 亥时」; a later year leads: 「三年 · 腊月廿三」. Other text stays as it is. */
export function sayGameTime(text: string): string {
  const match = GAME_TIME.exec(text);
  if (!match) return text;
  const [, year, month, day, hour] = match.map(Number) as [number, number, number, number, number];
  const monthName = MONTHS[month - 1];
  if (!monthName || day < 1 || day > 30) return text;
  const parts = [`${monthName}${lunarDay(day)}`];
  if (match[4] !== undefined) parts.push(doubleHour(hour));
  if (year > 1) parts.unshift(`${year}年`);
  return parts.join(' · ');
}
