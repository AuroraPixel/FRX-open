// The sound layer's public face: the interface talks to `audio` and nothing else here.
//
//   audio.listenForGestures()          once at start-up; sound begins on the player's first gesture
//   audio.play('ui.tap')               interface sounds and effects; loops return a handle to stop
//   audio.setAmbience('amb.wind')      the scene's ambience for the hour, or null; crossfades 2 s
//   audio.setMood('calm')              the scene's music mood, or null
//   audio.setMoment('combat')          combat or breakthrough borrow a mood; null hands it back
//   audio.buses() / setBus(name, {volume, on}) / onBusesChange(fn)   the four volume buses
//   audio.registry.register(name, def) replace any sound by name, e.g. with a recording later
import { builtInSounds } from './catalog';
import { AudioEngine } from './engine';

export const audio = new AudioEngine(builtInSounds());

export { AudioEngine, CROSSFADE, MOMENT_MOODS } from './engine';
export type { AudioStatus, Moment, SoundHandle } from './engine';
export type { AmbienceName } from './ambience';
export type { Mood, MusicName } from './music';
export type { SfxName } from './sounds';
export type { SoundDef, SoundParams, SoundStart, Voice } from './registry';
export { BUS_NAMES, DEFAULT_BUSES } from './settings';
export type { BusName, BusSetting, BusSettings } from './settings';
