// One turn as text: the player's stroke, story paragraphs, spoken lines with the speaker's head, cards
// and notices. Scene changes and arrivals belong to the stage and the status bar; options belong to
// the book's foot (on phones, to the end of the turn); neither leaves a mark here.
import { type CSSProperties, createContext, memo, useContext, useLayoutEffect, useRef } from 'react';
import type { Block, DeathBlock, Mark as TextMark, NarrationBlock, NoticeBlock, SpeechBlock, StateView } from '../../contracts';
import { joinSpeech } from '../../lib/story';
import { DeathCard } from './DeathCard';
import { liveText } from '../../store/text';
import { Btn } from '../../ui/Btn';
import { Card } from '../../ui/Card';
import { Line } from '../../ui/Line';
import { Me } from '../../ui/Me';
import { SceneMark } from '../../ui/SceneMark';
import { EmergePage, VolumePage, untold } from './BookPages';
import { CheckShow, diceStarts } from './CheckShow';
import { LifeActs, LifeAnnal, LifePerks } from './life';
import { useBeastFace } from './foe';
import { useHead, useRecipe } from './people';
import { isShowCard } from './shows';
import shows from './Shows.module.css';
import styles from './TurnView.module.css';

/** What the rows of a turn need from the page: whose save it is, and what a notice's button does. */
export interface Reading {
  saveId: string;
  view: StateView | null;
  onNotice?: (action: NonNullable<NoticeBlock['action']>) => void;
}

export const ReadingContext = createContext<Reading>({ saveId: '', view: null });

// paragraphs that were written before the reader's eyes, by turn and block: they do not float in
// again when they close
const streamed = new Set<string>();
const TurnNo = createContext<number | undefined>(undefined);

/** A paragraph with its marked names and terms; offsets count characters. */
export function Paragraph({ block, settled = false }: { block: NarrationBlock; settled?: boolean }) {
  const chars = [...block.text];
  const marks = [...(block.marks ?? [])].sort((a, b) => a.start - b.start);
  const parts: { text: string; mark?: TextMark }[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start < at || mark.end <= mark.start) continue;
    if (mark.start > at) parts.push({ text: chars.slice(at, mark.start).join('') });
    parts.push({ text: chars.slice(mark.start, mark.end).join(''), mark });
    at = mark.end;
  }
  if (at < chars.length) parts.push({ text: chars.slice(at).join('') });
  return (
    <p className={styles.para} data-settled={settled ? '' : undefined}>
      {parts.map((part, index) =>
        part.mark ? (
          <span key={index} className={styles[part.mark.kind]}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}

/**
 * The paragraph being written. Its words go straight into one text node as they arrive, so neither
 * this component nor the page re-renders per chunk; a gold diamond at its end shows it is still
 * being written.
 */
export function LiveParagraph({ block }: { block: NarrationBlock }) {
  const words = useRef<HTMLSpanElement>(null);
  const no = useContext(TurnNo);
  useLayoutEffect(() => {
    const span = words.current;
    if (!span) return;
    streamed.add(`${no}:${block.id}`);
    const node = document.createTextNode(liveText.read(block.id));
    span.replaceChildren(node);
    return liveText.listen(block.id, (delta) => node.appendData(delta));
  }, [block.id, no]);
  return (
    <p className={styles.para} data-live="">
      <span ref={words} />
      <i className={styles.pen} aria-hidden="true" data-endless="" />
    </p>
  );
}

/**
 * A spoken line with the speaker's round head, cut from their portrait; a beast the people table lists
 * (its role reads 「妖兽 · 一阶妖兽」) shows its bestiary picture instead.
 */
function Speech({ block }: { block: SpeechBlock }) {
  const { saveId, view } = useContext(ReadingContext);
  const listed = block.speaker.self ? undefined : block.speaker.charId;
  const beast = useBeastFace(listed ? { name: block.speaker.name, role: block.speaker.role ?? '' } : null);
  const charId = beast ? undefined : listed;
  // with the name the turn gives: the id may be someone else's now
  const recipe = useRecipe(saveId, view, charId, block.speaker.name);
  const head = useHead(recipe);
  return <Line block={block} avatar={beast ?? head} />;
}

/** The end of a life: 重入轮回 reads the save again, as a notice's 重新载入 does. */
function Death({ block }: { block: DeathBlock }) {
  const { onNotice } = useContext(ReadingContext);
  return <DeathCard block={block} onRestart={onNotice && (() => onNotice('reload'))} />;
}

function Notice({ block }: { block: NoticeBlock }) {
  const { onNotice } = useContext(ReadingContext);
  const words = { retry: '重试', resume: '继续结算', reload: '重新载入' } as const;
  return (
    <div className={styles.notice} data-level={block.level} role={block.level === 'error' ? 'alert' : 'note'}>
      <span>{block.text}</span>
      {block.action && onNotice && <Btn onClick={() => onNotice(block.action!)}>{words[block.action]}</Btn>}
    </div>
  );
}

/** The big round 胜, 负 or 遁 pressed onto a fight's last exchange (spec 七, 交锋). */
const VERDICT = { win: '胜', lose: '负', flee: '遁' } as const;

function BlockView({ block, delay, verdict }: { block: Block; delay?: number; verdict?: boolean }) {
  const no = useContext(TurnNo);
  const wait: CSSProperties | undefined = delay ? { animationDelay: `${delay}ms` } : undefined;
  switch (block.type) {
    case 'action':
      return <Me block={block} />;
    case 'narration':
      return <Paragraph block={block} settled={streamed.has(`${no}:${block.id}`)} />;
    case 'speech':
      return (
        <div className={styles.row}>
          <Speech block={block} />
        </div>
      );
    case 'check': {
      // a check thrown in this visit rolls its dice first, then is stamped
      const start = diceStarts.get(`${no}:${block.id}`);
      return (
        <div className={styles.card} style={wait} data-card={block.type}>
          {start === undefined ? <Card block={block} /> : <CheckShow block={block} start={start} />}
        </div>
      );
    }
    case 'combat':
      return (
        <div
          className={verdict && block.end ? `${styles.card} ${shows.verdict}` : styles.card}
          style={wait}
          data-card={block.type}
          data-verdict={verdict && block.end ? VERDICT[block.end] : undefined}
        >
          <Card block={block} />
        </div>
      );
    case 'receipt':
      return (
        <div className={styles.card} style={wait} data-card={block.type}>
          <Card block={block} />
        </div>
      );
    case 'notice':
      // the first scene closes' note on how to go on stands under 接下来 (PlayPage), not in the turn
      return block.note === 'close' ? null : <Notice block={block} />;
    case 'death':
      return (
        <div className={styles.card} style={wait} data-card={block.type}>
          <Death block={block} />
        </div>
      );
    // the cultivation life: an annals line, a scene's mark, a beat's action cards
    case 'chronicle':
      return <LifeAnnal block={block} no={no} />;
    case 'mark':
      return <SceneMark kind={block.kind} title={block.title} chapter={block.chapter} couplet={block.couplet} />;
    case 'actions':
      return <LifeActs block={block} no={no} />;
    case 'perks':
      return <LifePerks block={block} no={no} />;
    // the life's book (章回, item 38): a volume's closing page, and 出关见闻 after years away
    case 'volume':
      return <VolumePage block={block} />;
    case 'emerge':
      return <EmergePage block={block} />;
    default:
      return null;
  }
}

export interface TurnViewProps {
  /** the turn's number: block ids are only unique within a turn */
  no?: number;
  blocks: Block[];
  open?: NarrationBlock | null;
  cancelled?: boolean;
  /** how long each card waits before it floats in (a turn being written: 0.25 s apart) */
  delays?: ReadonlyMap<string, number>;
  /** in a performed turn, the cards that land with a performance and have not landed yet: left out
   *  until they do (an empty set: the turn is performed and everything has landed) */
  held?: ReadonlySet<string>;
  /** a fight's last exchange that has had its 胜 or 负 pressed onto it */
  verdicts?: ReadonlySet<string>;
}

/** The blocks of a turn, the options left out (they belong to the book's foot). */
export const TurnView = memo(function TurnView({ no, blocks, open, cancelled = false, delays, held, verdicts }: TurnViewProps) {
  return (
    <TurnNo.Provider value={no}>
      {joinSpeech(untold(blocks)).map((block) =>
        block.type === 'action' ? (
          // one key for the stroke, whether shown before the server answered or after
          <Me key="action" block={block} cancelled={cancelled} className={styles.float} />
        ) : held?.has(block.id) ? null : (
          // a card its performance lands floats in at that moment, without the rhythm's wait
          <BlockView
            key={block.id}
            block={block}
            delay={held && isShowCard(block) ? undefined : delays?.get(block.id)}
            verdict={verdicts?.has(block.id)}
          />
        ),
      )}
      {open && <LiveParagraph block={open} />}
    </TurnNo.Provider>
  );
});
