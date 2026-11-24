// Which size of the painted pictures the stage takes, and how finely it draws (执行计划第 70 项, 界面规范第九节
// 「性能上的规矩」 and 第十一节「手机上的性能和流量」). Decided once, when the stage is made, from the canvas's size in CSS
// pixels and the device's pixel ratio.

import { TALL_BELOW } from './camera';

// A phone: narrower than 760 px, or lower than 560 (a phone on its side, which takes the desktop's compact layout).
export const PHONE_WIDTH = 760;
export const PHONE_HEIGHT = 560;

export function isPhone(width: number, height: number): boolean {
  return width < PHONE_WIDTH || height < PHONE_HEIGHT;
}

// The pixel ratio the stage draws at, at most: 1.25 on phones, 1.6 elsewhere.
export function ratioCap(phone: boolean): number {
  return phone ? 1.25 : 1.6;
}

// The half-size layers and skies (each scene's half/ folder) are made for a phone held upright: its tall cameras
// see the layers about as finely as a half-size picture is painted. They serve wherever the stage's drawing buffer is
// no finer than that: a tall view up to 1400 px high (a phone, a narrow window), or a wide one up to 560 px high (a
// phone on its side). A desktop window or a tablet draws finer and keeps the full-size pictures.
export function halfSize(width: number, height: number, deviceRatio: number): boolean {
  const ratio = Math.min(deviceRatio || 1, ratioCap(isPhone(width, height)));
  const buffer = height * ratio;
  return width / Math.max(1, height) < TALL_BELOW ? buffer <= 1400 : buffer <= 560;
}
