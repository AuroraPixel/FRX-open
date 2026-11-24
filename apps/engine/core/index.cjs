/* Every page function and page value in core/, by name: what host.cjs installs in a page.
 * A name belongs to one module only. */
'use strict';

const MODULES = [
  'variables', 'settings', 'tables', 'snapshots', 'equipment', 'prompt', 'recall', 'reply', 'archive', 'creation',
  'helpers', 'death', 'beasts',
];

const functions = new Map();
const values = new Map();
for (const module of MODULES) {
  for (const [name, value] of Object.entries(require(`./${module}.cjs`))) {
    if (functions.has(name) || values.has(name)) throw new Error(`${name} is in two core modules`);
    (typeof value === 'function' ? functions : values).set(name, value);
  }
}

module.exports = { functions, values };
