// How a turn's states read on the page (spec 五, 各种状态): the waiting diamond with 取消, the turn
// being settled once its words are all here, the model error with 重试 and 改写行动, the pending
// settlement with 继续结算, and the two dialogs: the version conflict, and going back to an earlier
// turn, which says what it gives up.
import type { NoticeBlock } from '../../contracts';
import { turnWords } from '../../lib/book';
import { chapterTitle } from '../../lib/numerals';
import type { LiveTurn } from '../../store/merge';
import { useTurnsStore } from '../../store/turns';
import { Btn } from '../../ui/Btn';
import { Dialog } from '../../ui/Dialog';
import { Loading } from '../../ui/Loading';
import bookStyles from './Book.module.css';
import styles from './PlayScreen.module.css';

/**
 * What follows the rows of the turn being written: the waiting line, or the error card. Once the words
 * are all here the server only settles and commits the turn: the line says so, and there is nothing left
 * to cancel.
 */
export function LiveState({ live, onCancel, onRetry, onRewrite }: { live: LiveTurn; onCancel: () => void; onRetry: () => void; onRewrite: () => void }) {
  return (
    <>
      {live.status === 'streaming' && live.settling && (
        <div className={bookStyles.waiting}>
          <Loading text="结算中……" />
          <Btn className={bookStyles.stop} onClick={onCancel}>停止等待</Btn>
        </div>
      )}
      {live.status === 'streaming' && !live.settling && (
        <div className={bookStyles.waiting}>
          {/* the turn waits for the work after the turn before (a world evolution that is due): it says what for */}
          {!live.open && <Loading text={live.waiting} />}
          <Btn className={bookStyles.stop} onClick={onCancel}>
            取消
          </Btn>
        </div>
      )}
      {/* a version conflict is the dialog's to say */}
      {live.status === 'failed' && live.error?.code !== 'version_conflict' && (
        <div className={bookStyles.failure} role="alert">
          <p>{live.error?.message ?? '这一回没能写完。'}</p>
          <div className={bookStyles.actions}>
            <Btn variant="solid" onClick={onRetry}>
              重试
            </Btn>
            <Btn onClick={onRewrite}>改写行动</Btn>
          </div>
        </div>
      )}
    </>
  );
}

/** What a server notice's button does: 重试, 继续结算, 重新载入. */
export function noticeAction(action: NonNullable<NoticeBlock['action']>) {
  const store = useTurnsStore.getState();
  if (action === 'retry') void store.retry();
  if (action === 'resume') void store.settle();
  if (action === 'reload') void store.reload();
}

/** 待结算: the words came, the settlement did not. */
export function PendingCard({ error, onSettle, onAbandon }: {
  error?: string;
  onSettle: () => void;
  onAbandon: () => void;
}) {
  return (
    <div className={bookStyles.pending} role="status">
      <p>{error ?? '这一回合还在等待结算。'}</p>
      <div className={bookStyles.actions}>
        <Btn variant="solid" onClick={onSettle}>继续结算</Btn>
        <Btn onClick={onAbandon}>放弃本回合</Btn>
      </div>
    </div>
  );
}

export interface UndoAsk {
  toTurn: number;
  dropped: number;
  /** the last turn itself is taken back (撤回) */
  last: boolean;
}

export interface TurnDialogsProps {
  conflict: boolean;
  onReload: () => void;
  undo: UndoAsk | null;
  onUndo: () => void;
  onKeep: () => void;
  /** the cultivation life's book (item 38): a turn is a 回合, not a 回 */
  book?: boolean;
}

export function TurnDialogs({ conflict, onReload, undo, onUndo, onKeep, book = false }: TurnDialogsProps) {
  return (
    <>
      <Dialog open={conflict} className={styles.solid} title="存档已在别处改过" confirmLabel="重新载入" onConfirm={onReload}>
        <p>这个存档在别处被改过，这边的进度对不上了。重新载入后再接着玩；写下的字还在。</p>
      </Dialog>
      <Dialog
        open={undo !== null}
        className={styles.solid}
        title={undo?.last ? (book ? '撤回这一回合' : '撤回这一回') : '回到此处'}
        confirmLabel={undo?.last ? '撤回' : '回到此处'}
        danger
        onConfirm={onUndo}
        onCancel={onKeep}
      >
        <p>
          {undo?.last
            ? book
              ? `会作废${turnWords(undo.toTurn + 1, true)}，不能复原。`
              : `会作废这一回合（${chapterTitle(undo.toTurn + 1)}），不能复原。`
            : `会作废之后的 ${undo?.dropped ?? 0} 个回合，不能复原。`}
        </p>
      </Dialog>
    </>
  );
}
