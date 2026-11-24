// The painted interface textures (plan item 37: apps/play-web/assets/ui/, listed in ui.json). They are
// runtime assets, served at /play/assets/ui/ and never bundled, so their addresses go on the root element
// as custom properties once, and the style files use them as var(--tex-paper) and so on. Phones take the
// half-size copies in ui/half/. Colour stays with the tokens: the seal ink and the corner ornaments are
// used as masks over token colours (--cin, --gold), the paper grain as a faint overlay.
const UI = '/play/assets/ui/';

export const TEXTURES = {
  paper: 'paper.webp',
  seal: 'seal.webp',
  'corner-cloud': 'corner-cloud.webp',
  'corner-fret': 'corner-fret.webp',
  divider: 'divider.webp',
  'title-clouds': 'title-clouds.webp',
  'title-mountains': 'title-mountains.webp',
} as const;

export type TextureName = keyof typeof TEXTURES;

/** The address of a texture: the half-size copy on narrow screens. */
export function textureUrl(name: TextureName, narrow: boolean): string {
  return `${UI}${narrow ? 'half/' : ''}${TEXTURES[name]}`;
}

/** Puts --tex-<name> on the root element, following the phone breakpoint. */
export function installTextures(root: HTMLElement = document.documentElement): () => void {
  const query = typeof matchMedia === 'function' ? matchMedia('(max-width: 759px)') : null;
  const apply = () => {
    for (const name of Object.keys(TEXTURES) as TextureName[]) {
      root.style.setProperty(`--tex-${name}`, `url("${textureUrl(name, query?.matches ?? false)}")`);
    }
  };
  apply();
  query?.addEventListener('change', apply);
  return () => query?.removeEventListener('change', apply);
}
