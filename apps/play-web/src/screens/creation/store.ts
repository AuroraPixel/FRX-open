// The creation in progress: the options from GET /creation, the player's choices step by step, and the
// draws, made with POST /creation/draw under the creation's own seed (the server draws the same again
// when the save is made). One creation at a time; leaving the screen keeps it until a new one starts.
import { create } from 'zustand';
import { ApiError } from '../../api/client';
import { saves } from '../../api/saves';
import { pins } from '../../lib/params';
import { seededRandom } from '../../lib/pinned';
import type { CreationOptions, CreationTrait, Recipe, SaveSummary } from '../../contracts';
import {
  type Creation, STEPS, canPickRoot, canPickTrait, creationInput, fresh, pointsLeft, rootDrawsLeft, stepDone,
  traitDrawsLeft,
} from './rules';

// A pinned page (?seed=) takes its seeds from a stream of their own. Math.random is seeded too, but the
// stage and three.js draw from it as they load, and how many numbers they have taken by the time the
// creation asks depends on what has arrived: one more chunk on the way gave screenshots another face.
let pinned: { seed: number; next: () => number } | null = null;

function random(): number {
  const { seed } = pins();
  if (seed === undefined) return Math.random();
  if (pinned?.seed !== seed) pinned = { seed, next: seededRandom(seed ^ 0x6f9e2b) };
  return pinned.next();
}

/** A seed for the draws: random, but the same every time on a pinned page (?seed=). */
export function newSeed(): string {
  const part = () => Math.floor(random() * 2 ** 32).toString(36).padStart(7, '0');
  return `${part()}${part()}`;
}

export interface CreationStore {
  options: CreationOptions | null;
  error: ApiError | null;
  c: Creation;
  step: number;
  loading: boolean;
  /** the draw under way */
  drawing: 'root' | 'traits' | null;
  /** the round of the trait draw on offer */
  offerRound: number;
  submitting: boolean;
  load: (refresh?: boolean) => Promise<void>;
  /** starts over: a new seed, the free defaults chosen */
  restart: () => void;
  change: (patch: Partial<Creation>) => void;
  go: (step: number) => void;
  drawRoot: () => Promise<string | null>;
  pickRoot: (root: string) => void;
  drawTraits: () => Promise<CreationTrait[] | null>;
  toggleOffered: (trait: CreationTrait) => void;
  pickTrait: (trait: CreationTrait) => void;
  dropTrait: (name: string) => void;
  setAttribute: (key: string, value: number) => void;
  setPortrait: (portrait: Recipe) => void;
  submit: () => Promise<SaveSummary>;
}

/** The choices that cost nothing, made for the player to start from: 普通, 凡人, 人族. */
function defaults(options: CreationOptions | null, seed: string): Creation {
  const c = fresh(seed);
  if (!options) return c;
  const { config } = options;
  if (config.DIFFICULTIES['普通']) c.difficulty = '普通';
  if (config.BIRTHS['凡人']) c.birth = '凡人';
  if (config.RACES['人族']) c.race = '人族';
  return c;
}

function problem(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('network');
}

export const useCreation = create<CreationStore>()((set, get) => ({
  options: null,
  error: null,
  c: fresh(''),
  step: 0,
  loading: false,
  drawing: null,
  offerRound: 0,
  submitting: false,

  async load(refresh = false) {
    if (get().loading || (get().options && !refresh)) return;
    set({ error: null, loading: true });
    try {
      const options = await saves.creation();
      set({ options, c: defaults(options, newSeed()), step: 0, offerRound: 0 });
    } catch (error) {
      set({ error: problem(error) });
    } finally {
      set({ loading: false });
    }
  },

  restart() {
    set((s) => ({ c: defaults(s.options, newSeed()), step: 0, offerRound: 0, drawing: null }));
  },

  change(patch) {
    set((s) => ({ c: { ...s.c, ...patch } }));
  },

  go(step) {
    const { options, c } = get();
    if (!options?.play?.available || step < 0 || step >= STEPS.length) return;
    // forward only over steps that are done
    for (let at = 0; at < step; at += 1) if (!stepDone(options, c, at)) return;
    set({ step });
  },

  async drawRoot() {
    const { options, c, drawing } = get();
    if (!options?.play?.available || drawing || rootDrawsLeft(options, c) < 1) return null;
    set({ drawing: 'root' });
    try {
      const round = c.rootRounds + 1;
      const answer = await saves.draw({ seed: c.seed, kind: 'root', round });
      if (!answer.root) throw new ApiError('bad_response');
      set((s) => ({ c: { ...s.c, root: answer.root ?? null, rootRounds: round } }));
      return answer.root;
    } finally {
      set({ drawing: null });
    }
  },

  pickRoot(root) {
    const { options, c } = get();
    if (!options || !canPickRoot(options, c, root)) return;
    set({ c: { ...c, root } });
  },

  async drawTraits() {
    const { options, c, drawing } = get();
    if (!options?.play?.available || drawing || traitDrawsLeft(options, c) < 1) return null;
    set({ drawing: 'traits' });
    try {
      const round = c.traitRounds + 1;
      const answer = await saves.draw({ seed: c.seed, kind: 'traits', round });
      const offer = answer.traits ?? [];
      set((s) => ({ c: { ...s.c, offer, traitRounds: round }, offerRound: round }));
      return offer;
    } finally {
      set({ drawing: null });
    }
  },

  toggleOffered(trait) {
    const { options, c, offerRound } = get();
    if (!options) return;
    if (c.traits.some((t) => t.trait.name === trait.name)) {
      set({ c: { ...c, traits: c.traits.filter((t) => t.trait.name !== trait.name) } });
      return;
    }
    if (c.traits.length >= options.rules.maxTraits) return;
    set({ c: { ...c, traits: [...c.traits, { trait, round: offerRound }] } });
  },

  pickTrait(trait) {
    const { options, c } = get();
    if (!options || c.traits.some((t) => t.trait.name === trait.name) || !canPickTrait(options, c)) return;
    set({ c: { ...c, traits: [...c.traits, { trait, round: null }] } });
  },

  dropTrait(name) {
    set((s) => ({ c: { ...s.c, traits: s.c.traits.filter((t) => t.trait.name !== name) } }));
  },

  setAttribute(key, value) {
    const { options, c } = get();
    if (!options) return;
    const now = c.attributes[key] ?? 0;
    const wanted = Math.max(0, Math.min(options.rules.attributeMax, Math.round(value)));
    // going up spends points: never past what is left
    const next = wanted > now ? Math.min(wanted, now + Math.max(0, pointsLeft(options, c))) : wanted;
    if (next === now) return;
    set({ c: { ...c, attributes: { ...c.attributes, [key]: next } } });
  },

  setPortrait(portrait) {
    set((s) => ({ c: { ...s.c, portrait } }));
  },

  async submit() {
    const { options, c, submitting } = get();
    if (!options?.play?.available) throw new ApiError('refused', options?.play?.reason ?? '暂时无法开启修仙人生，请重新检查。');
    const input = options ? creationInput(options, c) : null;
    if (!input || submitting) throw new ApiError('refused', '还有没选好的地方。');
    set({ submitting: true });
    try {
      return await saves.create(input);
    } finally {
      set({ submitting: false });
    }
  },
}));
