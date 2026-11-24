/* The stage: a painted three.js scene under the page's text (执行计划「舞台」, 界面规范第九节, 实现指南第六节).

   const stage = create(canvas, { assets: '/play/assets/' });
   await stage.setScene('guanyuntai', { hour: 'night' });
   stage.focus('read'); stage.still(1);
   await stage.portrait('main', recipe);              // composed with the portrait kit, lit by the scene
   stage.veil({ x: -400, y: -400, w: 1078, h: 1700 }); // soften and darken the picture under the reading column
   await stage.fx('cultivate', { seconds: 6 });
   await stage.protagonist({ recipe: playerRecipe });    // the protagonist's back view, robe in their clothes' colour
   stage.setCovered(true);                              // a full-height panel is over the picture: 30 fps, no veil
   stage.motion('weak');                                // the settings' motion level
   await stage.foe({ picture: '/play/assets/bestiary/wolf.webp' });  // a fight's opponent on the right
   await stage.fx('strike', { hit: true });             // one exchange: the picture flashes, the foe reels

   Scene numbers live in assets/scenes/<id>/scene.json; nothing here knows a particular scene. A place composed on
   the page from its family's kit (stage/compose) is handed over whole: stage.setScene({ file, folder, plaques }), its
   name written on the plaques by the stage; the canvas's data-scene names the scene up. The stage reads no save and imports nothing from the page: it only knows
   recipes, scene files and these calls. Without WebGL2 (a
   canvas that gives no 'webgl2' context, or `fallback`) it is a still of the scene at the hour rendered beforehand
   from the same layers, with the portraits laid on top and changes crossfading (fallback.ts); the calls that cannot
   be shown do nothing. */
import { FallbackStage } from './fallback';
import { LiveStage } from './live';
import { hasWebGL2 } from './renderer';
import type { Stage, StageOptions } from './types';

export type {
  CheckOutcome, FocusPreset, FoeSpec, FxName, FxParams, FxTiming, Hour, MotionLevel, PortraitSlot, Pose, ProtagonistSpec,
  PlaqueSpec, Quality, Recipe, SceneSettings, SceneSpec, Stage, StageOptions, VeilRect, Weather,
} from './types';
export { sceneIdOf } from './types';

export function create(canvas: HTMLCanvasElement, opts: StageOptions = {}): Stage {
  canvas.setAttribute('aria-hidden', 'true');
  if (!opts.fallback && hasWebGL2()) {
    try {
      const stage = new LiveStage(canvas, opts);
      canvas.dataset.stage = 'webgl2';
      return stage;
    } catch (error) {
      (opts.onError ?? console.error)(error instanceof Error ? error : new Error(String(error)));
    }
  }
  canvas.dataset.stage = 'fallback';
  return new FallbackStage(canvas, opts);
}
