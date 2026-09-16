import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindingLedger, createFinding, titleSimilarity } from "../src/core/findings.ts";

function sample(overrides: Partial<Parameters<typeof createFinding>[0]> = {}) {
  return createFinding({
    run_id: "r1",
    target: "t",
    category: "test-quality",
    severity: "medium",
    title: "Missing boundary test for isFreeShipping at exactly 50",
    claim: "Boundary value 50 is never asserted.",
    source_location: { file: "test/threshold.test.js", line: 4 },
    deterministic_evidence: false,
    final_status: "suspected",
    ...overrides,
  });
}

test("titleSimilarity: high for paraphrases, low for unrelated", () => {
  const a = "Missing boundary test at cartTotal=50 for isFreeShipping";
  const b = "No boundary case tested for free shipping threshold 50";
  assert.ok(titleSimilarity(a, b) >= 0.35, `paraphrase similarity ${titleSimilarity(a, b)}`);
  const unrelated = "SQL injection in login query handler";
  assert.ok(titleSimilarity(a, unrelated) < 0.15);
});

test("ledger: near-duplicate same-file same-category finding is merged", () => {
  const dir = mkdtempSync(join(tmpdir(), "aq-near-"));
  const ledger = new FindingLedger(dir);
  const first = sample();
  const r1 = ledger.add(first);
  const r2 = ledger.add(
    sample({ title: "Missing boundary test at cartTotal=50 for isFreeShipping" }),
  );
  assert.ok(r1.added);
  assert.ok(!r2.added);
  assert.equal(r2.duplicateOf?.id, first.id);
  rmSync(dir, { recursive: true, force: true });
});

test("ledger: different file anchors are not merged even with similar titles", () => {
  const dir = mkdtempSync(join(tmpdir(), "aq-near2-"));
  const ledger = new FindingLedger(dir);
  ledger.add(sample());
  const res = ledger.add(sample({ source_location: { file: "src/threshold.js" } }));
  assert.ok(res.added);
  rmSync(dir, { recursive: true, force: true });
});
