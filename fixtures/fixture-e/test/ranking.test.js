"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { rankVideos } = require("../src/ranking.js");

test("returns all videos", () => {
  const input = [
    { id: "a", score: 10, createdAt: "2026-01-01" },
    { id: "b", score: 30, createdAt: "2026-01-02" },
    { id: "c", score: 20, createdAt: "2026-01-03" },
  ];
  const out = rankVideos(input);
  assert.strictEqual(out.length, 3);
  assert.ok(out.some((v) => v.id === "a"));
  assert.ok(out.some((v) => v.id === "b"));
  assert.ok(out.some((v) => v.id === "c"));
});
