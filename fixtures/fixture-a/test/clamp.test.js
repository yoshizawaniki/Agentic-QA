"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { clamp } = require("../src/clamp.js");

test("keeps in-range values unchanged", () => {
  assert.strictEqual(clamp(5, 0, 10), 5);
  assert.strictEqual(clamp(0, 0, 10), 0);
});

test("clamps values below the minimum", () => {
  assert.strictEqual(clamp(-1, 0, 10), 0);
});
