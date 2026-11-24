import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseUp, FIGHT_HOLD_MS, HOLD_MS } from './CloseUp';

describe('continuing from a first encounter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function show(inFight: boolean) {
    const onLeave = vi.fn();
    const onGone = vi.fn();
    render(
      <CloseUp
        entry={{ id: 'b1', type: 'enter', charId: 'C1', name: '巡山兽', first: true }}
        where="松径"
        inFight={inFight}
        onLeave={onLeave}
        onGone={onGone}
      />,
    );
    return { onLeave, onGone };
  }

  it('automatically releases the fight after the introduction', () => {
    const { onLeave, onGone } = show(true);
    expect(screen.getByRole('button', { name: '继续斗法' })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(FIGHT_HOLD_MS - 1));
    expect(onLeave).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onLeave).toHaveBeenCalledOnce();
    act(() => void vi.advanceTimersByTime(700));
    expect(onGone).toHaveBeenCalledOnce();
  });

  it('lets the player continue immediately after the minimum hold', () => {
    const { onLeave } = show(true);
    fireEvent.click(screen.getByRole('button', { name: '继续斗法' }));
    expect(onLeave).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    expect(onLeave).toHaveBeenCalledOnce();
    act(() => void vi.advanceTimersByTime(FIGHT_HOLD_MS));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('keeps an ordinary encounter on screen until the reader continues', () => {
    const { onLeave } = show(false);
    act(() => void vi.advanceTimersByTime(FIGHT_HOLD_MS));
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
