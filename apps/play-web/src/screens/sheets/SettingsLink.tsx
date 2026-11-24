// 模型连接 (plan item 47; spec 七, 设置): the main connection — address, model and key, the key only
// ever shown as 「已填」 — and one row per profile (主回合, 总结与记忆, 向量嵌入 …) whose model can be
// picked from the list the connection offers or typed in. Both are shared by everyone on the server.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client';
import { Btn } from '../../ui/Btn';
import { cx } from '../../ui/cx';
import { Dialog } from '../../ui/Dialog';
import { Loading } from '../../ui/Loading';
import { useAccount } from '../../store/account';
import { useUiStore } from '../../store/ui';
import { Field } from './SettingsControls';
import { type Connection, type Profile, addressProblem, link, refusal } from './SettingsData';
import common from './common.module.css';
import styles from './Settings.module.css';

const ENVIRONMENT = '由本机的环境变量管理，要改请在启动环境里改。';
/** How many models the list shows at once; typing narrows it. */
const LISTED = 12;

/** The models a profile's connection offers, asked for when its row opens. */
function useModels(profile: string | null) {
  const [state, setState] = useState<{ profile: string; models: string[] | null; error: string }>({
    profile: '',
    models: null,
    error: '',
  });
  useEffect(() => {
    if (!profile) return;
    let live = true;
    setState({ profile, models: null, error: '' });
    link.models(profile).then(
      (answer) => live && setState({ profile, models: answer.models, error: '' }),
      (error: unknown) => live && setState({ profile, models: [], error: refusal(error) }),
    );
    return () => {
      live = false;
    };
  }, [profile]);
  return state.profile === profile ? state : { profile: profile ?? '', models: null, error: '' };
}

/**
 * Whether a model answers, asked with one tiny call when the player picks it (实玩二: the relay listed
 * gemini-3.7-flash-high but could not route it, and the next turn failed). The answer stays with the
 * name it was asked for.
 */
function useModelCheck(profile: string) {
  const [check, setCheck] = useState<{ model: string; answers: boolean | null; message: string } | null>(null);
  const run = useCallback(
    (model: string) => {
      const name = model.trim();
      if (!name) {
        setCheck(null);
        return;
      }
      setCheck({ model: name, answers: null, message: '' });
      const settle = (answers: boolean, message: string) =>
        setCheck((now) => (now?.model === name ? { model: name, answers, message } : now));
      link.checkModel(profile, name).then(
        () => settle(true, ''),
        (error: unknown) =>
          settle(false, error instanceof ApiError ? error.message : `没能试「${name}」：连不上服务端，稍后再试。`),
      );
    },
    [profile],
  );
  return { check, run };
}

type ModelCheck = ReturnType<typeof useModelCheck>;

interface ModelPickProps {
  profile: string;
  value: string;
  onChange: (model: string) => void;
  /** the editor's trying of models: one picked from the list is tried at once */
  tries: ModelCheck;
}

/**
 * A model name: typed, or picked from the connection's list, which the typing narrows. A model picked is
 * tried with one tiny call (one typed, once it is saved), and one that does not answer is said plainly;
 * the list stays as the service gives it.
 */
function ModelPick({ profile, value, onChange, tries }: ModelPickProps) {
  const { models, error } = useModels(profile);
  const { check, run } = tries;
  const listId = useId();
  // the list narrows only to what the player types, not to the name already there
  const [typed, setTyped] = useState(false);
  const shown = useMemo(() => {
    const words = typed ? value.trim().toLowerCase() : '';
    const all = (models ?? []).filter((name) => name !== value);
    return (words ? all.filter((name) => name.toLowerCase().includes(words)) : all).slice(0, LISTED);
  }, [models, value, typed]);
  const tried = check && check.model === value.trim() ? check : null;
  return (
    <div className={styles.modelPick}>
      <Field
        label="模型"
        value={value}
        onChange={(next) => {
          setTyped(true);
          onChange(next);
        }}
        placeholder="模型名"
        autoComplete="off"
        aria-controls={shown.length ? listId : undefined}
        note={
          tried
            ? tried.answers === null
              ? `正在试「${tried.model}」……`
              : tried.answers
                ? `试过了，「${tried.model}」能回答。`
                : tried.message
            : models === null
              ? '正在读取这个连接提供的模型……'
              : error
                ? `读不到模型清单：${error}可以直接写模型名。`
                : models.length > LISTED && shown.length === LISTED
                  ? `共 ${models.length} 个模型，写几个字可以筛选。`
                  : undefined
        }
        wrong={tried ? tried.answers === false : Boolean(error)}
      />
      {shown.length > 0 && (
        <ul id={listId} className={styles.models} aria-label="可选的模型">
          {shown.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={styles.model}
                onClick={() => {
                  setTyped(false);
                  onChange(name);
                  run(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ConnectionEditorProps {
  connection: Connection;
  onSaved: (connection: Connection) => void;
}

/** The main connection: address, model and key; the key is written and never shown back. */
function ConnectionEditor({ connection, onSaved }: ConnectionEditorProps) {
  const notify = useUiStore((s) => s.notify);
  const tries = useModelCheck('default');
  const [address, setAddress] = useState(connection.base_url);
  const [model, setModel] = useState(connection.model);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [clearing, setClearing] = useState(false);
  const locked = connection.environment_managed;
  const wrongAddress = address.trim() ? addressProblem(address) : '地址不能空着。';
  const changed = address.trim() !== connection.base_url || model.trim() !== connection.model || key.trim() !== '';

  const save = async (clear = false) => {
    if (wrongAddress) {
      setProblem(wrongAddress);
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      const body = {
        base_url: address.trim(),
        model: model.trim(),
        ...(key.trim() && !clear ? { api_key: key.trim() } : {}),
        ...(clear ? { clear_key: true } : {}),
      };
      const saved = await link.saveConnection(body);
      setKey('');
      onSaved(saved);
      notify(clear ? '密钥已清除。' : '模型连接已保存，下一回合起生效。');
      // a model typed in is tried once saved (one picked from the list was tried as it was picked)
      if (!clear && body.model && tries.check?.model !== body.model) tries.run(body.model);
    } catch (error) {
      setProblem(refusal(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={common.more}>
      {locked && <p className={styles.note}>{ENVIRONMENT}</p>}
      <Field
        label="地址"
        type="url"
        inputMode="url"
        value={address}
        onChange={setAddress}
        disabled={locked}
        placeholder="https://…/v1"
        note={address.trim() && wrongAddress ? wrongAddress : undefined}
        wrong={Boolean(address.trim() && wrongAddress)}
      />
      <ModelPick profile="default" value={model} onChange={setModel} tries={tries} />
      <Field
        label="密钥"
        type="password"
        autoComplete="off"
        value={key}
        onChange={setKey}
        disabled={locked}
        placeholder={connection.key_set ? '已填' : '填入密钥'}
        note={connection.key_set ? '已填。留空就不改，填了就换成新的；填过的密钥不会显示出来。' : '还没有密钥。'}
      />
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {!locked && (
        <div className={common.actions}>
          <Btn variant="solid" disabled={saving || !changed} onClick={() => void save()}>
            {saving ? '保存中……' : '保存'}
          </Btn>
          {connection.key_set && (
            <Btn variant="danger" disabled={saving} onClick={() => setClearing(true)}>
              清除密钥
            </Btn>
          )}
        </div>
      )}
      {/* the panel's frame blurs what is behind it, which would pin a fixed dialog inside it */}
      {clearing &&
        createPortal(
          <Dialog
            open
            title="清除密钥"
            confirmLabel="清除"
            danger
            onConfirm={() => {
              setClearing(false);
              void save(true);
            }}
            onCancel={() => setClearing(false)}
          >
            清除之后，模型连接没有密钥，回合会写不出来，要重新填一个。
          </Dialog>,
          document.body,
        )}
    </div>
  );
}

interface ProfileEditorProps {
  profile: Profile;
  onSaved: (profiles: Profile[]) => void;
}

/** One profile's model, picked or typed; its address and key are the main connection's. */
function ProfileEditor({ profile, onSaved }: ProfileEditorProps) {
  const notify = useUiStore((s) => s.notify);
  const tries = useModelCheck(profile.id);
  const [model, setModel] = useState(profile.model);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  if (profile.environment_managed) {
    return (
      <div className={common.more}>
        <p className={styles.note}>{ENVIRONMENT}</p>
      </div>
    );
  }
  const save = async () => {
    setSaving(true);
    setProblem('');
    try {
      const chosen = model.trim();
      onSaved(await link.chooseModel(profile.id, chosen));
      notify(`「${profile.label}」改用 ${chosen || '主连接的模型'}。`);
      // a model typed in is tried once saved (one picked from the list was tried as it was picked)
      if (chosen && tries.check?.model !== chosen) tries.run(chosen);
    } catch (error) {
      setProblem(refusal(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={common.more}>
      <ModelPick profile={profile.id} value={model} onChange={setModel} tries={tries} />
      <p className={styles.note}>地址和密钥用主连接的。</p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={common.actions}>
        <Btn variant="solid" disabled={saving || model.trim() === profile.model} onClick={() => void save()}>
          {saving ? '保存中……' : '保存'}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The section: the main connection first, then every profile, each opening to its editor. A player of a
 * server with accounts sees the models the administrator set and changes none of them (the server
 * refuses a player's writes, docs/accounts-and-isolation-plan.md 页面).
 */
export function LinkSection({ opened }: { opened?: string }) {
  const account = useAccount((s) => s.account);
  const onlyToRead = account?.mode === 'accounts' && account.user.role !== 'admin';
  const [connection, setConnection] = useState<Connection | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(opened ?? null);
  const editorId = useId();

  const load = useCallback(() => {
    setError('');
    Promise.all([link.connection(), link.profiles()]).then(
      ([main, all]) => {
        setConnection(main);
        setProfiles(all);
      },
      (problem: unknown) => setError(refusal(problem)),
    );
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className={styles.failed} role="alert">
        <span>模型连接没能读到：{error}</span>
        <Btn onClick={load}>重试</Btn>
      </div>
    );
  }
  if (!connection || !profiles) return <Loading text="读取模型连接……" />;
  if (onlyToRead) {
    return (
      <>
        <dl className={cx(common.rows, styles.readRows)}>
          {[{ id: 'connection', label: '主连接', model: connection.model }, ...profiles].map((row) => (
            <div key={row.id}>
              <dt>{row.label}</dt>
              <dd>{row.model || '未配置'}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>模型由管理员设置，这里只能看。</p>
      </>
    );
  }

  const rows = [
    {
      id: 'connection',
      label: '主连接',
      value: connection.model ? `${connection.model} · ${connection.key_set ? '密钥已填' : '未填密钥'}` : '未配置',
    },
    ...profiles.map((profile) => ({ id: profile.id, label: profile.label, value: profile.model || '未配置' })),
  ];
  return (
    <ul className={common.list}>
      {rows.map((row) => {
        const expanded = open === row.id;
        const profile = profiles.find((p) => p.id === row.id);
        return (
          <li key={row.id}>
            <button
              type="button"
              className={styles.linkRow}
              aria-expanded={expanded}
              aria-controls={expanded ? `${editorId}-${row.id}` : undefined}
              onClick={() => setOpen(expanded ? null : row.id)}
            >
              <span className={styles.linkName}>{row.label}</span>
              <span className={styles.linkModel} data-missing={row.value === '未配置' ? '' : undefined}>
                {row.value}
              </span>
            </button>
            {expanded && (
              <div id={`${editorId}-${row.id}`}>
                {row.id === 'connection' ? (
                  <ConnectionEditor
                    connection={connection}
                    onSaved={(saved) => {
                      setConnection(saved);
                      void link.profiles().then(setProfiles, () => undefined);
                    }}
                  />
                ) : (
                  profile && <ProfileEditor key={profile.id} profile={profile} onSaved={setProfiles} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
