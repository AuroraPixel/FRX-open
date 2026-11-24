import type { Recipe } from '../../contracts';
import { usePicture } from '../../kit/shared';
import { cx } from '../../ui/cx';
import styles from './Portrait.module.css';

export interface HeadProps {
  recipe?: Recipe;
  /** a picture to show in place of a portrait: a beast's, from the bestiary */
  picture?: string;
  /** whose head: its first character stands in until the picture is drawn */
  name: string;
  /** 40 (lists of people, as the spoken lines) or 56 (saves) */
  size?: 40 | 56;
  className?: string;
}

/** A round head cut from a portrait (spec 三, 对白行: a 1 px gold rim and a 3 px pale ring). */
export function Head({ recipe, picture, name, size = 40, className }: HeadProps) {
  const drawn = usePicture(picture ? undefined : recipe, 'head');
  const url = picture ?? drawn;
  const box = cx(styles.head, className);
  if (url) return <img className={box} data-size={size} src={url} alt="" width={size} height={size} />;
  return (
    <>
      <span className={box} data-size={size} aria-hidden="true">
        {[...name][0] ?? '·'}
      </span>
      {/* still being drawn: pages that wait for their pictures (the panels' screenshot page) see it */}
      {recipe && <span role="status" hidden />}
    </>
  );
}
