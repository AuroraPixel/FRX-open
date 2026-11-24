// The portrait maker's choices against the kit's manifest.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Recipe } from '../../contracts';
import { PortraitKit } from '../../kit/kit';
import type { KitManifest } from '../../kit/types';
import { basesFor, choose, chosen, optionsOf, rebase, sameLook, tintsFor } from './parts';

const manifest = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../assets/portrait-kit/manifest.json'), 'utf8'),
) as KitManifest;
const kit = new PortraitKit(manifest, '');
const youngMan: Recipe = { base: 'm-young', face: 'face-1-3', hair: 'hair-1-2', tint: 'ink', body: 'body-c', tilt: -2 };

describe('the portrait maker', () => {
  it('offers the bases of a sex from young to old, children last', () => {
    expect(basesFor(kit, 'm')).toEqual(['m-young', 'm-mid', 'm-old', 'm-child']);
    expect(basesFor(kit).length).toBe(Object.keys(manifest.bases).length);
  });

  it('moves a recipe to another base part by part, keeping what fits', () => {
    const old = rebase(kit, youngMan, 'm-old');
    expect(old.base).toBe('m-old');
    for (const [kind, id] of [
      ['faces', old.face],
      ['hair', old.hair],
      ['bodies', old.body],
    ] as const) {
      expect(manifest.bases['m-old']![kind].some((part) => part.id === id), `${kind} ${id}`).toBe(true);
    }
    // the old bases paint their hair white: ink is not one of their colours
    expect(kit.tints('m-old', old.hair)).not.toContain('ink');
    expect(old.tint).toBeUndefined();
    expect(old.tilt).toBe(-2);
    expect(rebase(kit, youngMan, 'm-young')).toBe(youngMan);
  });

  it('changes one row at a time, dropping a colour the new hair cannot take', () => {
    expect(choose(kit, youngMan, 'face', 'face-1-1').face).toBe('face-1-1');
    expect(choose(kit, youngMan, 'tint', null).tint).toBeUndefined();
    expect(choose(kit, youngMan, 'tint', 'brown').tint).toBe('brown');
    const hair = manifest.bases['m-young']!.hair[3]!.id;
    expect(choose(kit, youngMan, 'hair', hair)).toMatchObject({ hair, tint: 'ink' });
  });

  it('puts traits on and takes them off by kind, in the base order', () => {
    const eared = choose(kit, youngMan, 'trait', 'fox-tail');
    const both = choose(kit, eared, 'trait', 'fox-ears');
    expect(both.trait).toEqual(['fox-ears', 'fox-tail']);
    expect(chosen(both, 'trait', 'fox-tail')).toBe(true);
    const back = choose(kit, choose(kit, both, 'trait', 'fox-tail'), 'trait', 'fox-ears');
    expect(back.trait).toBeUndefined();
    expect(sameLook(back, youngMan)).toBe(true);
  });

  it('lists each row with a name for every option', () => {
    expect(optionsOf(kit, youngMan, 'trait').map((o) => o.label)).toContain('狐尾');
    expect(optionsOf(kit, { ...youngMan, base: 'm-child', face: 'face-1-1', hair: 'hair-1-1', body: 'body-a' }, 'trait')).toEqual([]);
    const tints = optionsOf(kit, youngMan, 'tint');
    expect(tints[0]).toEqual({ value: null, label: '原色' });
    expect(tints.map((o) => o.value)).toEqual(tintsFor(kit, youngMan));
    expect(optionsOf(kit, youngMan, 'face').every((o) => o.label.length > 0)).toBe(true);
  });

  it('tells two recipes apart only by what they draw', () => {
    expect(sameLook({ ...youngMan, trait: [] }, youngMan)).toBe(true);
    expect(sameLook({ ...youngMan, tilt: 2 }, youngMan)).toBe(false);
  });
});
