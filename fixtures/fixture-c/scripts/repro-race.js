"use strict";

// Invariant: N concurrent increments must yield exactly N.
// Exits non-zero when the invariant is violated (lost updates).
const assert = require("node:assert");
const { createCounter } = require("../src/counter.js");

async function main() {
  const counter = createCounter();
  const N = 20;
  await Promise.all(Array.from({ length: N }, () => counter.increment(1)));
  assert.strictEqual(counter.value(), N, `lost updates: expected ${N}, got ${counter.value()}`);
  console.log("invariant OK");
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
