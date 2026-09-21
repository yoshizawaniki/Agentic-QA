import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditExitCode } from "../src/cli.ts";
import { runGates } from "../src/gates/index.ts";
import { scanSecrets } from "../src/gates/static.ts";
import { generateReport } from "../src/pipeline/report.ts";
import { RunContext } from "../src/core/evidence.ts";
import { createRedactor } from "../src/util/redact.ts";
import type { TargetConfig } from "../src/config/detect.ts";

test("auditExitCode maps verdict to process exit code", () => {
  assert.equal(auditExitCode("pass"), 0);
  assert.equal(auditExitCode("fail"), 1);
});

test("runGates: passing and failing commands produce correct GateResults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aq-gates-"));
  const cfg = {
    target: { root: dir },
    rules: [],
    gates: {
      test: { cmd: 'node -e "process.exit(0)"', timeout_sec: 30 },
      lint: { cmd: 'node -e "process.exit(5)"', timeout_sec: 30 },
    },
    invariants: [],
    forbidden_paths: [],
    sandbox: { exclude_globs: [] },
    environment: {},
    secrets_env: [],
    ai: { enabled: false, concurrency: 1, review_timeout_sec: 60 },
    mutation: { enabled: false, max_mutants: 0, timeout_sec: 30, include: [] },
    limits: { max_fix_rounds: 1, campaign_max_rounds: 1 },
  } as unknown as TargetConfig;
  try {
    const results = await runGates({ config: cfg, cwd: dir, selected: ["test", "lint"] });
    const t = results.find((r) => r.name === "test")!;
    const l = results.find((r) => r.name === "lint")!;
    assert.equal(t.passed, true);
    assert.equal(t.exit_code, 0);
    assert.equal(l.passed, false);
    assert.equal(l.exit_code, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeCtx(root: string): RunContext {
  return new RunContext({ runsRoot: join(root, "runs"), kind: "audit", targetRoot: root, redactor: createRedactor() });
}

test("scanSecrets: flags real literals; downgrades redactor self-tests; honors excludes", () => {
  const dir = mkdtempSync(join(tmpdir(), "aq-secret-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "skipme"));
  writeFileSync(join(dir, "src", "app.js"), 'const k = "sk-reallookingkey123456789";\n');
  writeFileSync(
    join(dir, "tests-self.js"),
    'test redactor expect "[REDACTED]" for input sk-faketestkey0000000000\n',
    "utf8",
  );
  writeFileSync(join(dir, "skipme", "leak.js"), 'token = "AKIAIOSFODNN7EXAMPLE"\n');
  // extensionless file must still be scanned (ext === "" branch)
  writeFileSync(join(dir, "Dockerfile"), "ENV OPENAI_KEY=sk-dockerfiletestkey000000\n");
  const ctx = makeCtx(dir);
  try {
    const findings = scanSecrets(dir, ctx, (rel) => rel.startsWith("skipme"));
    const realHit = findings.find((x) => x.source_location?.file === "src/app.js");
    const selfTestHit = findings.find((x) => x.source_location?.file === "tests-self.js");
    const dockerHit = findings.find((x) => x.source_location?.file === "Dockerfile");
    assert.ok(realHit);
    assert.equal(realHit.severity, "critical");
    assert.ok(selfTestHit);
    assert.ok(selfTestHit.title.includes("[likely self-test]"));
    assert.equal(selfTestHit.severity, "low");
    assert.ok(dockerHit, "extensionless files must be scanned");
    assert.ok(!findings.some((x) => x.source_location?.file?.startsWith("skipme")), "excluded dir must not be scanned");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generateReport: renders architecture section only when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "aq-report-"));
  const ctx = makeCtx(dir);
  try {
    const base = {
      kind: "audit",
      targetRoot: dir,
      gates: [],
      findings: [],
      mutationSurvivedCount: 0,
      driftFiles: [],
      aiEnabled: false,
      aiAvailable: false,
    };
    const without = generateReport(ctx, { ...base });
    const mdWithout = ctx.readArtifact("final-report.md") ?? "";
    assert.ok(!mdWithout.includes("**Dangerous paths:**"));
    void without;
    generateReport(ctx, {
      ...base,
      architecture: { summary: "single module script", entry_points: ["index.js"], dangerous_paths: [], state_stores: [] },
    });
    const mdEmptyPaths = ctx.readArtifact("final-report.md") ?? "";
    assert.ok(!mdEmptyPaths.includes("**Dangerous paths:**"), "empty dangerous_paths must not render header");
    generateReport(ctx, {
      ...base,
      architecture: { summary: "single module script", entry_points: ["index.js"], dangerous_paths: ["scripts/deploy.js"], state_stores: [] },
    });
    const mdWith = ctx.readArtifact("final-report.md") ?? "";
    assert.ok(mdWith.includes("**Dangerous paths:**"));
    assert.ok(mdWith.includes("scripts/deploy.js"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
