// 传承 (gameplay plan item 49): the protagonist died of old age (play.legacy, state choosing) and the way
// goes on in an heir. On top who died, when, where and at what age, and the old acquaintances' words
// (written by the model in the dying turn); then the heirs: a 道侣 or a 弟子 of the ties (their realm and
// age now), or a new one (另立后人: a name, 男 or 女, the root drawn on the save's seed, a portrait from the
// kit to reroll); the last word (the default one when left empty); 定下传人 confirms and sends inherit.
// 一生的年谱 opens the life's record.
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { play as api } from '../../api/client';
import type { PlayLegacy, Recipe } from '../../contracts';
import { useKit } from '../../kit/shared';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Dialog } from '../../ui/Dialog';
import { Empty } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { Figure } from '../portrait/Figure';
import { usePanelAction } from './act';
import { dayWords } from './Sect';
import common from './common.module.css';
import styles from './Legacy.module.css';

const NAME_MOST = 8;
const WORDS_MOST = 40;

/** Why a new heir's name will not do, or null: one to eight characters, no space and no bar. */
export function nameProblem(name: string): string | null {
  const chars = [...name.trim()];
  if (!chars.length) return '写下后人的名字';
  if (chars.length > NAME_MOST) return `名字最多${chineseNumber(NAME_MOST)}个字`;
  if (/[\s|｜]/.test(name.trim())) return '名字不能带空格和竖线';
  return null;
}

/** 「筑基后期 · 正月初一坐化于观云台 · 享年二百」 */
export function passingLine(legacy: PlayLegacy): string {
  const when = legacy.died ? dayWords(legacy.died) : '';
  return [
    legacy.realm ?? '',
    `${when}坐化${legacy.place ? `于${legacy.place}` : ''}`,
    legacy.age !== undefined ? `享年${chineseNumber(legacy.age)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The seal of an heir's tie: 侣 for a 道侣, 徒 for a 弟子. */
const tieSeal = (kind: string) => (kind === '道侣' ? '侣' : kind === '弟子' ? '徒' : kind.slice(0, 1));

function Eulogies({ legacy }: { legacy: PlayLegacy }) {
  if (!legacy.eulogies?.length) return null;
  return (
    <ul className={styles.eulogies} aria-label="故人的评说">
      {legacy.eulogies.map((said) => (
        <li key={`${said.id ?? said.name}`}>
          <q>{said.text}</q>
          <cite>
            {said.name}
            {said.kind ? `（${said.kind}）` : ''}
          </cite>
        </li>
      ))}
    </ul>
  );
}

export function LegacySheet({ saveId }: { saveId: string }) {
  const legacy = useStateStore((s) => s.view?.play?.legacy);
  const sex = useStateStore((s) => s.view?.player.sex);
  const openSheet = useUiStore((s) => s.openSheet);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const { run, blocked } = usePanelAction(saveId);
  const kit = useKit();
  const [heir, setHeir] = useState<string>('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'男性' | '女性'>(sex === 'f' ? '女性' : '男性');
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [words, setWords] = useState('');
  const [confirming, setConfirming] = useState(false);
  const nameId = useId();
  const wordsId = useId();
  const heirs = legacy?.heirs ?? [];
  const chosen = heir || (heirs[0]?.id ?? 'new');
  // a new heir's look: drawn from the kit for the gender, again on 换一副
  const roll = (seed: string) => kit && setRecipe(kit.random(`${saveId}:heir:${seed}`, { sex: gender === '女性' ? 'f' : 'm', age: 'young' }));
  useEffect(() => {
    if (kit && chosen === 'new') setRecipe(kit.random(`${saveId}:heir:${gender}`, { sex: gender === '女性' ? 'f' : 'm', age: 'young' }));
  }, [kit, chosen, gender, saveId]);

  if (legacy?.state !== 'choosing') return <Empty title="传承" text="主角还在世，谈不上传承。" />;
  const picked = heirs.find((each) => each.id === chosen);
  const fresh = chosen === 'new';
  const problem = fresh ? nameProblem(name) : null;
  const heirName = fresh ? name.trim() : (picked?.name ?? '');
  const said = words.trim() || legacy.words || '';
  const send = () => {
    setConfirming(false);
    void run(
      (version) =>
        api.action(saveId, {
          version,
          action: 'inherit',
          heir: chosen,
          ...(fresh ? { name: name.trim(), gender, ...(recipe ? { portrait: recipe } : {}) } : {}),
          ...(words.trim() ? { words: words.trim() } : {}),
        }),
      `${heirName}承了${legacy.name ?? '前人'}的衣钵`,
    ).then((done) => done && closeSheet());
  };
  return (
    <div className={styles.legacy}>
      <header className={styles.head}>
        <i className={styles.seal} aria-hidden="true">
          逝
        </i>
        <div>
          <h3>
            {legacy.name ?? '你'}
            <small>坐化</small>
          </h3>
          <p>{passingLine(legacy)}</p>
        </div>
      </header>
      <Eulogies legacy={legacy} />

      <section className={common.section} aria-labelledby={`${nameId}-heirs`}>
        <Sub id={`${nameId}-heirs`}>传人</Sub>
        <ul className={styles.heirs} role="radiogroup" aria-labelledby={`${nameId}-heirs`}>
          {heirs.map((each) => (
            <li key={each.id}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen === each.id}
                className={styles.heir}
                onClick={() => setHeir(each.id)}
              >
                <i className={styles.mark} aria-hidden="true">
                  {tieSeal(each.kind)}
                </i>
                <span className={styles.what}>
                  <b>{each.name}</b>
                  <small>
                    {[each.kind, each.realm, each.age !== undefined ? `${chineseNumber(each.age)}岁` : ''].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" role="radio" aria-checked={fresh} className={styles.heir} onClick={() => setHeir('new')}>
              <i className={styles.mark} aria-hidden="true">
                后
              </i>
              <span className={styles.what}>
                <b>另立后人</b>
                <small>{legacy.root ? `灵根已抽：${legacy.root}` : '名字由你起，灵根照建角的规矩抽'}</small>
              </span>
            </button>
          </li>
        </ul>
        {fresh && (
          <div className={styles.fresh}>
            {recipe && (
              <div className={styles.figure}>
                <Figure recipe={recipe} crop="half" label="后人的半身像" />
                <Btn onClick={() => roll(String(Date.now()))} disabled={!kit}>
                  换一副
                </Btn>
              </div>
            )}
            <div className={styles.fields}>
              <label htmlFor={nameId}>名字</label>
              <input
                id={nameId}
                className={styles.input}
                value={name}
                maxLength={NAME_MOST * 2}
                placeholder="一到八个字"
                aria-invalid={name.length > 0 && Boolean(problem)}
                onChange={(event) => setName(event.target.value)}
              />
              <span className={styles.label}>性别</span>
              <span className={styles.toggle} role="radiogroup" aria-label="性别">
                {(['男性', '女性'] as const).map((each) => (
                  <button key={each} type="button" role="radio" aria-checked={gender === each} onClick={() => setGender(each)}>
                    {each.slice(0, 1)}
                  </button>
                ))}
              </span>
              {legacy.root && (
                <>
                  <span className={styles.label}>灵根</span>
                  <span className={styles.root}>{legacy.root}</span>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={common.section} aria-labelledby={wordsId}>
        <Sub id={wordsId}>遗言</Sub>
        <textarea
          className={styles.words}
          rows={2}
          maxLength={WORDS_MOST}
          value={words}
          placeholder={legacy.words ?? '留一句话给传人'}
          aria-labelledby={wordsId}
          onChange={(event) => setWords(event.target.value)}
        />
      </section>

      <div className={styles.go}>
        <Act
          glyph="承"
          name="定下传人"
          note={problem ?? (heirName ? `${heirName}接过洞府、仓库和这一句话` : '先选一位传人')}
          hot={!problem && Boolean(heirName) && !blocked}
          unavailable={Boolean(problem) || !heirName || blocked}
          onClick={() => setConfirming(true)}
        />
        <Btn onClick={() => openSheet('life')}>一生的年谱</Btn>
      </div>
      {createPortal(
        <Dialog
          open={confirming}
          title={`由${heirName}接着走`}
          confirmLabel="定下"
          cancelLabel="再想想"
          danger
          onConfirm={send}
          onCancel={() => setConfirming(false)}
        >
          <p>
            {legacy.name ?? '前人'}的这一世到此为止：{heirName}成了主角，接过洞府、仓库、身上的东西和灵石，还有「{said}」这一句话。定下就改不回来了。
          </p>
        </Dialog>,
        document.body,
      )}
    </div>
  );
}
