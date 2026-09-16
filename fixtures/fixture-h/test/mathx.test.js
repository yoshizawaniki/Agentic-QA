"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { divide, mean } = require("../src/mathx.js");

test("divide works", () => {
  assert.strictEqual(divide(6, 3), 2);
});

test("mean computes average", () => {
  assert.strictEqual(mean([1, 2, 3, 4]), 3);
});
