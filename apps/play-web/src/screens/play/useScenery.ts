// Where the story is: the place, the hour and the weather, from the turn being written when it moved
// on (its scene block comes before the words), else from the state view. The stage shows the scene at
// that hour (a place of a family with a kit composed for it, composed.ts), the page takes the hour's
// colour set, and the sound takes the scene's ambience and mood.
import { useEffect, useState } from 'react';
import { audio } from '../../audio';
import type { Block, ComposedPlace, PlaceLook, SceneBlock, SceneFile, StateView } from '../../contracts';
import { openingDrawn } from '../../lib/opening';
import { placeName } from '../../lib/story';
import { type WeatherKind, weatherKind, weatherWords } from '../../lib/weather';
import { sceneMood } from '../../stage/compose/mood';
import { type Light, lightFor, useUiStore } from '../../store/ui';
import { composedScene } from './composed';
import type { Director } from './director';
import { ambienceOf, sceneFile } from './scenes';

export interface Scenery {
  sceneId: string;
  /** the place the scene is composed for, when its family has a kit */
  composed?: ComposedPlace;
  /** the place's mood (its look's), which the music takes where it says one */
  mood?: PlaceLook['mood'];
  hour: SceneBlock['hour'];
  weather: WeatherKind;
  /** 「青岚山 · 观云台」 */
  place: string;
  /** 「观云台」: the book's title and the phone's place line */
  title: string;
  hourName: string;
  date: string;
  /** the weather in words: the story's own (「月明云平」), or a phrase for a bare kind name (「薄雾」) */
  weatherText: string;
}

function lastScene(blocks: readonly Block[] | undefined): SceneBlock | undefined {
  if (!blocks) return undefined;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block?.type === 'scene') return block;
  }
  return undefined;
}

export function sceneryOf(view: StateView, liveBlocks?: readonly Block[]): Scenery {
  const moved = lastScene(liveBlocks);
  if (moved) {
    return {
      sceneId: moved.sceneId,
      ...(moved.composed ? { composed: moved.composed } : {}),
      ...(moved.look ? { mood: moved.look.mood } : {}),
      hour: moved.hour,
      weather: weatherKind(moved.weather),
      place: moved.place,
      title: moved.place.split('·').pop()?.trim() || moved.place,
      hourName: moved.hourName,
      date: moved.date,
      weatherText: weatherWords(moved.weather),
    };
  }
  return {
    sceneId: view.scene.sceneId,
    ...(view.scene.composed ? { composed: view.scene.composed } : {}),
    ...(view.scene.look ? { mood: view.scene.look.mood } : {}),
    hour: view.time.hour,
    weather: weatherKind(view.scene.weather),
    place: view.place.text,
    title: placeName(view.place),
    hourName: view.time.hourName,
    date: view.time.date,
    weatherText: weatherWords(view.scene.weather),
  };
}

/**
 * Shows the scenery on the stage and in the sound (the scene's ambience, or the rain's where it rains,
 * and the place's mood where its look says one, else the scene's); `settled` is told when the stage has
 * drawn it. `light` holds the page's colour set while a performance needs its own (a journey's passage
 * keeps the night's ink until the new place is up); the hour's set follows when it is let go. Returns
 * the scene file shown, once it is known.
 */
export function useScenery(
  scenery: Scenery | null,
  director: Director | null,
  settled: (work: Promise<unknown>) => void,
  light: Light | null = null,
): SceneFile | null {
  const setLight = useUiStore((s) => s.setLight);
  const [shown, setShown] = useState<SceneFile | null>(null);
  const id = scenery?.sceneId;
  const hour = scenery?.hour;
  const weather = scenery?.weather;
  // the composed place as a key: the same place again changes nothing
  const place = scenery?.composed ? JSON.stringify(scenery.composed) : '';
  const mood = scenery?.mood;

  useEffect(() => {
    if (light) setLight(light);
    else if (hour) setLight(lightFor(hour));
  }, [hour, light, setLight]);

  useEffect(() => {
    if (!id || !hour || !weather) return;
    let live = true;
    const composed = place ? composedScene(JSON.parse(place) as ComposedPlace).catch(() => null) : Promise.resolve(null);
    const work = composed.then(async (spec) => {
      // a place whose kit cannot be had shows its family's one painting
      const file = spec?.file ?? (await sceneFile(id));
      if (!live) return;
      if (!file) {
        if (director) openingDrawn();
        return;
      }
      setShown(file);
      audio.setAmbience(ambienceOf(file, hour, weather));
      audio.setMood(sceneMood(mood, file.mood));
      if (!director) return;
      await director.setScene(spec ?? file.id, hour, weather);
      openingDrawn();
    });
    settled(work);
    return () => {
      live = false;
    };
  }, [director, id, place, mood, hour, weather, settled]);

  // leaving the screen: the scene's sound goes with it
  useEffect(
    () => () => {
      audio.setAmbience(null);
      audio.setMood(null);
      audio.setMoment(null);
    },
    [],
  );
  return shown;
}
