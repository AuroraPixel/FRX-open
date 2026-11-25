// The play interface's calls for saves outside play (docs/play-contracts.md, 四): what the creation
// offers and its draws, a new save, and a save's life as a file — export, import with a preview first,
// the full backup and its restore. Export, import and backup keep the existing implementation's
// shapes (snake_case), described here by what the screens read of them.
import type { CreationInput, CreationOptions, DrawAnswer, DrawRequest, Recipe, SaveSummary } from '../contracts';
import { API_BASE, ApiError, errorFrom, json, request, transport } from './client';

const id = encodeURIComponent;

/** What POST /saves/import/preview says about a save file before anything is written. */
export interface ImportPreview {
  name: string;
  logs: number;
  characters: number;
  items: number;
}

/** What POST /backup/preview says about a full backup. */
export interface BackupPreview {
  archive_names: string[];
  counts: Record<string, number>;
  media: number;
  settings_conflicts: number;
  settings_revision: string;
}

/** What POST /backup/restore did: the names the saves came back under. */
export interface RestoreResult {
  archives: string[];
  [key: string]: unknown;
}

/** A file to hand to the player: its bytes and the name the server gave it. */
export interface Download {
  blob: Blob;
  filename: string;
}

/** The file name a download carries (RFC 6266 filename* or filename), else the fallback. */
export function filenameOf(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return fallback;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

async function download(path: string, fallback: string): Promise<Download> {
  const response = await request('GET', path);
  return { blob: await response.blob(), filename: filenameOf(response.headers.get('Content-Disposition'), fallback) };
}

/** Sends a file's bytes as the body (the server reads the raw upload); throws ApiError like the rest. */
async function upload<T>(path: string, body: Blob | string, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'X-FRX-Client': 'local', Accept: 'application/json', 'Content-Type': 'application/octet-stream', ...headers },
    body,
    credentials: 'same-origin',
  };
  let response: Response;
  try {
    response = await transport()(API_BASE + path, init);
  } catch {
    throw new ApiError('network');
  }
  if (!response.ok) throw await errorFrom(response);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('bad_response', undefined, response.status);
  }
}

export const saves = {
  creation: () => json<CreationOptions>('GET', '/creation'),
  draw: (body: DrawRequest) => json<DrawAnswer>('POST', '/creation/draw', body),
  create: (input: CreationInput) => json<SaveSummary>('POST', '/saves', input),
  remove: (save: string, version: number) => json<void>('DELETE', `/saves/${id(save)}?version=${version}`),
  exportFile: (save: string, name: string) => download(`/saves/${id(save)}/export`, `${name}.json`),
  previewImport: (file: Blob | string) => upload<ImportPreview>('/saves/import/preview', file),
  importFile: (file: Blob | string) => upload<SaveSummary>('/saves/import', file),
  backup: (save?: string, name?: string) => download(save ? `/backup?save=${id(save)}` : '/backup',
    name ? `${name}.zip` : 'frx-backup.zip'),
  previewBackup: (file: Blob) => upload<BackupPreview>('/backup/preview', file),
  restoreBackup: (file: Blob, revision: string, settings: boolean) =>
    upload<RestoreResult>(`/backup/restore?restoreSettings=${settings}`, file, { 'x-frx-backup-revision': revision }),
  setPortrait: (save: string, char: string, recipe: Recipe) =>
    json<Recipe>('PUT', `/saves/${id(save)}/people/${id(char)}/portrait`, recipe),
};

/** Hands a file to the player: the browser's own download, named as the server named it. */
export function saveToDisk({ blob, filename }: Download): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Lets the player pick one file; resolves with it, or null when they close the picker without one. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}

/** The turns a save file holds, counted as the server's preview counts the last one: AI logs that are real turns. */
export function turnsInSaveFile(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { format?: string; version?: number; logs?: unknown[] };
    if (parsed.format !== 'frx-save' || parsed.version !== 1) return null;
    const logs = parsed.logs;
    if (!Array.isArray(logs)) return null;
    return logs.filter((log) => {
      if (!log || typeof log !== 'object') return false;
      const entry = log as Record<string, unknown>;
      return entry.type === 'ai' && !entry.isGhost && !entry.isDeepSummary && !entry.isUndoSnapshot;
    }).length;
  } catch {
    return null;
  }
}
