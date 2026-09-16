import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "../config/load.ts";
import type { ConfigOverrides } from "../config/load.ts";
import { createRedactor } from "../util/redact.ts";
import { RunContext } from "../core/evidence.ts";
import { FindingLedger, createFinding } from "../core/findings.ts";
import { recordBaseline } from "../core/baseline.ts";
import { makeExclusionMatcher } from "../core/sandbox.ts";
import { prepareGateWorkspace } from "../core/workspace.ts";
import { runGates } from "../gates/index.ts";
import { scanSecrets, checkReadmeClaims } from "../gates/static.ts";
import { runMutationTesting } from "../gates/mutation.ts";
import { OpencodeRunner, NoopRunner } from "../ai/runner.ts";
import type { AgentRunner } from "../ai/runner.ts";
import { mapLimit, runRole } from "../ai/invoke.ts";
import type { ReviewOutput, SpecContractsOutput, ArchitectureOutput, JudgeOutput } from "../ai/parse.ts";
import { SCHEMAS } from "../ai/parse.ts";
import {
  specAnalystPrompt,
  EXPLORER_PROMPT,
  TEST_AUDITOR_PROMPT,
  ADVERSARIAL_PROMPT,
  SECURITY_PROMPT,
  PERF_DATA_PROMPT,
  judgePrompt,
  COMMON_RULES,
} from "../ai/prompts.ts";
import { generateReport } from "./report.ts";
import type { Finding } from "../types.ts";
import type { Schema } from "../util/schema.ts";
import type { TargetConfig } from "../config/detect.ts";
import { runInvariants } from "../gates/invariants.ts";

export interface AuditResult {
  runId: string;
  runDir: string;
  verdict: "pass" | "fail";
}

export async function runAudit(targetRootInput: string, overrides: ConfigOverrides = {}, runsRoot = defaultRunsRoot()): Promise<AuditResult> {
  const targetRoot = resolveTargetRoot(targetRootInput);
  const { config, detected } = resolveConfig(targetRoot, overrides);
  const redactor = createRedactor(config.secrets_env);
  const ctx = new RunContext({ runsRoot, kind: "audit", targetRoot, redactor });

  console.log(`[audit] run ${ctx.runId}`);
  console.log(`[audit] target: ${ctx.redact(targetRoot)}`);
  console.log(`[audit] detection: ${detected.join(", ") || "none"}`);

  ctx.writeManifest({
    run_id: ctx.runId,
    kind: "audit",
    target_root: ctx.redact(targetRoot),
    started_at: new Date().toISOString(),
    agentic_qa_version: version(),
    ai_enabled: config.ai.enabled,
    detected,
    gates_configured: Object.entries(config.gates)
      .filter(([, g]) => g !== undefined)
      .map(([k]) => k),
  });

  // ---- baseline (read-only on original) ----
  const isExcludedForBaseline = makeExclusionMatcher([
    ...config.sandbox.exclude_globs,
    ...config.forbidden_paths,
  ]);
  const baseline = recordBaseline(targetRoot, config.sandbox.exclude_globs, isExcludedForBaseline);
  ctx.writeArtifact("baseline/baseline.json", JSON.stringify(baseline, null, 2));
  console.log(`[baseline] ${baseline.file_count} files hashed`);

  // ---- isolated workspace for gates/AI/mutation ----
  const ws = await prepareGateWorkspace({
    targetRoot,
    destRoot: ctx.path("workspace"),
    excludeGlobs: [...config.sandbox.exclude_globs, ...config.forbidden_paths],
    mode: "junction",
  });
  console.log(`[sandbox] mode=${ws.mode} files=${ws.filesCopied === -1 ? "?" : ws.filesCopied} (${ws.notes.join("; ")})`);

  // ---- Layer 1: deterministic gates (in sandbox) ----
  console.log("[gates] running Layer 1...");
  const gateResults = await runGates({ config, cwd: ws.root, ctx, phase: "baseline" });
  for (const g of gateResults) {
    if (g.skipped_reason) console.log(`[gate] ${g.name}: skipped (${g.skipped_reason})`);
    else console.log(`[gate] ${g.name}: ${g.passed ? "PASS" : "FAIL"} (${g.duration_ms}ms)`);
  }
  const testGate = gateResults.find((g) => g.name === "test");
  const testPassed = testGate?.passed ?? false;

  // ---- static deterministic checks (read-only on original) ----
  const ledger = new FindingLedger(ctx.runDir);

  // deterministic findings for every failing gate
  for (const g of gateResults) {
    if (g.skipped_reason || g.passed) continue;
    ledger.add(
      createFinding({
        run_id: ctx.runId,
        target: ctx.targetRoot,
        category: "gate-failure",
        severity: g.name === "test" || g.name === "integration_test" ? "high" : "medium",
        title: `Deterministic gate failed: ${g.name}`,
        claim: `\`${g.name}\` gate exited non-zero${g.timed_out ? " (timed out)" : ""}.`,
        evidence: `exit=${g.exit_code}${g.timed_out ? " TIMED_OUT" : ""}; logs under run ${ctx.runId}`,
        reproduction: g.cmd,
        confidence: 1,
        deterministic_evidence: true,
        final_status: "confirmed",
      }),
    );
  }

  for (const f of scanSecrets(targetRoot, ctx, isExcludedForBaseline)) ledger.add(f);
  const readmeFinding = checkReadmeClaims(targetRoot, gateResults.every((g) => g.passed), ctx);
  if (readmeFinding) ledger.add(readmeFinding);

  // ---- mutation testing (deterministic) ----
  let mutationSurvivedCount = 0;
  let mutationSkippedReason: string | undefined;
  if (!config.mutation.enabled) {
    mutationSkippedReason = "disabled by config";
  } else if (!testGate || testGate.skipped_reason === "not_configured") {
    mutationSkippedReason = "no test gate configured/detected";
  } else {
    console.log("[mutation] running mutation testing...");
    try {
      const mutationFindings = await runMutationTesting({
        workspaceRoot: ws.root,
        includeGlobs: config.mutation.include,
        maxMutants: config.mutation.max_mutants,
        timeoutSec: config.mutation.timeout_sec,
        testCmd: config.gates.test?.cmd ?? "npm test",
        ctx,
      });
      for (const f of mutationFindings) ledger.add(f);
      mutationSurvivedCount = mutationFindings.length;
      console.log(`[mutation] survived mutants: ${mutationSurvivedCount}`);
    } catch (err) {
      mutationSkippedReason = `error: ${String(err).slice(0, 200)}`;
    }
  }

  // ---- declared invariants (metamorphic/property checks, executed) ----
  await runInvariants(ctx, ws.root, config, ledger);

  // ---- Layer 2: independent AI review ----
  const runner: AgentRunner = config.ai.enabled ? new OpencodeRunner() : new NoopRunner();
  let specContracts: SpecContractsOutput | undefined;
  let architecture: ArchitectureOutput | undefined;

  if (runner.available) {
    console.log(`[ai] reviewer backend: ${runner.name}; roles starting...`);
    const rulesFiles = config.rules.filter((r) => existsSync(join(targetRoot, r)));
    const withRules = (body: string): string => `${body}\n${COMMON_RULES}`;
    const roles: Array<{ name: string; agent: string; promptBody: string; schema: Schema }> = [
      { name: "spec-analyst", agent: "plan", promptBody: withRules(specAnalystPrompt({ rulesFiles })), schema: SCHEMAS.specContracts },
      { name: "explorer", agent: "plan", promptBody: withRules(EXPLORER_PROMPT), schema: SCHEMAS.architecture },
      { name: "test-auditor", agent: "plan", promptBody: withRules(TEST_AUDITOR_PROMPT), schema: SCHEMAS.review },
      { name: "adversarial-reviewer", agent: "plan", promptBody: withRules(ADVERSARIAL_PROMPT), schema: SCHEMAS.review },
      { name: "security-reviewer", agent: "plan", promptBody: withRules(SECURITY_PROMPT), schema: SCHEMAS.review },
      { name: "perf-data-reviewer", agent: "plan", promptBody: withRules(PERF_DATA_PROMPT), schema: SCHEMAS.review },
    ];
    await mapLimit(roles, config.ai.concurrency, async (role) => {
      console.log(`[ai] ${role.name}: start`);
      const res = await runRole<Record<string, unknown>>(runner, {
        cwd: ws.root,
        agent: role.agent,
        model: config.ai.reviewer_model,
        title: `aq-${role.name}`,
        promptBody: role.promptBody,
        schema: role.schema,
        timeoutSec: config.ai.review_timeout_sec,
      });
      if (!res.ok) {
        console.warn(`[ai] ${role.name}: FAILED (${res.error?.slice(0, 160)})`);
        ctx.saveAiFailure(role.name, `${res.error ?? "unknown"} (${res.duration_ms}ms)`, res.raw);
        return;
      }
      writeAiArtifact(ctx, role.name, res.data, res.raw);
      console.log(`[ai] ${role.name}: done (${res.duration_ms}ms)`);
      if (role.name === "spec-analyst") specContracts = res.data as unknown as SpecContractsOutput;
      else if (role.name === "explorer") architecture = res.data as unknown as ArchitectureOutput;
      else if ("findings" in (res.data as object)) {
        for (const item of (res.data as unknown as ReviewOutput).findings) {
          addAiFinding(ledger, ctx, role.name, item);
        }
      }
    });
  } else if (config.ai.enabled) {
    console.warn("[ai] opencode CLI not available; AI layers SKIPPED (deterministic-only audit)");
  } else {
    console.log("[ai] disabled by --no-ai");
  }

  // ---- integrity re-check on original tree ----
  const driftFiles = detectDrift(targetRoot, baseline.files, isExcludedForBaseline);
  if (driftFiles.length > 0) {
    ledger.add(
      createFinding({
        run_id: ctx.runId,
        target: ctx.targetRoot,
        category: "other",
        severity: "low",
        title: `Original target tree changed during audit (${driftFiles.length} files)`,
        claim: "Files in the original target differ from the pre-audit baseline. Audit itself ran in an isolated sandbox, so an external process wrote to the target.",
        evidence: "sha256 baseline comparison before/after run",
        confidence: 1,
        deterministic_evidence: true,
        final_status: "confirmed",
      }),
    );
    ctx.writeArtifact("baseline/drift.json", JSON.stringify(driftFiles, null, 2));
  }

  // ---- Judge (evidence-based accept/reject) ----
  if (runner.available && ledger.all().length > 0) {
    console.log("[judge] consolidating...");
    const table = ledger
      .all()
      .map((f) => `${f.id} | ${f.severity} | ${f.category} | ${f.final_status} | ${f.title}`)
      .join("\n");
    const gateTable = gateResults.map((g) => `${g.name}: ${g.passed ? "PASS" : "FAIL"}${g.skipped_reason ? ` (${g.skipped_reason})` : ""}`).join("\n");
    const verifierNote = "(no fixes applied in audit run)";
    const judgeRes = await runRole(runner, {
      cwd: ws.root,
      agent: "plan",
      model: config.ai.reviewer_model,
      title: "aq-judge",
      promptBody: judgePrompt({ findingsTable: table, gateResults: gateTable, verifierResults: verifierNote }),
      schema: SCHEMAS.judge,
      timeoutSec: config.ai.review_timeout_sec,
    });
    if (judgeRes.ok && judgeRes.data) {
      const judge = judgeRes.data as unknown as JudgeOutput;
      writeAiArtifact(ctx, "judge", judgeRes.data, judgeRes.raw);
      for (const id of judge.accepted_finding_ids) {
        const f = ledger.get(id.trim());
        if (f && f.final_status === "suspected") ledger.setStatus(id.trim(), "confirmed", "accepted by judge (evidence-based)");
      }
      for (const id of judge.rejected_finding_ids) {
        const f = ledger.get(id.trim());
        if (f && !f.deterministic_evidence) ledger.setStatus(id.trim(), "rejected", "rejected by judge");
      }
    } else {
      console.warn(`[judge] failed: ${judgeRes.error?.slice(0, 160)}`);
      ctx.saveAiFailure("judge", `${judgeRes.error ?? "unknown"} (${judgeRes.duration_ms}ms)`, judgeRes.raw);
    }
  }

  // ---- report ----
  const report = generateReport(ctx, {
    kind: "audit",
    targetRoot,
    gates: gateResults,
    findings: ledger.all(),
    specContracts,
    architecture,
    mutationSurvivedCount,
    mutationSkippedReason,
    driftFiles,
    aiEnabled: config.ai.enabled,
    aiAvailable: runner.available,
  });
  updateManifest(ctx, gateResults, ledger);
  const summaryJson = ctx.readArtifact("summary.json") ?? "{}";
  const verdict = verdictOf(summaryJson);
  console.log(`[report] ${report.mdPath}`);
  console.log(`[audit] verdict: ${verdict.toUpperCase()} — findings: ${ledger.all().length}`);
  return { runId: ctx.runId, runDir: ctx.runDir, verdict };
}

function verdictOf(summaryJson: string): "pass" | "fail" {
  try {
    const s = JSON.parse(summaryJson) as { unresolved_critical_high?: number; gates?: Array<{ passed: boolean }> };
    const gatesOk = (s.gates ?? []).every((g) => g.passed);
    return gatesOk && (s.unresolved_critical_high ?? 0) === 0 ? "pass" : "fail";
  } catch {
    return "fail";
  }
}

function updateManifest(ctx: RunContext, gates: readonly import("../types.ts").GateResult[], ledger: FindingLedger): void {
  const manifestPath = ctx.path("manifest.json");
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    // fresh
  }
  manifest["finished_at"] = new Date().toISOString();
  manifest["gates"] = gates;
  manifest["finding_count"] = ledger.all().length;
  ctx.writeManifest(manifest);
}

const AI_CATEGORY_SET = new Set([
  "logic",
  "test-quality",
  "race",
  "data-integrity",
  "spec-mismatch",
  "boundary",
  "security",
  "performance",
  "regression",
]);

type AiItem = ReviewOutput["findings"][number];

function addAiFinding(ledger: FindingLedger, ctx: RunContext, role: string, item: AiItem): void {
  if (!AI_CATEGORY_SET.has(item.category)) item.category = "logic";
  const finding = createFinding({
    run_id: ctx.runId,
    target: ctx.targetRoot,
    category: item.category as Finding["category"],
    severity: normalizeSeverity(item.severity),
    title: `${item.title}`,
    claim: item.claim,
    evidence: item.evidence ? `[${role}] ${item.evidence}` : `[${role}]`,
    source_location: item.source_location,
    reproduction: item.reproduction,
    expected: item.expected,
    actual: item.actual,
    confidence: clamp01(item.confidence ?? 0.5),
    deterministic_evidence: false,
    final_status: "suspected",
  });
  ledger.add(finding);
}

function normalizeSeverity(s: string): "critical" | "high" | "medium" | "low" {
  return s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "medium";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function detectDrift(targetRoot: string, before: Record<string, string>, isExcluded: (rel: string) => boolean): string[] {
  const after = recordBaseline(targetRoot, [], isExcluded).files;
  const drift: string[] = [];
  for (const [file, hash] of Object.entries(after)) {
    if (before[file] !== hash) drift.push(file);
  }
  for (const file of Object.keys(before)) {
    if (!(file in after)) drift.push(`${file} (deleted)`);
  }
  return drift;
}

function writeAiArtifact(ctx: RunContext, role: string, data: unknown, raw?: string): void {
  ctx.writeArtifact(`ai/${role}.json`, JSON.stringify(data, null, 2));
  if (raw) ctx.writeArtifact(`ai/${role}.raw.txt`, raw);
}

export function resolveTargetRoot(input: string): string {
  const r = resolve(input);
  if (!existsSync(r)) throw new Error(`target root does not exist: ${r}`);
  return r;
}

export function defaultRunsRoot(): string {
  return join(process.cwd(), "runs");
}

let cachedVersion: string | undefined;
export function version(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}
