// 灵根 (spec 七, 建角 4): 测灵根 draws a spirit root with a short show, the result in large brush strokes,
// the draws the points still allow written beside the button; 自选灵根 buys one from the list instead.
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { audio, type SoundHandle } from '../../audio';
import type { CreationOptions } from '../../contracts';
import { pins } from '../../lib/params';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { useMedia } from '../../ui/useMedia';
import { Choice } from './Choice';
import { type Creation, canPickRoot, rootCost, rootDrawsLeft } from './rules';
import { useCreation } from './store';
import styles from './Creation.module.css';

const ELEMENTS = ['金', '木', '水', '火', '土', '冰', '风', '雷', '暗'];

/**
 * 「真灵根 金,木」 → 真灵根 and 金 · 木. The kind ends at the first space; the elements are everything
 * after it, however they are separated (the chosen roots are written 「真灵根 水, 火」).
 */
export function rootParts(root: string): { kind: string; elements: string[] } {
  const at = root.search(/\s/);
  if (at < 0) return { kind: root, elements: [] };
  return { kind: root.slice(0, at), elements: root.slice(at + 1).split(/[,，、\s]+/).filter(Boolean) };
}

/** How long the show lasts: none when the clock is pinned (screenshots) or motion is reduced. */
function useShowTime(): number {
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  return pins().t !== undefined || reduced ? 0 : 1100;
}

export function RootStep({ options, c }: { options: CreationOptions; c: Creation }) {
  const drawRoot = useCreation((s) => s.drawRoot);
  const pickRoot = useCreation((s) => s.pickRoot);
  const drawing = useCreation((s) => s.drawing);
  const notify = useUiStore((s) => s.notify);
  const [showing, setShowing] = useState(false);
  const [picking, setPicking] = useState(false);
  const showTime = useShowTime();
  const sound = useRef<SoundHandle | null>(null);
  const left = rootDrawsLeft(options, c);
  const cost = options.rules.rootDraw.cost;

  useEffect(() => () => sound.current?.stop(), []);

  const draw = async () => {
    if (showing || drawing || left < 1) return;
    setShowing(true);
    sound.current = audio.play('fx.gather');
    const started = Date.now();
    try {
      await drawRoot();
      const wait = showTime - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      audio.play('ui.seal');
    } catch (problem) {
      audio.play('ui.error');
      notify(problem instanceof ApiError ? problem.message : new ApiError('network').message, 'error');
    } finally {
      sound.current?.stop(0.4);
      sound.current = null;
      setShowing(false);
    }
  };

  const parts = c.root ? rootParts(c.root) : null;
  return (
    <>
      <p className={styles.lead}>灵根定下修炼的快慢和功法的契合。测一次耗 {cost} 点，不满意可以重测。</p>
      <div className={styles.root} aria-live="polite" data-showing={showing ? '' : undefined}>
        {showing ? (
          <div className={styles.rootShow} aria-label="测灵根中">
            {ELEMENTS.map((element, at) => (
              <i key={element} style={{ animationDelay: `${at * 0.11}s` }} data-endless="">
                {element}
              </i>
            ))}
          </div>
        ) : parts ? (
          <div className={styles.rootResult}>
            <strong>{parts.kind}</strong>
            {/* the elements spaced with the ideographic space: the brush face has no middle dot */}
            {parts.elements.length > 0 && <span>{parts.elements.join('\u3000')}</span>}
            {rootCost(options, c.root) > 0 && <small>此灵根计 {rootCost(options, c.root)} 点</small>}
          </div>
        ) : (
          <p className={styles.rootEmpty}>尚未测定</p>
        )}
      </div>
      <div className={styles.drawRow}>
        <Act
          glyph="测"
          name={c.root ? '重测灵根' : '测灵根'}
          note={left > 0 ? `耗 ${cost} 点 · 还可测 ${left} 次` : '点数不够再测'}
          hot={!c.root && left > 0}
          unavailable={left < 1 || showing || drawing !== null}
          onClick={() => void draw()}
        />
        <Btn aria-expanded={picking} onClick={() => setPicking(!picking)}>
          {picking ? '收起自选' : '自选灵根'}
        </Btn>
      </div>
      {picking && (
        <div className={styles.choices} role="group" aria-label="自选灵根">
          {Object.entries(options.config.LINGGEN).map(([name, data]) => (
            <Choice
              key={name}
              title={name}
              cost={`${data!.cost} 点`}
              chosen={c.root === name}
              blocked={canPickRoot(options, c, name) ? undefined : '点数不够'}
              onChoose={() => {
                pickRoot(name);
                audio.play('ui.seal');
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
