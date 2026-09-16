"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { applyDiscount } = require("../src/discount.js");

test("discount math", () => {
  assert.strictEqual(applyDiscount(100, 0.2), 80);
  assert.strictEqual(applyDiscount(200, 0.5), 100);
});
