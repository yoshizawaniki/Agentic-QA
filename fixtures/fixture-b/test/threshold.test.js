"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { isFreeShipping } = require("../src/threshold.js");

test("large carts get free shipping", () => {
  assert.strictEqual(isFreeShipping(100), true);
});

test("small carts do not", () => {
  assert.strictEqual(isFreeShipping(10), false);
});
