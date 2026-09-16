import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMutationTesting } from "../src/gates/mutation.ts";
import { RunContext } from "../src/core/evidence.ts";
import { createRedactor } from "../src/util/redact.ts";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "aq-mutation-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "test"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "mut-fixture", scripts: { test: "node --test" } }),
    "utf8",
  );
  // boundary bug: > should be >=; tests only probe the interior so mutants survive
  writeFileSync(
    join(dir, "src", "score.js"),
    'function isPassing(score) {\n  return score > 60;\n}\nmodule.exports = { isPassing };\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "test", "score.test.js"),
    `const test = require("node:test");
const assert = require("node:assert");
const { isPassing } = require("../src/score.js");
test("interior values", () => {
  assert.strictEqual(isPassing(100), true);
  assert.strictEqual(isPassing(10), false);
});
`,
    "utf8",
  );
  return dir;
}

test("mutation: survived mutant yields deterministic test-gap finding", async () => {
  const dir = makeProject();
  const ctx = new RunContext({
    runsRoot: join(dir, "runs"),
    kind: "audit",
    targetRoot: dir,
    redactor: createRedactor(),
  });
  try {
    const findings = await runMutationTesting({
      workspaceRoot: dir,
      includeGlobs: ["src/**"],
      maxMutants: 6,
      timeoutSec: 60,
      testCmd: "npm test",
      ctx,
    });
    // score.js has one comparison (>) whose flip survives the weak suite
    assert.ok(findings.some((f) => f.category === "test-quality" && f.deterministic_evidence));
    // original file restored byte-for-byte
    const restored = await import("node:fs").then((fs) => fs.readFileSync(join(dir, "src", "score.js"), "utf8"));
    assert.ok(restored.includes("score > 60"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
