"use strict";

// Invariant: date extraction must respect the caller's UTC offset, including
// instants whose local calendar date differs from the UTC date.
const assert = require("node:assert");
const { formatDate } = require("../src/format.js");

const CASES = [
  ["2026-01-01T23:30:00Z", 540, "2026-01-02"],
  ["2026-06-15T00:10:00Z", -300, "2026-06-14"],
  ["2026-12-31T13:00:00Z", 600, "2027-01-01"],
];

for (const [iso, off, expected] of CASES) {
  assert.strictEqual(formatDate(iso, off), expected, `OFFSET BROKEN for ${iso} @${off}: got ${formatDate(iso, off)}, want ${expected}`);
}
console.log("invariant OK");
