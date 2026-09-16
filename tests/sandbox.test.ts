import { test } from "node:test";
import assert from "node:assert/strict";
import { makeExclusionMatcher } from "../src/core/sandbox.ts";

test("exclusion matcher: plain directory names excluded at any depth", () => {
  const m = makeExclusionMatcher(["node_modules", ".git"]);
  assert.ok(m("node_modules/foo/index.js"));
  assert.ok(m("packages/app/node_modules/x.js"));
  assert.ok(m(".git/config"));
  assert.ok(!m("src/node_modules-helper.ts"));
  assert.ok(!m("src/index.ts"));
});

test("exclusion matcher: wildcard globs", () => {
  const m = makeExclusionMatcher(["*.log", ".env.*"]);
  assert.ok(m("server.log"));
  assert.ok(m("logs/server.log"));
  assert.ok(m(".env.local"));
  assert.ok(!m("env.local"));
});

test("exclusion matcher: ** deep patterns", () => {
  const m = makeExclusionMatcher(["dist/**"]);
  assert.ok(m("dist/bundle.js"));
  assert.ok(m("a/dist/bundle.js"));
  assert.ok(!m("distribution/x.js"));
});
