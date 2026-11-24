import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneBlock } from '../../contracts';
import { Passage } from './Passage';
import * as clock from './showClock';

function scene(weather: string): SceneBlock {
  return { id: 'b2', type: 'scene', sceneId: 'jieshi', place: '潮岚道 · 回潮渡', hour: 'dawn', hourName: '卯时', date: '正月初六', weather, indoor: false };
}

describe('a journey’s passage', () => {
  it('says a bare weather name in words, never the name itself', () => {
    render(<Passage show={{ kind: 'travel', key: '12:b2', turn: 12, scene: scene('mist'), line: '往回潮渡去' }} level="full" sceneUp={false} onDone={() => undefined} />);
    const where = screen.getByRole('status', { name: '赶路 · 回潮渡' }).textContent ?? '';
    expect(where).toContain('潮岚道 · 回潮渡 · 卯时 · 薄雾');
    expect(where).not.toContain('mist');
  });

  it('keeps the story’s own words for the weather', () => {
    render(<Passage show={{ kind: 'travel', key: '12:b2', turn: 12, scene: scene('晨雾初散'), line: '' }} level="full" sceneUp={false} onDone={() => undefined} />);
    expect(screen.getByRole('status', { name: '赶路 · 回潮渡' }).textContent).toContain('卯时 · 晨雾初散');
  });

  it('releases the page when the stage never reports the new scene', () => {
    const time = vi.spyOn(clock, 'useShowTime').mockReturnValue(7.99);
    try {
      const done = vi.fn();
      const show = { kind: 'travel' as const, key: '12:b2', turn: 12, scene: scene('mist'), line: '' };
      const passage = <Passage show={show} level="full" sceneUp={false} onDone={done} />;
      const { rerender } = render(passage);
      expect(done).not.toHaveBeenCalled();
      time.mockReturnValue(8);
      rerender(<Passage {...passage.props} />);
      expect(done).not.toHaveBeenCalled();
      time.mockReturnValue(8.9);
      rerender(<Passage {...passage.props} />);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      time.mockRestore();
    }
  });
});
