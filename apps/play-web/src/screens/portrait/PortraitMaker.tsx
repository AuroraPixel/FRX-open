// The portrait maker (spec 七, 人物 · 改形象; 建角 · 形象): one row of small cells for each of the base,
// face, hair, hair colour, body and traits, each row scrolling sideways. A change shows at once in the
// figure its owner draws; the creation's look step and the people panel's 改形象 both use it.
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { Recipe } from '../../contracts';
import type { PortraitKit } from '../../kit/kit';
import type { KitPart, KitTrait } from '../../kit/types';
import { cx } from '../../ui/cx';
import { useRoving } from '../sheets/roving';
import { ROW_LABEL, ROWS, type Row, choose, chosen, optionsOf, rebase, tintOf } from './parts';
import styles from './Portrait.module.css';

type Box = 'head' | 'bust' | 'wide';

/** What a thumbnail frames on the base, at scale 1: [x, y, size] of a square. */
function frame(kit: PortraitKit, recipe: Recipe, box: Box): [number, number, number] {
  const G = kit.base(recipe.base).geometry;
  if (box === 'head') return [G.cx - 150, G.chin - 268, 300];
  if (box === 'bust') return [G.cx - 330, G.chin - 300, 660];
  return [G.cx - 560, G.chin - 250, 1000];
}

/** Whether an element has come near the visible part of its scrolling row (always, where nothing can tell). */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          watch.disconnect();
        }
      },
      { rootMargin: '0px 240px' },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [ref, seen]);
  return seen;
}

/**
 * A recipe drawn small with the parts' own pictures laid in the kit's order (no hair colour, no tilt):
 * cheap enough for a row of twenty, while the owner's figure shows the real thing. The pictures are only
 * asked for once the cell comes near the visible part of its row (a body is some 150 KB).
 */
function Thumb({ kit, recipe, box }: { kit: PortraitKit; recipe: Recipe; box: Box }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const [x0, y0, size] = frame(kit, recipe, box);
  const k = 100 / size;
  const traits = kit.traitsOf(recipe);
  const of = (layer: KitTrait['layer']) => traits.filter((t) => t.layer === layer);
  const parts: KitPart[] = [
    ...of('back'),
    ...(box === 'head' ? [] : [kit.part(recipe.base, 'bodies', recipe.body)]),
    kit.part(recipe.base, 'faces', recipe.face),
    ...of('skin'),
    kit.part(recipe.base, 'hair', recipe.hair),
    ...of('over'),
  ];
  return (
    <span ref={ref} className={styles.thumb} aria-hidden="true">
      {seen && parts.map((part) => (
        <img
          key={part.file}
          src={kit.root + part.file}
          alt=""
          decoding="async"
          draggable={false}
          style={{ left: `${(part.x - x0) * k}%`, top: `${(part.y - y0) * k}%`, width: `${part.w * k}%` }}
        />
      ))}
    </span>
  );
}

function Swatch({ kit, recipe, tint }: { kit: PortraitKit; recipe: Recipe; tint: string | null }) {
  const ramp = tintOf(kit, recipe, tint);
  const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;
  return (
    <span
      className={styles.swatch}
      data-painted={ramp ? undefined : ''}
      style={ramp ? { background: `linear-gradient(135deg, ${css(ramp.dark)}, ${css(ramp.light)})` } : undefined}
      aria-hidden="true"
    />
  );
}

interface RowProps {
  kit: PortraitKit;
  recipe: Recipe;
  row: Row;
  sex?: 'm' | 'f';
  onChange: (next: Recipe) => void;
}

/** Brings the chosen cell of a row into sight when the row first shows, sideways only. */
function useChosenInSight(row: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const box = row.current;
    const cell = box?.querySelector<HTMLElement>('[aria-checked="true"], [aria-pressed="true"]');
    if (!box || !cell) return;
    // the row is the cells' offset parent: offsetLeft is the cell's place in the row
    if (cell.offsetLeft + cell.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = cell.offsetLeft;
  }, [row]);
}

function PartRow({ kit, recipe, row, sex, onChange }: RowProps) {
  const labelId = useId();
  const cellsRef = useRef<HTMLDivElement>(null);
  useChosenInSight(cellsRef);
  const options = optionsOf(kit, recipe, row, sex);
  const multi = row === 'trait';
  const picked = options.filter((option) => chosen(recipe, row, option.value));
  const keys = options.map((option) => option.value ?? '');
  const roving = useRoving(keys, picked[0]?.value ?? keys[0] ?? null);
  const caption = multi ? picked.map((option) => option.label).join('、') || '无' : (picked[0]?.label ?? '');

  if (options.length === 0) {
    return (
      <section className={styles.row}>
        <header className={styles.rowHead}>
          <h4 id={labelId}>{ROW_LABEL[row]}</h4>
          <span className={styles.caption}>这个底模没有可选的{ROW_LABEL[row]}</span>
        </header>
      </section>
    );
  }

  return (
    <section className={styles.row} data-row={row}>
      <header className={styles.rowHead}>
        <h4 id={labelId}>{ROW_LABEL[row]}</h4>
        <span className={styles.caption} aria-live="polite">
          {caption}
        </span>
      </header>
      <div
        ref={cellsRef}
        className={styles.cells}
        role={multi ? 'group' : 'radiogroup'}
        aria-labelledby={labelId}
        {...roving.group}
      >
        {options.map((option) => {
          const on = chosen(recipe, row, option.value);
          const look =
            row === 'base' && option.value
              ? rebase(kit, recipe, option.value)
              : row === 'trait' && option.value && !on
                ? choose(kit, recipe, row, option.value)
                : row === 'tint'
                  ? recipe
                  : choose(kit, recipe, row, option.value);
          const tail = row === 'trait' && kit.traitsOf(look).some((t) => t.kind === option.value && t.layer === 'back');
          return (
            <button
              key={option.value ?? 'painted'}
              type="button"
              className={styles.cell}
              data-row={row}
              role={multi ? undefined : 'radio'}
              aria-checked={multi ? undefined : on}
              aria-pressed={multi ? on : undefined}
              aria-label={option.label}
              title={option.label}
              {...roving.item(option.value ?? '')}
              onClick={() => onChange(choose(kit, recipe, row, option.value))}
            >
              {row === 'tint' ? (
                <>
                  <Swatch kit={kit} recipe={recipe} tint={option.value} />
                  <span className={styles.cellName}>{option.label}</span>
                </>
              ) : (
                <Thumb kit={kit} recipe={look} box={row === 'body' ? 'bust' : tail ? 'wide' : 'head'} />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export interface PortraitMakerProps {
  kit: PortraitKit;
  recipe: Recipe;
  onChange: (next: Recipe) => void;
  /** bases of this sex only (the creation's chosen sex); any base when absent */
  sex?: 'm' | 'f';
  className?: string;
}

/** The rows of the maker; its owner draws the figure and the 随机, 保存 and 还原 buttons. */
export function PortraitMaker({ kit, recipe, onChange, sex, className }: PortraitMakerProps) {
  return (
    <div className={cx(styles.maker, className)}>
      {ROWS.map((row) => (
        <PartRow key={row} kit={kit} recipe={recipe} row={row} sex={sex} onChange={onChange} />
      ))}
    </div>
  );
}
