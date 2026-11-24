// Sample-data mode (?fixture=<name>): answers the play interface from apps/play-web/fixtures/<name>/
// without touching the network. Panel actions are played out on a copy of the sample's state
// (fixture-actions.ts). Only development and screenshot builds carry the samples.
//
//   saves.json, state.json, turns.json   the lists and views, as the server sends them
//   stream.json     the events of a whole turn (turn … done), replayed for a new turn and for a retry,
//                   each event after its recorded delay (scaled by ?speed=; 0 sends everything at once)
//   pending.json    the turn under way or waiting for its settlement (GET …/turns/pending; else 204)
//   resume.json     the events a resumed turn replays (GET …/events?after=); stream.json when absent. They
//                   start once the play screen has drawn its first scene (lib/opening.ts), so a change of
//                   scene in them always has the save's own place to leave from
//   refuse.json     requests the server turns down: { "POST turns": { "status": 409, "error": {…} } },
//                   keyed by method and the last part of the path (turns, retry, cancel, undo, events,
//                   check: trying a model)
//   person-<id>.json  one person's page
//   preview.json    answers to POST …/preview (the cultivation life's standing commands seen before they are
//                   done): [{ verb, preview }], the one whose verb is most like the request's answers (a
//                   journey's only for its own destination, a notice's, a good's, a piece's, a beast's or a
//                   recipe's only for its own)
//   life.json       GET …/life (一生的年谱, gameplay plan item 49); with ?index=n, life-<n>.json when the set has it
//   creation.json, draws.json, created.json, import.json, backup.json   saves outside play (fixture-saves.ts)
//   account-options.json, account.json, account-usage.json   accounts mode (fixture-account.ts); without
//                   them a set stands for local mode
//
// A recorded event may carry "then": "drop" (the connection breaks after it) or "hang" (the
// connection stays open and silent after it), to show a dropped stream being picked up again.
import type {
  ErrorBody,
  PeopleView,
  PersonDetail,
  PreviewRequest,
  StateView,
  Turn,
  TurnEvent,
  TurnPage,
  UndoRequest,
  Verb,
  VerbPreview,
} from '../contracts';
import { openingScene } from '../lib/opening';
import { type Hour, pins } from '../lib/params';
import { answerAccount } from './fixture-account';
import { simulateAction, simulatedState, withBonds } from './fixture-actions';
import { answerSaves } from './fixture-saves';

type Loader = () => Promise<unknown>;

const FILES: Record<string, Loader> = __DEV_PAGES__
  ? import.meta.glob<unknown>('../../fixtures/*/*.json', { import: 'default' })
  : {};

export interface RecordedEvent {
  /** milliseconds to wait before this event */
  after: number;
  event: TurnEvent;
  then?: 'drop' | 'hang';
}

type Refusals = Record<string, { status: number } & ErrorBody>;

async function load(set: string, name: string): Promise<unknown | undefined> {
  const loader = FILES[`../../fixtures/${set}/${name}.json`];
  return loader ? loader() : undefined;
}

export function fixtureNames(): string[] {
  return [...new Set(Object.keys(FILES).map((file) => file.split('/')[3] ?? ''))].filter(Boolean).sort();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function missing(what: string): Response {
  return jsonResponse({ error: { code: 'not_found', message: `样例数据里没有${what}。` } }, 404);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * An event-stream response that plays the recorded events after `after`, with their delays. Each
 * event is handed over when the reader asks for it, so a break after an event comes only once that
 * event has been read.
 */
export function replay(events: RecordedEvent[], after: number, speed: number, signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  const left = events.filter((item) => item.event.seq > after);
  let at = 0;
  let then: RecordedEvent['then'];
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (then === 'drop') {
          controller.error(new TypeError('the sample connection broke'));
          return;
        }
        if (then === 'hang') {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            signal?.addEventListener('abort', () => resolve());
          });
          controller.close();
          return;
        }
        const item = left[at];
        if (!item || signal?.aborted) {
          controller.close();
          return;
        }
        at += 1;
        if (speed > 0) await sleep(item.after / speed, signal);
        if (signal?.aborted) {
          controller.close();
          return;
        }
        then = item.then;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item.event)}\n\n`));
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const TURNS = /^\/saves\/[^/]+\/turns$/;
const EVENTS = /^\/saves\/[^/]+\/turns\/[^/]+\/events$/;
const RETRY = /^\/saves\/[^/]+\/turns\/[^/]+\/retry$/;
const CANCEL = /^\/saves\/[^/]+\/turns\/[^/]+\/cancel$/;
const PENDING = /^\/saves\/[^/]+\/turns\/pending$/;
const UNDO = /^\/saves\/[^/]+\/undo$/;
const SAVE_PART = /^\/saves\/[^/]+\/([a-z]+)$/;
const PERSON = /^\/saves\/[^/]+\/people\/([^/]+)$/;
const ACTIONS = /^\/saves\/[^/]+\/actions$/;
const MODEL_CHECK = /^\/profiles\/[^/]+\/check$/;
const STATE = /^\/saves\/[^/]+\/state$/;
const PREVIEW = /^\/saves\/[^/]+\/preview$/;

/** The sample sets' writes, in order: what a fixture-mode page sent (end-to-end checks read it). */
export const fixtureLog: { method: string; path: string; body: unknown }[] = [];
if (__DEV_PAGES__ && typeof window !== 'undefined') (window as { __frxSent?: typeof fixtureLog }).__frxSent = fixtureLog;

export interface PreviewSample {
  verb: Verb;
  preview: VerbPreview;
}

/**
 * The sample answer most like a request's verb: of its kind, scored over how long it lasts, whether it
 * spends stones, how many and whether it haggles (the same value 2, the same kind of length 1). A
 * journey answers only for its own destination (`to`), a notice or a good only for its own id (and side),
 * a piece, a beast or a recipe for its own (itemId, beastId, recipe): the sample of another would name that
 * place or thing.
 */
export function pickPreview(samples: readonly PreviewSample[], verb: Verb): VerbPreview | undefined {
  const keys = ['days', 'until', 'full', 'hours', 'stones', 'count', 'haggle', 'tier', 'smith', 'batches', 'hire', 'item', 'charge', 'person', 'room'] as const;
  const plain = (value: unknown) => (value === false || value === undefined || value === null ? undefined : value);
  let best: { score: number; preview: VerbPreview } | undefined;
  for (const sample of samples) {
    if (sample.verb.kind !== verb.kind) continue;
    // a journey, a notice, a good: only its own (another's would name the wrong place or thing)
    if (
      plain(sample.verb.to) !== plain(verb.to) ||
      plain(sample.verb.id) !== plain(verb.id) ||
      plain(sample.verb.side) !== plain(verb.side) ||
      plain(sample.verb.recipe) !== plain(verb.recipe) ||
      // 洞府's doings and 布阵's arrays: only the same one (plan items 45 and 43)
      plain(sample.verb.action) !== plain(verb.action) ||
      plain(sample.verb.name) !== plain(verb.name) ||
      plain(sample.verb.repair) !== plain(verb.repair)
    )
      continue;
    let score = 0;
    for (const key of keys) {
      const [mine, asked] = [plain(sample.verb[key]), plain(verb[key])];
      if (mine === asked) score += 2;
      else if ((mine === undefined) === (asked === undefined)) score += 1;
    }
    if (!best || score > best.score) best = { score, preview: sample.preview };
  }
  return best?.preview;
}

/** The key a refusal is filed under: 「POST turns」, 「GET events」… */
function refusalKey(method: string, path: string): string {
  return `${method} ${path.split('/').filter(Boolean).pop() ?? ''}`;
}

/** What going back to the end of a turn leaves: the sample state, moved back, one version on. */
async function undone(set: string, body: BodyInit | null | undefined): Promise<Response> {
  const state = (await load(set, 'state')) as StateView | undefined;
  if (!state) return missing('状态');
  const request = (typeof body === 'string' ? JSON.parse(body) : {}) as Partial<UndoRequest>;
  const toTurn = request.toTurn ?? state.turnNo - 1;
  return jsonResponse({ state: { ...state, turnNo: toTurn, version: state.version + 1 }, turns: toTurn });
}

const HOUR_NAMES: Record<Hour, string> = { night: '子时', dawn: '卯时', day: '午时', dusk: '酉时' };

/**
 * The sample's state, standing in the scene and at the hour the address pins (?scene=, ?hour=), and in
 * a place of the scene's family composed from its kit (?place=, ?region=, and ?kind=, the place's own scene type, which
 * a room takes after), or from another kit by the place's look (?kit=, ?look=).
 */
function pinnedScene(view: StateView): StateView {
  const { scene, hour, place, region, kind, kit, look } = pins();
  if (!scene && !hour) return view;
  const composed = scene && place
    ? {
      kit: `kit-${kit ?? scene}`, id: place, name: place, region: region ?? '潮岚道', ...(kind ? { kind } : {}),
      ...(look ? { look } : {}),
    }
    : undefined;
  return {
    ...view,
    ...(scene ? { scene: { ...view.scene, sceneId: scene, ...(composed ? { composed } : {}), ...(look ? { look } : {}) } } : {}),
    ...(hour ? { time: { ...view.time, hour, hourName: HOUR_NAMES[hour] } } : {}),
  };
}

/** A fetch for one sample set. Paths are those of the play interface, /api/play included. */
export function fixtureFetch(set: string, speed: number) {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, 'http://local');
    const path = url.pathname.replace(/^\/api\/play/, '');
    const method = (init.method ?? 'GET').toUpperCase();

    if (method !== 'GET') {
      let body: unknown = init.body;
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        // kept as it came
      }
      fixtureLog.push({ method, path, body });
    }

    const refusal = ((await load(set, 'refuse')) as Refusals | undefined)?.[refusalKey(method, path)];
    if (refusal) return jsonResponse({ error: refusal.error }, refusal.status);

    const account = await answerAccount(method, path, (name) => load(set, name));
    if (account) return account;

    const outside = await answerSaves(set, method, path, init, (name) => load(set, name));
    if (outside) return outside;

    if (method === 'GET' && EVENTS.test(path)) {
      const stream = ((await load(set, 'resume')) ?? (await load(set, 'stream'))) as RecordedEvent[] | undefined;
      if (!stream) return missing('回合的事件流');
      await openingScene();
      return replay(stream, Number(url.searchParams.get('after') ?? 0), speed, init.signal);
    }
    if (method === 'POST' && (TURNS.test(path) || RETRY.test(path))) {
      const stream = (await load(set, 'stream')) as RecordedEvent[] | undefined;
      if (!stream) return missing('回合的事件流');
      return replay(stream, 0, speed, init.signal);
    }
    if (method === 'POST' && CANCEL.test(path)) return jsonResponse({ status: 'cancelled' });
    // trying a model (设置 · 模型连接): it answers, unless the set's refuse.json says otherwise
    if (method === 'POST' && MODEL_CHECK.test(path)) {
      const { model } = JSON.parse(String(init.body ?? '{}')) as { model?: string };
      return jsonResponse({ model: model ?? '', answers: true });
    }
    if (method === 'POST' && UNDO.test(path)) return undone(set, init.body);
    if (method === 'POST' && ACTIONS.test(path)) {
      return simulateAction(set, init.body, () => load(set, 'state'), () => load(set, 'people'));
    }
    if (method === 'POST' && PREVIEW.test(path)) {
      const samples = (await load(set, 'preview')) as PreviewSample[] | undefined;
      const asked = (JSON.parse(String(init.body ?? '{}')) as Partial<PreviewRequest>).verb;
      const preview = samples && asked ? pickPreview(samples, asked) : undefined;
      return preview ? jsonResponse(preview) : missing('这个指令的预览');
    }
    if (method !== 'GET') return missing('这项操作');
    if (PENDING.test(path)) {
      const turn = (await load(set, 'pending')) as Turn | undefined;
      return turn ? jsonResponse(turn) : new Response(null, { status: 204 });
    }
    if (STATE.test(path)) {
      const state = simulatedState(set) ?? ((await load(set, 'state')) as StateView | undefined);
      return state ? jsonResponse(pinnedScene(state)) : missing('状态');
    }
    if (path === '/saves') return jsonResponse((await load(set, 'saves')) ?? []);
    if (TURNS.test(path)) {
      const page = (await load(set, 'turns')) as TurnPage | undefined;
      if (!page) return missing('历史回合');
      const before = url.searchParams.get('before');
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const older = page.turns.filter((turn: Turn) => before === null || turn.no < Number(before));
      return jsonResponse({ turns: older.slice(-limit), more: older.length > limit });
    }
    const person = PERSON.exec(path);
    if (person) {
      const detail = (await load(set, `person-${person[1]}`)) as PersonDetail | undefined;
      return detail ? jsonResponse(withBonds(set, detail)) : missing('这个人物');
    }
    const part = SAVE_PART.exec(path);
    if (part?.[1]) {
      // an earlier life of the record (?index=), when the set has one of its own
      const index = part[1] === 'life' ? url.searchParams.get('index') : null;
      const data = (index !== null ? await load(set, `life-${index}`) : undefined) ?? (await load(set, part[1]));
      if (data !== undefined && part[1] === 'people') return jsonResponse(withBonds(set, data as PeopleView));
      return data === undefined ? missing(`「${part[1]}」`) : jsonResponse(data);
    }
    const plain = await load(set, path.replace(/^\//, '').replace(/\//g, '-'));
    return plain === undefined ? missing(`「${path}」`) : jsonResponse(plain);
  };
}
