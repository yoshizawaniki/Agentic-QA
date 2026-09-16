"use strict";

// Invariant from SPEC.md: ranking must be score DESC with createdAt ASC tie-break.
const assert = require("node:assert");
const { rankVideos } = require("../src/ranking.js");

const input = [
  { id: "a", score: 10, createdAt: "2026-01-01" },
  { id: "b", score: 30, createdAt: "2026-01-02" },
  { id: "c", score: 20, createdAt: "2026-01-03" },
  { id: "d", score: 10, createdAt: "2025-06-01" },
];

const out = rankVideos(input);
for (let i = 1; i < out.length; i++) {
  const prev = out[i - 1];
  const cur = out[i];
  if (prev.score === cur.score) {
    assert.ok(prev.createdAt <= cur.createdAt, "TIE-BREAK BROKEN: equal scores must keep earlier createdAt first");
  } else {
    assert.ok(prev.score > cur.score, "ORDER BROKEN: scores must be descending");
  }
}
console.log("invariant OK");
