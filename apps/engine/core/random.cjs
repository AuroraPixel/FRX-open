/* Seeded random values: the stream behind a page's Math.random and crypto.randomUUID in host.cjs
 * and settle.cjs, and the engine's own draws. Copied from the old page's js/random.js
 * (FRXRandom.create), so one seed gives the same values in the engine and on the page.
 */

  function create(seed) {
    let state = 2166136261;
    for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
    const random = () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    const uuid = () => {
      const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.map(n => n.toString(16).padStart(2,"0")).join("");
      return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
    };
    return { random, uuid };
  }

module.exports = { create };
