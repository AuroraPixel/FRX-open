// Text helpers for the reading page: how a turn's blocks are shown and copied. Pure functions.
import type { Block, OptionsBlock, QueueItem, SpeechBlock, Turn } from '../contracts';

/** Two speech blocks belong to one row when the same person says them back to back (spec 三, 对白行). */
function sameSpeaker(a: SpeechBlock, b: SpeechBlock): boolean {
  if (a.speaker.self || b.speaker.self) return Boolean(a.speaker.self && b.speaker.self);
  if (a.speaker.charId || b.speaker.charId) return a.speaker.charId === b.speaker.charId;
  return a.speaker.name === b.speaker.name;
}

/**
 * The blocks as rows: consecutive lines of one speaker are joined into one speech row, which keeps
 * the id of its first block. Nothing else changes.
 */
export function joinSpeech(blocks: readonly Block[]): Block[] {
  const rows: Block[] = [];
  for (const block of blocks) {
    const last = rows[rows.length - 1];
    if (block.type === 'speech' && last?.type === 'speech' && sameSpeaker(last, block)) {
      rows[rows.length - 1] = { ...last, lines: [...last.lines, ...block.lines] };
      continue;
    }
    rows.push(block);
  }
  return rows;
}

/** The player's words of a turn: what they wrote or the option they picked. */
export function actionText(blocks: readonly Block[]): string {
  const action = blocks.find((b) => b.type === 'action');
  return action?.type === 'action' ? action.text : '';
}

/** The options a turn ends with, if any. */
export function optionsOf(blocks: readonly Block[]): OptionsBlock | undefined {
  const options = blocks.find((b) => b.type === 'options');
  return options?.type === 'options' ? options : undefined;
}

/**
 * A turn's story as plain text, for 复制正文: the paragraphs and the spoken lines (「玄微子：“……”」),
 * one blank line between them. Cards, options and notices are left out.
 */
export function storyText(turn: Pick<Turn, 'blocks'>): string {
  const parts: string[] = [];
  for (const block of joinSpeech(turn.blocks)) {
    if (block.type === 'narration' && block.text.trim()) parts.push(block.text.trim());
    if (block.type === 'speech') parts.push(`${block.speaker.self ? '你' : block.speaker.name}：${block.lines.join('')}`);
  }
  return parts.join('\n\n');
}

/** How many turns going back to the end of turn `no` gives up, the latest being `last`. */
export function turnsDropped(no: number, last: number): number {
  return Math.max(0, last - no);
}

/** The place's own name for the book's title: the point of interest, else the area. */
export function placeName(place: { text: string; area: string; poi?: string }): string {
  return place.poi || place.area || place.text;
}

/**
 * What a chip of the action queue says above the input: a line to say names whom it is said to
 * (「对白蘅说：……」), by the name the state view gives the person; the others say what they are.
 */
export function chipText(item: QueueItem, people: readonly { id: string; name: string }[]): string {
  if (item.kind !== 'say' || !item.charId) return item.text;
  const listener = people.find((person) => person.id === item.charId)?.name;
  return listener ? `对${listener}说：${item.text}` : item.text;
}
