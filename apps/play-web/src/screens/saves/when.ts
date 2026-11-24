// How the saves list says when a save was last played: 今天 18:50, 昨天 09:12, 11月3日, 2025年12月30日.

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function playedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  if (days <= 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (at.getFullYear() === now.getFullYear()) return `${at.getMonth() + 1}月${at.getDate()}日`;
  return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`;
}
