// Chinese numerals for the book: chapter numbers (第三十七回) and option numbers (壹贰叁).

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UPPER = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const UNITS = ['', '十', '百', '千'];
const GROUPS = ['', '万', '亿'];

function belowTenThousand(n: number, digits: string[]): string {
  let out = '';
  let zero = false;
  for (let unit = 3; unit >= 0; unit -= 1) {
    const d = Math.floor(n / 10 ** unit) % 10;
    if (d === 0) {
      if (out) zero = true;
      continue;
    }
    if (zero) out += digits[0] ?? '';
    zero = false;
    out += (digits[d] ?? '') + (UNITS[unit] ?? '');
  }
  return out;
}

/** 37 → 三十七, 10 → 十, 105 → 一百零五, 20000 → 二万. */
export function chineseNumber(n: number, digits: string[] = DIGITS): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return digits[0] ?? '零';
  const groups: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 10000)) groups.push(rest % 10000);
  let out = '';
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i] ?? 0;
    if (group === 0) continue;
    if (out && group < 1000) out += digits[0];
    out += belowTenThousand(group, digits) + (GROUPS[i] ?? '');
  }
  // 一十 reads as 十 at the start: 十二, not 一十二
  if (digits === DIGITS && out.startsWith('一十')) out = out.slice(1);
  return n < 0 ? `负${out}` : out;
}

/** The chapter heading for a turn: 37 → 第三十七回. */
export function chapterTitle(turnNo: number): string {
  return `第${chineseNumber(turnNo)}回`;
}

/** Option numbers: 1 → 壹 … 10 → 拾. */
export function optionNumeral(index: number): string {
  if (index === 10) return '拾';
  return UPPER[index] ?? chineseNumber(index, UPPER);
}
