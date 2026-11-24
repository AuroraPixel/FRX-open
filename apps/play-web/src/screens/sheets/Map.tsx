// 地图 (plan item 51; spec 七, 地图): the whole world (疆域) and each region on its own tab, drawn in
// ink from the save's map; the player's place glows. A search box finds a place by name; a place
// picked opens its detail — what kind of place, where, how far — and 「前往」 puts a journey there
// in the action queue, to go out with the next turn. On phones the panel is full height and the map
// takes the room the rest leaves, so the detail and 「前往」 stand in sight under it.
// In a save of the cultivation life the panel is where 「去处」 leads (gameplay plan item 28): it opens on
// 「近处」, the nearest places with their days on foot (Near.tsx), and the whole map (「全图」) is its
// second page, whose 「前往」 shows the journey's preview there instead of queueing a chip. (The panel
// keeps its title 地图: the navigation's panel is already called 去处.)
import { useEffect, useId, useMemo, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { MapView } from '../../contracts';
import { pins } from '../../lib/params';
import { useQueueStore } from '../../store/queue';
import { showLevel, useSettingsStore } from '../../store/settings';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Detail } from '../../ui/Detail';
import { Empty, Loading } from '../../ui/Loading';
import { Tabs } from '../../ui/Tabs';
import { useMedia } from '../../ui/useMedia';
import { queueChip, useTurnBusy } from './act';
import { useAim } from './aim';
import { type MapAim, MapInk } from './MapInk';
import { KIND_LABEL, type Place, type World, kilometres, search, worldOf } from './MapShape';
import { NearList, TravelPanel } from './Near';
import common from './common.module.css';
import styles from './Map.module.css';

const WORLD_TAB = '疆域';

/** The save's map, asked for once per opening. */
function useMap(saveId: string) {
  const [map, setMap] = useState<MapView | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    play.map(saveId).then(
      (view) => live && setMap(view),
      (problem: unknown) => live && setError(problem instanceof ApiError ? problem.message : '地图没能读到。'),
    );
    return () => {
      live = false;
    };
  }, [saveId, round]);
  return { map, error, retry: () => setRound((r) => r + 1) };
}

function PlaceDetail({ place, world, onTravel }: { place: Place; world: World; onTravel?: (name: string) => void }) {
  const busy = useTurnBusy();
  const queued = useQueueStore((s) => s.items.some((item) => item.kind === 'travel' && item.placeId === place.id));
  const here = world.here?.id === place.id;
  const kind = KIND_LABEL[place.kind] ?? '地点';
  const distance = place.distanceKm;
  return (
    <Detail
      className={common.revealed}
      title={place.name}
      meta={`${kind} · ${place.areaName === place.regionName ? place.regionName : `${place.areaName} · ${place.regionName}`}`}
      actions={
        here ? (
          <span className={styles.hereNote}>你在这里</span>
        ) : (
          <Btn
            variant="solid"
            disabled={onTravel ? false : queued || busy}
            onClick={() => (onTravel ? onTravel(place.name) : queueChip({ kind: 'travel', text: `往 · ${place.name}`, placeId: place.id }))}
          >
            {queued && !onTravel ? '已在行动签' : '前往'}
          </Btn>
        )
      }
    >
      {!here && distance !== undefined && distance > 0 && (
        <p className={styles.distance}>
          距此约 <b>{kilometres(distance)}</b> 公里
        </p>
      )}
      {place.text && <p>{place.text}</p>}
    </Detail>
  );
}

/** The map panel: 近处 and the whole map in a save of the cultivation life, the map alone in a novel's. */
export function MapSheet({ saveId }: { saveId: string }) {
  const life = useStateStore((s) => Boolean(s.view?.play));
  return life ? <Places saveId={saveId} /> : <WorldMap saveId={saveId} />;
}

const PAGES = [
  { id: 'near', label: '近处' },
  { id: 'map', label: '全图' },
];

/** 近处 first (or the journey to a place picked, ?pick= on the screenshot page), the whole map second. */
function Places({ saveId }: { saveId: string }) {
  const play = useStateStore((s) => s.view?.play);
  const aimed = useAim('map');
  const page = useUiStore((s) => s.mapPage);
  const setPage = useUiStore((s) => s.setMapPage);
  const [to, setTo] = useState<string | null>(aimed?.pick ?? null);
  const paneId = useId();
  const travel = (name: string) => {
    setTo(name);
    setPage('near');
  };
  return (
    <div className={styles.places}>
      <div className={common.tabsRow}>
        <Tabs items={PAGES} value={page} label="去处" controls={paneId} onChange={(id) => setPage(id === 'map' ? 'map' : 'near')} />
      </div>
      <div id={paneId} role="tabpanel" aria-label={page === 'near' ? '近处' : '全图'} className={styles.places}>
        {page === 'map' ? (
          <WorldMap saveId={saveId} onTravel={travel} />
        ) : to ? (
          <TravelPanel key={to} saveId={saveId} to={to} onBack={() => setTo(null)} />
        ) : (
          <NearList near={play?.near ?? []} here={play?.place} onPick={setTo} />
        )}
      </div>
    </div>
  );
}

function WorldMap({ saveId, onTravel }: { saveId: string; onTravel?: (name: string) => void }) {
  const { map, error, retry } = useMap(saveId);
  const world = useMemo(() => (map ? worldOf(map) : null), [map]);
  const aimed = useAim('map');
  const [tab, setTab] = useState<string | null>(aimed?.tab ?? null);
  const [picked, setPicked] = useState<string | null>(aimed?.pick ?? null);
  const [query, setQuery] = useState('');
  const [aim, setAim] = useState<MapAim | null>(null);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const motion = useSettingsStore((s) => s.motion);
  const smooth = showLevel(motion, reduced) === 'full' && pins().t === undefined;
  const searchId = useId();
  const paneId = useId();

  const region = world?.regions.find((r) => r.id === (tab ?? world.hereRegion)) ?? null;
  const shownTab = tab ?? (world && world.regions.some((r) => r.id === world.hereRegion) ? world.hereRegion : WORLD_TAB);
  const selected = world?.places.find((p) => p.id === picked) ?? null;
  const found = useMemo(() => (world ? search(world.places, query) : []), [world, query]);

  // the panel may open on a place (the screenshot page, or a place named elsewhere): bring it into view
  // once the map has arrived
  useEffect(() => {
    if (!world || !aimed?.pick) return;
    const place = world.places.find((p) => p.id === aimed.pick);
    if (place) setAim({ place, n: 0 });
  }, [world, aimed]);

  if (error) {
    return (
      <div className={styles.failed} role="alert">
        <span>{error}</span>
        <Btn onClick={retry}>重试</Btn>
      </div>
    );
  }
  if (!world) return <Loading text="展开地图……" />;
  if (!world.places.length) return <Empty title="地图空白" text="这个存档的地图上还没有地点。" />;

  const pick = (place: Place, bring = false) => {
    setPicked(place.id);
    if (shownTab !== WORLD_TAB && place.regionId !== shownTab) setTab(place.regionId);
    if (bring) setAim((before) => ({ place, n: (before?.n ?? 0) + 1 }));
  };

  const choose = (place: Place) => {
    setQuery('');
    setTab(place.regionId);
    pick(place, true);
  };

  const tabs = [{ id: WORLD_TAB, label: WORLD_TAB }, ...world.regions.map((r) => ({ id: r.id, label: r.name }))];

  return (
    <div className={styles.map}>
      <div className={styles.search}>
        <input
          type="search"
          className={styles.searchBox}
          aria-label="按名字找地点"
          aria-controls={found.length ? searchId : undefined}
          placeholder="找地点……"
          value={query}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && found[0]) {
              event.preventDefault();
              choose(found[0]);
            }
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query.trim() && (
          <ul id={searchId} className={styles.found} aria-label="找到的地点">
            {found.map((place) => (
              <li key={place.id}>
                <button type="button" className={styles.foundItem} onClick={() => choose(place)}>
                  <strong>{place.name}</strong>
                  <span>
                    {place.areaName === place.regionName ? place.regionName : `${place.areaName} · ${place.regionName}`}
                  </span>
                </button>
              </li>
            ))}
            {found.length === 0 && <li className={styles.none}>没有叫这个名字的地点</li>}
          </ul>
        )}
      </div>
      <div className={common.tabsRow}>
        <Tabs
          items={tabs}
          value={shownTab}
          label="疆域与区域"
          controls={paneId}
          onChange={(id) => {
            setTab(id);
            setAim(null);
          }}
        />
      </div>
      <div id={paneId} role="tabpanel" aria-label={shownTab} className={styles.pane}>
        <MapInk
          world={world}
          region={shownTab === WORLD_TAB ? null : region}
          selected={selected}
          onPick={(place) => pick(place)}
          aim={aim}
          smooth={smooth}
        />
        {selected ? (
          <PlaceDetail key={selected.id} place={selected} world={world} onTravel={onTravel} />
        ) : (
          <p className={common.note}>
            {world.here ? `你在${world.here.areaName === world.here.regionName ? '' : world.here.areaName + ' · '}${world.here.name}。` : ''}
            点一个地点看它的详情，再「前往」。
          </p>
        )}
      </div>
    </div>
  );
}
