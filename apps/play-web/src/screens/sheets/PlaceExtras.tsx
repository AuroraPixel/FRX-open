// Under 去处's 「此处」 line in a save of the cultivation life (gameplay plan items 45 and 43): the arrays laid
// here and where the place's teleport array goes, in small words, and the way to the 洞府 and 阵法 panels
// from where the player stands.
import type { PlayView } from '../../contracts';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import styles from './PlaceExtras.module.css';

/** 「布着禁制、聚灵阵 · 传送阵通橘舟屿」, or nothing when neither is here. */
export function placeExtrasWords(play: PlayView): string {
  const arrays = play.arrays;
  const laid = arrays ? [...arrays.laid, ...arrays.field].map((each) => each.label) : [];
  const station = arrays?.station;
  return [
    laid.length ? `布着${laid.join('、')}` : '',
    station ? `传送阵${station.broken ? '残破' : `通${station.links.map((link) => link.to).join('、')}`}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function PlaceExtras({ play }: { play: PlayView }) {
  const openSheet = useUiStore((s) => s.openSheet);
  const words = placeExtrasWords(play);
  const home = play.home;
  return (
    <div className={styles.extras}>
      {words && <p className={styles.words}>{words}</p>}
      <div className={styles.links} role="group" aria-label="此处">
        <Btn onClick={() => openSheet('home')}>{home?.here ? '洞府 · 在此' : '洞府'}</Btn>
        <Btn onClick={() => openSheet('arrays')}>阵法</Btn>
      </div>
    </div>
  );
}
