// Sample blocks for the gallery, in the contract's shapes; the words come from the approved stills.
import type {
  ActionBlock,
  ActionCard,
  BookView,
  CheckBlock,
  CombatBlock,
  Mainline,
  NarrationBlock,
  OptionItem,
  PerkChoice,
  PlayClock,
  PlayFight,
  PlayGate,
  PlaceRealm,
  PlayDate,
  PlayNear,
  PlayPlace,
  PlayRealm,
  PlayToxin,
  PlayVerb,
  VerbPreview,
  ReceiptBlock,
  SpeechBlock,
  EmergeBlock,
  VolumeBlock,
} from '../../contracts';
import type { NextStep } from '../play/NextSteps';
import type { AnnalLine } from '../../ui/Annals';
import type { SlotThing } from '../../ui/Slot';

export const action: ActionBlock = { id: 'g1', type: 'action', text: '收功起身，向来人躬身行礼。' };
export const actionQueued: ActionBlock = {
  id: 'g1q',
  type: 'action',
  text: '请长老护法，子时三刻冲关。',
  queue: [{ kind: 'use', text: '用 · 筑基丹', itemId: 'I3', quantity: 1 }],
};

export const narration: NarrationBlock = {
  id: 'g2',
  type: 'narration',
  text: '你缓缓收功，十三层真元归于丹田。石阶尽头不知何时立着一位白须老者，鹤氅在夜风里纹丝不动，手里拄着一根挂着葫芦的木杖。',
};

export const narrationMarked: NarrationBlock = {
  id: 'g3',
  type: 'narration',
  text: '玄微子的目光在你袖口停了一瞬，像是早已看见了那两枚筑基丹。',
  marks: [
    { start: 0, end: 3, kind: 'name', charId: 'C7' },
    { start: 25, end: 28, kind: 'term' },
  ],
};

export const elder: SpeechBlock = {
  id: 'g4',
  type: 'speech',
  speaker: { name: '玄微子', charId: 'C7', role: '长老' },
  lines: ['“炼气十三层，真元倒还凝实。”', '“筑基丹备了几枚？”'],
};

export const self: SpeechBlock = {
  id: 'g5',
  type: 'speech',
  speaker: { name: '陆沉', charId: 'B1', self: true },
  lines: ['“两枚。”'],
};

export const stranger: SpeechBlock = {
  id: 'g6',
  type: 'speech',
  speaker: { name: '柳寒鸢' },
  lines: ['“道友不必紧张。听说青岚山有人要冲击筑基，我是来谈一笔生意的。”'],
};

export const check: CheckBlock = {
  id: 'g7',
  type: 'check',
  title: '神识探查',
  roll: 7,
  modifiers: [{ label: '神识', value: 3 }],
  total: 10,
  difficulty: 8,
  outcome: 'success',
  note: '看清来人袖口绣着一枚丹炉暗纹',
};

export const checkFail: CheckBlock = {
  id: 'g8',
  type: 'check',
  title: '冲击筑基',
  roll: 2,
  modifiers: [
    { label: '气运', value: 1 },
    { label: '心魔', value: -2 },
  ],
  total: 1,
  difficulty: 10,
  outcome: 'critical_failure',
  note: '真元逆冲，经脉受损',
};

export const clash: CombatBlock = {
  id: 'g9',
  type: 'combat',
  attacker: { name: '陆沉', charId: 'B1' },
  defender: { name: '青狼' },
  move: '青锋剑式',
  roll: 12,
  modifiers: [{ label: '身法', value: 4 }],
  total: 16,
  defense: 13,
  hit: true,
  damage: 18,
  defenderHp: { current: 62, max: 80 },
};

export const clashWon: CombatBlock = {
  ...clash,
  id: 'g10',
  move: '回身一刺',
  roll: 15,
  total: 19,
  damage: 64,
  defenderHp: { current: 0, max: 80 },
  end: 'win',
};

export const cultivate: ReceiptBlock = {
  id: 'g11',
  type: 'receipt',
  kind: 'cultivate',
  title: '静坐一夜',
  lines: [
    { label: '修为', value: '96 / 100', delta: '+6' },
    { label: '法力', value: '41 / 64', delta: '+12' },
  ],
};

export const gain: ReceiptBlock = {
  id: 'g12',
  type: 'receipt',
  kind: 'gain',
  title: '拾得储物袋',
  lines: [
    { label: '下品灵石', delta: '+12' },
    { label: '储物袋', value: '寒铁矿 ×1' },
  ],
};

export const options: OptionItem[] = [
  { index: 1, text: '谢过长老，问他为何相助' },
  { index: 2, text: '请教冲关时要留意什么' },
  { index: 3, text: '婉言谢绝，独自冲关' },
];

export const things: (SlotThing | null)[] = [
  { name: '筑基丹', grade: 4, quantity: 2 },
  { name: '回气丹', grade: 2, quantity: 3 },
  { name: '止血符', grade: 1, quantity: 2 },
  { name: '无名残卷', grade: 3, quantity: 1 },
  { name: '赤焰珠', grade: 5, quantity: 1 },
  { name: '寒铁矿', grade: 1, quantity: 1 },
  null,
];

export const equipment: (SlotThing | null)[] = [
  { name: '青锋剑', grade: 2 },
  { name: '云纹道袍', grade: 1 },
  null,
  { name: '太素引气诀', grade: 3 },
];

export const story = [
  '山风自云海深处涌来，带着雪线上的寒意。你在观云台边缘盘膝而坐，十三层的真元在经脉里缓缓流转，像一条将满未满的河。',
  '台下万顷云涛翻涌，远处的雪峰只露出一线银脊。丹田里那道屏障近在咫尺，只差最后一点水磨工夫。',
  '袖中两枚筑基丹隔着瓷瓶透出温热。师门的规矩你记得清楚：圆满之前不可冲关，圆满之后，成败只看这一夜。',
  '你取出一块下品灵石握在掌心，依《太素引气诀》吐纳。灵气如百川归海，自四面八方汇向云台。',
];

// the cultivation life (gameplay plan items 10 and 13), as the mock-ups write them (docs/review/gameplay/)
export const cards: ActionCard[] = [
  { index: 1, kind: '交涉', glyph: '言', title: '请长老为你护法', sub: '交涉 · 看魅力 · 难度难 · 成了冲关 +1', odds: 20, tone: 'poor' },
  { index: 2, kind: '探查', glyph: '察', title: '留意他为何而来', sub: '探查 · 看神识 · 难度中 · 败了他会察觉', odds: 50, tone: 'mid' },
  { index: 3, kind: '欺瞒', glyph: '饰', title: '谎称只是路过的散修', sub: '欺瞒 · 看魅力 · 难度易 · 败了好感 −4', odds: 80, tone: 'good' },
  { index: 4, kind: '用物', glyph: '物', title: '如实亮出两只瓷瓶', sub: '用物 · 聚气散、筑基丹 · 不掷骰', plain: true },
  { index: 5, kind: '施术', glyph: '术', title: '以敛息术藏起修为', sub: '施术 · 还没学会敛息术', locked: true, reason: '还没学会敛息术' },
];

/** the model gave no cards: its options classed by keywords, without odds */
export const fallbackCards: ActionCard[] = [
  { index: 1, kind: '探查', glyph: '察', title: '仔细搜查床柜后面', sub: '探查 · 看神识' },
  { index: 2, kind: '静观', glyph: '观', title: '静静看着', sub: '静观 · 不掷骰', plain: true },
];

export const annals: AnnalLine[] = [
  { id: 'a1', date: '冬月廿三', text: '观云台。闭关四十日，修为六十至九十。' },
  { id: 'a2', date: '正月初一', text: '下山往青岚坊市，行一日。以灵石二十一，购聚气散一包。' },
  { id: 'a3', date: '正月初二', text: '茶肆打探，得线索二：筑基丹的去处；山下有劫修盯梢。' },
  { id: 'a4', date: '正月初三', text: '回观云台，静坐一夜。', now: true },
];

export const verbs: PlayVerb[] = [
  { kind: 'cultivate', glyph: '修', label: '修炼', main: true },
  { kind: 'rest', glyph: '息', label: '调息' },
  { kind: 'wait', glyph: '候', label: '静候', off: true, note: '这场戏还没收场' },
];

// the cultivation life's clocks, fight, gate and 悟得 (gameplay plan items 18, 21 and 24), as the mock-ups
// write them
export const clocks: PlayClock[] = [
  { id: 'k1', name: '劫修盯梢', size: 6, value: 3, note: '离山十日退一格' },
  { id: 'k2', name: '神机卫搜捕', size: 6, value: 4, note: '交出赃物即消' },
  { id: 'k3', name: '坊市赊账', size: 4, value: 1, note: '还清三十灵石即消' },
];

export const fight: PlayFight = {
  round: 2,
  foes: [{ charId: 'C9', name: '黑衣劫修', intent: '蓄势', tags: ['破绽 一回合', '弱 · 火'] }],
  commands: [
    { command: 'strike', glyph: '攻', note: '命中八成' },
    { command: 'skill', glyph: '术', note: '耗法力六' },
    { command: 'item', glyph: '物', note: '腰带' },
    { command: 'guard', glyph: '御', note: '伤害减半', hint: true },
    { command: 'flee', glyph: '遁', note: '成算四成' },
    { command: 'probe', glyph: '察', note: '已用过', used: true },
    { command: 'talk', glyph: '和', note: '他不肯听', off: true },
  ],
  belt: [
    { itemId: 'I8', name: '火弹符', icon: 'talisman', quantity: 2 },
    { itemId: 'I2', name: '回气丹', icon: 'pill', quantity: 1 },
    { itemId: 'I9', name: '阵旗', icon: 'banner', quantity: 1 },
  ],
  skills: [
    { skillId: 'S1', name: '御剑术', cost: '法力 6', odds: 80 },
    { skillId: 'S2', name: '火弹术', cost: '法力 4', odds: 65 },
    { skillId: 'S3', name: '敛息术', cost: '法力 3', off: true, note: '斗法里用不上' },
  ],
};

export const gate: PlayGate = { name: '筑基', odds: 70, foundation: '虚浮', missing: ['修为差 4'] };

export const perks: PerkChoice[] = [
  { index: 1, name: '草木知音', text: '在山野修炼，速度 +10%' },
  { index: 2, name: '脚底抹油', text: '脱身检定 +2' },
  { index: 3, name: '守拙', text: '每年一次，让一口压力钟退一格', rare: true },
];

// 去处, the secret realm and 丹毒 (gameplay plan items 28, 32 and 44), as the sample sets life-travel,
// life-realm and life-pills give them
export const here: PlayPlace = { name: '泊灯城', kind: '城镇', aura: '薄', danger: '太平', venues: ['客栈', '茶肆', '店铺', '告示', '当铺', '丹房', '拍卖行'] };

export const near: PlayNear[] = [
  { name: '南雁城', kind: '城镇', venues: ['客栈', '茶肆', '店铺', '告示', '当铺', '丹房'], distance: 18, days: 1 },
  { name: '银栖阁', kind: '宗门', venues: ['藏经阁', '丹房', '器室', '执事堂'], distance: 30, days: 2 },
  { name: '白苇集', kind: '坊市', venues: ['店铺', '告示', '黑市'], distance: 93, days: 5 },
  { name: '听澜院', kind: '宗门', venues: ['藏经阁', '丹房', '器室', '执事堂'], distance: 108, days: 6 },
];

export const journey: VerbPreview = {
  ok: true,
  minutes: 7200,
  ends: { text: '正月初八', year: 1, month: 1, day: 8 },
  lines: ['往白苇集，路程约九十三，日行二十，行五日，正月初八到。', '这段日子被打扰的可能约半成。'],
  formula: [
    { label: '路程', value: '93' },
    { label: '脚力 31', value: '日行20' },
    { label: '日数', value: '93 ÷ 20 → 5' },
  ],
  risk: 3,
};

export const noJourney: VerbPreview = { ok: false, reason: '隔着大海，要寻传送阵或海船', minutes: 0, lines: [], formula: [] };

const node = (id: string, kind: string | null, state: 'walked' | 'open' | 'passed' | 'hidden') => ({
  id,
  ...(kind ? { kind, glyph: kind } : {}),
  state,
});

export const realm: PlayRealm = {
  id: 'bloodland',
  name: '沉钟泽',
  until: { text: '五月十五', year: 2, month: 5, day: 15 },
  daysLeft: 7,
  depth: 5,
  at: 2,
  exit: false,
  layers: [
    [node('1-1', '险', 'passed'), node('1-2', '宝', 'walked')],
    [node('2-1', '战', 'walked'), node('2-2', '宝', 'passed'), node('2-3', '歇', 'passed')],
    [node('3-1', '秘', 'open'), node('3-2', '宝', 'open'), node('3-3', '险', 'open')],
    [node('4-1', null, 'hidden'), node('4-2', null, 'hidden')],
    [node('5-1', '守', 'hidden')],
  ],
  others: [
    { id: 'C12', name: '苏眉', side: 'mate', layer: 2 },
    { id: 'C13', name: '萧烬', side: 'rival', layer: 4 },
  ],
  taken: [{ name: '照夜芦', count: 1 }],
};

/** past the deepest: the 守 beaten, a rival waiting at the exit */
export const realmOut: PlayRealm = {
  ...realm,
  daysLeft: 1,
  at: 2,
  depth: 2,
  exit: true,
  layers: [
    [node('1-1', '宝', 'walked'), node('1-2', '战', 'passed')],
    [node('2-1', '守', 'walked')],
  ],
  others: [{ id: 'C13', name: '萧烬', side: 'rival', layer: 2 }],
  taken: [
    { name: '照夜芦', count: 1 },
    { name: '月纹菌', count: 2 },
  ],
};

/** After a scene that left something open (the owner's second playtest): a thread first, under 约. */
export const threadHints = [
  { text: '赴齐管事之约：今夜子时，西坊地字号暗巷的闭门小易', kind: 'thread', verb: { kind: 'follow', id: 'T1' } },
  { text: '修为未满（炼气十三层），闭关修炼', kind: 'cultivate', verb: { kind: 'cultivate', full: true } },
] as unknown as NextStep[];

/** 入秘境 at the realm's entrance on 五月初五 (play.place.realm): open, closed till next year, barred. */
export const realmToday: PlayDate = { text: '五月初五', year: 2, month: 5, day: 5 };
export const realmGates: PlaceRealm[] = [
  { id: 'bloodland', name: '沉钟泽', open: true, until: { text: '五月十五', year: 2, month: 5, day: 15 } },
  {
    id: 'bloodland',
    name: '沉钟泽',
    open: false,
    next: { text: '五月初五', year: 3, month: 5, day: 5 },
    off: true,
    note: '沉钟泽眼下没有开启',
  },
  {
    id: 'bloodland',
    name: '沉钟泽',
    open: true,
    until: { text: '五月十五', year: 2, month: 5, day: 15 },
    off: true,
    note: '沉钟泽只许炼气期的人进',
  },
];

export const toxins: PlayToxin[] = [
  { value: 12, cap: 100, marks: [50, 70, 100], effects: [] },
  { value: 58, cap: 100, marks: [50, 70, 100], effects: ['法力上限少一成'] },
  { value: 100, cap: 120, marks: [50, 70, 120], effects: ['法力上限少一成', '修炼慢两成，不再自减'] },
];

// 主线, the reasons on the commands and 接下来 (the first playtest), as the sample set life-town and the
// engine's hints (apps/engine/life/hints.cjs) give them
export const mainline: Mainline = {
  chapter: '第一章 · 市井谋生',
  goal: '在泊灯城攒够二十块灵石，好在城里站住脚。',
  clues: [
    { text: '灵石不少于20', done: false, have: 9, need: 20 },
    { text: '持有聚气散', done: true, have: 1, need: 1 },
    { text: '到达白苇集', done: false },
  ],
  next: '第二章 · 太南之行',
};

/** the last chapter, everything met */
export const mainlineMet: Mainline = {
  chapter: '第三章 · 宗门暗涌',
  goal: '查清藏经阁失窃的真相。',
  clues: [
    { text: '到达青岚山', done: true },
    { text: '持有残卷', done: true, have: 3, need: 3 },
  ],
};

/** a town's commands with 修炼 waiting on an injury: more than a phone's bar holds */
export const townVerbs: PlayVerb[] = [
  { kind: 'cultivate', glyph: '修', label: '修炼', off: true, note: '内伤未愈，还要养八日' },
  { kind: 'rest', glyph: '息', label: '调息' },
  { kind: 'wait', glyph: '候', label: '静候' },
  { kind: 'ask', glyph: '探', label: '打探' },
  { kind: 'job', glyph: '告', label: '差事', main: true },
  { kind: 'trade', glyph: '市', label: '买卖' },
  { kind: 'craft', glyph: '炼', label: '炼制' },
];

/** a scene under way: the days' commands wait, for one reason */
export const sceneVerbs: PlayVerb[] = [
  { kind: 'cultivate', glyph: '修', label: '修炼', off: true, note: '这场戏还没收场' },
  { kind: 'rest', glyph: '息', label: '调息', off: true, note: '这场戏还没收场' },
  { kind: 'wait', glyph: '候', label: '静候', off: true, note: '这场戏还没收场' },
];

export const hints: NextStep[] = [
  { text: '主线·市井谋生（灵石 9/20）：揭告示接「除松灯林的妖兽」，酬十一块', kind: 'main', verb: { kind: 'job', id: '泊灯城·0·0' } },
  { text: '「劫修盯梢」满了', kind: 'clock' },
  { text: '内伤未愈，静候到正月十一', kind: 'injury', verb: { kind: 'wait', until: '0001-01-11' } },
];

// the life's book (章回, gameplay plan item 38), in the engine's words of the samples life-chapter and life-emerge
const day = (year: number, month: number, date: number, text: string) => ({ text, year, month, day: date });

export const couplet = '观云台月下问丹　玄微子石阶许诺';

export const gateVolume: VolumeBlock = {
  id: 'v1',
  type: 'volume',
  no: 1,
  cause: 'gate',
  name: '引气入体',
  since: day(1, 1, 1, '正月初一'),
  until: day(1, 2, 12, '二月十二'),
  annals: [{ date: day(1, 2, 11, '二月十一'), text: '冲击引气入体，成。境界：炼气一层。根基虚浮。' }],
  text: '这一卷，你从青岚山下的穷小子走到了引气入体。灵根是真的，路也是真的，只是山门里的路才刚开头。',
  next: 2,
};

export const eventVolume: VolumeBlock = {
  id: 'v2',
  type: 'volume',
  no: 2,
  cause: 'event',
  name: '魔道六宗入侵云汀湾',
  since: day(1, 2, 12, '二月十二'),
  until: day(29, 1, 3, '正月初三'),
  annals: [
    { date: day(26, 3, 1, '三月初一'), text: '坊间传言，魔道六宗在云汀湾边境集结。' },
    { date: day(28, 3, 1, '三月初一'), text: '魔道六宗大举入侵云汀湾。' },
    { date: day(28, 9, 1, '九月初一'), text: '云汀各院战败，退往远帆埠；魔道六宗占了云汀湾。' },
  ],
  text: '云汀各院战败，退往远帆埠；魔道六宗占了云汀湾',
  next: 3,
};

export const emerge: EmergeBlock = {
  id: 'e1',
  type: 'emerge',
  years: 5,
  since: day(24, 1, 3, '正月初三'),
  until: day(29, 1, 3, '正月初三'),
  lines: [
    { date: day(26, 3, 1, '三月初一'), text: '坊间传言，魔道六宗在云汀湾边境集结。' },
    { date: day(28, 3, 1, '三月初一'), text: '魔道六宗大举入侵云汀湾。' },
    { date: day(28, 3, 3, '三月初三'), text: '白苇集春汀集开市（五次）' },
    { date: day(28, 5, 5, '五月初五'), text: '沉钟泽开启' },
    { date: day(28, 9, 1, '九月初一'), text: '云汀各院战败，退往远帆埠；魔道六宗占了云汀湾。' },
  ],
};

export const book: BookView = {
  volume: 2,
  chapter: 3,
  volumes: [
    {
      no: 1,
      cause: 'gate',
      name: '引气入体',
      since: day(1, 1, 1, '正月初一'),
      until: day(1, 2, 12, '二月十二'),
      text: gateVolume.text,
      turn: 28,
      chapters: [
        { no: 1, turn: 28, title: '破庙夜雨', couplet: '青岚山下逢夜雨　破庙檐前遇仙师' },
        { no: 2, turn: 31, title: '石阶问心', couplet: '千级石阶问道心　一卷长春入玄关' },
      ],
    },
    { no: 2, since: day(1, 2, 12, '二月十二'), turn: 33, chapters: [{ no: 3, turn: 38, title: '石阶上的来客' }] },
  ],
};
