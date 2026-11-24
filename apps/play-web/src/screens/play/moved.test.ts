// What a turn moved on the main line and the next gate (moved.ts): the cards at the days' end show whole only
// then, and fold to a line under 接下来 otherwise.
import { describe, expect, it } from 'vitest';
import type { Mainline, PlayGate, StateView } from '../../contracts';
import { gateMoved, lackKind, mainlineMoved } from './moved';

const line: Mainline = {
  chapter: '第三章 · 太南风云',
  goal: '在春汀集上换得一件法宝。',
  clues: [
    { text: '持有法宝', done: false, have: 0, need: 1 },
    { text: '到达白苇集', done: true },
  ],
};
const gate: PlayGate = { name: '筑基', odds: 10, foundation: '虚浮', missing: ['还没到瓶颈', '心境 30（现有 12）'] };
const view = (mainline: Mainline | undefined, playGate: PlayGate | undefined) =>
  ({ mainline, play: playGate ? { gate: playGate } : {} }) as unknown as StateView;

describe('the main line moved', () => {
  it('when a condition is met, the chapter turns or a main line begins', () => {
    const met = { ...line, clues: [{ ...line.clues[0]!, done: true, have: 1 }, line.clues[1]!] };
    expect(mainlineMoved(view(line, gate), view(met, gate))).toBe(true);
    expect(mainlineMoved(view(line, gate), view({ ...line, chapter: '第四章 · 沉钟泽' }, gate))).toBe(true);
    expect(mainlineMoved(view(undefined, gate), view(line, gate))).toBe(true);
  });

  it('not when nothing on it changed, a count only crept, or there is no view before to tell from', () => {
    expect(mainlineMoved(view(line, gate), view(line, gate))).toBe(false);
    const crept = { ...line, clues: [{ ...line.clues[0]!, have: 0 }, line.clues[1]!] };
    expect(mainlineMoved(view(line, gate), view(crept, gate))).toBe(false);
    expect(mainlineMoved(null, view(line, gate))).toBe(false);
    expect(mainlineMoved(view(line, gate), view(undefined, gate))).toBe(false);
  });
});

describe('the next gate moved', () => {
  it('when its odds change, a lack is new, or the gate is another', () => {
    expect(gateMoved(view(line, gate), view(line, { ...gate, odds: 30 }))).toBe(true);
    expect(gateMoved(view(line, gate), view(line, { ...gate, missing: [...gate.missing, '没有功法'] }))).toBe(true);
    expect(gateMoved(view(line, gate), view(line, { ...gate, name: '结丹' }))).toBe(true);
    expect(gateMoved(view(line, undefined), view(line, gate))).toBe(true);
  });

  it('not when a lack only counts down or one goes, nor without a view before', () => {
    const before = { ...gate, missing: ['修为差 4'] };
    expect(gateMoved(view(line, before), view(line, { ...gate, missing: ['修为差 1'] }))).toBe(false);
    expect(gateMoved(view(line, gate), view(line, { ...gate, missing: ['还没到瓶颈'] }))).toBe(false);
    expect(gateMoved(null, view(line, gate))).toBe(false);
    expect(lackKind('心境 30（现有 12）')).toBe('心境 #（现有 #）');
  });
});
