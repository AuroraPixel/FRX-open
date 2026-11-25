// Folding a turn's events into the turn being shown (docs/play-contracts.md, 事件流). Events arrive
// here in order (events.ts puts them back in order); this decides what each one does to the turn.
import type { ErrorCode } from '../api/client';
import type { Block, NarrationBlock, QueueItem, Turn, TurnEvent } from '../contracts';
import type { LiveText } from './text';

/** The id of the player's stroke shown before the server has confirmed it. */
export const OPTIMISTIC_ACTION = 'local-action';

export interface LiveTurn {
  /** the request id until the server names the turn, then the turn's id */
  id: string;
  no: number;
  status: Turn['status'];
  blocks: Block[];
  /** the paragraph being written; its words live in LiveText until it closes */
  open: NarrationBlock | null;
  /** the reply is all here: the server settles and commits the turn (no more words come) */
  settling?: boolean;
  /** what the turn waits for before it starts (the work after the turn before), in the server's words */
  waiting?: string;
  /** why it failed, when it did */
  retryingSettlement?: boolean;
  error?: { code: ErrorCode; message: string; retryable: boolean; retryAt?: number };
}

export type Outcome =
  | { kind: 'live'; live: LiveTurn }
  | { kind: 'done'; turn: Turn; version: number }
  | { kind: 'state'; event: Extract<TurnEvent, { event: 'state' }> }
  | { kind: 'same' };

/**
 * The turn as shown before any event: the player's stroke alone, with the chips that went with it. A
 * standing command of the cultivation life has neither words nor chips: no stroke (its turn has none).
 */
export function startLive(requestId: string, no: number, text: string, queue?: QueueItem[]): LiveTurn {
  return {
    id: requestId,
    no,
    status: 'streaming',
    blocks: text || queue?.length ? [{ id: OPTIMISTIC_ACTION, type: 'action', text, ...(queue?.length ? { queue } : {}) }] : [],
    open: null,
  };
}

function upsert(blocks: Block[], block: Block): Block[] {
  const rest = block.type === 'action' ? blocks.filter((b) => b.id !== OPTIMISTIC_ACTION) : blocks;
  const at = rest.findIndex((b) => b.id === block.id);
  if (at < 0) return [...rest, block];
  const next = rest.slice();
  next[at] = block;
  return next;
}

/**
 * What one event does. `text` events change only the live text and never the store, so the page
 * does not re-render per chunk; `open` and `close` change the store once per paragraph.
 */
export function applyEvent(live: LiveTurn | null, event: TurnEvent, text: LiveText): Outcome {
  switch (event.event) {
    case 'turn':
      return {
        kind: 'live',
        live: {
          id: event.turn.id,
          no: event.turn.no,
          status: 'streaming',
          blocks: live?.blocks ?? [],
          open: null,
          // a settlement taken up again (继续结算) is settling from its first event
          ...(live?.settling && live.id === event.turn.id ? { settling: true } : {}),
        },
      };
    case 'block':
      if (!live) return { kind: 'same' };
      return { kind: 'live', live: { ...live, blocks: upsert(live.blocks, event.block) } };
    case 'open':
      if (!live) return { kind: 'same' };
      text.open(event.block.id);
      return { kind: 'live', live: { ...live, open: event.block } };
    case 'text':
      text.append(event.blockId, event.delta);
      return { kind: 'same' };
    case 'close': {
      if (!live) return { kind: 'same' };
      const words = text.close(event.blockId);
      const open = live.open?.id === event.blockId ? live.open : null;
      const block: Block | null = event.replace ?? (open ? { ...open, text: words } : null);
      return {
        kind: 'live',
        live: {
          ...live,
          open: open ? null : live.open,
          blocks: block ? upsert(live.blocks, block) : live.blocks,
        },
      };
    }
    case 'reset':
      if (!live) return { kind: 'same' };
      text.clear();
      return {
        kind: 'live',
        live: { ...live, open: null, blocks: live.blocks.filter((b) => event.keep.includes(b.id)) },
      };
    case 'settling':
      if (!live) return { kind: 'same' };
      return { kind: 'live', live: { ...live, settling: true } };
    case 'waiting': {
      if (!live) return { kind: 'same' };
      const { waiting: _, ...rest } = live;
      return { kind: 'live', live: event.text ? { ...rest, waiting: event.text } : rest };
    }
    case 'state':
      return { kind: 'state', event };
    case 'done':
      text.clear();
      return { kind: 'done', turn: event.turn, version: event.version };
    case 'error':
      if (!live) return { kind: 'same' };
      text.clear();
      return {
        kind: 'live',
        live: {
          ...live,
          status: live.retryingSettlement ? 'pending' : event.code === 'cancelled' ? 'cancelled' : 'failed',
          settling: undefined,
          open: null,
          error: { code: event.code, message: event.message, retryable: event.retryable,
            ...(event.retryAfter ? { retryAt: Date.now() + event.retryAfter * 1000 } : {}) },
        },
      };
    default:
      return { kind: 'same' };
  }
}

/** Adds or replaces a finished turn in the history, kept in turn order. */
export function placeTurn(turns: Turn[], turn: Turn): Turn[] {
  const rest = turns.filter((t) => t.id !== turn.id && t.no !== turn.no);
  return [...rest, turn].sort((a, b) => a.no - b.no);
}
