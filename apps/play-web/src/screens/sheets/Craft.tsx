// 炼制 (gameplay plan item 42): the recipes in the bag (丹方, 器谱, 符谱, 阵图), a row each. A recipe pressed:
// how many batches (a stepper, 1 to 10), made by the player or by a craftsman of the place for stones
// (请人做: no recipe or mastery needed, the goods due some days later), the preview (POST …/preview, verb
// craft { recipe, batches, hire }: the days, what it spends, the dice and the odds of 精, 常, 残 and 毁 a
// batch) and 「开炉」 or 「请人做」 sending that verb; 「看别的」 goes back.
import { useId, useState } from 'react';
import type { Item, Verb } from '../../contracts';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Empty, Loading } from '../../ui/Loading';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import { Choice } from './SettingsControls';
import { usePreview } from './usePreview';
import shop from './Shop.module.css';
import styles from './Craft.module.css';

/** What a recipe's name says it makes with: 丹方 炼丹, 器谱 炼器, 符谱 制符, 阵图 布阵. */
const CRAFTS: Record<string, string> = { 丹方: '炼丹', 器谱: '炼器', 符谱: '制符', 阵图: '布阵' };
const RECIPE = /^(丹方|器谱|符谱|阵图)·(.+)$/;

/** The recipes in the bag, with their craft and what they make. */
export function recipesOf(bag: readonly Item[]): { item: Item; craft: string; makes: string }[] {
  return bag.flatMap((item) => {
    const found = RECIPE.exec(item.name);
    return found ? [{ item, craft: CRAFTS[found[1]!]!, makes: found[2]! }] : [];
  });
}

/** 「精10% · 常50% · 残20% · 毁20%」 */
export function oddsWords(odds: Record<string, number | undefined> | undefined): string {
  return Object.entries(odds ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([quality, percent]) => `${quality}${percent}%`)
    .join(' · ');
}

function RecipeDetail({ saveId, recipe, recipeName, craft, onBack }: { saveId: string; recipe: Item; recipeName: string; craft: string; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const [batches, setBatches] = useState(1);
  const [hire, setHire] = useState(false);
  const verb: Verb = { kind: 'craft', recipe: recipeName, batches, ...(hire ? { hire: true } : {}) };
  const { preview, problem, asking } = usePreview(saveId, verb);
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene;
  const name = hire ? '请人做' : '开炉';
  const why = busy
    ? `这一回合写完之后才能${name}。`
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : (problem ?? (preview && !preview.ok ? (preview.reason ?? `眼下${name}不了。`) : preview ? spanWords(preview.minutes) : ''));
  const titleId = useId();
  return (
    <section className={shop.detail} aria-labelledby={titleId}>
      <header className={shop.head}>
        {/* the brush has no 「·」: the recipe's kind stands apart in the serif, its name in the brush */}
        <h3 id={titleId} aria-label={recipe.name}>
          <span className={styles.kind}>{recipe.name.split('·')[0]}</span>
          <span>{recipe.name.split('·').slice(1).join('·') || recipe.name}</span>
        </h3>
        <span>{craft}</span>
      </header>
      <div className={shop.count} role="group" aria-label="炼几炉">
        <button type="button" aria-label="少一炉" disabled={batches <= 1} onClick={() => setBatches(batches - 1)}>
          −
        </button>
        <output aria-live="polite">
          {batches}
          <small>炉</small>
        </output>
        <button type="button" aria-label="多一炉" disabled={batches >= 10} onClick={() => setBatches(batches + 1)}>
          +
        </button>
      </div>
      <div className={shop.haggle}>
        <span>自己炼要配方和火候；请此地的匠人做，付灵石，过些日子来取</span>
        <Choice
          label="谁来做"
          options={[
            { id: 'self', label: '自己炼' },
            { id: 'hire', label: '请人做' },
          ]}
          value={hire ? 'hire' : 'self'}
          onChange={(value) => setHire(value === 'hire')}
        />
      </div>
      <div className={days.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind="craft" /> : !problem ? <Loading text="推算中……" /> : null}
        {preview?.odds && <p className={styles.odds}>{oddsWords(preview.odds)}</p>}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className={shop.go}>
        <Act
          glyph="炼"
          name={name}
          note={why}
          hot={ready}
          unavailable={!ready}
          onClick={() => {
            if (ready && sendCommand({ verb })) closeSheet();
          }}
        />
        <Btn onClick={onBack}>看别的</Btn>
      </div>
    </section>
  );
}

export function CraftSheet({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const [picked, setPicked] = useState<string | null>(null);
  if (!view) return <Loading />;
  const recipes = view.play?.recipes?.flatMap((entry) => {
    const item = view.bag.find((each) => each.id === entry.itemId);
    return item ? [{ ...entry, item }] : [];
  }) ?? recipesOf(view.bag).map((entry) => ({ ...entry, recipe: entry.item.name, note: undefined }));
  if (!recipes.length) return <Empty title="储物袋里没有配方" text="丹方、器谱、符谱、阵图在手，才能在丹房、器室这些地方炼制。" />;
  const recipe = recipes.find((each) => `${each.item.id}:${each.recipe}` === picked);
  if (recipe && !recipe.note) return <RecipeDetail key={picked} saveId={saveId} recipe={recipe.item} recipeName={recipe.recipe} craft={recipe.craft} onBack={() => setPicked(null)} />;
  return (
    <div className={shop.shop}>
      <ul className={shop.rows} aria-label="配方">
        {recipes.map((each) => (
          <li key={`${each.item.id}:${each.recipe}`}>
            <button type="button" className={shop.row} disabled={Boolean(each.note)} onClick={() => setPicked(`${each.item.id}:${each.recipe}`)}>
              <span className={shop.what}>
                <b>{each.item.name}</b>
                <small>
                  {each.note || `${each.craft} · 炼出${each.makes}`}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
