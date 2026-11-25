// The line under a turn being written says what it waits for when the server makes it wait for the work
// after the turn before (实玩二: the player sat in silence for 15–20 s, over a minute at times).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { startLive } from '../../store/merge';
import { LiveState } from './TurnStates';

describe('the line under a turn being written', () => {
  it('says what the turn waits for, and the turn can still be cancelled', () => {
    const live = { ...startLive('request-1', 9, '收功起身。'), waiting: '等上一回合的世界演化写完……' };
    render(<LiveState live={live} onCancel={vi.fn()} onRetry={vi.fn()} onRewrite={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('等上一回合的世界演化写完……');
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('is the writing brush once nothing is waited for', () => {
    render(<LiveState live={startLive('request-1', 9, '收功起身。')} onCancel={vi.fn()} onRetry={vi.fn()} onRewrite={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('提笔中……');
  });
});


it('counts down a quota response and enables retry at the server deadline', () => {
  vi.useFakeTimers();
  try {
    const retry = vi.fn();
    const live = { ...startLive('quota', 7, '渡河'), status: 'failed' as const,
      error: { code: 'quota_exceeded' as const, retryable: true, retryAt: Date.now() + 62_000,
        message: '最近 24 小时的用量已到上限（费用 10.00 美元），约 2 分钟后可以再玩' } };
    render(<LiveState live={live} onCancel={vi.fn()} onRetry={retry} onRewrite={vi.fn()} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '重试' });
    expect(screen.getByRole('timer').textContent).toContain('1 分 2 秒');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(62_000));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
