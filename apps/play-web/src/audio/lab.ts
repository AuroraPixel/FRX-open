// The dev-only audio lab (audio-lab.html; the dev server serves it, the build leaves it out): play
// every sound, ambience and mood, move the buses, and measure any of them from an offline render.
// tools/audio-check.mjs drives the same offline renders through window.frxAudioCheck.
import { AMBIENCES } from './ambience';
import { audio, BUS_NAMES, type BusName, type Moment, type SoundHandle } from './index';
import { MOOD_NAMES, type Mood } from './music';
import * as offline from './offline';
import { SOUNDS, type SfxName } from './sounds';

declare global {
  interface Window {
    frxAudioCheck?: typeof offline;
  }
}
window.frxAudioCheck = offline;

const LABELS: Record<string, string> = {
  'ui.tap': '点选',
  'ui.page': '翻页',
  'ui.seal': '落印',
  'ui.receipt': '回执',
  'ui.error': '出错',
  'fx.gather': '聚气',
  'fx.bell': '钟',
  'fx.thunder': '远雷',
  'fx.sword': '剑鸣',
  'fx.dice': '掷骰',
  'fx.formation': '法阵启动',
  'amb.wind': '山风',
  'amb.sea': '海浪',
  'amb.rain': '雨',
  'amb.drip': '洞内滴水',
  'amb.fire': '火',
  'amb.insects': '夜虫',
  calm: '平静',
  tense: '紧张',
  solemn: '庄严',
  combat: '交锋',
  breakthrough: '突破',
  master: '总',
  music: '配乐',
  ambience: '环境',
  sfx: '音效',
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function labelled(name: string | null, caption = name ?? '无'): HTMLButtonElement {
  const button = make('button', LABELS[name ?? ''] ?? '无');
  button.type = 'button';
  if (name) button.append(make('small', caption));
  return button;
}

function section(title: string, ...content: Node[]): HTMLElement {
  const box = make('section');
  box.append(make('h2', title), ...content);
  return box;
}

/** A row of buttons of which exactly one is pressed. */
function oneOf<T extends string>(options: readonly (T | null)[], current: () => T | null, choose: (value: T | null) => void): HTMLElement {
  const row = make('div', '', 'grid');
  const buttons = options.map((option) => {
    const button = labelled(option);
    button.addEventListener('click', () => {
      choose(option);
      refresh();
    });
    row.append(button);
    return [option, button] as const;
  });
  const refresh = (): void => {
    for (const [option, button] of buttons) button.setAttribute('aria-pressed', String(option === current()));
  };
  refresh();
  return row;
}

function busRow(name: BusName): HTMLElement {
  const row = make('div', '', 'bus');
  const slider = make('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.setAttribute('aria-label', `${LABELS[name]}音量`);
  const value = make('span', '', 'status');
  const toggle = make('button');
  toggle.type = 'button';
  const show = (): void => {
    const setting = audio.buses()[name];
    slider.value = String(setting.volume);
    value.textContent = setting.volume.toFixed(2);
    toggle.textContent = setting.on ? '开' : '关';
    toggle.setAttribute('aria-pressed', String(setting.on));
  };
  slider.addEventListener('input', () => audio.setBus(name, { volume: Number(slider.value) }));
  toggle.addEventListener('click', () => audio.setBus(name, { on: !audio.buses()[name].on }));
  audio.onBusesChange(show);
  show();
  row.append(make('span', LABELS[name]), slider, value, toggle);
  return row;
}

function soundButtons(): HTMLElement {
  const row = make('div', '', 'grid');
  const loops = new Map<string, SoundHandle>();
  for (const name of Object.keys(SOUNDS) as SfxName[]) {
    const button = labelled(name, SOUNDS[name].loop ? `${name} · 循环` : name);
    button.addEventListener('click', () => {
      if (!SOUNDS[name].loop) {
        audio.play(name);
        return;
      }
      const playing = loops.get(name);
      if (playing) {
        playing.stop();
        loops.delete(name);
      } else {
        loops.set(name, audio.play(name));
      }
      button.setAttribute('aria-pressed', String(loops.has(name)));
    });
    row.append(button);
  }
  return row;
}

function measurer(): HTMLElement {
  const box = make('div');
  const picker = make('select');
  picker.setAttribute('aria-label', '要测量的声音');
  for (const name of [...Object.keys(SOUNDS), ...Object.keys(AMBIENCES), ...MOOD_NAMES.map((mood) => `music.${mood}`)]) {
    const option = make('option', `${LABELS[name.replace('music.', '')] ?? ''} ${name}`);
    option.value = name;
    picker.append(option);
  }
  const go = make('button', '离线渲染并测量');
  go.type = 'button';
  const result = make('pre');
  const player = make('audio');
  player.controls = true;
  go.addEventListener('click', () => {
    void (async () => {
      go.disabled = true;
      result.textContent = '渲染中…';
      const name = picker.value;
      const rendered = name.startsWith('music.')
        ? await offline.renderMusic({ mood: name.slice(6) as Mood, seconds: 60, volumes: 'default', seed: 1, wavSeconds: 30 })
        : await offline.renderSound({ name, volumes: 'default', seed: 1, hold: name.startsWith('amb.') ? 15 : 7, wav: true });
      const { levels } = rendered;
      result.textContent = [
        `峰值 ${levels.peakDb.toFixed(1)} dBFS，削波 ${levels.clipped} 个样本`,
        `整体响度 ${levels.integrated.toFixed(1)} LUFS`,
        levels.shortTerm
          ? `短时响度 中位 ${levels.shortTerm.median.toFixed(1)}，${levels.shortTerm.min.toFixed(1)} 到 ${levels.shortTerm.max.toFixed(1)} LUFS，响度范围 ${levels.shortTerm.lra.toFixed(1)} LU`
          : '太短，没有短时响度',
      ].join('\n');
      if (rendered.wav) player.src = `data:audio/wav;base64,${rendered.wav}`;
      go.disabled = false;
    })();
  });
  const row = make('div', '', 'grid');
  row.append(picker, go);
  box.append(row, result, player);
  return box;
}

function build(root: HTMLElement): void {
  const status = make('p', '', 'status');
  const showStatus = (): void => {
    const state = audio.status();
    status.textContent = `状态：${{ locked: '等第一次点按', running: '在响', suspended: '已挂起', unsupported: '浏览器不支持' }[state]}`;
  };
  setInterval(showStatus, 400);
  showStatus();
  audio.listenForGestures();
  const moods: (Mood | null)[] = [null, ...MOOD_NAMES];
  const moments: (Moment | null)[] = [null, 'combat', 'breakthrough'];
  root.append(
    make('h1', '声音实验室'),
    make('p', '开发用。第一次点按页面之后才会出声；这里的音量设置和游戏里是同一份。', 'note'),
    status,
    section('总线', ...BUS_NAMES.map(busRow)),
    section('界面音与特效', soundButtons()),
    section('环境声', oneOf([null, ...(Object.keys(AMBIENCES) as (keyof typeof AMBIENCES)[])], () => audio.ambienceName as keyof typeof AMBIENCES | null, (name) => audio.setAmbience(name))),
    section(
      '配乐',
      oneOf(moods, () => moodNow, (mood) => {
        moodNow = mood;
        audio.setMood(mood);
      }),
      make('h2', '临时情绪（交锋、突破）'),
      oneOf(moments, () => momentNow, (moment) => {
        momentNow = moment;
        audio.setMoment(moment);
      }),
    ),
    section('离线测量', measurer()),
  );
}

let moodNow: Mood | null = null;
let momentNow: Moment | null = null;
const root = document.getElementById('lab');
if (root) build(root);
