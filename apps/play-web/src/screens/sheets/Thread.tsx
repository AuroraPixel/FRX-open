// 接着办 (the owner's second playtest): a thread that 接下来 offered, opened the way the other commands open,
// with what taking it up would do (POST …/preview, the same answer the turn would settle) and the button that
// sends it as the turn's verb (follow); 看别的 goes back to the page.
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Empty } from '../../ui/Loading';
import { followVerb, threadsOf, whenWords } from '../play/threads';
import { useAim } from './aim';
import { Said, VerbDetail } from './VerbDetail';

export function ThreadSheet({ saveId }: { saveId: string }) {
  const play = useStateStore((s) => s.view?.play);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const aim = useAim('thread');
  const threads = threadsOf(play);
  const thread = threads.find((each) => each.id === aim?.pick) ?? threads[0];
  if (!thread) return <Empty title="没有约下的事" text="戏里约下的事、等着说话的人会记在这里。" />;
  const where = [thread.place, thread.spot].filter(Boolean).join(' · ');
  const sub = [whenWords(thread), where].filter(Boolean).join(' · ');
  return (
    <VerbDetail
      saveId={saveId}
      verb={followVerb(thread.id)}
      title={thread.who ? (thread.when ? `${thread.who.name}之约` : thread.who.name) : '接着办'}
      sub={sub}
      glyph="约"
      name="接着办"
      onBack={closeSheet}
    >
      <Said>{thread.text}</Said>
      {thread.item && <Said>带上：{thread.item}</Said>}
    </VerbDetail>
  );
}
