import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useReady } from '../lib/ready';
import { Btn } from '../ui/Btn';
import { Frame } from '../ui/Frame';
import styles from './Failure.module.css';

/** A page that could not be drawn: what happened, in plain words, and what can be done. */
export function FailurePage({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  useReady(true);
  return (
    <div className={styles.page}>
      <Frame className={styles.box} role="alert">
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.text}>{text}</p>
        <div className={styles.actions}>
          <Btn onClick={() => (location.hash = '#/')}>回到标题</Btn>
          <Btn variant="solid" onClick={onRetry ?? (() => location.reload())}>
            重新载入
          </Btn>
        </div>
      </Frame>
    </div>
  );
}

interface BoundaryState {
  failed: boolean;
}

/**
 * Catches a screen that fails to render, so one broken page never blanks the whole interface. The
 * save is on the server and is not affected.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('screen failed', error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <FailurePage
          title="出了点岔子"
          text="这一页没能画出来。存档在服务端，不受影响；重新载入就能接着玩。"
          onRetry={() => this.setState({ failed: false })}
        />
      );
    }
    return this.props.children;
  }
}
