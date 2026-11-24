// The gallery's sections: every base component in each of its states. data-hover, data-focus and
// data-active show the hover, keyboard-focus and pressed looks without a pointer.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Act } from '../../ui/Act';
import { Acts } from '../../ui/Acts';
import { Annals } from '../../ui/Annals';
import { Bar } from '../../ui/Bar';
import { Btn } from '../../ui/Btn';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Detail } from '../../ui/Detail';
import { Entry } from '../../ui/Entry';
import { Frame } from '../../ui/Frame';
import { Gem } from '../../ui/Gem';
import { KV } from '../../ui/KV';
import { Line } from '../../ui/Line';
import { Empty, Loading } from '../../ui/Loading';
import { Mark, Seal, Stamp } from '../../ui/Marks';
import { Me } from '../../ui/Me';
import { Medal } from '../../ui/Medal';
import { Opts } from '../../ui/Opts';
import { Own } from '../../ui/Own';
import { Perks } from '../../ui/Perks';
import { Pips } from '../../ui/Pips';
import { SceneMark } from '../../ui/SceneMark';
import { Scroll } from '../../ui/Scroll';
import { Slot, SlotGrid } from '../../ui/Slot';
import { Sub } from '../../ui/Sub';
import { Tabs } from '../../ui/Tabs';
import { Toast } from '../../ui/Toast';
import { Tool } from '../../ui/Tool';
import { Toxin } from '../../ui/Toxin';
import { VerbNotes, Verbs } from '../../ui/Verbs';
import { RECEIPT_SEAL } from '../../ui/Card';
import { liveText } from '../../store/text';
import { Clocks } from '../play/Clocks';
import { FightBar } from '../play/FightBar';
import { FoeIntent } from '../play/NamePlate';
import { MainlineCard } from '../play/MainlineCard';
import { NextGate } from '../play/NextGate';
import { NextLine, NextSteps } from '../play/NextSteps';
import { RealmMap } from '../play/Realm';
import { RealmGate } from '../play/RealmGate';
import { Preview } from '../sheets/Cultivate';
import days from '../sheets/Cultivate.module.css';
import { NearList } from '../sheets/Near';
import { LiveParagraph, Paragraph } from '../play/TurnView';
import { EmergePage, VolumePage } from '../play/BookPages';
import { ContentsList } from '../sheets/Contents';
import * as sample from './samples';
import styles from './Gallery.module.css';

const noop = () => {};

// a paragraph caught mid-stream, its words written so far
const LIVE = 'gallery-live';
liveText.open(LIVE);
liveText.append(LIVE, '他抬手一拂，台边的云气便退开三尺，');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.items}>{children}</div>
    </div>
  );
}

export function StatusSection() {
  return (
    <>
      <Row label="境界圆环">
        <Medal glyph="炼" progress={0.96} label="炼气十三层，修为 96 / 100" />
        <Medal glyph="筑" progress={0.15} label="筑基初期，修为 15 / 100" data-hover="" />
        <Medal glyph="丹" progress={0} label="结丹初期，修为 0 / 100" data-focus="" />
      </Row>
      <Row label="条">
        <div className={styles.bars}>
          <Bar label="气血" current={86} max={120} tone="hp" />
          <Bar label="法力" current={41} max={64} tone="mp" />
          <Bar label="气血" current={9} max={120} tone="hp" />
          <Bar label="熟练" current={64} max={64} tone="gold" />
        </div>
      </Row>
      <Row label="菱形钮">
        <div className={styles.rail}>
          <Gem icon="scroll" label="卷轴" selected />
          <Gem icon="person" label="角色" selected={false} data-hover="" />
          <Gem icon="bag" label="行囊" selected={false} data-focus="" />
          <Gem icon="flag" label="任务" selected={false} />
          <Gem icon="map" label="地图" selected={false} disabled />
        </div>
        <div className={styles.grid4}>
          <Gem icon="person" label="角色" labelMode="below" />
          <Gem icon="bag" label="行囊" labelMode="below" />
          <Gem icon="skill" label="技能" labelMode="below" />
          <Gem icon="flag" label="任务" labelMode="below" />
          <Gem icon="people" label="人物" labelMode="below" />
          <Gem icon="beast" label="灵兽" labelMode="below" />
          <Gem icon="world" label="世界" labelMode="below" />
          <Gem icon="map" label="地图" labelMode="below" />
          <Gem icon="save" label="存档" labelMode="below" />
          <Gem icon="settings" label="设置" labelMode="below" />
          <Gem glyph="卷" label="导航" labelMode="none" selected />
          <Gem icon="send" label="发送" labelMode="none" />
        </div>
      </Row>
      <Row label="圆钮">
        <Tool glyph="合" label="关闭" />
        <Tool glyph="回" label="返回" data-hover="" />
        <Tool glyph="日" label="切换时辰" data-focus="" />
        <Tool glyph="隐" label="隐去界面" data-active="" />
        <Tool glyph="合" label="关闭" disabled />
      </Row>
    </>
  );
}

export function ButtonsSection() {
  const [tab, setTab] = useState('all');
  return (
    <>
      <Row label="文字钮">
        <Btn>装备</Btn>
        <Btn data-hover="">使用</Btn>
        <Btn data-focus="">赠予</Btn>
        <Btn variant="solid">踏入仙途</Btn>
        <Btn variant="danger">删除存档</Btn>
        <Btn disabled>卸下</Btn>
      </Row>
      <Row label="行动钮">
        <div className={styles.acts}>
          <Act glyph="壹" name="闭关修炼" note="耗一块灵石 · 一日" />
          <Act glyph="贰" name="冲击筑基" note="修为圆满，可以冲关" hot />
          <Act glyph="叁" name="远眺云海" note="看看山外的动静" data-hover="" />
          <Act glyph="肆" name="冲击筑基" note="修为未满，尚不可冲关" unavailable />
        </div>
      </Row>
      <Row label="行动签">
        <Chip text="用 · 回气丹" onRemove={noop} />
        <Chip text="赠 · 青锋剑 → 白蘅" onRemove={noop} />
        <Chip text="往 · 太南谷" />
      </Row>
      <Row label="标签页">
        <Tabs
          label="行囊分类"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'all', label: '全部' },
            { id: 'weapon', label: '兵器' },
            { id: 'armor', label: '防具' },
            { id: 'pill', label: '丹药' },
            { id: 'material', label: '材料' },
            { id: 'key', label: '要物' },
          ]}
        />
      </Row>
      <Row label="列表项">
        <div className={styles.stack}>
          <Entry title="第一章 · 云台问道" text="在观云台冲击筑基。修为圆满 96 / 100" status="进" state="active" />
          <Entry title="采药" text="为灵药园采三株月见草 · 发布人 白蘅" status="成" state="done" />
          <Entry title="第二章 · 下山" text="筑基之后才会开启" status="未" state="locked" />
          <Entry title="陆沉 · 炼气十三层" text="青岚山 · 观云台 · 正月初三 子时 · 第 37 回" status="炼" onClick={noop} selected />
        </div>
      </Row>
    </>
  );
}

export function ReadingSection() {
  const [draft, setDraft] = useState('请长老护法。');
  // the first option shows its hover look
  const opts = useRef<HTMLDivElement>(null);
  useEffect(() => opts.current?.querySelector('button')?.setAttribute('data-hover', ''), []);
  return (
    <div className={styles.book}>
      <Me block={sample.action} />
      <Me block={sample.actionQueued} />
      <Paragraph block={sample.narration} />
      <Paragraph block={sample.narrationMarked} />
      <Line block={sample.elder} />
      <Line block={sample.self} />
      <Line block={sample.stranger} />
      <Card block={sample.check} />
      <Card block={sample.checkFail} />
      <Card block={sample.clash} />
      <Card block={sample.clashWon} />
      <Card block={sample.cultivate} />
      <Card block={sample.gain} />
      <LiveParagraph block={{ id: LIVE, type: 'narration', text: '' }} />
      <Loading />
      <div ref={opts}>
        <Opts items={sample.options} onPick={noop} />
      </div>
      <Own value="" onChange={noop} onSend={noop} />
      <Own value={draft} onChange={setDraft} onSend={noop} />
      <Me block={sample.action} cancelled />
    </div>
  );
}

export function PanelSection() {
  const [picked, setPicked] = useState(0);
  const thing = sample.things[picked];
  return (
    <Frame className={styles.panel}>
      <Sub>根基</Sub>
      <KV
        items={[
          { label: '境界', value: '炼气十三层' },
          { label: '修为', value: '96 / 100' },
          { label: '寿元', value: '27 / 100' },
          { label: '灵根', value: '真灵根 ×1.0' },
          { label: '功法', value: '太素引气诀' },
          { label: '每日修为', value: '约 3.6' },
        ]}
      />
      <Sub>属性</Sub>
      <KV
        items={[
          { label: '物攻', value: 38, delta: '+5' },
          { label: '物防', value: 33, delta: '+3' },
          { label: '法攻', value: 39, delta: '+4' },
          { label: '神识', value: 6 },
          { label: '物理穿透', value: 2 },
          { label: '法术穿透', value: 1 },
        ]}
      />
      <Sub>装备</Sub>
      <SlotGrid>
        {sample.equipment.map((item, index) => (
          <Slot key={index} thing={item} emptyLabel="法宝" />
        ))}
      </SlotGrid>
      <Sub>储物袋</Sub>
      <SlotGrid>
        {sample.things.map((item, index) => (
          <Slot key={index} thing={item} selected={index === picked} onClick={() => setPicked(index)} />
        ))}
      </SlotGrid>
      {thing && (
        <Detail
          title={thing.name}
          meta="丹药 · 极品"
          actions={
            <>
              <Btn>使用</Btn>
              <Btn>赠予</Btn>
            </>
          }
        >
          冲击筑基时服用。每枚让成算多三分，最多计两枚。
        </Detail>
      )}
      <Toast text="已装备 青锋剑" onClose={noop} />
      <Toast kind="error" text="连接中断了。写下的字还在，稍后重试。" onRetry={noop} onClose={noop} />
      <Toast kind="error" text="这里不能复制，浏览器没有给剪贴板。" onClose={noop} />
    </Frame>
  );
}

export function MarksSection() {
  return (
    <>
      <Row label="标记">
        <Mark glyph="卜" />
        <Mark glyph="战" />
      </Row>
      <Row label="印章">
        {Object.entries(RECEIPT_SEAL).map(([kind, glyph]) => (
          <Seal key={kind} glyph={glyph} />
        ))}
      </Row>
      <Row label="圆印">
        {['成', '败', '吉', '凶', '中', '空', '胜', '负'].map((glyph) => (
          <Stamp key={glyph} glyph={glyph} />
        ))}
      </Row>
      <Row label="小印">
        {['初识', '友善', '敌视', '同门'].map((glyph) => (
          <Seal key={glyph} glyph={glyph} small />
        ))}
        <Seal glyph="成" small tilt />
      </Row>
      <Row label="空状态">
        <Empty title="尚无任务" text="接下的任务会列在这里。" />
      </Row>
      <Row label="滚动条">
        <Scroll className={styles.scrollDemo} thread fade>
          {sample.story.map((text, index) => (
            <p key={index} className={styles.storyLine}>
              {text}
            </p>
          ))}
        </Scroll>
      </Row>
    </>
  );
}

/**
 * The cultivation life's parts (gameplay plan items 10 and 13): the action cards in their four looks
 * (the second hovered), a fallback beat, the scene's marks, the annals and the standing commands, in the
 * phone's bar and at the desktop's book foot. Reached by its address only (#/gallery/life): a tab of its
 * own would change every other section's picture.
 */
export function LifeSection() {
  const cards = useRef<HTMLDivElement>(null);
  useEffect(() => cards.current?.querySelectorAll('button')[1]?.setAttribute('data-hover', ''), []);
  return (
    <div className={styles.book}>
      <SceneMark kind="open" title="石阶上的来客" />
      <div ref={cards}>
        <Acts items={sample.cards} onPick={noop} />
      </div>
      <Acts items={sample.fallbackCards} onPick={noop} fallback />
      <SceneMark kind="close" title="石阶上的来客" />
      <Annals lines={sample.annals} onElaborate={noop} />
      <div className={styles.verbBar}>
        <Verbs verbs={sample.verbs} onVerb={noop} onOwn={noop} onPanels={noop} spread />
      </div>
      <Verbs verbs={sample.verbs} onVerb={noop} />
    </div>
  );
}

/**
 * The cultivation life's clocks, fight, gate and 悟得 (gameplay plan items 18, 21 and 24), by address only
 * (#/gallery/life2): the clocks with their segments, a foe's intent (seen and not), the fight's bar as the
 * book's foot and as the phone's bar, the card of the next gate, the three 悟得.
 */
export function LifeMoreSection() {
  return (
    <div className={styles.book}>
      <div className={styles.clocksDemo}>
        <Clocks clocks={sample.clocks} />
      </div>
      <div className={styles.row}>
        <div className={styles.stack}>
          <Pips value={0} size={4} name="空的" />
          <Pips value={3} size={6} name="过半" />
          <Pips value={6} size={6} name="满了" />
          <Pips value={3} size={6} name="编年里的" small />
        </div>
        <div className={styles.stack}>
          <FoeIntent intent="蓄势" tags={['破绽 一回合', '弱 · 火']} />
          <FoeIntent tags={['重伤']} />
        </div>
      </div>
      <FightBar fight={sample.fight} skills={sample.fight.skills ?? []} onMove={noop} caption />
      <div className={styles.verbBar} data-wide="">
        <FightBar fight={sample.fight} skills={sample.fight.skills ?? []} onMove={noop} onPanels={noop} spread />
      </div>
      <NextGate gate={sample.gate} onOpen={noop} />
      <NextGate gate={{ name: '结丹', odds: 25, foundation: '稳固', missing: [] }} onOpen={noop} />
      <Perks items={sample.perks} onPick={noop} />
    </div>
  );
}

/**
 * 去处, the secret realm and 丹毒 (gameplay plan items 28, 32 and 44), by address only (#/gallery/life3):
 * the nearest places, a journey's preview and a refused one with 启程, the realm's map in the middle of it
 * and at its exit, 入秘境 at its entrance open, closed till next year and barred, and the 丹毒 bar below
 * its first line, past it and at a wider cap.
 */
export function LifePlacesSection() {
  return (
    <div className={styles.book}>
      <NearList near={sample.near} here={sample.here} onPick={noop} />
      <div className={days.preview}>
        <Preview preview={sample.journey} kind="travel" />
      </div>
      <div className={days.preview}>
        <Preview preview={sample.noJourney} kind="travel" />
      </div>
      <Act glyph="往" name="启程" note="五日 · 正月初八到" hot onClick={noop} />
      <RealmMap realm={sample.realm} onStep={noop} />
      <RealmMap realm={sample.realmOut} onStep={noop} />
      {sample.realmGates.map((gate) => (
        <RealmGate key={`${gate.open}-${gate.off}`} realm={gate} today={sample.realmToday} onEnter={noop} />
      ))}
      <div className={styles.stack}>
        {sample.toxins.map((toxin) => (
          <Toxin key={toxin.value} toxin={toxin} />
        ))}
      </div>
    </div>
  );
}

/**
 * 主线, the reasons and 接下来 (the first playtest), by address only (#/gallery/life4): the main line's card
 * with a counted condition, a met one and the next chapter, and the last chapter all met; the next gate
 * held by an injury; the reasons of the commands that wait, one and three of them for one reason; a
 * town's commands crowding the phone's bar (sideways, 自写 and 面板 kept) and at the desktop's foot; the
 * three things to do now, the main line's first; and as after a scene that moved neither card, a thread
 * first (约), the main line and the gate folded to a line each, and the first closes' quiet line under it.
 */
export function LifeNextSection() {
  return (
    <div className={styles.book}>
      <MainlineCard line={sample.mainline} onOpen={noop} />
      <MainlineCard line={sample.mainlineMet} onOpen={noop} />
      <NextGate gate={sample.gate} onOpen={noop} blocked="内伤未愈，还要养八日" />
      <VerbNotes verbs={sample.sceneVerbs} />
      <div className={styles.verbBar}>
        <VerbNotes verbs={sample.townVerbs} />
        <Verbs verbs={sample.townVerbs} onVerb={noop} onOwn={noop} onPanels={noop} spread />
      </div>
      <Verbs verbs={sample.townVerbs} onVerb={noop} onPlaces={noop} onCalendar={noop} />
      <VerbNotes verbs={sample.townVerbs} />
      <NextSteps steps={sample.hints} verbs={sample.townVerbs} onStep={noop} />
      <NextSteps
        steps={sample.threadHints}
        verbs={sample.townVerbs}
        onStep={noop}
        lines={[
          // a chapter named long: a narrow screen cuts its words, never where it stands
          <NextLine key="main" kind="main" glyph="主" text="主线 · 第三章 · 春汀集前后的风云际会" tail="0/1" label="主线 · 第三章 · 春汀集前后的风云际会" onOpen={noop} />,
          <NextLine key="gate" kind="gate" glyph="关" text="下一关 · 筑基" tail="成算一成" label="下一关 · 筑基" onOpen={noop} />,
        ]}
        note="想顺着刚才的事走，点上面带「约」的一条，或者直接写一句你要做的。"
      />
    </div>
  );
}

/**
 * The cultivation life's book (章回, gameplay plan item 38), by address only (#/gallery/life5): a scene's
 * marks with its 回, the close with its 回目 and with the engine's own one line, the closing pages of a
 * volume a gate closed and of one a great event closed, 出关见闻, and the contents (目录) with a 回 still
 * on.
 */
export function LifeBookSection() {
  return (
    <div className={styles.book}>
      <SceneMark kind="open" title="石阶上的来客" chapter={3} />
      <SceneMark kind="close" title="石阶上的来客" chapter={3} couplet={sample.couplet} />
      <SceneMark kind="close" title="石阶上的来客" chapter={4} couplet="观云台石阶上的来客" />
      <VolumePage block={sample.gateVolume} />
      <EmergePage block={sample.emerge} />
      <VolumePage block={sample.eventVolume} />
      <div className={styles.panel}>
        <ContentsList book={sample.book} onGo={noop} />
      </div>
    </div>
  );
}
