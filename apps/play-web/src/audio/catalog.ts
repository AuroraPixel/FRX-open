// Every built-in sound under its name: interface sounds and effects, ambiences, music moods.
import { AMBIENCES } from './ambience';
import { MUSIC } from './music';
import { SoundRegistry, type SoundDef } from './registry';
import { SOUNDS } from './sounds';

export function builtInSounds(): SoundRegistry {
  const entries: [string, SoundDef][] = [...Object.entries(SOUNDS), ...Object.entries(AMBIENCES), ...Object.entries(MUSIC)];
  return new SoundRegistry(entries);
}
