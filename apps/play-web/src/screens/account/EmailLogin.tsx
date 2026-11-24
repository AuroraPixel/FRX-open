// Email verification uses the account welcome flow and clears the previous player’s data.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useAccount } from '../../store/account';
import { Btn } from '../../ui/Btn';
import { PHONE, useMedia } from '../../ui/useMedia';
import styles from './Account.module.css';

function emailProblem(email: string): string | null {
  if (!email.trim()) return '填上邮箱地址。';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '邮箱地址不完整，请检查一下。';
  return null;
}

export function EmailLogin({ registration }: { registration: boolean }) {
  const sendEmailCode = useAccount((s) => s.sendEmailCode);
  const signInEmail = useAccount((s) => s.signInEmail);
  const previousEmail = useAccount((s) => s.lapse?.email);
  const [email, setEmail] = useState(previousEmail ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const phone = useMedia(PHONE);
  const id = useId();

  useEffect(() => {
    if (!phone) (previousEmail ? codeRef : emailRef).current?.focus({ preventScroll: true });
  }, [phone, previousEmail]);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      tick();
      if (deadline <= Date.now()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const wait = (seconds: number) => {
    const delay = Math.max(0, Math.ceil(seconds));
    setRemaining(delay);
    setDeadline(Date.now() + delay * 1000);
  };

  const send = async () => {
    if (sending || busy || remaining > 0) return;
    const problem = emailProblem(email);
    if (problem) {
      setError(problem);
      emailRef.current?.focus();
      return;
    }
    const address = email.trim();
    setSending(true);
    setError('');
    setSent('');
    try {
      const reply = await sendEmailCode(address);
      wait(reply.retryAfter);
      setCode('');
      setSent(
        `验证码已发送至 ${address}，${Math.ceil(reply.expiresIn / 60)} 分钟内有效。请查收邮件，也可查看垃圾邮件。`,
      );
      codeRef.current?.focus();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : '没能发送验证码，稍后重试。');
      if (failure instanceof ApiError && failure.retryAfter) wait(failure.retryAfter);
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || sending) return;
    const addressProblem = emailProblem(email);
    const problem = addressProblem ?? (/^\d{6}$/.test(code) ? null : '填上邮件里的 6 位验证码。');
    if (problem) {
      setError(problem);
      (addressProblem ? emailRef : codeRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signInEmail(email.trim(), code);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : '没能登录，稍后重试。');
      if (failure instanceof ApiError && failure.code === 'unauthorized') {
        setCode('');
        codeRef.current?.focus();
      }
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} aria-label="邮箱验证码登录" onSubmit={(event) => void submit(event)} noValidate>
      <label className={styles.field}>
        <span>邮箱</span>
        <input
          ref={emailRef}
          className={styles.input}
          type="email"
          name="email"
          value={email}
          maxLength={254}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          enterKeyHint="next"
          disabled={sending || busy}
          aria-invalid={error && emailProblem(email) ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            setCode('');
            setSent('');
            setError('');
          }}
        />
      </label>
      <div className={styles.codeRow}>
        <label className={styles.field}>
          <span>验证码</span>
          <input
            ref={codeRef}
            className={styles.input}
            name="code"
            value={code}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            enterKeyHint="go"
            disabled={busy}
            aria-invalid={error && !/^\d{6}$/.test(code) ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
        <Btn className={styles.sendCode} disabled={sending || busy || remaining > 0} onClick={() => void send()}>
          {sending ? '发送中……' : remaining > 0 ? `${remaining} 秒后重发` : sent ? '重新获取验证码' : '获取验证码'}
        </Btn>
      </div>
      <p className={styles.rule}>
        {registration ? '未注册邮箱验证后自动注册。' : '仅已注册邮箱可登录，暂不开放新账号注册。'}
      </p>
      {sent && (
        <p className={styles.rule} role="status">
          {sent}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Btn variant="solid" type="submit" className={styles.submit} disabled={busy || sending}>
        {busy ? '登录中……' : '登录'}
      </Btn>
    </form>
  );
}
