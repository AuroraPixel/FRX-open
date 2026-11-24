// 存档 (plan item 49): the saves list as a page of its own, over the title's scene softened behind it. On
// desktops a framed column in the middle; on phones the whole window. 回 goes back to the title.
import { useEffect } from 'react';
import { audio } from '../../audio';
import type { SaveSummary } from '../../contracts';
import { isDrawn, usePicturesTick } from '../../kit/shared';
import { useReady } from '../../lib/ready';
import { navigate } from '../../router';
import { Frame } from '../../ui/Frame';
import { Tool } from '../../ui/Tool';
import { PHONE, useMedia } from '../../ui/useMedia';
import { latestSave, titleHour, TITLE_WISH, useBackdrop } from '../backdrop/wish';
import { SavesList, useSaves } from './SavesList';
import styles from './Saves.module.css';

export function SavesScreen() {
  const state = useSaves();
  const phone = useMedia(PHONE);
  const want = useBackdrop((s) => s.want);
  const drawn = useBackdrop((s) => s.drawn);
  const latest = state.saves ? latestSave(state.saves) : undefined;

  // the title's scene stays behind, quiet, softened under the column
  useEffect(() => {
    if (!state.saves && !state.error) return;
    const width = Math.min(innerWidth - 64, 760);
    want({
      ...TITLE_WISH,
      hour: titleHour(latest),
      still: 1,
      ...(latest ? { protagonist: latest.player.portrait } : {}),
      veil: phone
        ? { x: -400, y: -400, w: innerWidth + 800, h: innerHeight + 800, amount: 0.86 }
        : { x: (innerWidth - width) / 2 - 60, y: -400, w: width + 120, h: innerHeight + 800, feather: 160, amount: 0.8 },
    });
  }, [state.saves, state.error, latest, phone, want]);

  // drawn when the list, the scene behind and every round head are
  usePicturesTick();
  const heads = state.saves?.every((save) => isDrawn(save.player.portrait, 'head')) ?? false;
  useReady(((state.saves !== null && heads) || state.error !== null) && drawn);

  const load = (save: SaveSummary) => {
    audio.play('ui.tap');
    navigate({ name: 'play', id: save.id });
  };

  return (
    <main className={styles.page} aria-labelledby="saves-title">
      <Frame className={styles.frame} data-ornate="">
        <header className={styles.head}>
          <Tool glyph="回" label="回到标题" onClick={() => navigate({ name: 'title' })} />
          <h1 id="saves-title" className={styles.title}>
            存档
          </h1>
          {state.saves && <span className={styles.count}>{state.saves.length} 个</span>}
        </header>
        <div className={styles.body}>
          <SavesList state={state} current={latest?.id} onLoad={load} onNew={() => navigate({ name: 'new' })} />
        </div>
      </Frame>
    </main>
  );
}
