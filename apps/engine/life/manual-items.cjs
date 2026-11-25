'use strict';

const { plain } = require('../item-use.cjs');
const rules = require('../../../content/life/manual-items.json');
const namePattern = new RegExp(rules.manualName);
const descriptionPattern = new RegExp(rules.manualDescription);
const exclusions = new RegExp(rules.exclusions);

function isManual(name, type, description, effect) {
  const named = plain(name).split('|')[0].trim();
  const texts = [plain(description), plain(effect)];
  return rules.ambiguousTypes.includes(plain(type)) && namePattern.test(named)
    && !exclusions.test(named)
    && !texts.some(text => exclusions.test(text.split(/[，,。；;、：:\n]/)[0]))
    && texts.some(text => descriptionPattern.test(text));
}

function normalizeManuals(state) {
  for (const row of Object.values(state['1'] || {})) {
    if (row && isManual(row['1'], row['2'], row['3'], row['4'])) {
      row['2'] = '功法';
      if (!plain(row['9']) && plain(row['4']) !== '无') row['9'] = row['4'] || '';
    }
  }
}

module.exports = { isManual, normalizeManuals };
