'use strict';
/* The cultivation-life play's rule data: content/life/<name>.json, read once per process. The
 * numbers live there, not in the code (docs/gameplay-plan.md, 工作项开头的四条).
 */
const fs = require('node:fs');
const path = require('node:path');

const FOLDER = path.resolve(__dirname, '../../../content/life');
const read = new Map();

function data(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(name))) throw new Error(`没有「${name}」这份规则数据`);
  if (!read.has(name)) read.set(name, JSON.parse(fs.readFileSync(path.join(FOLDER, `${name}.json`), 'utf8')));
  return read.get(name);
}

module.exports = { data };
