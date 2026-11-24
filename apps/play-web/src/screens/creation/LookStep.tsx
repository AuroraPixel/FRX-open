// 形象 (spec 七, 建角 7): the portrait on the left (on phones the top 38% of the screen), the maker's rows on
// the right, and 随机. The stage behind shows the protagonist's back view in the same clothes.
import type { CreationOptions } from '../../contracts';
import type { PortraitKit } from '../../kit/kit';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { Figure } from '../portrait/Figure';
import { PortraitMaker } from '../portrait/PortraitMaker';
import type { Creation } from './rules';
import { newSeed, useCreation } from './store';
import styles from './Creation.module.css';

/** A portrait to start from: young, of the chosen sex, drawn from the creation's seed. */
export function firstPortrait(kit: PortraitKit, c: Creation) {
  return kit.random(`creation:${c.seed}`, { sex: c.sex ?? 'm', age: 'young' });
}

export function LookStep({
  kit,
  c,
  onDrawn,
}: {
  options: CreationOptions;
  kit: PortraitKit | null;
  c: Creation;
  onDrawn: () => void;
}) {
  const setPortrait = useCreation((s) => s.setPortrait);
  if (!kit || !c.portrait) return <Loading text="取部件……" />;
  const recipe = c.portrait;
  return (
    <div className={styles.look}>
      <div className={styles.lookFigure}>
        <Figure recipe={recipe} crop="full" label="你的立绘" onDrawn={onDrawn} />
        <Btn
          className={styles.random}
          onClick={() => setPortrait(kit.random(`creation:${newSeed()}`, { sex: c.sex ?? 'm', base: recipe.base }))}
        >
          随机
        </Btn>
      </div>
      <PortraitMaker kit={kit} recipe={recipe} onChange={setPortrait} sex={c.sex ?? undefined} className={styles.lookRows} />
    </div>
  );
}
