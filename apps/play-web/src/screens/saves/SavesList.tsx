// The saves and what can be done with them (plan item 49; spec 七, 存档): one entry per save with the
// protagonist's round head, the name, realm, place, date in the story, turns and when it was last played,
// the current one edged in gold; each entry's ⋯ opens 载入, 导出 and 删除 (with a confirmation); above the
// list 新开一局, 导入存档 (a preview first) and 完整备份 (download, or restore with a preview). The saves
// screen and the in-game 存档 panel both show it.
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import {
  type BackupPreview, type ImportPreview, pickFile, saves as api, saveToDisk, turnsInSaveFile,
} from '../../api/saves';
import { audio } from '../../audio';
import type { SaveSummary } from '../../contracts';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { cx } from '../../ui/cx';
import { Dialog } from '../../ui/Dialog';
import { Empty, Loading } from '../../ui/Loading';
import { Tool } from '../../ui/Tool';
import { Head } from '../portrait/Head';
import { playedWhen } from './when';
import styles from './Saves.module.css';

const PRONOUNS = new Set(['你', '我', '{{user}}']);

/** The line under a save's name: who, and how far along. */
function whoSaid(save: SaveSummary): string {
  const who = PRONOUNS.has(save.player.name) || save.player.name === save.name ? '' : `${save.player.name} · `;
  return `${who}${save.player.realm}`;
}

function whereSaid(save: SaveSummary): string {
  return `${save.place} · ${save.date} ${save.hourName}`;
}

function turnsSaid(save: SaveSummary): string {
  return save.turns > 0 ? `第 ${save.turns} 回` : '尚未动身';
}

export interface SavesState {
  saves: SaveSummary[] | null;
  error: ApiError | null;
  reload: () => void;
}

/** The save list from GET /saves, read again on reload(). */
export function useSaves(): SavesState {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    play.saves().then(
      (list) => live && setSaves(list),
      (problem: unknown) => live && setError(problem instanceof ApiError ? problem : new ApiError('network')),
    );
    return () => {
      live = false;
    };
  }, [round]);
  return { saves, error, reload: useCallback(() => setRound((n) => n + 1), []) };
}

export type Pending =
  | { kind: 'delete'; save: SaveSummary }
  | { kind: 'import'; file: string; preview: ImportPreview; turns: number | null }
  | { kind: 'backup' }
  | { kind: 'restore'; file: Blob; preview: BackupPreview; settings: boolean };

export interface SavesListProps {
  state: SavesState;
  /** the save being played (in the panel) or the one 继续 goes on with (on the saves screen) */
  current?: string;
  /** the save being played, which cannot be deleted while it is open */
  playing?: string;
  onLoad: (save: SaveSummary) => void;
  onNew: () => void;
}

export function SavesList({ state, current, playing, onLoad, onNew }: SavesListProps) {
  const { saves, error, reload } = state;
  const notify = useUiStore((s) => s.notify);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const moreId = useId();

  const fail = (problem: unknown) => {
    const said = problem instanceof ApiError ? problem.message : new ApiError('network').message;
    audio.play('ui.error');
    notify(said, 'error');
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy(false);
    }
  };

  const exportSave = (save: SaveSummary) =>
    run(async () => {
      saveToDisk(await api.exportFile(save.id, save.name));
      notify(`已导出「${save.name}」`);
    });

  // the file is picked before anything waits on it: a picker closed without a file may never say so
  const startImport = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    await run(async () => {
      const text = await file.text();
      const preview = await api.previewImport(text);
      setPending({
        kind: 'import',
        file: text,
        preview,
        turns: turnsInSaveFile(text),
      });
    });
  };

  const startRestore = async () => {
    const file = await pickFile('.zip,application/zip');
    if (!file) return;
    await run(async () => {
      const preview = await api.previewBackup(file);
      setPending({ kind: 'restore', file, preview, settings: false });
    });
  };

  const confirm = () => {
    const doing = pending;
    if (!doing) return;
    setPending(null);
    if (doing.kind === 'delete') {
      void run(async () => {
        await api.remove(doing.save.id, doing.save.version);
        setOpen(null);
        notify(`已删除「${doing.save.name}」`);
        reload();
      });
    } else if (doing.kind === 'import') {
      void run(async () => {
        const made = await api.importFile(doing.file);
        notify(`已导入「${made.name}」`);
        reload();
      });
    } else if (doing.kind === 'restore') {
      void run(async () => {
        const done = await api.restoreBackup(doing.file, doing.preview.settings_revision, doing.settings);
        notify(`已恢复 ${done.archives.length} 个存档`);
        reload();
      });
    } else {
      void run(async () => {
        saveToDisk(await api.backup());
        notify('完整备份已下载');
      });
    }
  };

  return (
    <div className={styles.saves}>
      <div className={styles.tops} role="group" aria-label="存档的操作">
        <Btn variant="solid" onClick={onNew}>
          新开一局
        </Btn>
        <Btn onClick={() => void startImport()} disabled={busy}>
          导入存档
        </Btn>
        <Btn onClick={() => setPending({ kind: 'backup' })} disabled={busy}>
          完整备份
        </Btn>
      </div>

      {error && (
        <div className={styles.failed} role="alert">
          <p>{error.message}</p>
          <Btn onClick={reload}>重试</Btn>
        </div>
      )}
      {!saves && !error && <Loading text="翻检存档……" />}
      {saves?.length === 0 && <Empty title="尚无存档" text="新开一局，存档会出现在这里。" />}

      {saves && saves.length > 0 && (
        <ul className={styles.list} aria-label="存档">
          {saves.map((save) => {
            const expanded = open === save.id;
            const isCurrent = save.id === current;
            const isPlaying = save.id === playing;
            return (
              <li key={save.id} className={styles.item}>
                <div className={styles.entry} data-current={isCurrent ? '' : undefined}>
                  <button
                    type="button"
                    className={styles.load}
                    onClick={() => onLoad(save)}
                    aria-label={`载入「${save.name}」${save.play === 'life' ? '（修仙人生）' : ''}：${whoSaid(save)}，${whereSaid(save)}，${turnsSaid(save)}`}
                  >
                    <Head recipe={save.player.portrait} name={save.player.name} size={56} />
                    <span className={styles.words}>
                      <strong className={styles.name}>
                        {save.name}
                        {save.play === 'life' && <em className={styles.flag}>修仙人生</em>}
                      </strong>
                      <span className={styles.who}>{whoSaid(save)}</span>
                      <span className={styles.where}>{whereSaid(save)}</span>
                      <span className={styles.when}>
                        {turnsSaid(save)} · 上次游玩 {playedWhen(save.lastPlayedAt)}
                        {save.pending && <em className={styles.flag}>有待结算的回合</em>}
                      </span>
                    </span>
                  </button>
                  {isCurrent && (
                    <i className={styles.glyph} aria-hidden="true">
                      {isPlaying ? '今' : '续'}
                    </i>
                  )}
                  <Tool
                    glyph="⋯"
                    label={`更多：${save.name}`}
                    className={styles.more}
                    aria-expanded={expanded}
                    aria-controls={`${moreId}-${save.id}`}
                    onClick={() => setOpen(expanded ? null : save.id)}
                  />
                </div>
                {expanded && (
                  <div id={`${moreId}-${save.id}`} className={styles.actions} role="group" aria-label={`「${save.name}」的操作`}>
                    <Btn variant="solid" onClick={() => onLoad(save)}>
                      载入
                    </Btn>
                    <Btn onClick={() => void exportSave(save)} disabled={busy}>
                      导出
                    </Btn>
                    <Btn
                      variant="danger"
                      onClick={() => setPending({ kind: 'delete', save })}
                      disabled={busy || isPlaying}
                      title={isPlaying ? '正在玩的存档不能删除' : undefined}
                    >
                      删除
                    </Btn>
                    {isPlaying && <span className={styles.note}>正在玩的存档不能删除</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={pending?.kind === 'delete'}
        title="删除存档"
        confirmLabel="删除"
        danger
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'delete' && (
          <p>
            「{pending.save.name}」连同它的 {pending.save.turns} 个回合会一起删除，删除后找不回来。
          </p>
        )}
      </Dialog>

      <Dialog
        open={pending?.kind === 'import'}
        title="导入存档"
        confirmLabel="导入"
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'import' && (
          <ImportBody pending={pending} />
        )}
      </Dialog>

      <Dialog
        open={pending?.kind === 'backup'}
        title="完整备份"
        confirmLabel="下载完整备份"
        cancelLabel="算了"
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        <p>全部存档、人物形象、记忆和设置打成一个文件下载；模型的密钥不在其中。</p>
        <p className={styles.aside}>
          要从备份恢复，
          <button
            type="button"
            className={styles.inline}
            onClick={() => {
              setPending(null);
              void startRestore();
            }}
          >
            选一个备份文件
          </button>
          。
        </p>
      </Dialog>

      <Dialog
        open={pending?.kind === 'restore'}
        title="从备份恢复"
        confirmLabel="恢复"
        danger={pending?.kind === 'restore' && pending.settings}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'restore' && (
          <RestoreBody pending={pending} onSettings={(settings) => setPending({ ...pending, settings })} />
        )}
      </Dialog>
    </div>
  );
}

function ImportBody({ pending }: { pending: Extract<Pending, { kind: 'import' }> }) {
  const { preview, turns } = pending;
  return (
    <p>
      「{preview.name}」：{turns !== null ? `${turns} 个回合，` : `${preview.logs} 条记事，`}
      {preview.characters} 个人物，{preview.items} 件物品。导入的是一份副本，原有的存档不受影响。
    </p>
  );
}

export function RestoreBody({
  pending,
  onSettings,
}: {
  pending: Extract<Pending, { kind: 'restore' }>;
  onSettings: (settings: boolean) => void;
}) {
  const { preview, settings } = pending;
  const names = preview.archive_names;
  return (
    <>
      <p>
        备份里有 {names.length} 个存档{names.length ? `：${names.slice(0, 6).join('、')}${names.length > 6 ? ' 等' : ''}` : ''}。
        与现有存档同名的，恢复时另起一个名字，不会覆盖。
      </p>
      {preview.settings_conflicts > 0 && (
        <div className={cx(styles.choice)} role="group" aria-label="设置">
          {/* the count is of settings this machine has too, not of ones that differ: a backup made a minute ago
              said its 13 settings were 「与现在的不同」 (item 73's walkthrough) */}
          <p className={styles.aside}>备份里的 {preview.settings_conflicts} 项设置本机也有。</p>
          {/* a switch keeps one name and shows its state: labelled 「只恢复存档」 while off, it read
              as the way to restore only the saves, and pressing it turned the settings on (实玩二) */}
          <Btn aria-pressed={settings} variant={settings ? 'solid' : 'line'} onClick={() => onSettings(!settings)}>
            {settings && <span aria-hidden="true">✓ </span>}连同设置一起恢复
          </Btn>
          {!settings && <p className={styles.aside}>不选就只恢复存档，已有的设置不会被覆盖。</p>}
          {settings && <p className={styles.warn}>现在的这些设置会被备份里的覆盖。</p>}
        </div>
      )}
    </>
  );
}
