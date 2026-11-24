import type { Recipe, SceneFile } from '../contracts';
import type { PlaqueSpec } from './compose/compose';

export type { PlaqueSpec, Recipe };

export type Hour = 'night' | 'dawn' | 'day' | 'dusk';
export type Weather = 'clear' | 'cloud' | 'mist' | 'rain' | 'snow';
export type FocusPreset = 'idle' | 'read' | 'sheet' | 'cult' | 'close' | 'cine1' | 'cine2';
// main: the one speaking, on the right; side: a second person, nearer the middle, a tenth shorter and a fifth darker
export type PortraitSlot = 'main' | 'side';
export type CheckOutcome = 'success' | 'failure' | 'critical_success' | 'critical_failure';
// how the protagonist's back view is drawn: seated on a cushion or standing
export type Pose = 'sit' | 'stand';
// the settings' motion level (界面规范第二节「动效」)
export type MotionLevel = 'full' | 'weak' | 'off';

// The protagonist's back view at the scene's player anchor (执行计划第 39 项). Lit like the painted layers; the
// robe is the painted blue-grey recoloured to the protagonist's own clothes.
export interface ProtagonistSpec {
  // which back view; default the recipe's sex, else a man
  sex?: 'm' | 'f';
  // the protagonist's portrait recipe: gives the sex and the robe's colour (the main colour of its body part)
  recipe?: Recipe;
  // the robe's colour, '#rrggbb' or sRGB 0..1; overrides the recipe's; default the painted blue-grey
  robe?: string | [number, number, number];
  // default the scene's (seated unless the scene says otherwise); cultivating and breaking through always sit
  pose?: Pose;
}

export const FOCUS_PRESETS: readonly FocusPreset[] = ['idle', 'read', 'sheet', 'cult', 'close', 'cine1', 'cine2'];
export const HOUR_NAMES: readonly Hour[] = ['night', 'dawn', 'day', 'dusk'];

// The part of the picture under the reading column, in CSS pixels from the canvas's top-left corner. It goes soft and
// is pushed towards the page colour. Feather and amount default to the reading layout's values (界面规范第九节).
export interface VeilRect {
  x: number;
  y: number;
  w: number;
  h: number;
  feather?: number;
  amount?: number;
}

export interface SceneSettings {
  hour?: Hour;
  weather?: Weather;
}

// A scene handed to the stage whole instead of read from assets/scenes/<id>/scene.json: a place composed on the page
// from its family's kit (stage/compose). Its pictures are in `folder` (the half-size ones in its half/), and the
// place's name is written on the plaques before they are shown (a plaque whose name cannot be written, the brush font
// missing, shows blank). Its file's id names it: the same id again only changes the hour and the weather.
export interface SceneSpec {
  file: SceneFile;
  // ends in '/'
  folder: string;
  plaques?: readonly PlaqueSpec[];
}

// the id of a scene asked for by id or handed over whole
export function sceneIdOf(scene: string | SceneSpec): string {
  return typeof scene === 'string' ? scene : scene.file.id;
}

// The opponent of a fight (执行计划第 60、63 项), standing on the right of the picture and lit like the portraits: a
// person composed from their recipe, or a beast's picture from the bestiary.
export interface FoeSpec {
  recipe?: Recipe;
  // the URL of a bestiary picture (transparent, the beast standing on its bottom edge)
  picture?: string;
  // how big the beast is next to a wolf (the bestiary's `size`, 0.5 to 1.8); default 1
  size?: number;
}

// Every effect also takes `since`: in the deterministic mode a still shows the effect that many seconds in (default
// the clock's t), so stills of several effects, or of one at several moments, can be taken with one clock.
export interface FxTiming {
  since?: number;
}

// What each effect takes. A receipt block's fx object ({ name, ... }) can be passed as the params as it is.
export interface FxParams {
  // the qi gathers for `seconds`; the camera goes to the cultivation preset and back
  cultivate: { seconds: number };
  // the breakthrough timeline; the title text and the black bars are the page's, on the same clock
  breakthrough: { success: boolean; realm?: string };
  // a sword-light crosses the sky and the camera follows it a little
  sword: object;
  // the flash when a judgement's seal lands
  check: { outcome: CheckOutcome };
  // the formation glows gold, as it does after a breakthrough
  settle: object;
  // back to the quiet formation
  reset: object;
  // who is speaking; the other portrait dims a fifth
  speaker: { slot: PortraitSlot };
  // one exchange of a fight (界面规范第七节「交锋」). At the foe (the default): a hit flashes and shakes the picture
  // (0.1 s up, 1.3 s down) and the foe reels; a miss makes the foe step aside. At the player: the foe lunges, and a
  // hit darkens and shakes the picture.
  strike: { hit: boolean; at?: 'foe' | 'player' };
}
export type FxName = keyof FxParams;

// The settings' picture quality: high keeps the full-size layers and the full pixel ratio, low takes the half-size
// layers and a lower resolution everywhere; auto is the stage's own policy (界面规范第九节「性能上的规矩」).
export type Quality = 'auto' | 'high' | 'low';

export interface StageOptions {
  // where the runtime art is served, ending in '/'
  assets?: string;
  // use the half-size layers (default: by the canvas's size and the device's pixel ratio when the stage is made, see
  // sizes.ts: a phone upright or on its side takes them, a desktop or a tablet the full-size ones)
  narrow?: boolean;
  // screenshots: seeded randomness, the clock stopped at t seconds, no pointer drift, no resolution drops, every
  // transition snaps and an effect is shown t seconds after it starts. With `transitionAt`, a change of scene, hour
  // or weather after the first scene is shown that many seconds in instead of snapping.
  deterministic?: { seed: string | number; t: number; transitionAt?: number };
  // default: the system's prefers-reduced-motion
  reducedMotion?: boolean;
  // default 'full' (the system's reduced motion still counts as 'off'); see Stage.motion
  motion?: MotionLevel;
  // default 'auto'; 'low' also implies the half-size layers and 'high' the full-size ones, unless `narrow` says
  quality?: Quality;
  // use the static stand-in even where WebGL2 works (tests and the lab)
  fallback?: boolean;
  // errors that would otherwise only reach the console (a scene that fails to load, a portrait part that is missing)
  onError?: (error: Error) => void;
  // the frames came too slowly and the stage drew at a lower resolution, `steps` times so far (界面规范第九节「性能上的
  // 规矩」): the page lightens what it draws over the picture (the panels' backdrop blur, 第三节「面板框」)
  onSlower?: (steps: number) => void;
}

export interface Stage {
  // Change scene, by id (assets/scenes/<id>/scene.json) or handed over whole; with the same id only the hour and the
  // weather change.
  setScene(scene: string | SceneSpec, settings?: SceneSettings): Promise<void>;
  focus(preset: FocusPreset): void;
  // Bring a portrait on (composed from the recipe with the portrait kit and lit by the scene) or take it off.
  portrait(slot: PortraitSlot, recipe: Recipe | null): Promise<void>;
  veil(rect: VeilRect | null): void;
  // Resolves when the effect has played out.
  fx<N extends FxName>(name: N, params: FxParams[N] & FxTiming): Promise<void>;
  // 0 lets the camera sway; 1 quiets it to a fifth, for reading.
  still(amount: number): void;
  // Resolves once the scene and the portraits asked for so far are loaded and drawn.
  ready(): Promise<void>;
  dispose(): void;
  // ---- added with the stage's follow-ups (items 39, 58, 62); everything above is unchanged
  // The protagonist's back view at the scene's player anchor; null takes it away. Until the first call the stage
  // shows nobody there (it does not guess the player). Resolves when it is drawn.
  protagonist(spec: ProtagonistSpec | null): Promise<void>;
  // A full-height panel covers the picture: the stage draws at most 30 frames a second and does no veil work.
  setCovered(covered: boolean): void;
  // The settings' motion level. 'weak' and 'off' stop the camera's sway, the portraits' breathing and the shakes,
  // and turn a change of scene into a plain crossfade; 'off' also slows the stage's time like reduced motion.
  motion(level: MotionLevel): void;
  // ---- added with the play screen's performances (items 59-61, 63); everything above is unchanged
  // The opponent of a fight; null sends it away (it fades out). Resolves when it is drawn.
  foe(spec: FoeSpec | null): Promise<void>;
}
