"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { formatDate, formatDateTime } = require("../src/format.js");

test("formats UTC midnight dates", () => {
  assert.strictEqual(formatDate("2026-03-10T00:00:00Z"), "2026-03-10");
});

test("same day noon", () => {
  assert.strictEqual(formatDate("2026-03-10T12:00:00Z"), "2026-03-10");
});

test("datetime includes time", () => {
  assert.strictEqual(formatDateTime("2026-03-10T12:34:56Z", 0), "2026-03-10 12:34");
});
