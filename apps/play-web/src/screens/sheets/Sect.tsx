// 宗门 (gameplay plan item 46), from the state view's play.sect: the sect and its ladder with the
// player's rung, the contribution in hand and all ever earned, the stipend, the next rung and what it
// asks (晋升, sect_promote, once both are met), this year's duty with its preview (领差事 sends verb
// duty; it is done at the sect's gate), the contests with their days (报名 is sect_enter; while one
// runs, 去比试 sends verb contest, a string of bouts the engine fights alone) and the exchange by hall (a
// row pressed shows 兑换, sect_exchange; one that cannot be had says why). A loose cultivator sees the
// two ways in (play.joining): 开院会 at its place on its day, or a 听澜帖 from the bag, and the sects,
// each with 入门 (sect_join, by fair or token) when one of them lets the player in now.
import { useId, useMemo, useState } from 'react';
import { play as api } from '../../api/client';
import type { PlayJoining, PlaySect, SectContest, SectOffer } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Empty, NOVEL_SAVE } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { Tabs } from '../../ui/Tabs';
import { sendCommand } from '../play/commands';
import { usePanelAction } from './act';
import { MONTHS, lunarDay } from './gameTime';
import { More } from './More';
import { usePreview } from './usePreview';
import common from './common.module.css';
import styles from './Sect.module.css';

/** The rungs of the ladder, lowest first (content/life/sects.json ladder). */
export const LADDER = ['记名', '外门', '内门', '真传', '执事', '长老'];

const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** 「0001-08-15」 → 「八月十五」; another year than `year` leads: 「四年八月十五」. */
export function dayWords(key: string | undefined, year?: number): string {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(key ?? '');
  if (!match) return key ?? '';
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = `${MONTHS[m - 1] ?? `${m}月`}${lunarDay(d)}`;
  return year !== undefined && y !== year ? `${chineseNumber(y)}年${day}` : day;
}

/** 「每年」, 「三年一次」 */
const everyWords = (every: number) => (every <= 1 ? '每年' : `${chineseNumber(every)}年一次`);

/** What a contest says on its row: when it opens, how long, how often, and where the player stands. */
export function contestTerms(contest: SectContest, year?: number): string {
  return [`${dayWords(contest.date, year)}起${chineseNumber(contest.days)}日`, everyWords(contest.every), contest.open ? '正开着' : '']
    .filter(Boolean)
    .join(' · ');
}

/** The halls of the exchange, in the order the list names them first. */
export function hallsOf(offers: readonly SectOffer[]): string[] {
  return [...new Set(offers.map((offer) => offer.hall))];
}

function Ladder({ status }: { status: string }) {
  const at = LADDER.indexOf(status);
  return (
    <ol className={styles.ladder} aria-label={`宗门的阶梯，你在${status}`}>
      {LADDER.map((rung, index) => (
        <li key={rung} data-at={index === at ? '' : undefined} data-past={index < at ? '' : undefined}>
          {rung}
        </li>
      ))}
    </ol>
  );
}

function Member({ saveId, sect, year }: { saveId: string; sect: PlaySect; year?: number }) {
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const scene = useStateStore((s) => Boolean(s.view?.play?.scene || s.view?.play?.fight));
  const { run, blocked } = usePanelAction(saveId);
  const halls = useMemo(() => hallsOf(sect.exchange), [sect.exchange]);
  const [hall, setHall] = useState(halls[0] ?? '');
  const [picked, setPicked] = useState<string | null>(null);
  const duty = sect.duty.next;
  const { preview, problem, asking } = usePreview(saveId, duty ? { kind: 'duty' } : null);
  const paneId = useId();
  const turnWhy = busy ? '这一回合写完之后再说。' : scene ? '这场戏还没收场。' : '';
  const dutyReady = Boolean(preview?.ok) && !asking && !turnWhy;
  const dutyNote = turnWhy || (asking ? '推算中……' : (problem ?? (preview && !preview.ok ? (preview.reason ?? '眼下领不了。') : (preview?.lines[0] ?? ''))));
  const send = (verb: Parameters<typeof sendCommand>[0]['verb']) => {
    if (sendCommand({ verb })) closeSheet();
  };
  const next = sect.next;
  return (
    <div className={styles.sect}>
      <header className={styles.head}>
        <i className={styles.seal} aria-hidden="true">
          {sect.name.slice(0, 1)}
        </i>
        <div>
          <h3>{sect.name}</h3>
          <p>
            <b className={styles.rung}>{sect.status}</b>弟子
            {sect.place ? (sect.here ? ' · 人在山门' : ` · 山门在${sect.place}`) : ''}
          </p>
        </div>
      </header>
      <Ladder status={sect.status} />
      <dl className={styles.purse}>
        <div>
          <dt>贡献</dt>
          <dd>
            <b>{chineseNumber(sect.contribution)}</b>
            <small>历来挣下{chineseNumber(sect.earned)}</small>
          </dd>
        </div>
        <div>
          <dt>月俸</dt>
          <dd>
            <b>{sect.stipend ? `${two(sect.stipend)}块` : '无'}</b>
            <small>灵石，月结时发</small>
          </dd>
        </div>
      </dl>

      <section className={common.section} aria-label="晋升">
        <Sub>晋升</Sub>
        {next ? (
          <div className={styles.step}>
            <p>
              往上是<b>{next.status}</b>：要到<b>{next.realm}</b>，历来挣下贡献<b>{chineseNumber(next.earned)}</b>
              {next.met ? '，都齐了。' : `（现有${chineseNumber(sect.earned)}）。`}
            </p>
            <Act
              glyph="升"
              name="晋升"
              note={next.met ? `升为${next.status}` : '境界或贡献还不够'}
              hot={next.met && !blocked}
              unavailable={!next.met || blocked}
              onClick={() => void run((version) => api.action(saveId, { version, action: 'sect_promote' }), `升为${next.status}`)}
            />
          </div>
        ) : (
          <p className={common.note}>已到最高的一阶。</p>
        )}
      </section>

      <section className={common.section} aria-label="差事">
        <Sub>差事</Sub>
        <p className={styles.line}>
          今年办了<b>{chineseNumber(sect.duty.done)}</b>件，要办{chineseNumber(sect.duty.need)}件
          {sect.duty.since ? `（从${dayWords(sect.duty.since, year)}算起）` : ''}。一年不办，执法堂要问罪。
        </p>
        {duty && (
          <Act
            glyph="差"
            name={`领差事 · ${duty.title}`}
            note={dutyNote || `${chineseNumber(duty.days)}日 · 贡献${chineseNumber(duty.contribution)}`}
            hot={dutyReady}
            unavailable={!dutyReady}
            onClick={() => send({ kind: 'duty' })}
          />
        )}
      </section>

      {sect.contests && sect.contests.length > 0 && (
        <section className={common.section} aria-label="比试">
          <Sub>比试</Sub>
          <ul className={styles.rows}>
            {sect.contests.map((contest) => {
              const entered = Boolean(contest.entered);
              return (
                <li key={contest.name} className={styles.contest}>
                  <i className={styles.mark} aria-hidden="true">
                    {contest.name.slice(0, 1)}
                  </i>
                  <span className={styles.what}>
                    <b>{contest.name}</b>
                    <small>{contestTerms(contest, year)}</small>
                  </span>
                  {entered && contest.open ? (
                    <Act glyph="比" name="去比试" note="一日之内比完" hot={!turnWhy} unavailable={Boolean(turnWhy)} onClick={() => send({ kind: 'contest' })} />
                  ) : entered ? (
                    <em className={styles.entered}>已报名</em>
                  ) : (
                    <button
                      type="button"
                      className={styles.enter}
                      disabled={blocked || Boolean(sect.contests?.some((each) => each.entered))}
                      onClick={() =>
                        void run(
                          (version) => api.action(saveId, { version, action: 'sect_enter', contest: contest.name as '小比' | '大比' }),
                          `报了${contest.name}：${dayWords(contest.date, year)}开比`,
                        )
                      }
                    >
                      报名
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={common.section} aria-label="兑换">
        <Sub>兑换</Sub>
        <div className={common.tabsRow}>
          <Tabs
            items={halls.map((name) => ({ id: name, label: name }))}
            value={hall}
            onChange={(id) => {
              setHall(id);
              setPicked(null);
            }}
            label="兑换的殿"
            controls={paneId}
          />
        </div>
        <ul id={paneId} className={styles.rows} role="tabpanel">
          {sect.exchange
            .filter((offer) => offer.hall === hall)
            .map((offer) => (
              <li key={offer.id}>
                <button
                  type="button"
                  className={styles.offer}
                  data-off={offer.off ? '' : undefined}
                  aria-expanded={picked === offer.id}
                  onClick={() => setPicked(picked === offer.id ? null : offer.id)}
                >
                  <span className={styles.what}>
                    <b>{offer.name}</b>
                    <small>{offer.off ? offer.note : `${offer.status}以上可换`}</small>
                  </span>
                  <span className={styles.price}>
                    <b>{chineseNumber(offer.price)}</b>
                    <small>贡献</small>
                  </span>
                </button>
                {picked === offer.id && (
                  <More id={`offer-${offer.id}`}>
                    <p>
                      花{chineseNumber(offer.price)}点贡献换一份{offer.name}，换来的放进行囊。
                    </p>
                    <Act
                      glyph="换"
                      name="兑换"
                      note={offer.off ? offer.note : `贡献${chineseNumber(sect.contribution)} → ${chineseNumber(sect.contribution - offer.price)}`}
                      hot={!offer.off && !blocked}
                      unavailable={Boolean(offer.off) || blocked}
                      onClick={() =>
                        void run((version) => api.action(saveId, { version, action: 'sect_exchange', offerId: offer.id }), `换得${offer.name}`)
                      }
                    />
                  </More>
                )}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

/** How a sect would take the player now: by the token, by the fair, or why neither. */
export function wayIn(joining: PlayJoining): { by: 'token' | 'fair' } | { why: string } {
  if (joining.token.have) return { by: 'token' };
  if (joining.fair.open && !joining.fair.why) return { by: 'fair' };
  return { why: joining.fair.why ?? `没有${joining.token.name}` };
}

function Loose({ saveId, joining, year }: { saveId: string; joining: PlayJoining; year?: number }) {
  const { run, blocked } = usePanelAction(saveId);
  const way = wayIn(joining);
  const fair = joining.fair;
  return (
    <div className={styles.sect}>
      <header className={styles.head}>
        <i className={styles.seal} aria-hidden="true">
          散
        </i>
        <div>
          <h3>散修</h3>
          <p>身无宗门：没有月俸，也没有差事。入门有两条路。</p>
        </div>
      </header>
      <dl className={common.rows}>
        <div>
          <dt>{fair.name}</dt>
          <dd>
            {fair.place}
            {fair.date ? ` · ${dayWords(fair.date, year)}${fair.open ? '正开着' : '开场'}` : ''}
            {fair.why ? <small className={styles.why}>{fair.why}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{joining.token.name}</dt>
          <dd>{joining.token.have ? '行囊里有一枚，持令可入任何一派' : '行囊里没有'}</dd>
        </div>
      </dl>
      <section className={common.section} aria-label="宗门">
        <Sub>入门</Sub>
        {'why' in way && <p className={common.note}>{way.why}，眼下入不了门。</p>}
        <ul className={styles.rows}>
          {joining.sects.map((sect) => (
            <li key={sect.name} className={styles.contest}>
              <i className={styles.mark} aria-hidden="true">
                {sect.name.slice(0, 1)}
              </i>
              <span className={styles.what}>
                <b>{sect.name}</b>
                <small>{sect.place ? `山门在${sect.place}` : '没有定处的山门'}</small>
              </span>
              <button
                type="button"
                className={styles.enter}
                disabled={blocked || 'why' in way}
                onClick={() =>
                  'by' in way &&
                  void run(
                    (version) => api.action(saveId, { version, action: 'sect_join', sect: sect.name, by: way.by }),
                    `入了${sect.name}`,
                  )
                }
              >
                {'by' in way && way.by === 'token' ? '持令入门' : '入门'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SectSheet({ saveId }: { saveId: string }) {
  const play = useStateStore((s) => s.view?.play);
  if (!play) return <Empty title="没有宗门" text={NOVEL_SAVE} />;
  const year = play.date?.year;
  if (play.sect) return <Member saveId={saveId} sect={play.sect} year={year} />;
  if (play.joining) return <Loose saveId={saveId} joining={play.joining} year={year} />;
  return <Empty title="宗门" text="眼下看不到宗门的事。" />;
}
