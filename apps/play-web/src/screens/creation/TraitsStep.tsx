// 词条 (spec 七, 建角 5): 逆天改命 draws six traits for the points of a draw; choose up to five from the latest
// draw, keep them through later draws, or buy one from the whole list (自选词条, at its high price).
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { audio } from '../../audio';
import type { CreationOptions, CreationTrait } from '../../contracts';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Chip } from '../../ui/Chip';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { Choice } from './Choice';
import { type Creation, RARITY_EDGE, allTraits, bonusSaid, canPickTrait, traitDrawsLeft } from './rules';
import { useCreation } from './store';
import styles from './Creation.module.css';

/** 「你天生方向感极差。野外探索时更容易迷路；附赠「…」」: the description, the effect and the gift, punctuated once. */
export function traitText(trait: CreationTrait): string {
  const parts = [
    trait.desc ?? '',
    trait.effects && trait.effects !== '无' ? trait.effects : '',
    trait.item && trait.item !== '无' ? `附赠${trait.item.replace(/^【([^|】]+).*$/, '「$1」')}` : '',
  ].filter(Boolean);
  return parts.reduce((text, part) => (text ? `${text}${/[。！？；]$/.test(text) ? '' : '；'}${part}` : part), '');
}

export function TraitsStep({ options, c }: { options: CreationOptions; c: Creation }) {
  const drawTraits = useCreation((s) => s.drawTraits);
  const toggleOffered = useCreation((s) => s.toggleOffered);
  const pickTrait = useCreation((s) => s.pickTrait);
  const dropTrait = useCreation((s) => s.dropTrait);
  const drawing = useCreation((s) => s.drawing);
  const notify = useUiStore((s) => s.notify);
  const [picking, setPicking] = useState(false);
  const left = traitDrawsLeft(options, c);
  const { maxTraits, traitDraw, traitPick } = options.rules;
  const full = c.traits.length >= maxTraits;
  const chosen = (name: string) => c.traits.some((t) => t.trait.name === name);

  const draw = async () => {
    audio.play('fx.dice');
    try {
      if (await drawTraits()) audio.play('ui.page');
    } catch (problem) {
      audio.play('ui.error');
      notify(problem instanceof ApiError ? problem.message : new ApiError('network').message, 'error');
    }
  };

  return (
    <>
      <p className={styles.lead}>
        逆天改命一次耗 {traitDraw.cost} 点，给出六个词条；从最新的一抽里选，至多 {maxTraits} 个，选过的留着。
      </p>
      <Sub>
        已选 {c.traits.length} / {maxTraits}
      </Sub>
      {c.traits.length > 0 ? (
        <div className={styles.chips} aria-label="已选的词条">
          {c.traits.map(({ trait, round }) => (
            <Chip key={trait.name} text={round === null ? `${trait.name} · 自选` : trait.name} onRemove={() => dropTrait(trait.name)} />
          ))}
        </div>
      ) : (
        <p className={styles.note}>还没有选词条，也可以不选。</p>
      )}
      <div className={styles.drawRow}>
        <Act
          glyph="抽"
          name="逆天改命"
          note={left > 0 ? `耗 ${traitDraw.cost} 点 · 还可抽 ${left} 次` : '点数不够再抽'}
          hot={c.offer.length === 0 && left > 0}
          unavailable={left < 1 || drawing !== null}
          onClick={() => void draw()}
        />
        <Btn aria-expanded={picking} onClick={() => setPicking(!picking)}>
          {picking ? '收起自选' : '自选词条'}
        </Btn>
      </div>
      {drawing === 'traits' && <Loading text="天机流转……" />}
      {c.offer.length > 0 && drawing !== 'traits' && (
        <div className={styles.choices} role="group" aria-label="这一抽的词条" data-offer="">
          {c.offer.map((trait) => (
            <Choice
              key={trait.name}
              title={trait.name}
              cost={trait.rarity}
              bonus={bonusSaid(trait.bonus)}
              text={traitText(trait)}
              edge={RARITY_EDGE[trait.rarity ?? ''] ?? undefined}
              chosen={chosen(trait.name)}
              blocked={full ? `已选满 ${maxTraits} 个` : undefined}
              onChoose={() => toggleOffered(trait)}
            />
          ))}
        </div>
      )}
      {picking && (
        <>
          <Sub>自选词条</Sub>
          <p className={styles.note}>
            从全部词条里直接挑，一个耗 {traitPick.cost} 点{canPickTrait(options, c) ? '' : '，眼下点数不够'}。
          </p>
          <div className={styles.choices} role="group" aria-label="自选词条">
            {allTraits(options).map((trait) => (
              <Choice
                key={`${trait.rarity}-${trait.name}`}
                title={trait.name}
                cost={trait.rarity}
                bonus={bonusSaid(trait.bonus)}
                text={traitText(trait)}
                edge={RARITY_EDGE[trait.rarity ?? ''] ?? undefined}
                chosen={chosen(trait.name)}
                blocked={chosen(trait.name) ? undefined : canPickTrait(options, c) ? undefined : `要 ${traitPick.cost} 点`}
                onChoose={() => (chosen(trait.name) ? dropTrait(trait.name) : pickTrait(trait))}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
