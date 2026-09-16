"use strict";

// Invariant: full month table for the non-leap baseline must match the calendar.
const assert = require("node:assert");
const { daysInMonth } = require("../src/days.js");

const EXPECTED = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
for (let m = 1; m <= 12; m++) {
  assert.strictEqual(daysInMonth(m), EXPECTED[m - 1], `BOUNDARY BROKEN: month ${m} returned ${daysInMonth(m)}, expected ${EXPECTED[m - 1]}`);
}
console.log("invariant OK");
