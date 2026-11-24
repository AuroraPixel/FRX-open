import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayKarma } from '../../contracts';
import { Karma, karmaState, StoryHead } from './Story';

describe('the ledger’s words', () => {
  const promise: PlayKarma = { id: 'Y4', kind: '诺', who: '玄微子', what: '答应抄完', back: '到期不办，就成了一笔怨', year: 1, due: { text: '四月初三', year: 1, month: 4, day: 3 } };

  it('say a promise’s day, a settled entry and a broken one', () => {
    expect(karmaState(promise)).toBe('四月初三为期');
    expect(karmaState({ ...promise, done: true })).toBe('已了结');
    expect(karmaState({ ...promise, broken: true })).toBe('失信');
    expect(karmaState({ ...promise, kind: '恩', due: undefined })).toBe('');
  });

  it('fade a settled entry’s seal and mark a broken promise', () => {
    render(<Karma karma={[{ ...promise, done: true }, { ...promise, id: 'Y5', broken: true }]} />);
    const [settled, broken] = within(screen.getByRole('region', { name: '因果' })).getAllByRole('listitem');
    expect(settled!.hasAttribute('data-settled')).toBe(true);
    expect(settled!.querySelector('[data-mark]')?.getAttribute('data-tone')).toBe('faint');
    expect(broken!.textContent).toBe('诺玄微子答应抄完到期不办，就成了一笔怨失信');
  });
});

describe('the chapter’s conditions', () => {
  it('distinguishes a story condition awaiting evidence from a missing realm', () => {
    render(<StoryHead line={{
      title: '失灯旧约', chapter: '第一章 · 潮湾验锁', goal: '取锁并通过院试',
      clues: [{ text: '取出渡口的铜锁', done: false, pending: true },
        { text: '达到筑基后期', done: false }],
    }} />);
    const [story, realm] = screen.getAllByRole('listitem');
    expect(within(story!).getByText('待核验')).toBeTruthy();
    expect(within(realm!).queryByText('待核验')).toBeNull();
    expect(realm?.textContent).toContain('缺');
  });
});
