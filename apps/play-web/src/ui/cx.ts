/** Joins class names, skipping the empty ones (CSS module lookups may be undefined). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
