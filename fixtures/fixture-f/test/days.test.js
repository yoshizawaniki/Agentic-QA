"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { daysInMonth } = require("../src/days.js");

test("march has 31 days", () => {
  assert.strictEqual(daysInMonth(3), 31);
});

test("april has 30 days", () => {
  assert.strictEqual(daysInMonth(4), 30);
});

test("december has 31 days", () => {
  assert.strictEqual(daysInMonth(12), 31);
});
