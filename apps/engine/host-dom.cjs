/* The page's document for the old page's functions in core/ (see host.cjs).
 *
 * The old page turns HTML into text through the DOM: `div.innerHTML = log; div.textContent`
 * for the history in every prompt, and a whole walk over the daily paper's markup. Node has no
 * DOM, so this is a small one that follows the HTML standard where those results depend on it:
 * the tokenizer (character references, raw text and RCDATA elements, comments, tags cut off
 * at the end), the in-body tree rules that decide nesting, serialization, simple selectors and
 * a text tree walker. Tables are not foster-parented and formatting elements are not
 * reconstructed; neither changes the text of the markup the page feeds it.
 *
 * The document itself is empty: the functions in core/ no longer draw the page, so they look up
 * none of its elements (the one read left, the daily paper's fallback for the time display,
 * finds nothing, as it found the page's empty element). html-entities.json is the standard's
 * table of named character references (Python's html.entities.html5).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENTITIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'html-entities.json'), 'utf8'));
const LONGEST_ENTITY = Math.max(...Object.keys(ENTITIES).map(name => name.length));

const VOID = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
  'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'script']);
const RCDATA = new Set(['textarea', 'title']);
const RAW_SERIALIZED = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search',
  'section', 'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'plaintext', 'table',
  'hr', 'xmp']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SPECIAL = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote',
  'body', 'br', 'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link', 'listing', 'main',
  'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext',
  'pre', 'script', 'search', 'section', 'select', 'source', 'style', 'summary', 'table', 'tbody', 'td', 'template',
  'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp']);
const SCOPE_LIMITS = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
const BLOCK_END = new Set(['address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir',
  'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'listing', 'main', 'menu',
  'nav', 'ol', 'pre', 'search', 'section', 'summary', 'ul', 'applet', 'marquee', 'object']);
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong',
  'tt', 'u']);
const FOREIGN_BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt',
  'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta',
  'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul',
  'var']);
// Windows-1252 for the C1 range, as numeric character references are read.
const C1 = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
  0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
  0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
  0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};
const SVG_NAMES = Object.fromEntries(['altGlyph', 'altGlyphDef', 'altGlyphItem', 'animateColor', 'animateMotion',
  'animateTransform', 'clipPath', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
  'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'foreignObject', 'glyphRef', 'linearGradient', 'radialGradient', 'textPath'].map(name => [name.toLowerCase(), name]));

const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isAlnum = c => isAlpha(c) || (c >= '0' && c <= '9');
const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\f';
const lower = s => s.replace(/[A-Z]+/g, m => m.toLowerCase());

// A character reference starting at `at` (just after '&'): [text, length consumed] or null.
function characterReference(input, at, inAttribute) {
  if (input[at] === '#') {
    const hex = input[at + 1] === 'x' || input[at + 1] === 'X';
    const digits = hex ? /^[0-9a-fA-F]+/ : /^[0-9]+/;
    const start = at + (hex ? 2 : 1);
    const match = input.slice(start, start + 64).match(digits);
    if (!match) return null;
    let end = start + match[0].length;
    while (end < input.length && digits.test(input[end])) end += 1;
    let code = parseInt(input.slice(start, end), hex ? 16 : 10);
    if (input[end] === ';') end += 1;
    if (!Number.isFinite(code) || code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) code = 0xFFFD;
    else if (C1[code]) code = C1[code];
    return [String.fromCodePoint(code), end - at];
  }
  for (let length = Math.min(LONGEST_ENTITY, input.length - at); length > 0; length -= 1) {
    const name = input.slice(at, at + length);
    if (!Object.hasOwn(ENTITIES, name)) continue;
    const next = input[at + length];
    if (inAttribute && !name.endsWith(';') && next !== undefined && (next === '=' || isAlnum(next))) return null;
    return [ENTITIES[name], length];
  }
  return null;
}

function decode(text, inAttribute = false) {
  if (!text.includes('&')) return text;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '&') { out += text[i]; continue; }
    const reference = characterReference(text, i + 1, inAttribute);
    if (!reference) { out += '&'; continue; }
    out += reference[0];
    i += reference[1];
  }
  return out;
}

// ---------------------------------------------------------------- nodes

class Node {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get nextSibling() { const list = this.parentNode?.childNodes; return list ? list[list.indexOf(this) + 1] || null : null; }
  get previousSibling() { const list = this.parentNode?.childNodes; return list ? list[list.indexOf(this) - 1] || null : null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get childElementCount() { return this.children.length; }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.data;
    let text = '';
    for (const node of walk(this)) if (node.nodeType === 3) text += node.data;
    return text;
  }
  set textContent(value) {
    if (this.nodeType === 3 || this.nodeType === 8) { this.data = String(value ?? ''); return; }
    this.replaceChildren();
    const text = String(value ?? '');
    if (text) this.appendChild(new Text(text, this.ownerDocument));
  }
  get nodeValue() { return this.nodeType === 3 || this.nodeType === 8 ? this.data : null; }
  set nodeValue(value) { if (this.nodeType === 3 || this.nodeType === 8) this.data = String(value ?? ''); }
  hasChildNodes() { return this.childNodes.length > 0; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    const nodes = node.nodeType === 11 ? [...node.childNodes] : [node];
    for (const each of nodes) {
      each.parentNode?.removeChild(each);
      const index = reference ? this.childNodes.indexOf(reference) : -1;
      if (index < 0) this.childNodes.push(each); else this.childNodes.splice(index, 0, each);
      each.parentNode = this;
    }
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(node, old) { this.insertBefore(node, old); return this.removeChild(old); }
  remove() { this.parentNode?.removeChild(this); }
  append(...nodes) { for (const node of nodes) this.appendChild(asNode(node, this.ownerDocument)); }
  prepend(...nodes) { const first = this.firstChild; for (const node of nodes) this.insertBefore(asNode(node, this.ownerDocument), first); }
  before(...nodes) { for (const node of nodes) this.parentNode?.insertBefore(asNode(node, this.ownerDocument), this); }
  after(...nodes) { const next = this.nextSibling; for (const node of nodes) this.parentNode?.insertBefore(asNode(node, this.ownerDocument), next); }
  replaceWith(...nodes) { const parent = this.parentNode; if (!parent) return; for (const node of nodes) parent.insertBefore(asNode(node, this.ownerDocument), this); this.remove(); }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) this.removeChild(node); this.append(...nodes); }
  cloneNode(deep = false) {
    let copy;
    if (this.nodeType === 3) copy = new Text(this.data, this.ownerDocument);
    else if (this.nodeType === 8) copy = new Comment(this.data, this.ownerDocument);
    else if (this.nodeType === 11) copy = new DocumentFragment(this.ownerDocument);
    else {
      copy = new Element(this.localName, this.ownerDocument, this.namespace);
      copy.attributesList = this.attributesList.map(([name, value]) => [name, value]);
      if (this.content) copy.content = this.content.cloneNode(true);
    }
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}
Object.assign(Node, { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11 });

class Text extends Node {
  constructor(data, ownerDocument) { super(3, ownerDocument); this.data = data; }
  get nodeName() { return '#text'; }
  get wholeText() { return this.data; }
}

class Comment extends Node {
  constructor(data, ownerDocument) { super(8, ownerDocument); this.data = data; }
  get nodeName() { return '#comment'; }
}

class DocumentFragment extends Node {
  constructor(ownerDocument) { super(11, ownerDocument); }
  get nodeName() { return '#document-fragment'; }
  querySelector(selector) { return select(this, selector, true)[0] || null; }
  querySelectorAll(selector) { return select(this, selector, false); }
  getElementById(id) { return find(this, node => node.nodeType === 1 && node.getAttribute('id') === id); }
}

function asNode(value, ownerDocument) {
  return value instanceof Node ? value : new Text(String(value), ownerDocument);
}

// Every node below `root` in tree order; a template's contents are not its children.
function* walk(root) {
  for (const child of root.childNodes) {
    yield child;
    yield* walk(child);
  }
}

function find(root, test) {
  for (const node of walk(root)) if (test(node)) return node;
  return null;
}

class ClassList {
  constructor(element) { this.element = element; }
  get names() { return (this.element.getAttribute('class') || '').split(/[ \t\n\f\r]+/).filter(Boolean); }
  write(names) { this.element.setAttribute('class', names.join(' ')); }
  contains(name) { return this.names.includes(name); }
  add(...names) { const list = this.names; for (const name of names) if (!list.includes(name)) list.push(name); this.write(list); }
  remove(...names) { if (this.element.hasAttribute('class')) this.write(this.names.filter(name => !names.includes(name))); }
  toggle(name, force) {
    const has = this.contains(name);
    const want = force === undefined ? !has : !!force;
    if (want && !has) this.add(name);
    if (!want && has) this.remove(name);
    return want;
  }
  replace(old, name) { if (!this.contains(old)) return false; this.write(this.names.map(n => (n === old ? name : n))); return true; }
  get length() { return this.names.length; }
  item(index) { return this.names[index] ?? null; }
  forEach(fn) { this.names.forEach(fn); }
  [Symbol.iterator]() { return this.names[Symbol.iterator](); }
  toString() { return this.names.join(' '); }
  get value() { return this.element.getAttribute('class') || ''; }
}

// Inline style as the style attribute, the way the page reads it back with getAttribute.
function styleOf(element) {
  const read = () => {
    const declarations = new Map();
    for (const part of (element.getAttribute('style') || '').split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    return declarations;
  };
  const write = declarations => element.setAttribute('style',
    [...declarations].map(([name, value]) => `${name}: ${value};`).join(' '));
  const css = name => name.startsWith('--') ? name : name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const methods = {
    setProperty: (name, value) => { const d = read(); if (value === '' || value === null) d.delete(name); else d.set(name, String(value)); write(d); },
    getPropertyValue: name => read().get(name) || '',
    removeProperty: name => { const d = read(); const old = d.get(name) || ''; d.delete(name); write(d); return old; },
  };
  return new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (methods[name]) return methods[name];
      if (name === 'cssText') return element.getAttribute('style') || '';
      if (name === 'length') return read().size;
      return read().get(css(name)) || '';
    },
    set(_, name, value) {
      if (name === 'cssText') { element.setAttribute('style', String(value)); return true; }
      methods.setProperty(css(String(name)), value);
      return true;
    },
  });
}

function datasetOf(element) {
  const attribute = name => 'data-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  return new Proxy({}, {
    get(_, name) { return typeof name === 'string' ? element.getAttribute(attribute(name)) ?? undefined : undefined; },
    set(_, name, value) { element.setAttribute(attribute(String(name)), String(value)); return true; },
    deleteProperty(_, name) { element.removeAttribute(attribute(String(name))); return true; },
    has(_, name) { return typeof name === 'string' && element.hasAttribute(attribute(name)); },
  });
}

class Element extends Node {
  constructor(localName, ownerDocument, namespace = 'html') {
    super(1, ownerDocument);
    this.localName = localName;
    this.namespace = namespace;
    this.attributesList = [];
    if (localName === 'template' && namespace === 'html') this.content = new DocumentFragment(ownerDocument);
  }
  get tagName() { return this.namespace === 'html' ? this.localName.toUpperCase() : this.localName; }
  get nodeName() { return this.tagName; }
  get attributes() { return this.attributesList.map(([name, value]) => ({ name, value })); }
  getAttribute(name) {
    const key = this.namespace === 'html' ? lower(String(name)) : String(name);
    const found = this.attributesList.find(([n]) => n === key);
    return found ? found[1] : null;
  }
  setAttribute(name, value) {
    const key = this.namespace === 'html' ? lower(String(name)) : String(name);
    const found = this.attributesList.find(([n]) => n === key);
    if (found) found[1] = String(value); else this.attributesList.push([key, String(value)]);
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) {
    const key = this.namespace === 'html' ? lower(String(name)) : String(name);
    this.attributesList = this.attributesList.filter(([n]) => n !== key);
  }
  toggleAttribute(name, force) {
    const want = force === undefined ? !this.hasAttribute(name) : !!force;
    if (want) { if (!this.hasAttribute(name)) this.setAttribute(name, ''); } else this.removeAttribute(name);
    return want;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get classList() { return new ClassList(this); }
  get style() { return styleOf(this); }
  set style(value) { this.setAttribute('style', String(value)); }
  get dataset() { return datasetOf(this); }
  get title() { return this.getAttribute('title') || ''; }
  set title(value) { this.setAttribute('title', value); }
  get src() { return this.getAttribute('src') || ''; }
  set src(value) { this.setAttribute('src', value); }
  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  get name() { return this.getAttribute('name') || ''; }
  set name(value) { this.setAttribute('name', value); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  set placeholder(value) { this.setAttribute('placeholder', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { this.toggleAttribute('hidden', !!value); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', !!value); }
  // Form controls keep a value of their own once it is set, as the page sees them.
  get type() {
    if (this.localName === 'textarea') return 'textarea';
    if (this.localName === 'select') return this.hasAttribute('multiple') ? 'select-multiple' : 'select-one';
    if (this.localName === 'button') return lower(this.getAttribute('type') || 'submit');
    return lower(this.getAttribute('type') || 'text');
  }
  set type(value) { this.setAttribute('type', value); }
  get value() {
    if (this.dirtyValue !== undefined) return this.dirtyValue;
    if (this.localName === 'textarea') return this.textContent;
    if (this.localName === 'select') {
      const options = this.querySelectorAll('option');
      const chosen = options.find(o => o.hasAttribute('selected')) || options[0];
      return chosen ? chosen.value : '';
    }
    if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent.replace(/[ \t\n\f\r]+/g, ' ').trim();
    if (this.localName === 'input' && ['checkbox', 'radio'].includes(this.type)) return this.getAttribute('value') ?? 'on';
    return this.getAttribute('value') ?? '';
  }
  set value(value) { this.dirtyValue = String(value ?? ''); }
  get checked() { return this.dirtyChecked ?? this.hasAttribute('checked'); }
  set checked(value) { this.dirtyChecked = !!value; }
  get selected() { return this.dirtySelected ?? this.hasAttribute('selected'); }
  set selected(value) { this.dirtySelected = !!value; }
  get options() { return this.querySelectorAll('option'); }
  add(option, before = null) { this.insertBefore(option, typeof before === 'number' ? this.options[before] || null : before); }
  get selectedIndex() { const options = this.options; const index = options.findIndex(o => o.selected); return options.length ? Math.max(index, 0) : -1; }
  set selectedIndex(index) { this.options.forEach((o, i) => { o.selected = i === Number(index); }); }
  get innerHTML() { return serializeChildren(this.content || this); }
  set innerHTML(html) {
    const target = this.content || this;
    target.replaceChildren();
    for (const node of parseFragment(String(html ?? ''), this)) target.appendChild(node);
  }
  get outerHTML() { return serializeNode(this); }
  set outerHTML(html) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const node of parseFragment(String(html ?? ''), parent.nodeType === 1 ? parent : this)) parent.insertBefore(node, this);
    this.remove();
  }
  get innerText() { return this.textContent; }
  // The standard's "set the inner text": each line break becomes a <br>.
  set innerText(value) {
    this.replaceChildren();
    const lines = String(value ?? '').split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
      if (index) this.appendChild(new Element('br', this.ownerDocument));
      if (line) this.appendChild(new Text(line, this.ownerDocument));
    });
  }
  get outerText() { return this.innerText; }
  insertAdjacentHTML(position, html) {
    const nodes = parseFragment(String(html ?? ''), this);
    const where = String(position).toLowerCase();
    for (const node of where === 'afterbegin' ? nodes.reverse() : nodes) {
      if (where === 'beforebegin') this.parentNode?.insertBefore(node, this);
      else if (where === 'afterend') this.parentNode?.insertBefore(node, this.nextSibling);
      else if (where === 'afterbegin') this.insertBefore(node, this.firstChild);
      else this.appendChild(node);
    }
  }
  insertAdjacentElement(position, element) {
    const where = String(position).toLowerCase();
    if (where === 'beforebegin') this.parentNode?.insertBefore(element, this);
    else if (where === 'afterend') this.parentNode?.insertBefore(element, this.nextSibling);
    else if (where === 'afterbegin') this.insertBefore(element, this.firstChild);
    else this.appendChild(element);
    return element;
  }
  insertAdjacentText(position, text) { this.insertAdjacentElement(position, new Text(String(text), this.ownerDocument)); }
  querySelector(selector) { return select(this, selector, true)[0] || null; }
  querySelectorAll(selector) { return select(this, selector, false); }
  getElementsByTagName(name) { return select(this, name, false); }
  getElementsByClassName(names) { return select(this, String(names).trim().split(/\s+/).map(n => '.' + n).join(''), false); }
  matches(selector) { return parseSelectors(selector).some(complex => matchesComplex(this, complex, null)); }
  closest(selector) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n; return null; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get offsetTop() { return 0; }
  get offsetLeft() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }
  focus() {}
  blur() {}
  click() {}
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  showModal() {}
  close() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  getContext() { return null; }
  attachShadow() { return new DocumentFragment(this.ownerDocument); }
}

// ---------------------------------------------------------------- parsing

// The children of `context` after setting its innerHTML to `html`.
function parseFragment(html, context) {
  const owner = context?.ownerDocument || null;
  const root = new Element(context?.localName || 'div', owner, context?.namespace || 'html');
  const input = html.replace(/\r\n?/g, '\n');
  const stack = [root];
  const current = () => stack.at(-1);
  const insert = node => {
    const parent = current();
    (parent.content || parent).appendChild(node);
  };
  const text = data => {
    if (!data) return;
    const parent = current().content || current();
    const last = parent.lastChild;
    if (last && last.nodeType === 3) last.data += data; else parent.appendChild(new Text(data, owner));
  };
  const inScope = (test, limits = []) => {
    const matches = typeof test === 'string' ? node => node.localName === test : test;
    for (let i = stack.length - 1; i > 0; i -= 1) {
      if (stack[i].namespace === 'html' && matches(stack[i])) return i;
      if (stack[i].namespace === 'html' && (SCOPE_LIMITS.has(stack[i].localName) || limits.includes(stack[i].localName))) return -1;
    }
    return -1;
  };
  const closeP = () => { const at = inScope('p'); if (at > 0) stack.length = at; };
  let pos = 0;
  let skipNewline = false;
  // Raw text and RCDATA run to the matching end tag; plaintext runs to the end.
  const rawUntil = (name, rcdata) => {
    const pattern = new RegExp(`</${name}(?=[\\t\\n\\f />])`, 'i');
    const rest = input.slice(pos);
    const match = rest.match(pattern);
    const end = match ? match.index : rest.length;
    let body = rest.slice(0, end).replace(/\0/g, '�');
    if (skipNewline && body.startsWith('\n')) body = body.slice(1);
    skipNewline = false;
    text(rcdata ? decode(body) : body);
    pos += end;
    if (!match) return;
    const close = input.indexOf('>', pos);
    pos = close < 0 ? input.length : close + 1;
    stack.pop();
  };
  // Inside these foreign elements, tags are read as HTML again.
  const integrationPoint = node => (node.namespace === 'svg' && ['foreignObject', 'desc', 'title'].includes(node.localName))
    || (node.namespace === 'math' && ['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml'].includes(node.localName));
  const startTag = (rawName, attributes, selfClosing) => {
    let name = rawName === 'image' ? 'img' : rawName;
    if (current().namespace !== 'html' && current() !== root && !integrationPoint(current())) {
      const breakout = FOREIGN_BREAKOUT.has(name)
        || (name === 'font' && attributes.some(([n]) => ['color', 'face', 'size'].includes(n)));
      if (!breakout) {
        const element = new Element(current().namespace === 'svg' ? SVG_NAMES[name] || name : name, owner, current().namespace);
        element.attributesList = attributes;
        insert(element);
        if (!selfClosing) stack.push(element);
        return;
      }
      while (stack.length > 1 && current().namespace !== 'html') stack.pop();
    }
    if (['html', 'body', 'head', 'frameset'].includes(name)) return;
    if (CLOSES_P.has(name)) closeP();
    if (HEADINGS.has(name) && HEADINGS.has(current().localName)) stack.pop();
    if (name === 'li' || name === 'dd' || name === 'dt') {
      const siblings = name === 'li' ? ['li'] : ['dd', 'dt'];
      for (let i = stack.length - 1; i > 0; i -= 1) {
        const node = stack[i];
        if (siblings.includes(node.localName)) { stack.length = i; break; }
        if (SPECIAL.has(node.localName) && !['address', 'div', 'p'].includes(node.localName)) break;
      }
      closeP();
    }
    if (name === 'a') { const at = stack.findLastIndex(n => n.localName === 'a'); if (at > 0) stack.length = at; }
    if (name === 'button') { const at = inScope('button'); if (at > 0) stack.length = at; }
    if (name === 'option' && current().localName === 'option') stack.pop();
    const namespace = name === 'svg' ? 'svg' : name === 'math' ? 'math' : 'html';
    const element = new Element(name, owner, namespace);
    element.attributesList = attributes;
    insert(element);
    if (namespace !== 'html') { if (!selfClosing) stack.push(element); return; }
    if (VOID.has(name)) return;
    stack.push(element);
    if (name === 'pre' || name === 'listing' || name === 'textarea') skipNewline = true;
    if (name === 'plaintext') { text(input.slice(pos).replace(/\0/g, '�')); pos = input.length; return; }
    if (RAWTEXT.has(name)) rawUntil(name, false);
    else if (RCDATA.has(name)) rawUntil(name, true);
  };
  // End tags close what is in scope; a formatting element closed around an open block leaves
  // the block open, which is where the adoption agency puts the text that follows.
  const endTag = name => {
    if (current() !== root && current().namespace !== 'html') {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].namespace === 'html') break;
        if (lower(stack[i].localName) === name) { stack.length = i; return; }
      }
    }
    if (name === 'br') { startTag('br', [], false); return; }
    if (name === 'body' || name === 'html') return;
    const closeTo = at => { if (at > 0) stack.length = at; };
    if (name === 'p') {
      if (inScope('p', ['button']) < 0) { startTag('p', [], false); stack.pop(); return; }
      closeTo(inScope('p', ['button']));
      return;
    }
    if (name === 'li') { closeTo(inScope('li', ['ol', 'ul'])); return; }
    if (name === 'dd' || name === 'dt') { closeTo(inScope(name)); return; }
    if (HEADINGS.has(name)) { closeTo(inScope(node => HEADINGS.has(node.localName))); return; }
    if (BLOCK_END.has(name)) { closeTo(inScope(name)); return; }
    if (FORMATTING.has(name)) {
      const at = stack.findLastIndex(node => node.localName === name && node.namespace === 'html');
      if (at <= 0) return;
      if (stack.slice(at + 1).some(node => node.namespace === 'html' && SPECIAL.has(node.localName))) stack.splice(at, 1);
      else stack.length = at;
      return;
    }
    for (let i = stack.length - 1; i > 0; i -= 1) {
      const node = stack[i];
      if (lower(node.localName) === name) { stack.length = i; return; }
      if (node.namespace === 'html' && SPECIAL.has(node.localName)) return;
    }
  };
  // One tag after '<'; returns false when the input ends inside it (the tag is dropped).
  const tag = () => {
    const closing = input[pos] === '/';
    let i = pos + (closing ? 1 : 0);
    let name = '';
    while (i < input.length && !isSpace(input[i]) && input[i] !== '/' && input[i] !== '>') name += input[i++];
    name = lower(name).replace(/\0/g, '�');
    const attributes = [];
    let selfClosing = false;
    for (;;) {
      while (i < input.length && (isSpace(input[i]) || input[i] === '/')) {
        if (input[i] === '/') selfClosing = input[i + 1] === '>';
        i += 1;
      }
      if (i >= input.length) return false;
      if (input[i] === '>') { i += 1; break; }
      let attribute = input[i++];
      while (i < input.length && !isSpace(input[i]) && !'/>='.includes(input[i])) attribute += input[i++];
      attribute = lower(attribute).replace(/\0/g, '�');
      while (i < input.length && isSpace(input[i])) i += 1;
      let value = '';
      if (input[i] === '=') {
        i += 1;
        while (i < input.length && isSpace(input[i])) i += 1;
        const quote = input[i] === '"' || input[i] === "'" ? input[i] : null;
        if (quote) {
          const end = input.indexOf(quote, i + 1);
          if (end < 0) return false;
          value = input.slice(i + 1, end);
          i = end + 1;
        } else {
          while (i < input.length && !isSpace(input[i]) && input[i] !== '>') value += input[i++];
        }
        value = decode(value, true).replace(/\0/g, '�');
      }
      if (!attributes.some(([n]) => n === attribute)) attributes.push([attribute, value]);
    }
    pos = i;
    skipNewline = false;
    if (closing) endTag(name); else startTag(name, attributes, selfClosing);
    return true;
  };
  const comment = (start, close) => {
    skipNewline = false;
    const end = input.indexOf(close, start);
    if (end < 0) { insert(new Comment(input.slice(start).replace(/\0/g, '�'), owner)); pos = input.length; return; }
    insert(new Comment(input.slice(start, end).replace(/\0/g, '�'), owner));
    pos = end + close.length;
  };
  let pending = '';
  const flush = () => {
    if (!pending) return;
    if (skipNewline && pending.startsWith('\n')) pending = pending.slice(1);
    skipNewline = false;
    text(decode(pending.replace(/\0/g, '')));
    pending = '';
  };
  while (pos < input.length) {
    const lt = input.indexOf('<', pos);
    if (lt < 0) { pending += input.slice(pos); pos = input.length; break; }
    pending += input.slice(pos, lt);
    pos = lt + 1;
    const next = input[pos];
    if (next === undefined) { pending += '<'; break; }
    if (next === '!') {
      flush();
      skipNewline = false;
      if (input.startsWith('--', pos + 1)) {
        const start = pos + 3;
        if (input[start] === '>') { insert(new Comment('', owner)); pos = start + 1; continue; }
        if (input.startsWith('->', start)) { insert(new Comment('', owner)); pos = start + 2; continue; }
        const end = input.slice(start).search(/--!?>/);
        if (end < 0) { comment(start, '-->'); continue; }
        insert(new Comment(input.slice(start, start + end).replace(/\0/g, '�'), owner));
        pos = start + end + (input[start + end + 2] === '!' ? 4 : 3);
        continue;
      }
      if (input.startsWith('[CDATA[', pos + 1) && current() !== root && current().namespace !== 'html') {
        const end = input.indexOf(']]>', pos + 8);
        text(end < 0 ? input.slice(pos + 8) : input.slice(pos + 8, end));
        pos = end < 0 ? input.length : end + 3;
        continue;
      }
      if (/^doctype/i.test(input.slice(pos + 1, pos + 8))) {
        const end = input.indexOf('>', pos);
        pos = end < 0 ? input.length : end + 1;
        continue;
      }
      comment(pos + 1, '>');
      continue;
    }
    if (next === '/') {
      const after = input[pos + 1];
      if (after === '>') { pos += 2; continue; }
      if (after === undefined) { pending += '</'; pos += 1; break; }
      if (!isAlpha(after)) { flush(); comment(pos + 1, '>'); continue; }
      flush();
      if (!tag()) { pos = input.length; break; }
      continue;
    }
    if (next === '?') { flush(); comment(pos, '>'); continue; }
    if (!isAlpha(next)) { pending += '<'; continue; }
    flush();
    if (!tag()) { pos = input.length; break; }
  }
  flush();
  return [...(root.content || root).childNodes];
}

// ---------------------------------------------------------------- serialization

const escapeText = s => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = s => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

function serializeNode(node) {
  if (node.nodeType === 3) {
    const parent = node.parentNode;
    return parent?.nodeType === 1 && parent.namespace === 'html' && RAW_SERIALIZED.has(parent.localName) ? node.data : escapeText(node.data);
  }
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType === 11) return serializeChildren(node);
  const name = node.localName;
  let out = '<' + name + node.attributesList.map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join('') + '>';
  if (node.namespace === 'html' && VOID.has(name)) return out;
  out += serializeChildren(node.content || node);
  return out + `</${name}>`;
}

function serializeChildren(node) {
  return node.childNodes.map(serializeNode).join('');
}

// ---------------------------------------------------------------- selectors

// Type, #id, .class and [attribute] selectors joined by descendant or child combinators.
function parseSelectors(text) {
  return String(text).split(',').map(part => {
    const steps = [];
    let combinator = ' ';
    for (const token of part.trim().match(/>|[^\s>]+/g) || []) {
      if (token === '>') { combinator = '>'; continue; }
      const compound = { combinator, type: null, ids: [], classes: [], attributes: [] };
      for (const piece of token.match(/[#.][^#.[]+|\[[^\]]*\]|[^#.[]+/g) || []) {
        if (piece[0] === '#') compound.ids.push(piece.slice(1));
        else if (piece[0] === '.') compound.classes.push(piece.slice(1));
        else if (piece[0] === '[') {
          const m = piece.slice(1, -1).match(/^\s*([^\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|(\S*?)))?\s*$/);
          if (m) compound.attributes.push({ name: lower(m[1]), op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? '' });
        } else if (piece !== '*') compound.type = lower(piece);
      }
      steps.push(compound);
      combinator = ' ';
    }
    return steps;
  }).filter(steps => steps.length);
}

function matchesCompound(element, compound) {
  if (element.nodeType !== 1) return false;
  if (compound.type && lower(element.localName) !== compound.type) return false;
  if (compound.ids.some(id => element.getAttribute('id') !== id)) return false;
  const classes = compound.classes.length ? element.classList.names : [];
  if (compound.classes.some(name => !classes.includes(name))) return false;
  for (const { name, op, value } of compound.attributes) {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    if (op === '=' && actual !== value) return false;
    if (op === '~=' && !actual.split(/\s+/).includes(value)) return false;
    if (op === '^=' && !actual.startsWith(value)) return false;
    if (op === '$=' && !actual.endsWith(value)) return false;
    if (op === '*=' && !actual.includes(value)) return false;
    if (op === '|=' && actual !== value && !actual.startsWith(value + '-')) return false;
  }
  return true;
}

function matchesComplex(element, steps, scope) {
  const match = (node, index) => {
    if (!matchesCompound(node, steps[index])) return false;
    if (index === 0) return true;
    const combinator = steps[index].combinator;
    for (let parent = node.parentNode; parent && parent !== scope?.parentNode; parent = parent.parentNode) {
      if (parent.nodeType !== 1) break;
      if (match(parent, index - 1)) return true;
      if (combinator === '>') break;
    }
    return false;
  };
  return match(element, steps.length - 1);
}

function select(root, text, first) {
  const selectors = parseSelectors(text);
  const found = [];
  for (const node of walk(root)) {
    if (node.nodeType === 1 && selectors.some(steps => matchesComplex(node, steps, null))) {
      found.push(node);
      if (first) break;
    }
  }
  return found;
}

// ---------------------------------------------------------------- document

const NodeFilter = { SHOW_ALL: 0xFFFFFFFF, SHOW_ELEMENT: 0x1, SHOW_TEXT: 0x4, SHOW_COMMENT: 0x80, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };

// The node after `node` in tree order, staying inside `root`.
function following(node, root) {
  if (node.childNodes.length) return node.childNodes[0];
  for (let n = node; n && n !== root; n = n.parentNode) {
    const sibling = n.nextSibling;
    if (sibling) return sibling;
  }
  return null;
}

function treeWalker(root, whatToShow = NodeFilter.SHOW_ALL, filter = null) {
  const shows = node => (whatToShow & (1 << (node.nodeType - 1))) !== 0
    && (!filter || (typeof filter === 'function' ? filter(node) : filter.acceptNode(node)) === NodeFilter.FILTER_ACCEPT);
  return {
    root,
    currentNode: root,
    nextNode() {
      for (let node = following(this.currentNode, root); node; node = following(node, root)) {
        if (shows(node)) { this.currentNode = node; return node; }
      }
      return null;
    },
  };
}

// The page's document: an empty <head> and <body> under <html>.
function createDocument() {
  const document = {
    nodeType: 9,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    cookie: '',
    title: '',
    createElement: name => new Element(lower(String(name)), document),
    createElementNS: (namespace, name) => new Element(String(name), document, /svg/.test(namespace) ? 'svg' : /MathML/.test(namespace) ? 'math' : 'html'),
    createTextNode: data => new Text(String(data), document),
    createComment: data => new Comment(String(data), document),
    createDocumentFragment: () => new DocumentFragment(document),
    createTreeWalker: treeWalker,
    getElementById: id => find(document.documentElement, node => node.nodeType === 1 && node.getAttribute('id') === String(id)),
    querySelector: selector => document.documentElement.querySelector(selector),
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
    getElementsByTagName: name => document.documentElement.getElementsByTagName(name),
    getElementsByClassName: names => document.documentElement.getElementsByClassName(names),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    execCommand() { return false; },
    hasFocus() { return true; },
    exitFullscreen() { return Promise.resolve(); },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true },
  };
  const html = new Element('html', document);
  const head = new Element('head', document);
  const body = new Element('body', document);
  html.append(head, body);
  Object.assign(document, { documentElement: html, head, body, activeElement: body });
  return document;
}

module.exports = { createDocument, parseFragment, decode, Node, Element, Text, Comment, DocumentFragment, NodeFilter };
