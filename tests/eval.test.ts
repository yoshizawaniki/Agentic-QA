import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesExpected } from "../src/eval/evaluate.ts";
import type { Finding } from "../src/types.ts";

function f(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    run_id: "r",
    target: "t",
    category: "logic",
    severity: "high",
    title: "Bug in clamp upper bound",
    claim: "returns min instead of max",
    source_location: { file: "src/clamp.js", line: 9 },
    confidence: 1,
    deterministic_evidence: false,
    final_status: "confirmed",
    created_at: new Date().toISOString(),
    status_history: [],
    ...overrides,
  };
}

test("matcher: category+file match", () => {
  assert.ok(matchesExpected(f(), { category: "logic", file: "clamp.js" }));
});

test("matcher: file anchor accepts any category (wording variance)", () => {
  assert.ok(matchesExpected(f({ category: "boundary" }), { category: "logic", file: "clamp.js" }));
});

test("matcher: wrong file does not match", () => {
  assert.ok(!matchesExpected(f({ source_location: { file: "src/other.js" } }), { category: "logic", file: "clamp.js" }));
});

test("matcher: keyword anchor requires category when given", () => {
  assert.ok(matchesExpected(f(), { category: "logic", keyword: "upper bound" }));
  assert.ok(!matchesExpected(f(), { category: "security", keyword: "upper bound" }));
});

test("matcher: rejected findings still compare (filtering happens elsewhere)", () => {
  assert.ok(matchesExpected(f({ final_status: "rejected" }), { category: "logic" }));
});
