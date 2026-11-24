/* Runs the old page's functions outside the browser: prompt assembly, memory recall, the work
 * after a turn, panel actions and character creation. The functions and the page's variables
 * are copied out of the page script into core/ (core/index.cjs lists them by name).
 *
 * - take(): the named page functions and values from core/, and glue: functions of the caller
 *   whose source runs in the page's scope, beside the page's own.
 * - open(): a vm context in which the page's closure variables are globals. Functions read and
 *   assign them there; callers set them before a call and read them back after. Every run gets
 *   its own copy of the page's values.
 * - discover: the same code runs inside `with (proxy)`, and every name the context does not
 *   provide is recorded instead of failing, so a sample run lists what a function still needs.
 * - Browser stand-ins: the page's own document (host-dom.cjs), localStorage from the saved
 *   preferences, the settings and archive tables, seeded Math.random and crypto, a fixed clock in
 *   a given locale and time zone, and timers on a virtual clock.
 * - Network: fetch never leaves the process. A request without a given answer is recorded in
 *   `needs` and never settles; the caller fetches the answers and runs again with them.
 */
'use strict';

const vm = require('node:vm');
const { create } = require('./core/random.cjs');
const dom = require('./host-dom.cjs');
const core = require('./core/index.cjs');

/* The pieces of the page a caller runs: page functions and values of core/ by name (the values
 * are the page's variables and constants with their initial values; each run gets its own
 * copy), and glue (host functions whose source runs in the page's scope, beside the page's). */
function take({ functions = [], constants = [], glue = [] }) {
  const fns = functions.map(name => {
    const fn = core.functions.get(name);
    if (!fn) throw new Error(`core/ has no page function named ${name}`);
    return { name, text: fn.toString() };
  });
  const consts = constants.map(name => {
    if (!core.values.has(name)) throw new Error(`core/ has no page value named ${name}`);
    return { name, value: core.values.get(name) };
  });
  return {
    functions: fns, constants: consts, glue,
    names: [...fns.map(f => f.name), ...glue.map(fn => fn.name)],
    declarations: [...fns.map(f => f.text), ...glue.map(fn => fn.toString())].join('\n'),
  };
}

// ---------------------------------------------------------------- stand-ins

// Timers on a virtual clock: they run in order of due time as soon as nothing else can.
function virtualTimers() {
  const queue = [];
  let seq = 0, clock = 0;
  const later = (fn, ms, args) => {
    const id = ++seq;
    queue.push({ id, at: clock + Math.max(0, Number(ms) || 0), seq: id, fn, args });
    return id;
  };
  return {
    queue,
    setTimeout: (fn, ms, ...args) => (typeof fn === 'function' ? later(fn, ms, args) : 0),
    clearTimeout: id => { const at = queue.findIndex(t => t.id === id); if (at >= 0) queue.splice(at, 1); },
    // Repeating timers only drive the page's own displays; they never fire here.
    setInterval: () => ++seq,
    clearInterval: () => {},
    requestAnimationFrame: fn => later(fn, 16, [clock + 16]),
    cancelAnimationFrame: id => { const at = queue.findIndex(t => t.id === id); if (at >= 0) queue.splice(at, 1); },
    next() {
      if (!queue.length) return null;
      queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const timer = queue.shift();
      clock = timer.at;
      return timer;
    },
  };
}

function storage(entries = {}) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k, String(v)]));
  return {
    getItem: key => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: key => { map.delete(String(key)); },
    clear: () => map.clear(),
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    entries: () => Object.fromEntries(map),
  };
}

// Code that runs inside the context: the clock, the locale and an in-realm structuredClone.
const REALM_SETUP = `
(() => {
  const RealDate = Date;
  const fixed = __clock.now;
  function FixedDate(...args) {
    if (!new.target) return new RealDate(fixed).toString();
    return Reflect.construct(RealDate, args.length ? args : [fixed], new.target);
  }
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = () => fixed;
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  globalThis.Date = FixedDate;
  for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    const original = RealDate.prototype[method];
    RealDate.prototype[method] = function (locales, options) {
      return original.call(this, locales ?? __clock.locale, { timeZone: __clock.timeZone, ...(options || {}) });
    };
  }
  const numberLocale = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (locales, options) { return numberLocale.call(this, locales ?? __clock.locale, options); };
  const DateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (locales, options) {
    return new DateTimeFormat(locales ?? __clock.locale, { timeZone: __clock.timeZone, ...(options || {}) });
  };
  Intl.DateTimeFormat.prototype = DateTimeFormat.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = DateTimeFormat.supportedLocalesOf;
  globalThis.structuredClone = function structuredClone(value) {
    const seen = new Map();
    const copy = item => {
      if (item === null || typeof item !== 'object') {
        if (typeof item === 'function' || typeof item === 'symbol') throw new TypeError('could not be cloned');
        return item;
      }
      if (seen.has(item)) return seen.get(item);
      let out;
      if (Array.isArray(item)) { out = []; seen.set(item, out); item.forEach((x, i) => { out[i] = copy(x); }); return out; }
      if (item instanceof RealDate) return new RealDate(item.getTime());
      if (item instanceof RegExp) return new RegExp(item.source, item.flags);
      if (item instanceof Map) { out = new Map(); seen.set(item, out); item.forEach((v, k) => out.set(copy(k), copy(v))); return out; }
      if (item instanceof Set) { out = new Set(); seen.set(item, out); item.forEach(v => out.add(copy(v))); return out; }
      out = {};
      seen.set(item, out);
      for (const key of Object.keys(item)) out[key] = copy(item[key]);
      return out;
    };
    return copy(value);
  };
})();
`;

// AbortSignal on the virtual clock: a timeout never fires, since nothing here waits for real.
function abortStandIns() {
  class Signal {
    constructor() { this.aborted = false; this.reason = undefined; this.listeners = []; this.onabort = null; }
    addEventListener(type, fn) { if (type === 'abort') this.listeners.push(fn); }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(each => each !== fn); }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    abort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      for (const fn of [this.onabort, ...this.listeners]) if (fn) fn({ type: 'abort', target: this });
    }
    static timeout() { return new Signal(); }
    static abort(reason) { const signal = new Signal(); signal.abort(reason); return signal; }
    static any(signals) {
      const signal = new Signal();
      for (const each of signals) {
        if (each.aborted) { signal.abort(each.reason); break; }
        each.addEventListener('abort', () => signal.abort(each.reason));
      }
      return signal;
    }
  }
  class Controller {
    constructor() { this.signal = new Signal(); }
    abort(reason) { this.signal.abort(reason); }
  }
  return { AbortSignal: Signal, AbortController: Controller };
}

// A canonical key for a network request, so an answer given by the caller finds its request.
function requestKey(url, init = {}) {
  let address = String(url);
  try { address = new URL(address, 'http://page.local').pathname; } catch { /* keep as is */ }
  let body = init.body ?? null;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep the text */ } }
  return JSON.stringify([String(init.method || 'GET').toUpperCase(), address, body]);
}

function responseOf(answer) {
  const status = answer.status ?? 200;
  const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? null);
  return {
    ok: status >= 200 && status < 300, status, statusText: String(status),
    headers: { get: name => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/* A vm context for one run. Options:
 *   env          closure variables of the page, set in the context before anything runs
 *   stubs        names of page functions that do nothing here: messages to the player the caller
 *                does not show, and work after a turn that is not carried over
 *   settings     the settings table (key → value), behind db.settings and the page's dbGet
 *   archive      the save behind db.archives; writes to it are kept and listed in `writes`
 *   vectors      the memory records behind db.vectors
 *   preferences  the localStorage mirror the page keeps in settings
 *   answers      network answers by requestKey; requests without one are listed in `needs`
 *   seed, now, locale, timeZone, frx (fields of window.FRX), discover
 */
function open(page, options = {}) {
  const missing = new Set();
  const needs = [];
  const writes = { settings: [], archives: [] };
  const errors = [];
  const variables = {};
  const timers = virtualTimers();
  // Math.random and crypto draw from streams of their own, as they are independent in a browser.
  const random = create(String(options.seed ?? 'frx'));
  const ids = create(String(options.seed ?? 'frx') + ':uuid');
  const answers = options.answers || {};
  const settings = new Map(Object.entries(options.settings || {}));
  let archive = options.archive ? JSON.stringify(options.archive) : null;
  const document = dom.createDocument();
  const sandbox = {};
  const context = vm.createContext(sandbox);
  const realmJSON = vm.runInContext('JSON', context);
  const inRealm = value => (value === undefined ? undefined : realmJSON.parse(JSON.stringify(value)));
  const math = vm.runInContext('Object.create(Math)', context);
  math.random = random.random;
  const realmPromise = vm.runInContext('Promise', context);
  const never = () => new realmPromise(() => {});
  const fetch = async (url, init = {}) => {
    const key = requestKey(url, init);
    if (Object.hasOwn(answers, key)) return responseOf(answers[key]);
    if (!needs.some(need => need.key === key)) needs.push({ key, url: String(url), method: String(init.method || 'GET').toUpperCase(), body: init.body ?? null });
    return never();
  };
  const table = name => ({
    known: new Map(),
    async get(key) {
      if (name === 'settings') return settings.has(String(key)) ? inRealm({ key: String(key), value: settings.get(String(key)) }) : undefined;
      if (name === 'archives') {
        if (!archive) return undefined;
        const value = realmJSON.parse(archive);
        return value.name === String(key) ? value : undefined;
      }
      return undefined;
    },
    async put(value) {
      const copy = JSON.parse(JSON.stringify(value));
      if (name === 'settings') { settings.set(String(copy.key), copy.value); writes.settings.push(copy); return copy.key; }
      if (name === 'archives') { archive = JSON.stringify(copy); writes.archives.push(copy); return copy.name; }
      return undefined;
    },
    async toArray() {
      if (name === 'vectors') return inRealm(options.vectors || []);
      if (name === 'settings') return inRealm([...settings].map(([key, value]) => ({ key, value })));
      if (name === 'archives') return archive ? [realmJSON.parse(archive)] : [];
      return inRealm([]);
    },
    async count() { return (await this.toArray()).length; },
  });
  const db = { archives: table('archives'), settings: table('settings'), vectors: table('vectors') };
  const frx = {
    clearVariables() { for (const key of Object.keys(variables)) delete variables[key]; },
    random: random.random, uuid: random.uuid,
    ...(options.frx || {}),
  };
  const standIns = {
    ...abortStandIns(),
    console: {
      log() {}, info() {}, debug() {}, warn() {}, group() {}, groupEnd() {}, groupCollapsed() {}, table() {}, time() {}, timeEnd() {},
      error: (...args) => errors.push(args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 500)),
    },
    document,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    Element: dom.Element,
    HTMLElement: dom.Element,
    Text: dom.Text,
    DocumentFragment: dom.DocumentFragment,
    localStorage: storage(options.preferences),
    sessionStorage: storage(),
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', language: options.locale || 'zh-CN', languages: [options.locale || 'zh-CN'], clipboard: { writeText: async () => {} }, onLine: true },
    location: { origin: 'http://127.0.0.1', href: 'http://127.0.0.1/', pathname: '/', search: '', hash: '', protocol: 'http:', host: '127.0.0.1', reload() {} },
    innerWidth: 1280, innerHeight: 1000, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getComputedStyle: element => element?.style || {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    Audio: class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} },
    Option: function Option(text = '', value, defaultSelected, selected) {
      const option = document.createElement('option');
      option.textContent = String(text);
      if (value !== undefined) option.setAttribute('value', String(value));
      if (defaultSelected) option.setAttribute('selected', '');
      if (selected) option.selected = true;
      return option;
    },
    Image: function Image() { return document.createElement('img'); },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class { constructor(type) { this.type = type; } preventDefault() {} stopPropagation() {} },
    Math: math,
    crypto: {
      randomUUID: ids.uuid,
      getRandomValues: array => { for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(ids.random() * 256); return array; },
    },
    fetch,
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob,
    queueMicrotask,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    requestAnimationFrame: timers.requestAnimationFrame, cancelAnimationFrame: timers.cancelAnimationFrame,
    requestIdleCallback: fn => timers.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1),
    db,
    FRX: frx,
    toastr: { success() {}, info() {}, warning() {}, error() {}, clear() {}, remove() {}, options: {} },
    insertOrAssignVariables: async value => { Object.assign(variables, JSON.parse(JSON.stringify(value))); },
    __clock: { now: Number(options.now ?? 0), locale: options.locale || 'zh-CN', timeZone: options.timeZone || 'Asia/Shanghai' },
  };
  const noop = () => {};
  for (const name of options.stubs || []) standIns[name] = noop;

  const discover = !!options.discover;
  let scope = null;
  if (discover) {
    // Free names of the taken code go through this proxy: the page's variables and stand-ins
    // first, then the built-ins of the context; anything else is a missing dependency, handed
    // out as a function that does nothing so one run lists them all.
    const env = {};
    const realm = vm.runInContext('globalThis', context);
    const placeholders = new Map();
    scope = new Proxy(env, {
      has: () => true,
      get(target, name) {
        if (typeof name === 'symbol') return undefined;
        if (Object.hasOwn(target, name)) return target[name];
        if (name in realm) return realm[name];
        missing.add(name);
        if (!placeholders.has(name)) placeholders.set(name, () => { missing.add(name + '()'); });
        return placeholders.get(name);
      },
      set(target, name, value) { target[name] = value; return true; },
    });
    Object.assign(sandbox, standIns);
    sandbox.window = sandbox.globalThis = sandbox.self = sandbox.parent = sandbox.top = realm;
    sandbox.__scope = scope;
    vm.runInContext(REALM_SETUP, context);
    const exported = page.names.map(name => `${name}: ${name}`).join(', ');
    vm.runInContext(`var __page = (function () { with (__scope) { return (function () {\n${page.declarations}\n`
      + `return { ${exported} };\n})(); } })();`, context, { filename: 'page.js' });
    Object.assign(env, vm.runInContext('__page', context));
  } else {
    Object.assign(sandbox, standIns);
    const realm = vm.runInContext('globalThis', context);
    sandbox.window = sandbox.self = sandbox.parent = sandbox.top = realm;
    vm.runInContext(REALM_SETUP, context);
    const declared = page.constants.length ? `\nvar ${page.constants.map(constant => constant.name).join(', ')};` : '';
    vm.runInContext(`${page.declarations}${declared}`, context, { filename: 'page.js' });
  }

  const evaluate = expression => vm.runInContext(discover ? `(function () { with (__scope) { return (${expression}); } })()` : expression, context);
  const set = (name, value) => {
    sandbox.__value = inRealm(value);
    evaluate(`${name} = __value`);
  };
  // The page's values: this run's own copies, made in the page's realm (in discovery they land
  // in the scope object).
  const RealmMap = vm.runInContext('Map', context);
  const RealmSet = vm.runInContext('Set', context);
  for (const constant of page.constants) {
    const { value } = constant;
    sandbox.__value = value instanceof Map ? new RealmMap(inRealm([...value]))
      : value instanceof Set ? new RealmSet(inRealm([...value])) : inRealm(value);
    evaluate(`${constant.name} = __value`);
  }
  const get = name => {
    const text = evaluate(`JSON.stringify(${name})`);
    return text === undefined ? undefined : JSON.parse(text);
  };
  for (const [name, value] of Object.entries(options.env || {})) set(name, value);

  // Wait for a promise of the page while the virtual clock runs; a run that waits on an
  // unanswered request (or anything else that never comes) stops with done: false.
  async function settle(promise) {
    let state = 'pending', value, failure;
    Promise.resolve(promise).then(result => { state = 'done'; value = result; }, error => { state = 'failed'; failure = error; });
    for (let step = 0; step < 100000; step += 1) {
      await new Promise(resolve => setImmediate(resolve));
      if (state !== 'pending') break;
      const timer = timers.next();
      if (!timer) break;
      try { timer.fn(...timer.args); } catch (error) { errors.push(String(error?.message || error).slice(0, 500)); }
    }
    if (state === 'failed') throw failure;
    return { done: state === 'done', value };
  }

  return {
    context,
    set,
    get,
    evaluate,
    // Call a page function; arguments and the result cross as JSON.
    async call(name, ...args) {
      sandbox.__args = inRealm(args);
      const result = await settle(evaluate(`${name}(...__args)`));
      return { done: result.done, value: result.value === undefined ? undefined : JSON.parse(JSON.stringify(result.value) ?? 'null') };
    },
    get missing() { return [...missing].sort(); },
    needs,
    writes,
    errors,
    variables,
    localStorage: standIns.localStorage,
    get archive() { return archive ? JSON.parse(archive) : null; },
  };
}

module.exports = { take, open, requestKey };
