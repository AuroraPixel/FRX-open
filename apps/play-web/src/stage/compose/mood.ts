// The music of a place (contracts SceneFile mood): its look's mood where that says something the painting may not (a
// bandits' hall is tense whatever hall was painted for it, a haunted gorge eerie and so tense, an ancestral hall
// solemn, a busy street calm), else the painting's own. A calm or desolate look leaves the painting's mood: the music
// of ruins stays tense, of a temple solemn.
import type { PlaceLook, SceneFile } from '../../contracts';

const MUSIC: Partial<Record<PlaceLook['mood'], SceneFile['mood']>> = {
  tense: 'tense', eerie: 'tense', solemn: 'solemn', lively: 'calm',
};

export function sceneMood(look: PlaceLook['mood'] | undefined, own: SceneFile['mood']): SceneFile['mood'] {
  return (look && MUSIC[look]) || own;
}
