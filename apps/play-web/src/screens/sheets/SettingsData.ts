// What the settings panel reads and writes on the server (plan item 47): the model connection and
// the model of each profile, which keep the old page's shapes (snake_case, docs/play-contracts.md
// 四: 「沿用现有实现的形状」), and the licences listed in THIRD-PARTY-NOTICES.md for 关于.
import { ApiError, json } from '../../api/client';
import notices from '../../../../../THIRD-PARTY-NOTICES.md';

/** GET /connection: the main model connection; its key is never sent back, only whether one is set. */
export interface Connection {
  base_url: string;
  model: string;
  configured: boolean;
  key_set: boolean;
  /** set from the server's environment: it cannot be changed here */
  environment_managed: boolean;
}

/** PUT /connection. A blank key keeps the saved one; clear_key removes it. */
export interface ConnectionUpdate {
  base_url: string;
  model: string;
  api_key?: string;
  clear_key?: boolean;
}

/** GET /profiles: what each purpose (主回合, 总结与记忆 …) uses; address and key are the main connection's. */
export interface Profile {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  environment_managed: boolean;
}

const id = encodeURIComponent;

export const link = {
  connection: () => json<Connection>('GET', '/connection'),
  saveConnection: (body: ConnectionUpdate) => json<Connection>('PUT', '/connection', body),
  profiles: () => json<Profile[]>('GET', '/profiles'),
  chooseModel: (profile: string, model: string) => json<Profile[]>('PUT', `/profiles/${id(profile)}`, { model }),
  models: (profile: string) => json<{ models: string[] }>('GET', `/profiles/${id(profile)}/models`),
  /** one tiny call with the model: whether it answers (a relay lists models it cannot route) */
  checkModel: (profile: string, model: string) =>
    json<{ model: string; answers: boolean }>('POST', `/profiles/${id(profile)}/check`, { model }),
};

/**
 * Why an address will be refused, in the server's own terms (gateway.ModelConfig.check_url): http or
 * https with a host, and no user name, password, query or fragment. Empty when it will do.
 */
export function addressProblem(address: string): string {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return '地址要写全，以 http:// 或 https:// 开头。';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '地址要以 http:// 或 https:// 开头。';
  if (!url.hostname) return '地址里缺少主机名。';
  if (url.username || url.password) return '地址里不要带用户名和密码，密钥填在下面。';
  if (url.search || url.hash || address.includes('?') || address.includes('#')) return '地址里不要带问号或井号后面的部分。';
  return '';
}

/** What to tell the player when a write was refused; a 422 is the server rejecting the values. */
export function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return '没能保存，稍后重试。';
  if (error.status === 422) return '地址或模型名不合要求，改过再存。';
  return error.message;
}

/** One distributed part: 「react 19.3.1 MIT」. */
export interface Licence {
  name: string;
  version: string;
  licence: string;
}

export interface LicenceGroup {
  title: string;
  /** the sentence before the table, when there is one: 「运行时随页面分发：」 */
  note?: string;
  items: Licence[];
}

/**
 * The tables of THIRD-PARTY-NOTICES.md, by heading. Tables of tools used only to develop and build
 * (「不随页面分发」) are left out: the player is not given them.
 */
export function licenceGroups(text: string = notices): LicenceGroup[] {
  const groups: LicenceGroup[] = [];
  let title = '';
  let note: string | undefined;
  let current: LicenceGroup | null = null;
  let header = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      title = line.slice(3).trim();
      note = undefined;
      current = null;
      continue;
    }
    if (!line.startsWith('|')) {
      if (line) {
        note = line;
        current = null;
      }
      continue;
    }
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((cell) => cell.trim());
    if (!current) {
      // the first row of a table names its columns, the second is the rule under them
      current = { title, ...(note ? { note } : {}), items: [] };
      header = true;
      if (!note?.includes('不随页面分发')) groups.push(current);
      continue;
    }
    if (header) {
      header = false;
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    }
    const [name = '', version = '', licence = ''] = cells;
    if (name) current.items.push(cells.length >= 3 ? { name, version, licence } : { name, version: '', licence: version });
  }
  return groups.filter((group) => group.items.length > 0);
}
