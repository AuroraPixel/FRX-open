// The ink map (spec 七, 地图): the land, regions and areas as the ink their places spread, places as
// small diamonds, the player's place a glowing gold one. It drags and zooms — one finger drags, two
// pinch, the wheel zooms where the pointer is — and its gestures never reach the sheet, so a pull on
// the map does not close it. By keyboard the arrows walk from place to place, Enter picks, + and −
// zoom. The view is written straight into the SVG while it moves; React draws only what changes.
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../../ui/cx';
import { Tool } from '../../ui/Tool';
import {
  type Direction, type Place, type Point, type RegionShape, type Terrain, type View, type World, fit, nearest, stepFrom,
  terrainOf, toScreen, zoomAt,
} from './MapShape';
import styles from './Map.module.css';

/** px per map unit at the closest; places at least 11 units apart stand 66 px apart there. */
const MAX_SCALE = 6;
/** px per map unit the panel opens at around the player: places some 30 units apart are named. */
const HOME_SCALE = 1.1;
/** How long the map takes to move to a region or a place. */
const GLIDE_MS = 550;
/** Below this the whole world is in view: places shrink to points. */
const WHOLE_BELOW = 0.2;
/** Terrain signs appear from this close. */
const TERRAIN_FROM = 0.5;

/** The ink signs beside places, in px around the place. */
const TERRAIN: Record<Exclude<Terrain, null>, string> = {
  hills: 'M-21 -3L-16.5 -9L-12 -3M-15 -3L-11.5 -7.5L-8 -3',
  waves: 'M-22 -4q2 -2.4 4 0t4 0t4 0',
  trees: 'M-19 -2V-8M-21 -6L-19 -9L-17 -6M-13 -2V-7M-15 -5L-13 -8L-11 -5',
  dunes: 'M-22 -3q3 -4 6 0M-15 -5q2.5 -3 5 0',
  snow: 'M-16 -10V-2M-20 -6H-12M-19 -9L-13 -3M-13 -9L-19 -3',
  walls: 'M-20 -2V-7H-11V-2M-17.5 -7V-9.5H-13.5V-7',
  rift: 'M-21 -9L-17 -5L-19 -3L-14 -1',
};

export interface MapAim {
  place: Place;
  /** a new number brings the same place into view again */
  n: number;
}

export interface MapInkProps {
  world: World;
  /** the region shown, or null for the whole world (疆域) */
  region: RegionShape | null;
  selected: Place | null;
  onPick: (place: Place) => void;
  aim: MapAim | null;
  /** glide to a new view; otherwise jump (reduced motion, screenshots) */
  smooth: boolean;
}

interface Label {
  id: string;
  at: Point;
  w: number;
  h: number;
}

/** Greedy placement: labels in order of importance, each only where it overlaps none placed before. */
function placeLabels(labels: readonly Label[], view: View, w: number, h: number): Set<string> {
  const placed: [number, number, number, number][] = [];
  const shown = new Set<string>();
  for (const label of labels) {
    const [sx, sy] = toScreen(view, w, h, label.at);
    const box: [number, number, number, number] = [sx - 6, sy - label.h / 2 - 2, sx + label.w + 4, sy + label.h / 2 + 2];
    if (box[2] < 0 || box[0] > w || box[3] < 0 || box[1] > h) continue;
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    shown.add(label.id);
  }
  return shown;
}

export function MapInk({ world, region, selected, onPick, aim, smooth }: MapInkProps) {
  const frame = useRef<HTMLDivElement>(null);
  const shapes = useRef<SVGGElement>(null);
  const marks = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  const viewRef = useRef<View | null>(null);
  const glide = useRef(0);
  const [settledView, setSettledView] = useState<View | null>(null);
  const [cursor, setCursor] = useState<Place | null>(null);
  const hintId = useId();
  const sayId = useId();

  const limits = useMemo<[number, number]>(() => {
    const whole = size.w ? fit(world.box, size.w, size.h).scale : 0.05;
    return [whole * 0.7, MAX_SCALE];
  }, [world.box, size]);

  // ---------------------------------------------------------------- drawing the view

  const apply = useCallback((view: View) => {
    viewRef.current = view;
    const { w, h } = sizeRef.current;
    shapes.current?.setAttribute('transform', `translate(${w / 2 - view.cx * view.scale} ${h / 2 - view.cy * view.scale}) scale(${view.scale})`);
    for (const node of marks.current?.querySelectorAll<SVGGElement>('[data-x]') ?? []) {
      const [sx, sy] = toScreen(view, w, h, [Number(node.dataset.x), Number(node.dataset.y)]);
      node.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    }
  }, []);

  /** Moves to a view: gliding, or at once; the labels follow once it rests. */
  const show = useCallback(
    (target: View, glideTo = false) => {
      cancelAnimationFrame(glide.current);
      const from = viewRef.current;
      if (!glideTo || !from) {
        apply(target);
        setSettledView(target);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - start) / GLIDE_MS);
        const k = 1 - (1 - u) ** 3;
        // the scale moves in proportion, so the zoom feels even
        const scale = from.scale * (target.scale / from.scale) ** k;
        apply({ cx: from.cx + (target.cx - from.cx) * k, cy: from.cy + (target.cy - from.cy) * k, scale });
        if (u < 1) glide.current = requestAnimationFrame(step);
        else setSettledView(target);
      };
      glide.current = requestAnimationFrame(step);
    },
    [apply],
  );

  useEffect(() => () => cancelAnimationFrame(glide.current), []);

  // the frame's size
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const next = { w: element.clientWidth, h: element.clientHeight };
      sizeRef.current = next;
      setSize((before) => (before.w === next.w && before.h === next.h ? before : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // a region (or the whole world) chosen: fit it. The frame changing size (on phones the place's
  // detail comes and goes under it) keeps the view as the player left it, centred where it was.
  const box = region?.box ?? world.box;
  const fitted = useRef<string>('');
  useLayoutEffect(() => {
    if (!size.w || !size.h) return;
    const key = region?.id ?? '*';
    if (fitted.current === key) return;
    const first = fitted.current === '';
    fitted.current = key;
    const target = fit(box, size.w, size.h, region ? 34 : 22);
    // the panel opens on the player's own region close enough to read the places around them
    const here = world.here;
    if (first && region && here && region.id === here.regionId) {
      show({ cx: here.x, cy: here.y, scale: Math.min(MAX_SCALE / 2, Math.max(target.scale * 2.4, HOME_SCALE)) }, false);
      return;
    }
    show({ ...target, scale: Math.min(target.scale, MAX_SCALE / 2) }, smooth && !first);
  }, [box, region, size, show, smooth, world.here]);

  // a place asked for from outside (a search result, the panel opening on it): bring it into view
  useEffect(() => {
    if (!aim || !size.w) return;
    const view = viewRef.current;
    const scale = Math.max(view?.scale ?? 1, Math.min(MAX_SCALE / 2, 1.2));
    show({ cx: aim.place.x, cy: aim.place.y, scale }, smooth);
  }, [aim, size.w, show, smooth]);

  // every render draws the view onto whatever React has just put in place
  useLayoutEffect(() => {
    if (viewRef.current) apply(viewRef.current);
  });

  // ---------------------------------------------------------------- gestures

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; view: View; moved: number; dist?: number; mid?: Point } | null>(null);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = frame.current?.getBoundingClientRect();
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)];
  };

  const restart = () => {
    const view = viewRef.current;
    const points = [...pointers.current.values()];
    if (!view || points.length === 0) {
      gesture.current = null;
      return;
    }
    if (points.length === 1) {
      gesture.current = { start: points[0]!, view, moved: gesture.current?.moved ?? 0 };
      return;
    }
    const [a, b] = points as [Point, Point];
    gesture.current = {
      start: a,
      view,
      moved: 99,
      dist: Math.hypot(a[0] - b[0], a[1] - b[1]),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    cancelAnimationFrame(glide.current);
    frame.current?.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    gesture.current = null;
    restart();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    const g = gesture.current;
    const { w, h } = sizeRef.current;
    if (!g) return;
    const points = [...pointers.current.values()];
    if (points.length === 1) {
      const [x, y] = points[0]!;
      const dx = x - g.start[0];
      const dy = y - g.start[1];
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      apply({ cx: g.view.cx - dx / g.view.scale, cy: g.view.cy - dy / g.view.scale, scale: g.view.scale });
      return;
    }
    const [a, b] = points as [Point, Point];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!g.dist || !g.mid) return;
    const zoomed = zoomAt(g.view, w, h, g.mid, dist / g.dist, limits);
    apply({ cx: zoomed.cx - (mid[0] - g.mid[0]) / zoomed.scale, cy: zoomed.cy - (mid[1] - g.mid[1]) / zoomed.scale, scale: zoomed.scale });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const g = gesture.current;
    const single = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (single && g && g.moved < 6) {
      const { w, h } = sizeRef.current;
      const view = viewRef.current;
      const place = view ? nearest(world.places, view, w, h, local(event), 24) : null;
      if (place) {
        setCursor(place);
        onPick(place);
      }
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (viewRef.current) setSettledView(viewRef.current);
    } else restart();
  };

  const zoomBy = useCallback(
    (factor: number, at?: Point) => {
      const view = viewRef.current;
      const { w, h } = sizeRef.current;
      if (!view) return;
      show(zoomAt(view, w, h, at ?? [w / 2, h / 2], factor, limits), smooth && !at);
    },
    [limits, show, smooth],
  );

  // the wheel zooms where the pointer is; touches never reach the sheet, so a pull here never drags it
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let rest = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      const { w, h } = sizeRef.current;
      if (!view) return;
      cancelAnimationFrame(glide.current);
      apply(zoomAt(view, w, h, local(event), Math.exp(-event.deltaY * 0.0016), limits));
      clearTimeout(rest);
      rest = window.setTimeout(() => viewRef.current && setSettledView(viewRef.current), 160);
    };
    const keep = (event: TouchEvent) => event.stopPropagation();
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('touchstart', keep, { passive: true });
    element.addEventListener('touchmove', keep, { passive: true });
    element.addEventListener('touchend', keep, { passive: true });
    return () => {
      clearTimeout(rest);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', keep);
      element.removeEventListener('touchmove', keep);
      element.removeEventListener('touchend', keep);
    };
  }, [apply, limits]);

  // ---------------------------------------------------------------- keys

  const walkable = region ? region.places : world.places;
  const keepInSight = (place: Place) => {
    const view = viewRef.current;
    const { w, h } = sizeRef.current;
    if (!view) return;
    const [sx, sy] = toScreen(view, w, h, [place.x, place.y]);
    const margin = 48;
    if (sx < margin || sx > w - margin || sy < margin || sy > h - margin) show({ ...view, cx: place.x, cy: place.y }, smooth);
  };

  // the frame changed size: the picked place stays in sight (on phones the detail that opens under the
  // map takes the frame's lower part). The first size is the fit's and the aim's to use.
  const picked = useRef(selected);
  picked.current = selected;
  const keepPicked = useRef(keepInSight);
  keepPicked.current = keepInSight;
  const lastSize = useRef(size);
  useEffect(() => {
    const before = lastSize.current;
    lastSize.current = size;
    if (!before.w || !before.h || !size.w || !size.h || !picked.current) return;
    keepPicked.current(picked.current);
  }, [size]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== frame.current) return;
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const direction = arrows[event.key];
    if (direction) {
      event.preventDefault();
      const from = cursor ?? selected ?? world.here ?? walkable[0];
      if (!from) return;
      const next = cursor || selected ? (stepFrom(walkable, from, direction) ?? from) : from;
      setCursor(next);
      keepInSight(next);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && cursor) {
      event.preventDefault();
      onPick(cursor);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(1.5);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / 1.5);
    } else if (event.key === '0') {
      event.preventDefault();
      show(fit(box, sizeRef.current.w, sizeRef.current.h), smooth);
    }
  };

  // ---------------------------------------------------------------- what is drawn

  const view = settledView;
  const close = (view?.scale ?? 0) >= TERRAIN_FROM;
  const named = useMemo(() => {
    if (!view || !size.w) return new Set<string>();
    const labels: Label[] = [];
    const add = (id: string, at: Point, text: string, px: number) => labels.push({ id, at, w: text.length * px, h: px + 2 });
    // a region: the picked place and the player's own first, then the areas' names, then as many of the
    // region's places as fit without overlapping any of those; the whole world: the regions' names first
    // the bigger the region or area, the sooner its name is placed
    const shapes = [...(region ? region.areas : world.regions)].sort((a, b) => b.places.length - a.places.length);
    const names = shapes.map((shape): Label => {
      const px = region ? 15 : 26;
      return { id: `name:${shape.id}`, at: [shape.label[0] - (shape.name.length * px) / 2, shape.label[1]], w: shape.name.length * px, h: px + 8 };
    });
    if (!region) labels.push(...names);
    if (selected) add(selected.id, [selected.x, selected.y], selected.name, 13);
    if (world.here) add(world.here.id, [world.here.x, world.here.y], world.here.name, 13);
    if (region) {
      labels.push(...names);
      for (const place of region.places) add(place.id, [place.x, place.y], place.name, 12);
    }
    return placeLabels(labels, view, size.w, size.h);
  }, [view, size, region, selected, world.here]);

  return (
    <div
      ref={frame}
      className={styles.ink}
      tabIndex={0}
      role="group"
      aria-roledescription="地图"
      aria-label={region ? `${region.name}的地图` : '疆域全图'}
      aria-describedby={`${hintId} ${sayId}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => zoomBy(2, local(event))}
      onKeyDown={onKeyDown}
      data-close={close ? '' : undefined}
      data-whole={(view?.scale ?? 1) < WHOLE_BELOW ? '' : undefined}
    >
      <svg className={styles.svg} width={size.w} height={size.h} aria-hidden="true">
        <g ref={shapes}>
          <path className={styles.land} d={world.land} />
          {world.regions.map((shape) => (
            <path
              key={shape.id}
              className={styles.region}
              d={shape.outline}
              data-on={region?.id === shape.id ? '' : undefined}
              data-off={region && region.id !== shape.id ? '' : undefined}
            />
          ))}
        </g>
        <g ref={marks}>
          {!region &&
            world.regions.map(
              (shape) =>
                named.has(`name:${shape.id}`) && (
                  <g key={`r-${shape.id}`} data-x={shape.label[0]} data-y={shape.label[1]}>
                    <text className={styles.regionName} textAnchor="middle" y={8}>
                      {shape.name}
                    </text>
                  </g>
                ),
            )}
          {region?.areas.map(
            (area) =>
              named.has(`name:${area.id}`) && (
                <g key={`a-${area.id}`} data-x={area.label[0]} data-y={area.label[1]}>
                  <text className={styles.areaName} textAnchor="middle" y={5}>
                    {area.name}
                  </text>
                </g>
              ),
          )}
          {world.places.map((place) => {
            const here = place.id === world.here?.id;
            const picked = place.id === selected?.id;
            const far = region !== null && place.regionId !== region.id;
            const terrain = terrainOf(place.kind);
            return (
              <g
                key={place.id}
                className={styles.mark}
                data-x={place.x}
                data-y={place.y}
                data-id={place.id}
                data-here={here ? '' : undefined}
                data-picked={picked ? '' : undefined}
                data-far={far ? '' : undefined}
                data-cursor={cursor?.id === place.id ? '' : undefined}
              >
                {here && <circle className={styles.halo} r={15} data-endless="" />}
                {terrain && close && !far && <path className={styles.terrain} d={TERRAIN[terrain]} />}
                <path className={styles.diamond} d={here ? 'M0 -7.5L7.5 0L0 7.5L-7.5 0Z' : 'M0 -4.5L4.5 0L0 4.5L-4.5 0Z'} />
                {picked && <circle className={styles.ring} r={11} />}
                {cursor?.id === place.id && <circle className={styles.cursor} r={15} />}
                {named.has(place.id) && (
                  <text className={cx(styles.name, here && styles.hereName)} x={here ? 12 : 8} y={4.5}>
                    {place.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className={styles.zoom}>
        <Tool glyph="近" label="放大" onClick={() => zoomBy(1.6)} />
        <Tool glyph="远" label="缩小" onClick={() => zoomBy(1 / 1.6)} />
        <Tool glyph="全" label={region ? `看全${region.name}` : '看全图'} onClick={() => show(fit(box, size.w, size.h), smooth)} />
      </div>
      <span id={hintId} className="visually-hidden">
        拖动或双指缩放；用键盘时方向键在地点之间移动，回车选定，加号减号缩放，零看全图。
      </span>
      <span id={sayId} className="visually-hidden" aria-live="polite">
        {cursor ? `${cursor.name}，${cursor.areaName}` : ''}
      </span>
    </div>
  );
}
