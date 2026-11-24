// The one place that talks to the server: /api/play/*, every request marked X-FRX-Client: local.
// Errors arrive as {error: {code, message}} with a Chinese message that can be shown as is. With
// ?fixture=<name> in the address the answers come from apps/play-web/fixtures/<name>/ instead,
// and nothing goes over the network.
import type {
  BookView,
  CalendarView,
  DirectorChange,
  DirectorView,
  ErrorDetail,
  EventsView,
  GateSheet,
  LifeView,
  GuidanceRequest,
  MapView,
  NewsView,
  NoticeBoard,
  PanelAction,
  PanelResult,
  PeopleView,
  PersonDetail,
  PlaySettings,
  PlotSwitch,
  Recipe,
  SaveSummary,
  ShopView,
  StateView,
  Turn,
  TurnPage,
  TurnRequest,
  UndoRequest,
  UndoResult,
  Verb,
  VerbPreview,
  VersionRequest,
  CreationInput,
} from '../contracts';
import { pins } from '../lib/params';
import { fixtureFetch } from './fixtures';

/** The server's codes, plus three of the client's own. */
export type ErrorCode = ErrorDetail['code'] | 'network' | 'bad_response' | 'aborted';

const SAID: Record<ErrorCode, string> = {
  version_conflict: '这个存档在别处被改过，重新载入后再继续。',
  turn_in_progress: '上一回合还没有写完。',
  pending_settlement: '上一回合还有待结算的事。',
  not_found: '没有找到这一项。',
  unauthorized: '需要先登录。',
  quota_exceeded: '今天的用量已经到了上限。',
  input_too_large: '这段话太长了，删短一些再发。',
  model_not_configured: '还没有配置模型，先到设置里填好模型连接。',
  model_failed: '模型那边出了错，稍后重试。',
  engine_failed: '结算出了错，稍后重试。',
  cancelled: '这一回合已取消。',
  refused: '这样不行，换一个再试。',
  forbidden: '这件事只有管理员能做。',
  busy: '服务器正忙，稍后再试。',
  too_many_attempts: '登录失败的次数太多，过一会儿再试。',
  invalid_input: '填写的内容不对，改一下再试。',
  email_unavailable: '暂时没能发送验证码，请稍后重试。',
  network: '连接中断了。写下的字还在，稍后重试。',
  bad_response: '服务端的回话读不懂，稍后重试。',
  aborted: '已停下。',
};

const RETRYABLE = new Set<ErrorCode>(['network', 'model_failed', 'engine_failed', 'turn_in_progress', 'bad_response', 'busy', 'email_unavailable']);

const BY_STATUS: Record<number, ErrorCode> = {
  400: 'model_not_configured',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  422: 'invalid_input',
  409: 'version_conflict',
  413: 'input_too_large',
  429: 'quota_exceeded',
  500: 'engine_failed',
  502: 'model_failed',
  503: 'email_unavailable',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfter?: number;

  constructor(code: ErrorCode, message?: string, status = 0, retryable = RETRYABLE.has(code), retryAfter?: number) {
    super(message || SAID[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export const API_BASE = '/api/play';

type Transport = (input: string, init: RequestInit) => Promise<Response>;

/** Where requests go: the network, or the sample data with ?fixture= in development and screenshot builds. */
export function transport(): Transport {
  const fixture = __DEV_PAGES__ ? pins().fixture : undefined;
  if (fixture) return fixtureFetch(fixture, pins().speed);
  return (input, init) => fetch(input, init);
}

/** The ApiError a failed response stands for: its {error: {code, message}}, else by its status. */
export async function errorFrom(response: Response): Promise<ApiError> {
  let detail: Partial<ErrorDetail> | undefined;
  try {
    detail = ((await response.json()) as { error?: Partial<ErrorDetail> }).error;
  } catch {
    detail = undefined;
  }
  const code: ErrorCode = (detail?.code as ErrorCode | undefined) ?? BY_STATUS[response.status] ?? 'bad_response';
  const delay = Number(response.headers.get('Retry-After'));
  return new ApiError(code, detail?.message, response.status, undefined,
    Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : undefined);
}

function aborted(error: unknown, signal?: AbortSignal | null): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

let onSignedOut: ((path: string) => void) | null = null;

/**
 * Who hears that the session has gone: any answer 401 except from the account's own requests under
 * /account, whose 401s (a wrong password, nobody signed in yet) the account store reads itself. It is
 * told before the request's error is thrown, so the page is on its way to the login when the caller
 * sees the error.
 */
export function whenSignedOut(handler: ((path: string) => void) | null): void {
  onSignedOut = handler;
}

/** Sends a request and returns the raw response; throws ApiError for anything but 2xx. */
export async function request(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    'X-FRX-Client': 'local',
    Accept: 'application/json, text/event-stream',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await transport()(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (aborted(error, signal)) throw new ApiError('aborted');
    throw new ApiError('network');
  }
  if (!response.ok) {
    const error = await errorFrom(response);
    if (response.status === 401 && !path.startsWith('/account')) onSignedOut?.(path);
    throw error;
  }
  return response;
}

/** Sends a request and reads its JSON answer. */
export async function json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await request(method, path, body, signal);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (aborted(error, signal)) throw new ApiError('aborted');
    throw new ApiError('bad_response', undefined, response.status);
  }
}

const id = encodeURIComponent;

/** The play interface (docs/play-contracts.md, section 四). Streams come back as raw responses. */
export const play = {
  saves: (signal?: AbortSignal) => json<SaveSummary[]>('GET', '/saves', undefined, signal),
  createSave: (input: CreationInput) => json<SaveSummary>('POST', '/saves', input),
  deleteSave: (save: string, version: number) => json<void>('DELETE', `/saves/${id(save)}?version=${version}`),
  state: (save: string, signal?: AbortSignal) => json<StateView>('GET', `/saves/${id(save)}/state`, undefined, signal),
  turns: (save: string, before?: number, signal?: AbortSignal) =>
    json<TurnPage>(
      'GET',
      `/saves/${id(save)}/turns?limit=10${before !== undefined ? `&before=${before}` : ''}`,
      undefined,
      signal,
    ),
  /** The turn under way or waiting for its settlement; null when there is none (204). */
  pending: async (save: string, signal?: AbortSignal): Promise<Turn | null> =>
    (await json<Turn | undefined>('GET', `/saves/${id(save)}/turns/pending`, undefined, signal)) ?? null,
  postTurn: (save: string, body: TurnRequest, signal?: AbortSignal) =>
    request('POST', `/saves/${id(save)}/turns`, body, signal),
  turnEvents: (save: string, turn: string, after: number, signal?: AbortSignal) =>
    request('GET', `/saves/${id(save)}/turns/${id(turn)}/events?after=${after}`, undefined, signal),
  retry: (save: string, turn: string, body: VersionRequest, signal?: AbortSignal) =>
    request('POST', `/saves/${id(save)}/turns/${id(turn)}/retry`, body, signal),
  cancel: (save: string, turn: string) => json<{ status: string }>('POST', `/saves/${id(save)}/turns/${id(turn)}/cancel`),
  undo: (save: string, body: UndoRequest) => json<UndoResult>('POST', `/saves/${id(save)}/undo`, body),
  action: (save: string, body: PanelAction) => json<PanelResult>('POST', `/saves/${id(save)}/actions`, body),
  /** The cultivation life: the book's volumes and their 回 (目录, plan item 38). */
  book: (save: string, signal?: AbortSignal) => json<BookView>('GET', `/saves/${id(save)}/book`, undefined, signal),
  /** The cultivation life: the next years of the calendar (日历). */
  calendar: (save: string, signal?: AbortSignal) => json<CalendarView>('GET', `/saves/${id(save)}/calendar`, undefined, signal),
  /** The cultivation life: the next gate's preparation sheet (准备单); with `aids` (bag ids, one a pill) those pills
   *  priced, none for an empty list (`?aids=`); without it, the bag's pills as many as count. */
  gate: (save: string, aids?: readonly string[], signal?: AbortSignal) =>
    json<GateSheet>('GET', `/saves/${id(save)}/gate${aids ? `?aids=${aids.map(id).join(',')}` : ''}`, undefined, signal),
  /** The cultivation life: the notices up here this half-year (差事, plan item 35). */
  notices: (save: string, signal?: AbortSignal) => json<NoticeBoard>('GET', `/saves/${id(save)}/notices`, undefined, signal),
  /** The cultivation life: what the shops here sell and take, at what price (买卖, plan item 35). */
  shop: (save: string, signal?: AbortSignal) => json<ShopView>('GET', `/saves/${id(save)}/shop`, undefined, signal),
  /** The cultivation life: a whole life as data (一生的年谱, plan item 49): the latest that ended, the dying
   *  protagonist's while the heir is chosen, the life under way when none ended; `index` an earlier one. */
  life: (save: string, index?: number, signal?: AbortSignal) =>
    json<LifeView>('GET', `/saves/${id(save)}/life${index !== undefined ? `?index=${index}` : ''}`, undefined, signal),
  /** The cultivation life: what a standing command would do if done now (修炼面板的预览); nothing is written. */
  preview: (save: string, verb: Verb, signal?: AbortSignal) =>
    json<VerbPreview>('POST', `/saves/${id(save)}/preview`, { verb }, signal),
  map: (save: string) => json<MapView>('GET', `/saves/${id(save)}/map`),
  people: (save: string) => json<PeopleView>('GET', `/saves/${id(save)}/people`),
  /** Someone by id; with the name an old turn gives, the one it named, though the id is someone else's now. */
  person: (save: string, char: string, name?: string) =>
    json<PersonDetail>('GET', `/saves/${id(save)}/people/${id(char)}${name ? `?name=${id(name)}` : ''}`),
  setPortrait: (save: string, char: string, recipe: Recipe) =>
    json<Recipe>('PUT', `/saves/${id(save)}/people/${id(char)}/portrait`, recipe),
  world: (save: string) => json<EventsView>('GET', `/saves/${id(save)}/events`),
  news: (save: string) => json<NewsView>('GET', `/saves/${id(save)}/news`),
  settings: () => json<PlaySettings>('GET', '/settings'),
  saveSettings: (body: PlaySettings) => json<PlaySettings>('PUT', '/settings', body),
  rebuildMemory: (save: string) => json<{ jobs: number }>('POST', `/saves/${id(save)}/memory/rebuild`),
  /** plot evolution for one save: its status, a run now, the main plot switch, 我的指示 */
  director: (save: string) => json<DirectorView>('GET', `/saves/${id(save)}/director`),
  runDirector: (save: string) => json<DirectorView>('POST', `/saves/${id(save)}/director/run`),
  setPlot: (save: string, body: PlotSwitch) => json<DirectorChange>('POST', `/saves/${id(save)}/director/plot`, body),
  setGuidance: (save: string, body: GuidanceRequest) =>
    json<DirectorChange>('PUT', `/saves/${id(save)}/director/guidance`, body),
};
