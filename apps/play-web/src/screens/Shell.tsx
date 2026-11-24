// An address that leads nowhere, and a page a build does not carry (the gallery outside development).
// It uses the base components only.
import { useReady } from '../lib/ready';
import { navigate } from '../router';
import { Btn } from '../ui/Btn';
import { Empty } from '../ui/Loading';
import styles from './Shell.module.css';

export function HoldingScreen({ title }: { title: string }) {
  useReady(true);
  return (
    <main className={styles.page} aria-label={title}>
      <Empty title={title} text="这一页还在画。" />
      <Btn onClick={() => navigate({ name: 'title' })}>回到标题</Btn>
    </main>
  );
}
