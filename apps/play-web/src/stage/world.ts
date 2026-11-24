import * as THREE from 'three';
import type { Timeline } from './anim';
import type { Shared } from './env';
import { Floor } from './floor';
import { Effects, type FxKey } from './fx';
import { Hero } from './hero';
import { Layers } from './layers';
import type { SceneDesc } from './scene-loader';
import { Scenery } from './scenery';
import { Sky } from './sky';
import { Textures } from './textures';
import { Precipitation } from './weather';

// Everything one scene puts on the stage. A change of scene builds a new world while the old one is still showing,
// then swaps and disposes the old one's geometry, materials and textures (the protagonist's paintings are the
// stage's and stay).
export class World {
  readonly scene = new THREE.Scene();
  readonly desc: SceneDesc;
  readonly textures: Textures;
  readonly sky: Sky;
  readonly layers: Layers;
  readonly effects: Effects;
  readonly hero: Hero;
  readonly scenery: Scenery;
  readonly precipitation: Precipitation;
  private readonly floor: Floor | null;

  constructor(
    desc: SceneDesc,
    shared: Shared,
    timeline: Timeline<FxKey>,
    random: (name: string) => () => number,
    low: boolean,
    anisotropy: number,
    onError: (error: Error) => void,
  ) {
    this.desc = desc;
    this.textures = new Textures(anisotropy, onError);
    this.sky = new Sky(desc, this.textures, shared);
    this.layers = new Layers(desc.pieces, desc.folder, this.textures, shared, desc.eye, desc.written);
    this.floor = desc.floor ? new Floor(desc.floor, shared, low) : null;
    this.effects = new Effects(desc, shared, timeline, random, low);
    this.hero = new Hero(desc, shared);
    this.scenery = new Scenery(desc, shared, random, low);
    this.precipitation = new Precipitation(shared, random, low);
    this.scene.add(this.sky.group, this.layers.group, this.effects.group, this.hero.group, this.scenery.group, this.precipitation.group);
    if (this.floor) this.scene.add(this.floor.group);
  }

  dispose(): void {
    this.sky.dispose();
    this.layers.dispose();
    this.floor?.dispose();
    this.effects.dispose();
    this.hero.dispose();
    this.scenery.dispose();
    this.precipitation.dispose();
    this.textures.dispose();
  }
}
