// Reading a turn's event stream (docs/play-contracts.md, 事件流): fetch plus a ReadableStream, frames
// split on blank lines, each `data:` line a JSON event with a rising `seq`. When the connection
// drops before `done`, the stream is picked up again from the last event received in order:
// GET …/turns/{turnId}/events?after=<seq>, at most three times, after 1, 2 and 4 seconds.
import type { Turn, TurnEvent } from '../contracts';
import { ApiError, play } from './client';

/** Splits what has arrived into complete frames and the unfinished rest. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((frame) => frame.trim() !== ''), rest };
}

/** The data of one frame: its data lines joined; comments and other fields are skipped. */
export function frameData(frame: string): string | null {
  const lines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return lines.length > 0 ? lines.join('\n') : null;
}

/** Reads a stream response and yields its events in arrival order. */
export async function* readEvents(response: Response): AsyncGenerator<TurnEvent> {
  if (!response.body) throw new ApiError('bad_response', undefined, response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const { frames, rest } = splitFrames(done ? `${buffer}\n\n` : buffer);
      buffer = rest;
      for (const frame of frames) {
        const data = frameData(frame);
        if (data === null || data === '[DONE]') continue;
        let event: TurnEvent;
        try {
          event = JSON.parse(data) as TurnEvent;
        } catch {
          throw new ApiError('bad_response', undefined, response.status);
        }
        yield event;
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    // stopped early (the last word arrived, or an error): let the connection go
    if (!finished) void reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
}

/**
 * Puts events back in order. An event is handed on only once every earlier `seq` has been; the ones
 * that come early wait, the ones seen before are dropped. `done` and `error` are the server's last
 * word and are handed on at once, after whatever was waiting.
 */
export class Sequencer {
  private next: number;
  private readonly held = new Map<number, TurnEvent>();

  constructor(after = 0) {
    this.next = after + 1;
  }

  /** The last seq handed on in order: where a resumed stream must start. */
  get after(): number {
    return this.next - 1;
  }

  push(event: TurnEvent): TurnEvent[] {
    if (event.seq < this.next || this.held.has(event.seq)) return [];
    if (event.event === 'done' || event.event === 'error') {
      const waiting = [...this.held.values()].filter((e) => e.seq < event.seq).sort((a, b) => a.seq - b.seq);
      this.held.clear();
      this.next = event.seq + 1;
      return [...waiting, event];
    }
    if (event.seq > this.next) {
      this.held.set(event.seq, event);
      return [];
    }
    const out: TurnEvent[] = [event];
    this.next += 1;
    for (let held = this.held.get(this.next); held; held = this.held.get(this.next)) {
      this.held.delete(this.next);
      out.push(held);
      this.next += 1;
    }
    return out;
  }
}

export const RETRY_DELAYS = [1000, 2000, 4000];

export interface TurnStreamOptions {
  saveId: string;
  /** opens the stream: the POST of a turn or of a retry, with the same requestId each time */
  start: (signal?: AbortSignal) => Promise<Response>;
  onEvent: (event: TurnEvent) => void;
  /** a dropped connection is being picked up again: attempt 1 to 3 */
  onReconnect?: (attempt: number) => void;
  signal?: AbortSignal;
  /** the turn and position to pick up from, when resuming a turn already under way */
  turnId?: string;
  after?: number;
  /** waits between attempts; tests replace it */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** where a dropped stream continues; defaults to the play interface */
  resume?: (turnId: string, after: number, signal?: AbortSignal) => Promise<Response>;
  /** asks for the turn under way when the connection dropped before its first event */
  pending?: (signal?: AbortSignal) => Promise<Turn | null>;
}

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ApiError('aborted'));
    });
  });
}

/**
 * Follows a turn's events to the end. Resolves with the last event's kind ('done' or 'error');
 * throws ApiError('network') when three attempts to pick the stream up again have failed, and
 * ApiError('aborted') when the signal fires.
 */
export async function streamTurn(options: TurnStreamOptions): Promise<'done' | 'error'> {
  const { saveId, start, onEvent, onReconnect, signal } = options;
  const wait = options.wait ?? defaultWait;
  const resume = options.resume ?? ((turn, after, s) => play.turnEvents(saveId, turn, after, s));
  const pending = options.pending ?? ((s) => play.pending(saveId, s));
  const order = new Sequencer(options.after ?? 0);
  let turnId = options.turnId;
  let attempt = 0;
  let connect: () => Promise<Response> = turnId ? () => resume(turnId as string, order.after, signal) : () => start(signal);

  for (;;) {
    if (signal?.aborted) throw new ApiError('aborted');
    let progressed = false;
    try {
      const response = await connect();
      for await (const event of readEvents(response)) {
        for (const ready of order.push(event)) {
          progressed = true;
          if (ready.event === 'turn') turnId = ready.turn.id;
          onEvent(ready);
          if (ready.event === 'done' || ready.event === 'error') return ready.event;
        }
      }
    } catch (error) {
      // the session is gone for every save: said even when the page let go of this turn on its way to
      // the login (store/account.ts), so the turn's words are kept for the player's return
      if (error instanceof ApiError && error.code === 'unauthorized') throw error;
      if (signal?.aborted || (error instanceof ApiError && error.code === 'aborted')) throw new ApiError('aborted');
      // the server refused outright: nothing to pick up
      if (error instanceof ApiError && !['network', 'bad_response'].includes(error.code)) throw error;
    }
    // the connection ended before the last word: pick it up again
    if (progressed) attempt = 0;
    attempt += 1;
    const delay = RETRY_DELAYS[attempt - 1];
    if (delay === undefined) throw new ApiError('network', '连接中断，重连了三次仍没接上。写下的字还在，稍后重试。');
    onReconnect?.(attempt);
    await wait(delay, signal);
    connect = async () => {
      if (!turnId) {
        let under: Turn | null;
        try {
          under = await pending(signal);
        } catch (error) {
          // a server from before 204 said 404 for no turn under way
          if (error instanceof ApiError && error.code === 'not_found') under = null;
          else throw error;
        }
        // the server never started the turn: send it again, same requestId
        if (!under) return start(signal);
        turnId = under.id;
      }
      return resume(turnId, order.after, signal);
    };
  }
}
