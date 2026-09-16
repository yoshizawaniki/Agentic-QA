import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindingLedger, createFinding, findingKey } from "../src/core/findings.ts";

function tmpLedger(): { ledger: FindingLedger; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aq-ledger-"));
  return { ledger: new FindingLedger(dir), dir };
}

function sample(overrides: Partial<Parameters<typeof createFinding>[0]> = {}) {
  return createFinding({
    run_id: "r1",
    target: "t",
    category: "logic",
    severity: "high",
    title: "Off-by-one in pagination window",
    claim: "Page windows drop the first item.",
    source_location: { file: "src/paginate.js", line: 4 },
    deterministic_evidence: false,
    final_status: "suspected",
    ...overrides,
  });
}

test("ledger: add persists and reloads", () => {
  const { ledger, dir } = tmpLedger();
  const f = sample();
  const res = ledger.add(f);
  assert.ok(res.added);
  const reloaded = new FindingLedger(dir);
  assert.equal(reloaded.all().length, 1);
  assert.equal(reloaded.all()[0].id, f.id);
  rmSync(dir, { recursive: true, force: true });
});

test("ledger: dedups same category + location", () => {
  const { ledger } = tmpLedger();
  const f1 = sample();
  assert.ok(ledger.add(f1).added);
  const res2 = ledger.add(sample({ title: "Off-by-one in pagination windows differently worded" }));
  assert.ok(!res2.added);
  assert.equal(res2.duplicateOf?.id, f1.id);
});

test("ledger: status transitions update history and verified_at", () => {
  const { ledger, dir } = tmpLedger();
  const f = sample();
  ledger.add(f);
  ledger.setStatus(f.id, "reproduced");
  ledger.setStatus(f.id, "verified");
  const got = ledger.get(f.id)!;
  assert.equal(got.final_status, "verified");
  assert.ok(got.verified_at);
  assert.deepEqual(
    got.status_history.map((h) => h.status),
    ["suspected", "reproduced", "verified"],
  );
  rmSync(dir, { recursive: true, force: true });
});

test("ledger: rejected findings do not dedup future ones", () => {
  const { ledger } = tmpLedger();
  const a = sample();
  ledger.add(a);
  ledger.setStatus(a.id, "rejected");
  const res = ledger.add(sample());
  assert.ok(res.added);
});

test("findingKey normalizes separators", () => {
  assert.equal(findingKey({ category: "c", source_location: { file: "a\\b/c.js" }, title: "x y" }),
    findingKey({ category: "c", source_location: { file: "A\\B\\C.js" }, title: "x y" }));
});
