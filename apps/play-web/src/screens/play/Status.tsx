// The status bar (spec 四, 状态; 十一 for phones) and the hour and place in the top right corner.
import type { StateView } from '../../contracts';
import { Bar } from '../../ui/Bar';
import { Medal } from '../../ui/Medal';
import styles from './Status.module.css';

export interface StatusProps {
  view: StateView;
  onOpen: () => void;
}

/** 心境 short of the current realm's threshold: cultivating goes at half speed (item 36). */
export const mindShort = (view: StateView): boolean => view.play?.mind?.now?.met === false;

/**
 * The realm ring, the name and realm, 气血 and 法力; desktops add 修为, 寿元 and 灵石. In the cultivation
 * life a phone has rows of 修为 and 灵石 under the bars too (gameplay plan item 13), and both say 心境
 * where the save has it (item 36), underlined in cinnabar when it is short of this realm's threshold.
 */
export function Status({ view, onOpen }: StatusProps) {
  const { player } = view;
  const progress = player.xp.max > 0 ? player.xp.current / player.xp.max : 0;
  const mind = view.play?.mind;
  const short = mindShort(view);
  return (
    <header className={styles.status} aria-label="状态">
      <Medal
        glyph={player.realmGlyph}
        progress={progress}
        label={`${player.realm}，修为 ${player.xp.current} / ${player.xp.max}，打开角色`}
        onClick={onOpen}
      />
      <div className={styles.lines}>
        <p className={styles.who}>
          <b className={styles.name}>{player.name}</b>
          <span className={styles.realm}>{player.realm}</span>
        </p>
        <Bar label="气血" current={player.hp.current} max={player.hp.max} tone="hp" />
        <Bar label="法力" current={player.mp.current} max={player.mp.max} tone="mp" />
        {view.play && (
          <p className={styles.life}>
            <span className={styles.lifeWords}>
              <span>修为 <b>{player.xp.current} / {player.xp.max}</b></span>
              {mind && <span>心境 <b data-short={short ? '' : undefined}>{mind.value}</b></span>}
              <span className={styles.stones}>灵石 <b>{player.stones}</b></span>
            </span>
          </p>
        )}
        <p className={styles.more}>
          <span>
            修为 <b>{player.xp.current}</b> / {player.xp.max}
          </span>
          <span>
            寿元 <b>{player.lifespan.age}</b> / {player.lifespan.max}
          </span>
          <span>
            <i className={styles.dot} aria-hidden="true" />
            灵石 <b>{player.stones}</b>
          </span>
          {mind && (
            <span>
              心境 <b data-short={short ? '' : undefined}>{mind.value}</b>
            </span>
          )}
        </p>
      </div>
    </header>
  );
}

export interface PlaceProps {
  hourName: string;
  /** 「青岚山 · 观云台」 */
  place: string;
  /** the place's own name, shown alone on phones */
  short: string;
  date: string;
  weather: string;
  /** the cultivation life on phones: the day, and 「廿七岁 · 寿元一百」, under the place */
  life?: { date?: string; age?: string; lifespan?: string };
}

/** The hour in brush, the place, and the date with the weather (desktops only). */
export function Place({ hourName, place, short, date, weather, life }: PlaceProps) {
  return (
    <div className={styles.place} aria-label="时辰与地点">
      <b className={styles.hour}>{hourName}</b>
      <span className={styles.where} title={place}>
        <span className={styles.long}>{place}</span>
        <span className={styles.short}>{short}</span>
      </span>
      <span className={styles.when}>
        {date}
        {weather && <span className={styles.weather}> · {weather}</span>}
      </span>
      {life?.date && <span className={styles.cal}>{life.date}</span>}
      {(life?.age || life?.lifespan) && (
        // on the narrowest phones the age and the lifespan take a line each: one line reached past the place
        <span className={styles.cal}>
          {life.age && <span>{life.age}</span>}
          {life.age && life.lifespan && <i> · </i>}
          {life.lifespan && <span>{life.lifespan}</span>}
        </span>
      )}
    </div>
  );
}
