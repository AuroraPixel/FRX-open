// How the book's text moves while a turn is written (spec 五, 滚动):
//   a new turn brings the player's stroke to the top of the text area (the turn being read is at least
//   as tall as the area, so there is always room for that);
//   while the reader can see the end of the text, new words keep it in view; once they scroll back the
//   text stays put and 「新的内容 ↓」 offers the way back;
//   when the turn is done, what comes after it (接下来) is brought in from its top, never past it;
//   scrolling to the very top fetches the ten turns before, without moving what is on screen.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface FollowOptions {
  /** the turn being read now (the one written last), by number */
  current: number | null;
  /** a turn is being written */
  writing: boolean;
  /** the number of the first turn shown, to keep the view still when earlier turns arrive above */
  first: number | null;
  /** earlier turns remain and none are being fetched */
  canLoadEarlier: boolean;
  loadEarlier: () => void;
  /** smooth scrolling, unless motion is off or the clock is pinned */
  smooth: boolean;
}

/** Room left under the end of the text: the faded last stretch of the book (64 px, 34 px on phones). */
function fadeOf(scroller: HTMLElement): number {
  return parseFloat(getComputedStyle(scroller).getPropertyValue('--fade')) || 0;
}

/** How far above the area's top 接下来's top may sit and still count as brought in (a line): past that the
 *  reader scrolled on, and the end is followed. */
const LEAD_SLACK = 32;

function scrollTo(scroller: HTMLElement, top: number, behavior: ScrollBehavior): void {
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior });
  else scroller.scrollTop = top;
}

export function useFollow(scrollerRef: RefObject<HTMLElement | null>, options: FollowOptions) {
  const { current, first, smooth } = options;
  const following = useRef(true);
  // where the page's own latest scroll is going, so that its scroll event is not taken for the reader's
  const own = useRef<number | null>(null);
  // the turn whose top was brought up: kept there while fonts and pictures settle, until the reader scrolls
  const pinned = useRef<number | null>(null);
  const [behind, setBehind] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  // where the reader was before the latest change: keeps the view still when turns arrive above
  const anchor = useRef<{ first: number | null; height: number; top: number }>({ first: null, height: 0, top: 0 });

  const endOf = useCallback((scroller: HTMLElement) => scroller.querySelector<HTMLElement>('[data-current] [data-end]'), []);

  /**
   * Whether the end of the current turn's text is in view (above the faded stretch), or as far in
   * view as it can come: a text scrolled to its very bottom is at its end.
   */
  const atEnd = useCallback(() => {
    const scroller = scrollerRef.current;
    const end = scroller && endOf(scroller);
    if (!scroller || !end) return true;
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2) return true;
    const box = scroller.getBoundingClientRect();
    return end.getBoundingClientRect().top <= box.bottom - fadeOf(scroller) + 12;
  }, [scrollerRef, endOf]);

  /**
   * Brings the end of the text into view, just above the faded stretch; but what comes after a turn that
   * is done (接下来, `data-lead`) comes in from its top: taller than the room left, its first suggestions
   * stay in view and the rest waits below (the owner's second playtest: on a phone the following brought
   * the end of it up, and the way on from the scene went up out of sight). A reader who has scrolled past
   * its top is followed to the end as before; a top a few pixels above the area's, where the page itself
   * shifted it after (a font or a picture settling), is still the top, and holds.
   */
  const toEnd = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const scroller = scrollerRef.current;
      const end = scroller && endOf(scroller);
      if (!scroller || !end) return;
      const box = scroller.getBoundingClientRect();
      const over = end.getBoundingClientRect().top - (box.bottom - fadeOf(scroller));
      const lead = scroller.querySelector<HTMLElement>('[data-current] [data-lead]');
      const room = lead ? lead.getBoundingClientRect().top - box.top - 8 : Infinity;
      const by = room >= -LEAD_SLACK ? Math.min(over + 8, room) : over + 8;
      if (over > 0 && by > 0) {
        const top = scroller.scrollTop + by;
        own.current = Math.min(top, scroller.scrollHeight - scroller.clientHeight);
        scrollTo(scroller, top, behavior);
      }
      following.current = true;
      pinned.current = null;
      setBehind(false);
    },
    [scrollerRef, endOf],
  );

  /**
   * Whether a turn's words fit under its top when the top is at the top of the area: measured from
   * the turn itself, not from where the view is now, which may still be on its way there.
   */
  const fits = useCallback(
    (no: number) => {
      const scroller = scrollerRef.current;
      const page = scroller?.querySelector<HTMLElement>(`[data-turn="${no}"] [data-page]`);
      const end = page?.querySelector<HTMLElement>('[data-end]');
      if (!scroller || !page || !end) return true;
      const words = end.getBoundingClientRect().top - page.getBoundingClientRect().top;
      return words <= scroller.clientHeight - fadeOf(scroller) + 12;
    },
    [scrollerRef],
  );

  /**
   * Puts the start of a turn's page, the player's stroke, at the top of the text area. `follow`: the end
   * is followed from there (a new turn); false for a turn gone back to (the contents' 回, item 38): it
   * stays at the top while the page settles, and a reader there is not taken to the end afterwards.
   */
  const toTurn = useCallback(
    (no: number, behavior: ScrollBehavior = 'auto', follow = true) => {
      const scroller = scrollerRef.current;
      const page = scroller?.querySelector<HTMLElement>(`[data-turn="${no}"] [data-page]`);
      if (!scroller || !page) return;
      const top = Math.max(0, page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      own.current = Math.min(top, scroller.scrollHeight - scroller.clientHeight);
      scrollTo(scroller, top, behavior);
      following.current = follow;
      pinned.current = no;
      setBehind(false);
    },
    [scrollerRef],
  );

  // the area's height, for the current turn's minimum height (CSS reads --book-h); measured before the
  // turn is brought up below, so there is room to bring it all the way up. The area itself changes as a
  // turn ends (its options take a desktop's foot: five of them about 230 px) or a phone's page docks: a
  // reader at the end stays at the end, here, before the change is drawn. Left to the words' own resize,
  // the last lines slid under the options and jumped back up a frame later (up to a second, busy).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver !== 'function') return;
    let height = scroller.clientHeight;
    const measure = () => {
      scroller.style.setProperty('--book-h', `${scroller.clientHeight}px`);
      if (scroller.clientHeight !== height && following.current && pinned.current === null) toEnd();
      height = scroller.clientHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef, toEnd]);

  // the reader scrolls: back at the end, the text is followed again; at the top, fetch the turns before.
  // Only a scroll back up stops the following, and never one of the page's own: a scroll is told a frame
  // after it was made, by when new words may have pushed the end below again (实玩二, 第三回: the view
  // stopped short of the end with 「新的内容 ↓」 though the reader had not touched it).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let top = scroller.scrollTop;
    const onScroll = () => {
      const back = scroller.scrollTop < top - 1;
      top = scroller.scrollTop;
      anchor.current = { ...anchor.current, height: scroller.scrollHeight, top: scroller.scrollTop };
      const ours = own.current !== null && Math.abs(scroller.scrollTop - own.current) <= 2;
      if (ours) own.current = null;
      if (atEnd()) {
        following.current = true;
        setBehind(false);
      } else if (back && !ours) {
        following.current = false;
      }
      if (scroller.scrollTop < 40 && latest.current.canLoadEarlier) latest.current.loadEarlier();
    };
    // the reader takes over: wheel, touch, keys or the scrollbar. A scroll back stops the following at
    // once, before its scroll events arrive, so new words never pull the page out from under the reader.
    const unpin = () => {
      pinned.current = null;
    };
    const back = (event: Event) => {
      unpin();
      const up =
        event instanceof WheelEvent
          ? event.deltaY < 0
          : event instanceof KeyboardEvent
            ? ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
            : true;
      if (up) following.current = false;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('touchstart', unpin, { passive: true });
    scroller.addEventListener('pointerdown', unpin, { passive: true });
    for (const name of ['wheel', 'keydown', 'touchmove'] as const) scroller.addEventListener(name, back, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', unpin);
      scroller.removeEventListener('pointerdown', unpin);
      for (const name of ['wheel', 'keydown', 'touchmove'] as const) scroller.removeEventListener(name, back);
    };
  }, [scrollerRef, atEnd]);

  // new words: keep the end in view, or say that there is more below
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !content || typeof ResizeObserver !== 'function') return;
    let frame = 0;
    // unknown at first: the observer's first call settles the turn brought up before it started
    let height = -1;
    let area = -1;
    const grown = () => {
      frame = 0;
      const writing = latest.current.writing;
      const end = atEnd();
      const was = height;
      height = (content as HTMLElement).offsetHeight;
      // the text area itself changes size too: on desktops the options come in under it as a turn ends
      const areaWas = area;
      area = scroller.clientHeight;
      const changed = height !== was || (areaWas >= 0 && area !== areaWas);
      // the turn brought up stays up while fonts and pictures settle, and while its words still fit
      // under its top (judged from the turn, so a long turn before it cannot pull the view to the end
      // while the view is still on its way up); a menu opening over the text changes no height and
      // moves nothing
      if (pinned.current !== null && (!writing || fits(pinned.current))) {
        if (changed) toTurn(pinned.current, 'auto', following.current);
        return;
      }
      // a turn that has just finished still settles (its words set again as the server stored them,
      // the options after them): a reader at the end stays at the end
      if (!writing && (!changed || !following.current)) return;
      if (following.current) toEnd();
      else if (!end) setBehind(true);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(grown);
    };
    const observer = new ResizeObserver(later);
    observer.observe(content);
    observer.observe(scroller);
    // words written straight into the open paragraph's text node
    const mutations = new MutationObserver(later);
    mutations.observe(content, { characterData: true, subtree: true, childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollerRef, toEnd, toTurn, atEnd, fits]);

  // a new turn, or the first view of the save: its top at the top of the area
  const shownTurn = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (current === null || current === shownTurn.current) return;
    const opening = shownTurn.current === null;
    shownTurn.current = current;
    toTurn(current, opening || !smooth ? 'auto' : 'smooth');
  }, [current, smooth, toTurn]);

  // earlier turns arrived above: keep what is on screen where it was
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const before = anchor.current;
    if (before.first !== null && first !== null && first < before.first) {
      scroller.scrollTop = before.top + (scroller.scrollHeight - before.height);
    }
    anchor.current = { first, height: scroller.scrollHeight, top: scroller.scrollTop };
  });

  return { behind, toEnd, toTurn };
}
