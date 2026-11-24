// The stage under the play screen: made on a fresh canvas once the screen's stage layer is in the page,
// disposed with its canvas when the layer goes (a disposed stage loses its drawing context, so a canvas
// is never reused). With the clock pinned (?t=, screenshots) the stage is deterministic too, and with
// ?at= a change of scene is shown that many seconds in, like every other performance. A change of the
// picture quality setting makes the stage anew: the size of its layers is chosen when it is made.
import { useEffect, useState } from 'react';
import { pins } from '../../lib/params';
import { create } from '../../stage';
import { stageStart, useSettingsStore } from '../../store/settings';
import { blurOff } from '../../ui/Frame';
import { Director } from './director';
import { ASSETS } from './scenes';
import { showPin } from './showClock';

/** `host` is the stage layer, from a callback ref: the screen draws it only once its data is in. */
export function useDirector(host: HTMLElement | null, canvasClass: string): Director | null {
  const [director, setDirector] = useState<Director | null>(null);
  const quality = useSettingsStore((s) => s.quality);
  useEffect(() => {
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = canvasClass;
    host.append(canvas);
    const pinned = pins();
    const at = showPin();
    const stage = create(canvas, {
      assets: ASSETS,
      ...(pinned.t !== undefined ? { deterministic: { seed: pinned.seed ?? 1, t: 1.2, ...(at !== null ? { transitionAt: at } : {}) } } : {}),
      ...stageStart(),
      // ?webgl=off: the stand-in a browser without WebGL2 gets
      ...(pinned.webgl === 'off' ? { fallback: true } : {}),
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
    };
  }, [host, canvasClass, quality]);
  return director;
}
