// 买卖 (gameplay plan item 35): what the shops at the player's place sell this year and which of the bag's
// things they take (GET …/shop), on two pages, 买 and 卖. A row each good: its name, the price of one and,
// with 识货, its tier and the prices behind it. A row pressed: how many (a stepper), 讨价 once a month
// before buying, the preview (POST …/preview, verb trade { side, id, count, haggle }) and 「买下」 or 「卖出」
// sending that verb; 「看别的」 goes back. The stones held stand at the top.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { ShopGood, ShopView, Verb } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Empty, Loading } from '../../ui/Loading';
import { Tabs } from '../../ui/Tabs';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import { Choice } from './SettingsControls';
import { usePreview } from './usePreview';
import styles from './Shop.module.css';

type Side = 'buy' | 'sell';
const SIDES = [
  { id: 'buy', label: '买' },
  { id: 'sell', label: '卖' },
];

/** 「每枚两块」 */
export function priceWords(good: ShopGood): string {
  return `每${good.unit}${good.price === 2 ? '两' : chineseNumber(good.price)}块`;
}

/** The most of a good this side can take: what the purse buys, or what the bag holds; at least one. */
export function mostOf(good: ShopGood, side: Side, stones: number): number {
  if (side === 'sell') return Math.max(1, good.count ?? 1);
  return Math.max(1, Math.min(99, good.price > 0 ? Math.floor(stones / good.price) : 99));
}

function GoodDetail({ saveId, shop, good, side, onBack }: { saveId: string; shop: ShopView; good: ShopGood; side: Side; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const stones = view?.player.stones ?? 0;
  const most = mostOf(good, side, stones);
  const [count, setCount] = useState(1);
  const [haggle, setHaggle] = useState(false);
  const verb: Verb = { kind: 'trade', side, id: good.id, count, ...(haggle && side === 'buy' ? { haggle: true } : {}) };
  const { preview, problem, asking } = usePreview(saveId, verb);
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene;
  const name = side === 'buy' ? '买下' : '卖出';
  const why = busy
    ? `这一回合写完之后才能${name}。`
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : (problem ?? (preview && !preview.ok ? (preview.reason ?? `眼下${name}不了。`) : preview ? spanWords(preview.minutes) : ''));
  const go = () => {
    if (ready && sendCommand({ verb })) closeSheet();
  };
  const titleId = useId();
  return (
    <section className={styles.detail} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h3 id={titleId}>{good.name}</h3>
        <span>{priceWords(good)}</span>
      </header>
      <div className={styles.count} role="group" aria-label={`${name}几${good.unit}`}>
        <button type="button" aria-label={`少一${good.unit}`} disabled={count <= 1} onClick={() => setCount(count - 1)}>
          −
        </button>
        <output aria-live="polite">
          {count}
          <small>{good.unit}</small>
        </output>
        <button type="button" aria-label={`多一${good.unit}`} disabled={count >= most} onClick={() => setCount(count + 1)}>
          +
        </button>
      </div>
      {side === 'buy' && shop.haggle.open && (
        <div className={styles.haggle}>
          <span>先讨价（成了便宜{shop.haggle.off === 20 ? '两' : chineseNumber(Math.round(shop.haggle.off / 10))}成，这个月一次）</span>
          <Choice
            label="先讨价"
            options={[
              { id: 'on', label: '讨' },
              { id: 'off', label: '不讨' },
            ]}
            value={haggle ? 'on' : 'off'}
            onChange={(value) => setHaggle(value === 'on')}
          />
        </div>
      )}
      <div className={days.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind="trade" /> : !problem ? <Loading text="推算中……" /> : null}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className={styles.go}>
        <Act glyph="市" name={name} note={why} hot={ready} unavailable={!ready} onClick={go} />
        <Btn onClick={onBack}>看别的</Btn>
      </div>
    </section>
  );
}

export function ShopSheet({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const [shop, setShop] = useState<ShopView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('buy');
  const [picked, setPicked] = useState<string | null>(null);
  const paneId = useId();
  useEffect(() => {
    const stop = new AbortController();
    play.shop(saveId, stop.signal).then(
      (answer) => !stop.signal.aborted && setShop(answer),
      (error: unknown) => !stop.signal.aborted && setProblem(error instanceof ApiError ? error.message : '店里的货没能看到，稍后再试。'),
    );
    return () => stop.abort();
  }, [saveId]);

  if (problem) {
    return (
      <p className={styles.problem} role="alert">
        {problem}
      </p>
    );
  }
  if (!shop) return <Loading text="进店……" />;
  if (!shop.open) return <Empty title="这里没有店铺" text="有店铺、当铺、黑市或拍卖行的地方才能买卖。" />;
  const goods = side === 'buy' ? shop.sells : shop.buys;
  const good = goods.find((each) => each.id === picked);
  if (good) return <GoodDetail key={`${side}:${good.id}`} saveId={saveId} shop={shop} good={good} side={side} onBack={() => setPicked(null)} />;
  return (
    <div className={styles.shop}>
      <p className={styles.where}>
        <b>{shop.place ?? '此处'}</b>
        持有灵石 {view?.player.stones ?? 0} 块{shop.haggle.open ? ' · 这个月还能讨一次价' : ''}
      </p>
      <Tabs
        items={SIDES}
        value={side}
        label="买或卖"
        controls={paneId}
        className={styles.sides}
        onChange={(id) => {
          setSide(id === 'sell' ? 'sell' : 'buy');
          setPicked(null);
        }}
      />
      <div id={paneId} role="tabpanel" aria-label={side === 'buy' ? '买' : '卖'}>
        {goods.length === 0 ? (
          <p className={styles.none}>{side === 'buy' ? '店里今年没有货。' : '储物袋里没有店里收的东西。'}</p>
        ) : (
          <ul className={styles.rows}>
            {goods.map((each) => (
              <li key={each.id}>
                <button type="button" className={styles.row} onClick={() => setPicked(each.id)}>
                  <span className={styles.what}>
                    <b>{each.name}</b>
                    <small>
                      {side === 'sell' && each.count !== undefined ? `持有 ${each.count}${each.unit}` : ''}
                      {shop.appraise && each.tier ? `${side === 'sell' && each.count !== undefined ? ' · ' : ''}${each.tier}` : ''}
                      {shop.appraise && each.base !== undefined ? ` · 底价 ${each.base}` : ''}
                      {shop.appraise && each.market !== undefined ? ` · 今年 ${each.market}` : ''}
                    </small>
                  </span>
                  <span className={styles.price}>
                    <b>{each.price}</b>
                    <small>灵石/{each.unit}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
