// 剧情演化 in the task panel (plan item 43; the old page's 剧情演化 panel): the player's own guidance
// (我的指示: the plot evolution must follow it, and the next turn's prompt carries it), a run now
// (立即推演, while the server runs plot evolution) and this save's main plot switch. The status
// comes from GET …/director; a run is followed every two seconds until it is over.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { DirectorChange, DirectorView } from '../../contracts';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { useTurnBusy } from './act';
import common from './common.module.css';
import styles from './Director.module.css';

const POLL_MS = 2000;

/** The status line: whether it can run here, how often it runs and how long ago it last did. */
function summary(status: DirectorView): string {
  if (status.running) return '推演中……';
  if (!status.serverOwned) return '剧情演化的模型还没有通过工具准入，推演不了。';
  if (!status.enabled) return '剧情演化没有开，在「设置 · 演化」里打开。';
  return `每 ${status.frequency} 回合推演一次 · 距上次 ${status.turnsSince} 回合`;
}

/** How the last run went, in the old panel's words. */
function lastWords(status: DirectorView): string | null {
  const last = status.last;
  if (!last) return null;
  if (last.status === 'ok') return '上次推演成功。';
  if (last.status === 'skipped') return `上次推演没有采用：${last.error ?? '来源回合已不在'}`;
  return `上次推演失败：${last.error ?? '原因未知'}`;
}

/** What the player is told when a run they started is over. */
function ranWords(status: DirectorView): string {
  if (status.last?.status === 'ok') return '推演完成，主线和线索已更新。';
  return lastWords(status) ?? '推演结束。';
}

function problemOf(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('network');
}

export function Director({ saveId }: { saveId: string }) {
  const version = useStateStore((s) => s.view?.version);
  const notify = useUiStore((s) => s.notify);
  const busy = useTurnBusy();
  const headId = useId();
  const boxId = useId();
  const [status, setStatus] = useState<DirectorView | null>(null);
  const [failed, setFailed] = useState<ApiError | null>(null);
  // null: the box shows the saved guidance; otherwise the player's edit
  const [draft, setDraft] = useState<string | null>(null);
  const [working, setWorking] = useState<'save' | 'run' | 'plot' | null>(null);
  const [watching, setWatching] = useState(false);

  // read when the panel opens and whenever the save moves on
  useEffect(() => {
    let live = true;
    play.director(saveId).then(
      (answer) => {
        if (!live) return;
        setStatus(answer);
        setFailed(null);
      },
      (error: unknown) => {
        if (live) setFailed(problemOf(error));
      },
    );
    return () => {
      live = false;
    };
  }, [saveId, version]);

  // a run under way is asked after every two seconds until it is over
  useEffect(() => {
    if (!status?.running) return;
    const timer = setTimeout(() => {
      play.director(saveId).then(
        (next) => {
          setStatus(next);
          if (next.running || !watching) return;
          setWatching(false);
          notify(ranWords(next), next.last?.status === 'ok' ? 'info' : 'error');
          // the mainline and its clues come from the run
          void useStateStore.getState().load(saveId);
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status, saveId, watching, notify]);

  if (!status) {
    return (
      <section className={common.section} aria-labelledby={headId}>
        <Sub id={headId}>剧情演化</Sub>
        {failed ? <p className={common.note}>{failed.message}</p> : <Loading text="翻检中……" />}
      </section>
    );
  }

  const saved = status.guidance;
  const text = draft ?? saved;
  const changed = text !== saved;

  const settle = (change: DirectorChange) => {
    setStatus(change.director);
    useStateStore.getState().set(change.state);
  };
  const refused = (error: unknown) => {
    const problem = problemOf(error);
    if (problem.code === 'version_conflict') {
      void useStateStore.getState().load(saveId);
      notify('这个存档在别处被改过，已重新载入，再试一次。');
    } else {
      notify(problem.message, 'error');
    }
  };

  const save = async () => {
    if (version === undefined) return;
    setWorking('save');
    try {
      settle(await play.setGuidance(saveId, { version, text }));
      setDraft(null);
      notify(text.trim() ? '已记下我的指示，下一回合起生效。' : '已清空我的指示。');
    } catch (error) {
      refused(error);
    } finally {
      setWorking(null);
    }
  };

  const runNow = async () => {
    setWorking('run');
    try {
      setStatus(await play.runDirector(saveId));
      setWatching(true);
      notify('开始推演，推完会告诉你。');
    } catch (error) {
      refused(error);
    } finally {
      setWorking(null);
    }
  };

  const switchPlot = async () => {
    const enabled = status.plotDisabled;
    setWorking('plot');
    try {
      settle(await play.setPlot(saveId, { enabled }));
      notify(enabled ? '本存档的主线已开启。' : '本存档的主线已关闭，剧情指导照常。');
    } catch (error) {
      refused(error);
    } finally {
      setWorking(null);
    }
  };

  const last = lastWords(status);
  return (
    <section className={common.section} aria-labelledby={headId}>
      <Sub id={headId}>剧情演化</Sub>
      <p className={common.note} aria-live="polite">
        {summary(status)}
      </p>
      {last && !status.running && (
        <p className={status.last?.status === 'ok' ? common.note : `${common.note} ${styles.failed}`}>{last}</p>
      )}
      <label className={styles.label} htmlFor={boxId}>
        我的指示
      </label>
      <textarea
        id={boxId}
        className={styles.box}
        value={text}
        maxLength={2000}
        rows={4}
        placeholder="例如：多写宗门之间的争斗；希望早点遇到能传授功法的前辈。"
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className={common.note}>剧情演化必须遵守，下一回合也带上；留空则由它自由发挥。</p>
      <div className={common.actions}>
        <Btn onClick={() => void save()} disabled={!changed || working !== null || busy}>
          {working === 'save' ? '保存中……' : '保存指示'}
        </Btn>
        <Btn onClick={() => void runNow()} disabled={!status.serverOwned || status.running || working !== null}>
          {status.running ? '推演中……' : '立即推演'}
        </Btn>
      </div>
      {busy && changed && <p className={common.note}>这一回合写完之后才能保存。</p>}
      {/* the switch names what it does, so it carries no pressed state; the line under it says what
          it leaves alone (the old panel's words when the plot is off) */}
      <div className={styles.plot}>
        <Btn onClick={() => void switchPlot()} disabled={working !== null}>
          {status.plotDisabled ? '开启主线' : '关闭主线'}
        </Btn>
        <p className={common.note}>
          {status.plotDisabled ? '本存档的主线已关闭，剧情指导照常。' : '关闭后本存档不再推演主线，剧情指导照常。'}
        </p>
      </div>
    </section>
  );
}
