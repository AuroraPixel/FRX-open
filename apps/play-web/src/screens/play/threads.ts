// 线头 (the owner's second playtest: 齐管事 named tonight's 闭门小易 in the story and nothing on screen
// followed it): what a scene left open, an appointment at a place and time, someone still waiting to talk,
// a thing promised, kept in play.threads and taken up by 接着办 (the verb follow, a turn of its own). 接下来
// offers each first (kind thread, under 约), the timed and the timeless alike.
import type { PlayThread, PlayView, Verb } from '../../contracts';

/** The view's threads (play.threads), none where there are none. */
export function threadsOf(play: PlayView | null | undefined): PlayThread[] {
  return play?.threads ?? [];
}

/** 接着办: the command that takes a thread up. */
export const followVerb = (id: string): Verb => ({ kind: 'follow', id });

/** Whether a command is 接着办. */
export const isFollow = (verb: Verb): verb is Verb & { id: string } => verb.kind === 'follow' && typeof verb.id === 'string';

/** When a thread can be taken up, in the calendar's words; nothing for a timeless one. */
export const whenWords = (thread: PlayThread): string => thread.when?.text ?? '';
