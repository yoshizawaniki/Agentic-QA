import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStructured, SCHEMAS } from "../src/ai/parse.ts";
import type { ReviewOutput } from "../src/ai/parse.ts";

test("parse: extracts fenced json block", () => {
  const raw = 'Some analysis text.\n\n```json\n{"findings":[{"category":"logic","severity":"high","title":"Bug in loop","claim":"The loop skips the last element"}]}\n```\n';
  const res = parseStructured<ReviewOutput>(raw, SCHEMAS.review);
  assert.ok(res.ok);
  assert.equal(res.data?.findings.length, 1);
});

test("parse: uses the LAST valid fenced block", () => {
  const raw = '```json\n{"findings":[]}\n```\nmore\n```json\n{"findings":[{"category":"race","severity":"high","title":"Lost update on write","claim":"Concurrent writes lose increments"}]}\n```';
  const res = parseStructured<ReviewOutput>(raw, SCHEMAS.review);
  assert.ok(res.ok);
  assert.equal(res.data?.findings.length, 1);
});

test("parse: falls back to balanced braces when unfenced", () => {
  const raw = 'Result: {"findings":[{"category":"security","severity":"low","title":"Weak hash usage","claim":"MD5 used for password hashing"}]} end.';
  const res = parseStructured<ReviewOutput>(raw, SCHEMAS.review);
  assert.ok(res.ok);
  assert.equal(res.data?.findings.length, 1);
});

test("parse: rejects invalid schema with errors", () => {
  const raw = '```json\n{"findings":[{"severity":"huge","title":"x","claim":"y"}]}\n```';
  const res = parseStructured<ReviewOutput>(raw, SCHEMAS.review);
  assert.ok(!res.ok);
  assert.ok(res.errors?.some((e) => e.includes("category")));
});

test("parse: no json at all -> not ok", () => {
  const res = parseStructured("I could not find anything wrong.", SCHEMAS.review);
  assert.ok(!res.ok);
});
