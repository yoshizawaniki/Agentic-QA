"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { normalizeTags } = require("../src/normalize.js");

test("dedupes repeated tags", () => {
  assert.deepStrictEqual(normalizeTags(["a", "b", "a"]), ["a", "b"]);
});

test("keeps values as given", () => {
  const out = normalizeTags(["Node", "js"]);
  assert.strictEqual(out[0], "Node");
  assert.strictEqual(out[1], "js");
});
