// When the deterministic mode draws a frame. Its clock stands still, so a frame comes out the same as the one before
// unless something changed: a call, a resize, a load settling. A frame is drawn after such a change, while anything is
// still on its way or someone waits for frames, and a few frames more for what the change set off to settle (a timed
// call that fires on the next step, a figure fading out on the next update); then the canvas keeps its last picture
// until the next change. Drawing the same picture sixty times a second only made screenshot runs slow under load.
export const SETTLE_FRAMES = 3;

export class Redraw {
  private left = SETTLE_FRAMES;

  /** Something may have changed the picture. */
  changed(): void {
    this.left = SETTLE_FRAMES;
  }

  /** Whether to draw this frame; `busy` while anything is on its way or frames are awaited. */
  due(busy: boolean): boolean {
    if (busy) {
      this.left = SETTLE_FRAMES;
      return true;
    }
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }
}
