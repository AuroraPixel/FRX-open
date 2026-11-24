// Saves outside play in sample-data mode (?fixture=<name>): the creation's draws, a new save, deleting,
// exporting and importing a save file, the full backup and its restore, and picking someone's portrait.
// Each is answered from the sample set's files and remembered for the rest of the visit, so the title,
// saves and creation screens and the people panel can be walked, screenshot and tested without a server.
//
//   creation.json   GET /creation (fixtures.ts serves it as a plain file)
//   draws.json      POST /creation/draw: { "traits": DrawAnswer[], "root": DrawAnswer[] }; round n answers
//                   entry n - 1, cycling, with its round set to n
//   created.json    POST /saves: the new save's summary; its name and portrait are the request's
//   import.json     POST /saves/import/preview; POST /saves/import then lists imported.json, or a copy of the
//                   first save under the file's name
//   backup.json     POST /backup/preview; POST /backup/restore answers its names
// Picking a portrait (PUT …/people/{id}/portrait) changes what people.json, person-<id>.json and the state
// say about that person afterwards.
import type { Character, CreationOptions, PeopleView, PersonDetail, Recipe, SaveSummary, StateView } from '../contracts';
import { simulatedState } from './fixture-actions';

type Load = (name: string) => Promise<unknown>;

const lists = new Map<string, SaveSummary[]>();
const portraits = new Map<string, Record<string, Recipe>>();

/** Forgets every simulated change (tests start from the sample again). */
export function resetSavesSimulation(): void {
  lists.clear();
  portraits.clear();
}

function answer(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function refuse(status: number, code: string, message: string): Response {
  return answer({ error: { code, message } }, status);
}

function attachment(body: BodyInit, filename: string, type: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` },
  });
}

async function list(set: string, load: Load): Promise<SaveSummary[]> {
  let found = lists.get(set);
  if (!found) {
    found = structuredClone(((await load('saves')) as SaveSummary[] | undefined) ?? []);
    lists.set(set, found);
  }
  return found;
}

async function text(body: BodyInit | null | undefined): Promise<string> {
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body.text();
  return '';
}

function withPortrait<T extends Character>(person: T, chosen: Record<string, Recipe>): T {
  const recipe = chosen[person.id];
  return recipe ? { ...person, portrait: recipe } : person;
}

const PATHS = {
  draw: /^\/creation\/draw$/,
  saves: /^\/saves$/,
  save: /^\/saves\/([^/]+)$/,
  exportFile: /^\/saves\/([^/]+)\/export$/,
  importPreview: /^\/saves\/import\/preview$/,
  importFile: /^\/saves\/import$/,
  backup: /^\/backup$/,
  backupPreview: /^\/backup\/preview$/,
  restore: /^\/backup\/restore$/,
  portrait: /^\/saves\/[^/]+\/people\/([^/]+)\/portrait$/,
  people: /^\/saves\/[^/]+\/people$/,
  person: /^\/saves\/[^/]+\/people\/([^/]+)$/,
  state: /^\/saves\/[^/]+\/state$/,
};

/**
 * Answers one request about saves outside play for a sample set, or undefined when it is not one of these
 * (fixtures.ts then answers it as before).
 */
export async function answerSaves(
  set: string,
  method: string,
  path: string,
  init: RequestInit,
  load: Load,
): Promise<Response | undefined> {
  if (method === 'POST' && PATHS.draw.test(path)) {
    const body = JSON.parse(await text(init.body)) as { kind: 'traits' | 'root'; round?: number };
    const draws = (await load('draws')) as Record<string, unknown[]> | undefined;
    const rounds = draws?.[body.kind];
    if (!rounds?.length) return refuse(404, 'not_found', '样例数据里没有抽取。');
    const round = body.round ?? 1;
    return answer({ ...(rounds[(round - 1) % rounds.length] as object), round });
  }
  if (method === 'GET' && PATHS.saves.test(path) && lists.has(set)) return answer(lists.get(set));
  if (method === 'POST' && PATHS.saves.test(path)) {
    const input = JSON.parse(await text(init.body)) as { name: string; portrait: Recipe; play?: string };
    if (input.play !== undefined && input.play !== 'life') return refuse(422, 'invalid_input', '新存档只支持修仙人生');
    const options = (await load('creation')) as CreationOptions | undefined;
    if (!options?.play?.available) return refuse(422, 'refused', options?.play?.reason ?? '暂时无法开启修仙人生');
    const made = (await load('created')) as SaveSummary | undefined;
    if (!made) return refuse(404, 'not_found', '样例数据里没有新档。');
    const saves = await list(set, load);
    if (saves.some((save) => save.name === input.name)) return refuse(409, 'version_conflict', '已有同名的存档，请换个名字');
    const summary: SaveSummary = { ...made, play: 'life', name: input.name, player: { ...made.player, portrait: input.portrait } };
    saves.unshift(summary);
    return answer(summary, 201);
  }
  const one = PATHS.save.exec(path);
  if (method === 'DELETE' && one) {
    const saves = await list(set, load);
    const at = saves.findIndex((save) => save.id === decodeURIComponent(one[1]!));
    if (at < 0) return refuse(404, 'not_found', '存档不存在');
    saves.splice(at, 1);
    return new Response(null, { status: 204 });
  }
  const exported = PATHS.exportFile.exec(path);
  if (method === 'GET' && exported) {
    const save = (await list(set, load)).find((s) => s.id === decodeURIComponent(exported[1]!));
    if (!save) return refuse(404, 'not_found', '存档不存在');
    const file = JSON.stringify({
      format: 'frx-save', version: 1,
      archive: { id: save.id, name: save.name, attributes: {}, metadata: {} },
      state: { currentState: {} }, logs: [], snapshots: {}, snapshotRefs: [],
      memories: [], art: {}, places: [], requests: [], media: {},
    }, null, 2);
    return attachment(file, `${save.name}.json`, 'application/json');
  }
  if (method === 'POST' && PATHS.importPreview.test(path)) {
    const preview = await load('import');
    return preview ? answer(preview) : refuse(422, 'refused', '文件格式无效或已损坏');
  }
  if (method === 'POST' && PATHS.importFile.test(path)) {
    const preview = (await load('import')) as { name: string } | undefined;
    const saves = await list(set, load);
    const first = saves[0];
    const made = ((await load('imported')) as SaveSummary | undefined) ??
      (first && preview ? { ...first, id: `${first.id}-copy`, name: preview.name, version: 1 } : undefined);
    if (!made) return refuse(422, 'refused', '文件格式无效或已损坏');
    saves.unshift(made);
    return answer(made, 201);
  }
  if (method === 'GET' && PATHS.backup.test(path)) {
    return attachment(new Blob(['PK sample backup']), 'frx-backup.zip', 'application/zip');
  }
  if (method === 'POST' && PATHS.backupPreview.test(path)) {
    const preview = await load('backup');
    return preview ? answer(preview) : refuse(422, 'refused', '备份格式或文件摘要无效，没有写入存档');
  }
  if (method === 'POST' && PATHS.restore.test(path)) {
    const preview = (await load('backup')) as { archive_names: string[] } | undefined;
    if (!preview) return refuse(422, 'refused', '备份格式或文件摘要无效，没有写入存档');
    return answer({ archives: preview.archive_names, play_art: preview.archive_names.length });
  }
  const picked = PATHS.portrait.exec(path);
  if (method === 'PUT' && picked) {
    const recipe = JSON.parse(await text(init.body)) as Recipe;
    portraits.set(set, { ...portraits.get(set), [decodeURIComponent(picked[1]!)]: recipe });
    return answer(recipe);
  }
  const chosen = portraits.get(set);
  if (method !== 'GET' || !chosen) return undefined;
  if (PATHS.people.test(path)) {
    const people = (await load('people')) as PeopleView | undefined;
    if (!people) return undefined;
    return answer({
      present: people.present.map((p) => withPortrait(p, chosen)),
      known: people.known.map((p) => withPortrait(p, chosen)),
    });
  }
  const person = PATHS.person.exec(path);
  if (person) {
    const detail = (await load(`person-${person[1]}`)) as PersonDetail | undefined;
    return detail ? answer(withPortrait(detail, chosen)) : undefined;
  }
  if (PATHS.state.test(path)) {
    const state = (simulatedState(set) ?? ((await load('state')) as StateView | undefined));
    if (!state) return undefined;
    return answer({
      ...state,
      player: withPortrait(state.player, chosen),
      people: state.people.map((p) => withPortrait(p, chosen)),
    });
  }
  return undefined;
}
