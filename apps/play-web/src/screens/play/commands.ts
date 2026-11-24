// The cultivation life's turns that carry no words of the player's own (gameplay plan, 回合的四种走法): a
// standing command (verb), the action card picked (act, from 1), a move in a fight, a step in a secret
// realm. Each goes alone: the line keeps what is written in it and the queued chips wait for a turn of
// words. The bottom bar, the book's cards, the panels and the realm's map all send through here.
import type { Move, RealmStep, Verb } from '../../contracts';
import { useTurnsStore } from '../../store/turns';

export interface Command {
  verb?: Verb;
  act?: number;
  /** a move in a fight */
  move?: Move;
  /** a step in a secret realm: a node of the next layer, or out past the deepest */
  step?: RealmStep;
  /** what the page shows as the player's stroke until the server answers (a card's title); none for a verb */
  shown?: string;
}

/** A command, unless a turn is under way or waits for its settlement; whether it went. */
export function sendCommand({ verb, act, move, step, shown = '' }: Command): boolean {
  const turns = useTurnsStore.getState();
  const busy = turns.live?.status;
  if (busy === 'streaming' || busy === 'pending' || (!verb && !act && !move && !step)) return false;
  void turns.send({ text: shown, verb, act, move, step });
  return true;
}

/** Whether the turn last sent was a command, not words (its words are not given back to the line). */
export function sentCommand(): boolean {
  const request = useTurnsStore.getState().request;
  return Boolean(request && (request.verb || request.act || request.move || request.step));
}
