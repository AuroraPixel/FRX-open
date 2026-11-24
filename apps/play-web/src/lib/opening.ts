// The first scene the play screen draws on its stage. A sample set (?fixture=) replays the turn under way as
// the save opens only after it (api/fixtures.ts): at ?speed=0 the turn's change of scene would otherwise
// overtake the start scene's own file, and a journey's passage would have no place to leave from.

let expected = false;
let drawn: () => void = () => undefined;
const opening = new Promise<void>((resolve) => {
  drawn = resolve;
});

/** A play screen is opening: what waits for its first scene waits from now on. */
export function expectOpening(): void {
  expected = true;
}

/** Resolves once the play screen being opened has drawn its first scene; at once when none is opening. */
export function openingScene(): Promise<void> {
  return expected ? opening : Promise.resolve();
}

/** The play screen's stage has its first scene, or has found it has none to draw. */
export function openingDrawn(): void {
  drawn();
}
