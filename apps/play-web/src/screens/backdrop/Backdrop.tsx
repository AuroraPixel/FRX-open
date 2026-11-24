// The stage behind the title, the saves and the creation: made once when the first of them opens and kept
// while the player moves between them, then disposed with its canvas (the play screen makes its own). It
// shows what useBackdrop wants, gives the page the colour set of its hour, and plays the scene's sound.
import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio';
import { pins } from '../../lib/params';
import { create } from '../../stage';
import { stageStart, useSettingsStore } from '../../store/settings';
import { lightFor, useUiStore } from '../../store/ui';
import { blurOff } from '../../ui/Frame';
import { Director } from '../play/director';
import { ASSETS, ambienceOf, sceneFile } from '../play/scenes';
import { useBackdrop } from './wish';
import styles from './Backdrop.module.css';

export function Backdrop() {
  const host = useRef<HTMLDivElement>(null);
  const [director, setDirector] = useState<Director | null>(null);
  const wish = useBackdrop((s) => s.wish);
  const setDrawn = useBackdrop((s) => s.setDrawn);
  const setLight = useUiStore((s) => s.setLight);
  const motion = useSettingsStore((s) => s.motion);
  // the picture quality makes the stage anew, as on the play screen: its layers' size is chosen when it is made
  const quality = useSettingsStore((s) => s.quality);

  useEffect(() => {
    const layer = host.current;
    if (!layer) return;
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas ?? '';
    layer.append(canvas);
    const pinned = pins();
    const stage = create(canvas, {
      assets: ASSETS,
      ...(pinned.t !== undefined ? { deterministic: { seed: pinned.seed ?? 1, t: 1.2 } } : {}),
      ...stageStart(),
      onError: (error) => console.warn('stage:', error.message),
      // frames came too slowly: the panels drop their backdrop blur
      onSlower: () => blurOff(),
    });
    const made = new Director(stage);
    setDirector(made);
    return () => {
      made.dispose();
      canvas.remove();
      setDirector(null);
      useBackdrop.getState().setDrawn(false);
    };
  }, [quality]);

  // the page takes the colours of the hour shown
  useEffect(() => setLight(lightFor(wish.hour)), [wish.hour, setLight]);

  // the scene's sound: its ambience at this hour and its music
  useEffect(() => {
    let live = true;
    void sceneFile(wish.scene).then((file) => {
      if (!live || !file) return;
      audio.setAmbience(ambienceOf(file, wish.hour, wish.weather));
      audio.setMood(file.mood);
    });
    return () => {
      live = false;
    };
  }, [wish.scene, wish.hour, wish.weather]);
  useEffect(
    () => () => {
      audio.setAmbience(null);
      audio.setMood(null);
    },
    [],
  );

  useEffect(() => director?.motion(motion), [director, motion]);

  // everything the wish says, then: drawn once the stage has caught up with this very wish
  useEffect(() => {
    if (!director) return;
    let live = true;
    const work = director.setScene(wish.scene, wish.hour, wish.weather);
    director.focus(wish.focus);
    director.still(wish.still);
    director.veil(wish.veil);
    // a wish that drops the protagonist (the login) takes the last player's figure off the stage
    director.protagonist(wish.protagonist ?? null);
    void work
      .then(() => director.ready())
      .catch(() => undefined)
      .then(() => {
        if (live) setDrawn(true);
      });
    return () => {
      live = false;
    };
  }, [director, wish, setDrawn]);

  return <div ref={host} className={styles.backdrop} aria-hidden="true" />;
}
