// The stage knows five kinds of weather; the state view and scene blocks carry the story's own words
// for it (「月明云平」「细雨」), or one of the five names. This reads the kind out of either.
export type WeatherKind = 'clear' | 'cloud' | 'mist' | 'rain' | 'snow';

const KINDS: readonly WeatherKind[] = ['clear', 'cloud', 'mist', 'rain', 'snow'];

// First match wins: rain and snow outweigh mist, mist outweighs cloud. 「云平」「云海」 describe the
// view, not an overcast sky, so cloud needs words that mean the sky is covered.
const WORDS: readonly [WeatherKind, readonly string[]][] = [
  ['snow', ['雪', '霰']],
  ['rain', ['雨']],
  ['mist', ['雾', '霭', '岚', '烟']],
  ['cloud', ['阴', '乌云', '云遮', '云蔽', '浓云', '密云', '彤云', '云层']],
];

// What the place line says when all the server gave is one of the five names: never the name itself.
const WORDS_FOR: Readonly<Record<WeatherKind, string>> = {
  clear: '晴好',
  cloud: '阴云',
  mist: '薄雾',
  rain: '细雨',
  snow: '飞雪',
};

/** The weather in words for the place line: the story's own words, or a phrase for a bare kind name. */
export function weatherWords(text: string | undefined): string {
  const name = (text ?? '').trim();
  if (!name) return '';
  return (KINDS as readonly string[]).includes(name.toLowerCase()) ? WORDS_FOR[name.toLowerCase() as WeatherKind] : name;
}

export function weatherKind(text: string | undefined): WeatherKind {
  if (!text) return 'clear';
  const name = text.trim().toLowerCase();
  if ((KINDS as readonly string[]).includes(name)) return name as WeatherKind;
  for (const [kind, words] of WORDS) if (words.some((word) => text.includes(word))) return kind;
  return 'clear';
}
