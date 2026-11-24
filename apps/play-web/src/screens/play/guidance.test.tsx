import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mainline } from '../../contracts';
import { MainlineCard, clueCount, mainlineLabel } from './MainlineCard';

const line: Mainline = {
  chapter: '第一章 · 市井谋生',
  goal: '在泊灯城攒够二十块灵石，好在城里站住脚。',
  clues: [
    { text: '灵石不少于20', done: false, have: 9, need: 20 },
    { text: '持有聚气散', done: true, have: 1, need: 1 },
    { text: '到达白苇集', done: false },
  ],
  next: '第二章 · 白苇集之行',
};

describe('the main line’s card', () => {
  it('counts a condition that is counted, and says the chapter, its goal, each condition and the next', () => {
    expect(line.clues.map(clueCount)).toEqual(['9 / 20', '1 / 1', '']);
    expect(clueCount({ text: '灵石不少于20', done: true, have: 26, need: 20 })).toBe('20 / 20');
    expect(mainlineLabel(line)).toBe(
      '主线 · 第一章 · 市井谋生：在泊灯城攒够二十块灵石，好在城里站住脚。灵石不少于20，已有9，要20；持有聚气散，已达成；到达白苇集，未达成。下一章 第二章 · 白苇集之行。打开任务',
    );
    expect(mainlineLabel({ chapter: '第三章 · 宗门暗涌', goal: '查清真相', clues: [] })).toBe('主线 · 第三章 · 宗门暗涌：查清真相。打开任务');
    expect(mainlineLabel({
      title: '失灯旧约', chapter: '第一章 · 潮湾验锁', goal: '查验堤口的铜锁',
      clues: [{ text: '取出铜锁', done: false, pending: true }],
    })).toBe('主线 · 失灯旧约 · 第一章 · 潮湾验锁：查验堤口的铜锁。取出铜锁，待核验。打开任务');
  });

  it('draws a condition’s count and bar until it is met, a met one filled, the next chapter greyed; pressed, it opens', () => {
    const onOpen = vi.fn();
    render(<MainlineCard line={line} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /^主线 · 第一章 · 市井谋生/ });
    expect(card.textContent).toBe('主主线第一章 · 市井谋生在泊灯城攒够二十块灵石，好在城里站住脚。灵石不少于209 / 20持有聚气散到达白苇集下一章 · 白苇集之行');
    expect([...card.querySelectorAll('[data-done]')].map((each) => each.textContent)).toEqual(['持有聚气散']);
    expect((card.querySelector('i[style]') as HTMLElement).style.width).toBe('45%');
    act(() => void fireEvent.click(card));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
