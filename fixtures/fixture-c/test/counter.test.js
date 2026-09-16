"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createCounter } = require("../src/counter.js");

test("increments accumulate", async () => {
  const counter = createCounter();
  await counter.increment(0);
  await counter.increment(0);
  await counter.increment(0);
  assert.strictEqual(counter.value(), 3);
});
