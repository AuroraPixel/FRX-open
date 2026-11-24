// The title-page login has one entry: verify an email address. New addresses register as part of
// verification when the server allows it. A lapsed session keeps its destination and turn notice.
import { useState } from 'react';
import { type Lapse, useAccount } from '../../store/account';
import { Btn } from '../../ui/Btn';
import { cx } from '../../ui/cx';
import { frameClass } from '../../ui/Frame';
import styles from './Account.module.css';
import { EmailLogin } from './EmailLogin';

/** What the login says about a session that went mid-game. */
export function lapseNote(lapse: Lapse): string {
  const first = '登录已失效，重新登录后回到刚才的地方。';
  if (lapse.turn === 'unsent') return `${first}刚才那一回合没有发出去，你写的行动还在。`;
  if (lapse.turn === 'running') return `${first}刚才那一回合已交给服务端，回去后接着看。`;
  return first;
}

export function LoginPanel() {
  const options = useAccount((s) => s.options);
  const lapse = useAccount((s) => s.lapse);
  const notice = useAccount((s) => s.notice);
  const loadOptions = useAccount((s) => s.loadOptions);
  const [checking, setChecking] = useState(false);
  const said = lapse ? lapseNote(lapse) : notice;

  const check = async () => {
    setChecking(true);
    try {
      await loadOptions();
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className={cx(frameClass, styles.login)} aria-label="登录">
      <div className={styles.loginBody}>
        <h2 className={styles.loginTitle}>邮箱验证码登录</h2>
        {said && (
          <p className={styles.said} role="status">
            {said}
          </p>
        )}
        {options?.emailLogin ? (
          <EmailLogin registration={options.emailRegistration === true && options.registration !== 'closed'} />
        ) : (
          <>
            <p className={styles.rule} role="status">
              邮箱登录暂不可用，请稍后再试或联系管理员。
            </p>
            <Btn onClick={() => void check()} disabled={checking}>
              {checking ? '检查中……' : '重新检查'}
            </Btn>
          </>
        )}
      </div>
    </section>
  );
}
