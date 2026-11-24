import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab stops at inside, in order: a roving group's other items (tabindex -1) are not stops. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.closest('[hidden], [inert]') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      // a control not drawn here (the sheet's 回 on desktops) cannot take focus
      getComputedStyle(el).display !== 'none',
  );
}

/** The traps open now, the latest last: Escape is the top one's (a dialog over a panel). */
const opened: object[] = [];

/** The page's notices (data-toasts): Tab reaches them from an open panel or dialog, after its own. */
function toastStops(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-toasts]')].flatMap(focusables);
}

/**
 * Keeps keyboard focus inside a panel or dialog while it is open (spec 十二): Tab cycles within it and the
 * page's notices after it (the documents pass, #16: a notice's cross and 重试 could not be reached with a
 * panel open), Escape closes it, and focus goes back to whatever opened it. Both are heard on the document,
 * for the top one: so a control inside that uses Escape itself (the map's search clearing its words, a
 * turn's menu) keeps it by stopping it, and a desktop panel closes even with the focus in the book
 * beside it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const me = {};
    opened.push(me);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) (focusables(root)[0] ?? root).focus({ preventScroll: true });

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || opened[opened.length - 1] !== me) return;
      const own = focusables(root);
      const items = [...own, ...toastStops()];
      const at = items.indexOf(document.activeElement as HTMLElement);
      // focus elsewhere (a desktop's book beside its panel): its own Tab, as before
      if (at < 0 && !root.contains(document.activeElement)) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (at >= own.length - 1 || (event.shiftKey && at === own.length)) {
        // across the gap between the panel and the notices, which the browser's own order does not keep
        event.preventDefault();
        items[at + (event.shiftKey ? -1 : 1)]?.focus();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !escape.current || opened[opened.length - 1] !== me) return;
      event.preventDefault();
      escape.current();
    };
    document.addEventListener('keydown', onTab);
    document.addEventListener('keydown', onEscape);
    return () => {
      opened.splice(opened.indexOf(me), 1);
      document.removeEventListener('keydown', onTab);
      document.removeEventListener('keydown', onEscape);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
