// The cultivation life's turns that carry no words of the player's own (gameplay plan, 回合的四种走法): a
// standing command (verb), the action card picked (act, from 1), a move in a fight, a step in a secret
// realm. Each goes alone: the line keeps what is written in it and the queued chips wait for a turn of
// words. The bottom bar, the book's cards, the panels and the realm's map all send through here.
import type { Move, PlayLead, RealmStep, Verb } from '../../contracts';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { aimSheet } from '../sheets/aim';

export interface Command {
  verb?: Verb;
  act?: number;
  /** a move in a fight */
  move?: Move;
  /** a step in a secret realm: a node of the next layer, or out past the deepest */
  step?: RealmStep;
  lead?: string;
  /** what the page shows as the player's stroke until the server answers (a card's title); none for a verb */
  shown?: string;
}

/** A command, unless a turn is under way or waits for its settlement; whether it went. */
export function sendCommand({ verb, act, move, step, lead, shown = '' }: Command): boolean {
  const turns = useTurnsStore.getState();
  const busy = turns.live?.status;
  if (busy === 'streaming' || busy === 'pending' || (!verb && !act && !move && !step && !lead)) return false;
  void turns.send({ text: shown, verb, act, move, step, lead });
  return true;
}

/** Whether the turn last sent was a command, not words (its words are not given back to the line). */
export function sentCommand(): boolean {
  const request = useTurnsStore.getState().request;
  return Boolean(request && (request.verb || request.act || request.move || request.step || request.lead));
}

export function leadActionLabel(lead: PlayLead): string {
  if (lead.action === 'travel') return `查看去${lead.place ?? '线索所在地'}的路线`;
  return lead.action === 'ask' ? '打听去处' : '调查疑点';
}

export function followLead(lead: PlayLead): void {
  if (!lead.action || lead.proven) return;
  const ui = useUiStore.getState();
  if (lead.action === 'travel' && lead.place) {
    aimSheet({ sheet: 'map', pick: lead.place });
    ui.openSheet('map');
  } else if (lead.action !== 'travel' && sendCommand({ lead: lead.id, shown: `${leadActionLabel(lead)}：${lead.where || lead.text}` })) {
    ui.closeSheet();
  }
}
