"use strict";

// Executable spec properties for clamp (metamorphic checks).
// Exits non-zero on any violation so agentic-qa can treat it as an invariant gate.
const assert = require("node:assert");
const { clamp } = require("../src/clamp.js");

const samples = [
  [-10, 0, 10],
  [0, 0, 10],
  [5, 0, 10],
  [10, 0, 10],
  [11, 0, 10],
  [3.5, -2, 4],
];

for (const [v, lo, hi] of samples) {
  const out = clamp(v, lo, hi);
  assert.ok(out >= lo && out <= hi, `result ${out} outside [${lo},${hi}]`);
  if (v < lo) assert.strictEqual(out, lo, `below-min case broken for ${v}`);
  if (v > hi) assert.strictEqual(out, hi, `ABOVE-MAX CASE BROKEN for ${v}: got ${out}`);
  if (v >= lo && v <= hi) assert.strictEqual(out, v, `identity broken for ${v}`);
}
console.log("invariant OK");
