// 名字与出生地 (spec 七, 建角 8): the save's name, and the birthplace on a small map of the world the new save
// is born on: a region by its tab, its outline and its areas in ink, its places as small diamonds, the chosen
// one glowing. The places are also listed by area, for the keyboard and for thumbs.
import { useId, useMemo, useState } from 'react';
import type { BirthMap, BirthRegion, CreationOptions, Poi } from '../../contracts';
import { Tabs } from '../../ui/Tabs';
import { Sub } from '../../ui/Sub';
import { type Creation, nameProblem } from './rules';
import { useCreation } from './store';
import styles from './Creation.module.css';

type Box = { x: number; y: number; w: number; h: number };

/** The box around a region: its outline and its places, with a margin. */
function boxOf(region: BirthRegion): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of region.outline ?? []) {
    xs.push(x);
    ys.push(y);
  }
  for (const area of region.areas) {
    for (const poi of area.pois) {
      xs.push(poi.x);
      ys.push(poi.y);
    }
  }
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 || 200;
  const h = Math.max(...ys) - y0 || 200;
  const pad = Math.max(w, h) * 0.08 + 20;
  return { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };
}

const path = (points: [number, number][] | undefined) =>
  points && points.length > 2 ? `M${points.map(([x, y]) => `${x},${y}`).join('L')}Z` : '';

function regionOf(map: BirthMap, regionId: string | undefined): BirthRegion | undefined {
  return map.regions.find((r) => r.id === regionId) ?? map.regions.find((r) => r.id === '潮岚道') ?? map.regions[0];
}

export function NamePlaceStep({ options, c }: { options: CreationOptions; c: Creation }) {
  const change = useCreation((s) => s.change);
  const map = options.map;
  const [regionId, setRegionId] = useState(c.birthplace?.regionId ?? regionOf(map, undefined)?.id ?? '');
  const region = regionOf(map, regionId);
  const box = useMemo(() => (region ? boxOf(region) : { x: 0, y: 0, w: 100, h: 100 }), [region]);
  const nameId = useId();
  const paneId = useId();
  const problem = c.name ? nameProblem(c.name) : null;
  const picked = c.birthplace;
  const pickedPoi = picked
    ? map.regions.find((r) => r.id === picked.regionId)?.areas.find((a) => a.id === picked.areaId)?.pois.find((p) => p.id === picked.poiId)
    : undefined;
  const mark = box.w * 0.011;

  const choose = (areaId: string, poi: Poi) => {
    if (!region) return;
    change({ birthplace: { regionId: region.id, areaId, poiId: poi.id } });
  };

  return (
    <>
      <label className={styles.field} htmlFor={nameId}>
        <span>这一世的名号</span>
        <input
          id={nameId}
          className={styles.input}
          value={c.name}
          maxLength={40}
          placeholder="为这一世起个名字，也是存档的名字"
          enterKeyHint="next"
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          onChange={(event) => change({ name: event.target.value })}
        />
        {problem && <em className={styles.problem}>{problem}</em>}
      </label>

      <Sub>出生地</Sub>
      <p className={styles.lead} aria-live="polite">
        {picked ? (
          <>
            出生在 <b className={styles.place}>{[picked.regionId, picked.areaId === picked.regionId ? '' : picked.areaId, picked.poiId].filter(Boolean).join(' · ')}</b>
            {pickedPoi?.text ? `：${pickedPoi.text}` : ''}
          </>
        ) : (
          '在地图上点一个地方，或从下面的名录里选。'
        )}
      </p>
      <div className={styles.tabsRow}>
        <Tabs
          label="疆域"
          items={map.regions.map((r) => ({ id: r.id, label: r.name }))}
          value={region?.id ?? ''}
          controls={paneId}
          onChange={setRegionId}
        />
      </div>
      {region && (
        <div id={paneId} role="tabpanel" aria-label={region.name} className={styles.mapPane}>
          <svg
            className={styles.map}
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <path className={styles.mapRegion} d={path(region.outline as [number, number][] | undefined)} />
            {region.areas.map((area) => (
              <path key={area.id} className={styles.mapArea} d={path(area.outline as [number, number][] | undefined)} />
            ))}
            {region.areas.flatMap((area) =>
              area.pois.map((poi) => {
                const on = picked?.poiId === poi.id && picked.regionId === region.id;
                return (
                  <g key={`${area.id}/${poi.id}`} className={styles.mapPoi} data-on={on ? '' : undefined} onClick={() => choose(area.id, poi)}>
                    <rect
                      x={poi.x - mark}
                      y={poi.y - mark}
                      width={mark * 2}
                      height={mark * 2}
                      transform={`rotate(45 ${poi.x} ${poi.y})`}
                    />
                    {on && (
                      <text x={poi.x + mark * 2.2} y={poi.y + mark * 0.9} style={{ fontSize: `${mark * 3.2}px` }}>
                        {poi.name}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
          {region.text && <p className={styles.note}>{region.text}</p>}
          <div className={styles.places}>
            {region.areas
              .filter((area) => area.pois.length > 0)
              .map((area) => (
                <div key={area.id} className={styles.area} role="group" aria-label={area.name}>
                  <h5>{area.name === region.name ? `${area.name}各处` : area.name}</h5>
                  <div className={styles.placeList}>
                    {area.pois.map((poi) => {
                      const on = picked?.poiId === poi.id && picked.regionId === region.id && picked.areaId === area.id;
                      return (
                        <button
                          key={poi.id}
                          type="button"
                          className={styles.placeButton}
                          aria-pressed={on}
                          title={poi.text}
                          onClick={() => choose(area.id, poi)}
                        >
                          {poi.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
