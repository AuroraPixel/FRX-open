// The account in the settings (plan item 68; spec 七, 账号): who is signed in, the usage of the last 24
// hours against the limits as slanted bars, changing the password and signing out. Only in accounts mode:
// in local mode there is nobody to sign in and the section is not there.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { accountApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { Account, UsageReport } from '../../contracts';
import { useAccount } from '../../store/account';
import { Btn } from '../../ui/Btn';
import { Sub } from '../../ui/Sub';
import common from '../sheets/common.module.css';
import styles from './Account.module.css';

/** 「12 / 200」; money with two decimals and its unit. */
function amount(value: number, money: boolean): string {
  return money ? value.toFixed(2) : String(value);
}

/** When the limits let turns go again: the time today, else the date and time, in this browser's zone. */
export function againAt(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '稍后';
  const today = new Date(now);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const sameDay = at.toDateString() === today.toDateString();
  return sameDay ? `今天 ${time}` : `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${time}`;
}

interface MeterProps {
  label: string;
  used: number;
  /** absent: no limit */
  cap?: number;
  money?: boolean;
  /** the number is on its way: the row keeps its place, so nothing under it moves when it comes */
  pending?: boolean;
}

/** One limit: its name and 「used / cap」 over a slanted bar (spec 三, 条), or the use alone without a limit. */
export function Meter({ label, used, cap, money = false, pending = false }: MeterProps) {
  const unit = money ? ' 美元' : '';
  const shown = pending ? '…' : amount(used, money);
  if (cap === undefined) {
    return (
      <div className={styles.meter}>
        <div className={styles.meterHead}>
          <span>{label}</span>
          <b>
            {shown}
            {unit}（不设上限）
          </b>
        </div>
      </div>
    );
  }
  const share = pending ? 0 : cap > 0 ? Math.min(1, Math.max(0, used / cap)) : 1;
  const said = `${shown} / ${amount(cap, money)}${unit}`;
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <b>{said}</b>
      </div>
      <span
        className={styles.bar}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={pending ? undefined : used}
        aria-valuetext={pending ? '读取中' : said}
        data-full={!pending && used >= cap ? '' : undefined}
      >
        <i className={styles.fill} style={{ width: `${(share * 100).toFixed(2)}%` }} />
      </span>
    </div>
  );
}

function Usage({ account, report }: { account: Account; report: UsageReport | null }) {
  const { usage, limits } = account;
  // a cost limit means nothing when the model service does not say what calls cost
  const costKnown = usage.costReported || usage.cost > 0;
  return (
    <div className={styles.usage}>
      <p className={styles.note}>用量按最近 24 小时算。</p>
      <Meter label="回合" used={usage.turns} cap={limits.turns} />
      {costKnown ? (
        <Meter label="费用" used={usage.cost} cap={limits.cost} money />
      ) : (
        limits.cost !== undefined && <p className={styles.note}>模型服务没有报费用，只按回合数算。</p>
      )}
      {report ? (
        <Meter label="存档" used={report.stored.saves} cap={report.limits.saves} />
      ) : (
        <Meter label="存档" used={0} cap={account.limits.saves} pending />
      )}
      {account.retryAt && (
        <p className={styles.problem} role="status">
          用量到了上限，{againAt(account.retryAt)} 以后可以接着玩。
        </p>
      )}
    </div>
  );
}

/** 改密码: the old one, the new one twice. The server ends this account's other sessions. */
function PasswordForm({ onDone }: { onDone: () => void }) {
  const changePassword = useAccount((s) => s.changePassword);
  const [old, setOld] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const oldRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const againRef = useRef<HTMLInputElement>(null);

  useEffect(() => oldRef.current?.focus({ preventScroll: true }), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const empty = !old ? oldRef : !next ? nextRef : !again ? againRef : null;
    if (empty) {
      setError('三格都要填。');
      empty.current?.focus();
      return;
    }
    if (next !== again) {
      setError('两次写的新密码不一样。');
      againRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changePassword(old, next);
      onDone();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : '没能改密码，稍后重试。');
      setBusy(false);
    }
  };

  return (
    <form className={styles.password} onSubmit={(event) => void submit(event)} noValidate aria-label="改密码">
      <label className={styles.field}>
        <span>原密码</span>
        <input
          ref={oldRef}
          className={styles.input}
          type="password"
          autoComplete="current-password"
          maxLength={128}
          enterKeyHint="next"
          value={old}
          onChange={(event) => setOld(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>新密码</span>
        <input
          ref={nextRef}
          className={styles.input}
          type="password"
          autoComplete="new-password"
          maxLength={128}
          enterKeyHint="next"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>再写一遍新密码</span>
        <input
          ref={againRef}
          className={styles.input}
          type="password"
          autoComplete="new-password"
          maxLength={128}
          enterKeyHint="done"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </label>
      <p className={styles.rule}>新密码 8 到 128 个字符，和账号不同。改好之后，别处的登录都要重新登录。</p>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
      <div className={common.actions}>
        <Btn variant="solid" type="submit" disabled={busy}>
          {busy ? '改密码中……' : '改好'}
        </Btn>
      </div>
    </form>
  );
}

export function AccountSection() {
  const phase = useAccount((s) => s.phase);
  const account = useAccount((s) => s.account);
  const refresh = useAccount((s) => s.refresh);
  const signOut = useAccount((s) => s.signOut);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState('');
  const formId = useId();
  const buttons = useRef<HTMLDivElement>(null);

  // who is here (the app has asked already, unless the section stands on a page of its own)
  useEffect(() => void useAccount.getState().start(), []);

  // the usage as it is now, every time the settings open
  useEffect(() => {
    if (phase !== 'in') return;
    let live = true;
    refresh().catch(() => undefined);
    accountApi.usage().then(
      (next) => live && setReport(next),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [phase, refresh]);

  if (phase !== 'in' || !account) return null;

  const leave = async () => {
    setLeaving(true);
    setProblem('');
    try {
      await signOut();
    } catch (failure) {
      setProblem(failure instanceof ApiError ? `没能退出：${failure.message}` : '没能退出，稍后重试。');
      setLeaving(false);
    }
  };

  return (
    <section className={common.section} aria-labelledby="settings-account">
      <Sub id="settings-account">账号</Sub>
      <dl className={common.rows}>
        <div>
          <dt>账号</dt>
          <dd>{account.user.username}</dd>
        </div>
        <div>
          <dt>身份</dt>
          <dd>{account.user.role === 'admin' ? '管理员' : '玩家'}</dd>
        </div>
        {account.user.email && (
          <div>
            <dt>邮箱</dt>
            <dd className={styles.emailAddress}>{account.user.email}</dd>
          </div>
        )}
      </dl>
      <Usage account={account} report={report} />
      {changed && !changing && (
        <p className={styles.done} role="status">
          密码改好了。别处的登录已经失效。
        </p>
      )}
      <div ref={buttons} className={common.actions}>
        {account.user.hasPassword !== false && (
          <Btn
            aria-expanded={changing}
            aria-controls={formId}
            onClick={() => {
              setChanging(!changing);
              setChanged(false);
            }}
          >
            {changing ? '不改了' : '改密码'}
          </Btn>
        )}
        <Btn onClick={() => void leave()} disabled={leaving}>
          {leaving ? '退出中……' : '退出登录'}
        </Btn>
      </div>
      {changing && account.user.hasPassword !== false && (
        <div id={formId}>
          <PasswordForm
            onDone={() => {
              setChanging(false);
              setChanged(true);
              // the form goes; the keyboard goes back to 改密码, where it was opened from
              buttons.current?.querySelector('button')?.focus();
            }}
          />
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
