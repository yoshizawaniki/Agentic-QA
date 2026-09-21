import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveConfig } from "../config/load.ts";
import type { ConfigOverrides } from "../config/load.ts";
import type { TargetConfig } from "../config/detect.ts";
import { createRedactor } from "../util/redact.ts";
import { readJsonl } from "../util/jsonl.ts";
import { RunContext } from "../core/evidence.ts";
import { FindingLedger, createFinding } from "../core/findings.ts";
import { recordBaseline } from "../core/baseline.ts";
import { makeExclusionMatcher, sandboxDiff, listChangedFiles } from "../core/sandbox.ts";
import { prepareGateWorkspace } from "../core/workspace.ts";
import { runGates } from "../gates/index.ts";
import type { GateResult } from "../types.ts";
import { scanSecrets } from "../gates/static.ts";
import { runMutationTesting } from "../gates/mutation.ts";
import { runInvariants } from "../gates/invariants.ts";
import { OpencodeRunner, NoopRunner } from "../ai/runner.ts";
import type { AgentRunner } from "../ai/runner.ts";
import { runRole } from "../ai/invoke.ts";
import type { ReviewOutput, VerifierOutput, ImplementerOutput, TestDesignerOutput } from "../ai/parse.ts";
import { SCHEMAS } from "../ai/parse.ts";
import {
  ADVERSARIAL_PROMPT,
  IMPLEMENTER_SCHEMA,
  TEST_DESIGNER_SCHEMA,
  implementerPrompt,
  testDesignerPrompt,
  verifierPrompt,
  adversarialRetestPrompt,
} from "../ai/prompts.ts";
import { generateReport } from "./report.ts";
import { SEVERITY_ORDER } from "../types.ts";
import type { Finding } from "../types.ts";
import { resolveTargetRoot, defaultRunsRoot, version } from "./audit.ts";

export interface RepairOptions extends ConfigOverrides {
  fromRun?: string;
  maxFixes?: number;
  competing?: number;
}

export interface FixOutcome {
  findingId: string;
  status: "verified" | "fixed_unverified" | "failed" | "blocked";
  failFirstTestWritten: boolean;
  failFirstConfirmedByExecution: boolean;
  gatesPassedAfterFix: boolean | null;
  verifierVerdict?: string;
  adversarialNewCriticalHigh: number;
  changedFiles: string[];
  notes: string[];
}

const DIFF_TRUNCATE = 12000;

function qaAgentsSourceDir(): string | null {
  const base = fileURLToPath(new URL("../../", import.meta.url));
  for (const rel of [".opencode/agent", ".opencode/agents"]) {
    const abs = join(base, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function copyQaAgentsIntoSandbox(wsRoot: string): void {
  const srcDir = qaAgentsSourceDir();
  if (!srcDir) return;
  const dstDir = join(wsRoot, ".opencode", "agent");
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".md")) copyFileSync(join(srcDir, f), join(dstDir, f));
  }
}

async function prepareSandbox(ctx: RunContext, targetRoot: string, config: TargetConfig, name: string): Promise<string> {
  const destRoot = ctx.path(name);
  await prepareGateWorkspace({
    targetRoot,
    destRoot,
    excludeGlobs: [...config.sandbox.exclude_globs, ...config.forbidden_paths],
    mode: config.sandbox.node_modules_mode,
  });
  copyQaAgentsIntoSandbox(destRoot);
  return destRoot;
}

export async function runRepair(
  targetRootInput: string,
  opts: RepairOptions = {},
  runsRoot = defaultRunsRoot(),
): Promise<{ runId: string; runDir: string; outcomes: FixOutcome[] }> {
  const targetRoot = resolveTargetRoot(targetRootInput);
  const { config, detected } = resolveConfig(targetRoot, opts);
  const redactor = createRedactor(config.secrets_env);
  const ctx = new RunContext({ runsRoot, kind: "repair", targetRoot, redactor });
  console.log(`[repair] run ${ctx.runId} target ${ctx.redact(targetRoot)}`);

  ctx.writeManifest({
    run_id: ctx.runId,
    kind: "repair",
    target_root: ctx.redact(targetRoot),
    started_at: new Date().toISOString(),
    agentic_qa_version: version(),
    ai_enabled: config.ai.enabled,
    detected,
    from_run: opts.fromRun ?? null,
  });

  const isExcluded = makeExclusionMatcher([...config.sandbox.exclude_globs, ...config.forbidden_paths]);
  const baseline = recordBaseline(targetRoot, [], isExcluded);
  ctx.writeArtifact("baseline/baseline.json", JSON.stringify(baseline, null, 2));

  const wsRoot = await prepareSandbox(ctx, targetRoot, config, "workspace");
  console.log("[sandbox] prepared (node_modules mode=" + config.sandbox.node_modules_mode + ")");

  console.log("[gates] baseline...");
  const baseGates = await runGates({ config, cwd: wsRoot, ctx, phase: "baseline" });
  logGates(baseGates);

  const ledger = new FindingLedger(ctx.runDir);
  if (opts.fromRun) {
    const imported = importFindingsFromRun(runsRoot, opts.fromRun, ctx.runId, targetRoot);
    for (const f of imported) ledger.add(f);
    console.log(`[ledger] imported ${imported.length} findings from run ${opts.fromRun}`);
  }
  for (const f of scanSecrets(targetRoot, ctx, isExcluded)) ledger.add(f);

  let mutationSurvivedCount = 0;
  let mutationSkippedReason: string | undefined;
  if (!config.mutation.enabled) {
    mutationSkippedReason = "disabled by config";
  } else if (!baseGates.some((g) => g.name === "test" && !g.skipped_reason)) {
    mutationSkippedReason = "no test gate";
  } else {
    const mf = await runMutationTesting({
      workspaceRoot: wsRoot,
      includeGlobs: config.mutation.include,
      maxMutants: config.mutation.max_mutants,
      timeoutSec: config.mutation.timeout_sec,
      testCmd: config.gates.test?.cmd ?? "npm test",
      ctx,
    });
    for (const f of mf) ledger.add(f);
    mutationSurvivedCount = mf.length;
  }

  // declared invariants run in the sandbox too — violations become fixable findings
  await runInvariants(ctx, wsRoot, config, ledger);

  const fixable = ledger
    .all()
    .filter((f) => ["suspected", "confirmed", "reproduced"].includes(f.final_status))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const maxFixes = Math.max(1, opts.maxFixes ?? 3);
  const candidates = fixable.slice(0, maxFixes);
  console.log(`[repair] candidates: ${candidates.map((c) => c.id).join(", ") || "(none)"}`);

  const runner: AgentRunner = config.ai.enabled ? new OpencodeRunner() : new NoopRunner();
  if (!runner.available && candidates.length > 0) {
    console.warn("[repair] AI unavailable — findings recorded, no fixes attempted");
  }

  const outcomes: FixOutcome[] = [];
  const competing = Math.max(1, opts.competing ?? 1);
  let promotedWsRoot: string | undefined;
  for (const finding of candidates) {
    if (!runner.available) {
      ledger.setStatus(finding.id, "blocked", "AI layer unavailable");
      outcomes.push(emptyOutcome(finding.id, "AI disabled"));
      continue;
    }
    if (competing > 1) {
      const entries: Array<{ outcome: FixOutcome; wsRoot: string }> = [];
      for (let i = 0; i < competing; i++) {
        const compWs = await prepareSandbox(ctx, targetRoot, config, `workspace-competing-${i + 1}`);
        const outcome = await attemptFix(ctx, compWs, finding, config, runner, ledger, `c${i + 1}`);
        entries.push({ outcome, wsRoot: compWs });
      }
      const best = pickBestCompeting(entries.map((e) => e.outcome));
      const bestEntry = entries.find((e) => e.outcome === best);
      applyOutcome(ctx, ledger, best);
      outcomes.push(best);
      // the winning sandbox becomes the canonical workspace of this run
      if (bestEntry && (best.status === "verified" || best.status === "fixed_unverified")) {
        promotedWsRoot = bestEntry.wsRoot;
      }
    } else {
      const outcome = await attemptFix(ctx, wsRoot, finding, config, runner, ledger, undefined);
      applyOutcome(ctx, ledger, outcome);
      outcomes.push(outcome);
    }
  }

  // promote the winning competing sandbox into <run>/workspace so that
  // patches/ and later `agentic-qa verify` operate on the actual chosen fix
  if (promotedWsRoot && promotedWsRoot !== wsRoot && existsSync(promotedWsRoot)) {
    rmSync(wsRoot, { recursive: true, force: true });
    renameSync(promotedWsRoot, wsRoot);
    console.log("[repair] winning competing sandbox promoted to workspace/");
  }

  const diff = await sandboxDiff(wsRoot, (s) => ctx.redact(s));
  if (diff.trim()) {
    ctx.writeArtifact("patches/all-fixes.patch", diff);
    console.log("[patch] patches/all-fixes.patch written");
  }

  // finalize manifest (finished_at / finding_count / gate results)
  try {
    const manifestPath = ctx.path("manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest["finished_at"] = new Date().toISOString();
    manifest["finding_count"] = ledger.all().length;
    manifest["gates"] = baseGates;
    manifest["outcomes"] = outcomes.map((o) => ({ findingId: o.findingId, status: o.status }));
    ctx.writeManifest(manifest);
  } catch {
    // manifest unreadable: non-fatal, evidence already on disk
  }

  const report = generateReport(ctx, {
    kind: "repair",
    targetRoot,
    gates: baseGates,
    findings: ledger.all(),
    mutationSurvivedCount,
    mutationSkippedReason,
    driftFiles: [],
    aiEnabled: config.ai.enabled,
    aiAvailable: runner.available,
    extraNotes: [
      "Original target was NOT modified. Fixes live in this run's workspace/ directory.",
      "Apply manually after review: patches/all-fixes.patch contains the combined diff.",
      "verified = deterministic gates pass + fail-first test reproduced the bug pre-fix + independent verifier confirmed.",
    ],
  });
  console.log(`[report] ${report.mdPath}`);
  return { runId: ctx.runId, runDir: ctx.runDir, outcomes };
}

function emptyOutcome(findingId: string, note: string): FixOutcome {
  return {
    findingId,
    status: "blocked",
    failFirstTestWritten: false,
    failFirstConfirmedByExecution: false,
    gatesPassedAfterFix: null,
    adversarialNewCriticalHigh: 0,
    changedFiles: [],
    notes: [note],
  };
}

function pickBestCompeting(candidates: readonly FixOutcome[]): FixOutcome {
  const score = (o: FixOutcome): number =>
    (o.status === "verified" ? 100 : o.status === "fixed_unverified" ? 60 : 0) +
    (o.gatesPassedAfterFix ? 20 : 0) +
    (o.failFirstConfirmedByExecution ? 10 : 0) -
    o.adversarialNewCriticalHigh * 30 -
    o.changedFiles.length;
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

function applyOutcome(ctx: RunContext, ledger: FindingLedger, outcome: FixOutcome): void {
  switch (outcome.status) {
    case "verified":
      ledger.patch(outcome.findingId, {
        implementer_status: "claimed_fixed",
        verifier_status: "verified",
      });
      ledger.setStatus(outcome.findingId, "verified", "gates pass + fail-first confirmed + independent verifier verified");
      break;
    case "fixed_unverified":
      ledger.patch(outcome.findingId, { implementer_status: "claimed_fixed", verifier_status: "not_verified" });
      ledger.setStatus(outcome.findingId, "fixed_unverified", outcome.notes.join("; "));
      break;
    case "failed":
      ledger.patch(outcome.findingId, { implementer_status: "could_not_fix" });
      ledger.setStatus(outcome.findingId, "blocked", outcome.notes.join("; "));
      break;
    case "blocked":
      ledger.setStatus(outcome.findingId, "blocked", outcome.notes.join("; "));
      break;
  }
  ctx.writeArtifact(`verifier/${outcome.findingId}.json`, JSON.stringify(outcome, null, 2));
}

async function attemptFix(
  ctx: RunContext,
  wsRoot: string,
  finding: Finding,
  config: TargetConfig,
  runner: AgentRunner,
  ledger: FindingLedger,
  labelSuffix?: string,
): Promise<FixOutcome> {
  const tag = (s: string) => s + (labelSuffix ? `-${labelSuffix}` : "");
  const notes: string[] = [];
  const model = config.ai.implementer_model ?? config.ai.reviewer_model;

  // ---- 1. fail-first test design ----
  console.log(`[fix] ${tag(finding.id)}: designing fail-first test`);
  const tdRes = await runRole<TestDesignerOutput>(runner, {
    cwd: wsRoot,
    agent: "qa-test-designer",
    model,
    title: tag(`aq-test-designer-${finding.id}`),
    promptBody: testDesignerPrompt({
      findingId: finding.id,
      findingTitle: finding.title,
      findingClaim: finding.claim,
      reproduction: finding.reproduction,
    }),
    schema: TEST_DESIGNER_SCHEMA,
    timeoutSec: config.ai.review_timeout_sec,
  });
  let failFirstWritten = false;
  let failFirstConfirmed = false;
  if (tdRes.ok && tdRes.data) {
    writeAiArtifact(ctx, tag(`test-designer-${finding.id}`), tdRes.data, tdRes.raw);
    failFirstWritten = true;
  } else {
    notes.push(`test-designer failed: ${tdRes.error?.slice(0, 140) ?? ""}`);
    ctx.saveAiFailure(tag(`test-designer-${finding.id}`), `${tdRes.error ?? "unknown"} (${tdRes.duration_ms}ms)`, tdRes.raw);
  }

  if (failFirstWritten) {
    const beforeFix = await runGates({ config, cwd: wsRoot, ctx, phase: tag("pre-fix"), selected: ["test"] });
    const t = beforeFix.find((g) => g.name === "test");
    failFirstConfirmed = !!t && t.exit_code !== null && !t.passed && !t.skipped_reason;
    notes.push(`fail-first execution: ${failFirstConfirmed ? "CONFIRMED FAILING before fix (bug reproduced)" : "did NOT fail before fix"}`);
    if (failFirstConfirmed) {
      ledger.setStatus(finding.id, "reproduced", "fail-first test failed against unfixed code");
    }
  }

  // ---- 2. isolated fix implementation ----
  console.log(`[fix] ${tag(finding.id)}: implementing in sandbox`);
  const implRes = await runRole<ImplementerOutput>(runner, {
    cwd: wsRoot,
    agent: "qa-implementer",
    model,
    title: tag(`aq-implementer-${finding.id}`),
    promptBody: implementerPrompt({
      findingId: finding.id,
      findingTitle: finding.title,
      findingClaim: finding.claim,
      suggestedFix: finding.suggested_fix,
      reproduction: finding.reproduction,
      failFirstTest: failFirstWritten ? tdRes.data?.test_files.join(", ") : undefined,
    }),
    schema: IMPLEMENTER_SCHEMA,
    timeoutSec: config.ai.review_timeout_sec,
  });

  let gatesAfter: GateResult[] = [];
  let gatesPassed: boolean | null = null;
  let changedFiles: string[] = [];

  if (implRes.ok && implRes.data) {
    writeAiArtifact(ctx, tag(`implementer-${finding.id}`), implRes.data, implRes.raw);
    changedFiles = await listChangedFiles(wsRoot);
    console.log(`[fix] ${tag(finding.id)}: changed ${changedFiles.length} files; running full regression`);
    gatesAfter = await runGates({ config, cwd: wsRoot, ctx, phase: tag("post-fix") });
    gatesPassed = gatesAfter.filter((g) => !g.skipped_reason).every((g) => g.passed);
    notes.push(`post-fix regression: ${gatesPassed ? "ALL PASS" : "FAIL"}`);
  } else {
    notes.push(`implementer failed: ${implRes.error?.slice(0, 140) ?? ""}`);
    ctx.saveAiFailure(tag(`implementer-${finding.id}`), `${implRes.error ?? "unknown"} (${implRes.duration_ms}ms)`, implRes.raw);
  }

  if (!gatesPassed) {
    return {
      findingId: finding.id,
      status: "failed",
      failFirstTestWritten: failFirstWritten,
      failFirstConfirmedByExecution: failFirstConfirmed,
      gatesPassedAfterFix: gatesPassed,
      adversarialNewCriticalHigh: 0,
      changedFiles,
      notes,
    };
  }

  // ---- hard evidence guard: a "fix" that changed nothing cannot be verified ----
  const diffText = (await sandboxDiff(wsRoot, (s) => ctx.redact(s))).slice(0, DIFF_TRUNCATE);
  if (changedFiles.length === 0 || diffText.trim().length === 0) {
    notes.push("EVIDENCE GUARD: no file changes detected despite claimed fix and passing gates");
    return {
      findingId: finding.id,
      status: "failed",
      failFirstTestWritten: failFirstWritten,
      failFirstConfirmedByExecution: failFirstConfirmed,
      gatesPassedAfterFix: gatesPassed,
      adversarialNewCriticalHigh: 0,
      changedFiles,
      notes,
    };
  }

  // ---- 3. independent verification (context-separated: no implementer rationale) ----
  let verifierVerdict: string | undefined;
  const testEvidence = [
    ...gatesAfter.filter((g) => !g.skipped_reason).map((g) => `${g.name}: ${g.passed ? "PASS" : "FAIL"} (${g.duration_ms}ms)`),
    `fail-first test written: ${failFirstWritten}; failed pre-fix: ${failFirstConfirmed}`,
  ].join("\n");

  console.log(`[fix] ${tag(finding.id)}: independent verification`);
  const verRes = await runRole<VerifierOutput>(runner, {
    cwd: wsRoot,
    agent: "plan",
    model: config.ai.verifier_model ?? config.ai.reviewer_model,
    title: tag(`aq-verifier-${finding.id}`),
    promptBody: verifierPrompt({
      findingTitle: finding.title,
      findingClaim: finding.claim,
      diffSummary: diffText,
      testEvidence,
      changedFiles,
    }),
    schema: SCHEMAS.verifier,
    timeoutSec: config.ai.review_timeout_sec,
  });
  if (verRes.ok && verRes.data) {
    verifierVerdict = verRes.data.verdict;
    writeAiArtifact(ctx, `verifier-${tag(finding.id)}`, verRes.data, verRes.raw);
  } else {
    notes.push(`verifier failed: ${verRes.error?.slice(0, 140) ?? ""}`);
    ctx.saveAiFailure(`verifier-${tag(finding.id)}`, `${verRes.error ?? "unknown"} (${verRes.duration_ms}ms)`, verRes.raw);
  }

  // ---- 4. adversarial retest ("break this fix") ----
  console.log(`[fix] ${tag(finding.id)}: adversarial retest`);
  let advCriticalHigh = 0;
  const advRes = await runRole<ReviewOutput>(runner, {
    cwd: wsRoot,
    agent: "plan",
    model: config.ai.reviewer_model,
    title: tag(`aq-adversarial-retest-${finding.id}`),
    promptBody:
      adversarialRetestPrompt({
        findingTitle: finding.title,
        findingClaim: finding.claim,
        changedFiles,
      }) + "\n\nReference on general attack classes:\n" + ADVERSARIAL_PROMPT.split("JSON SCHEMA")[0],
    schema: SCHEMAS.review,
    timeoutSec: config.ai.review_timeout_sec,
  });
  if (advRes.ok && advRes.data) {
    advCriticalHigh = addAdversarialFindings(ctx, ledger, advRes.data);
  }

  // ---- 5. evidence-based final decision ----
  if (verifierVerdict === "verified" && failFirstConfirmed && advCriticalHigh === 0) {
    return {
      findingId: finding.id,
      status: "verified",
      failFirstTestWritten: failFirstWritten,
      failFirstConfirmedByExecution: failFirstConfirmed,
      gatesPassedAfterFix: gatesPassed,
      verifierVerdict,
      adversarialNewCriticalHigh: advCriticalHigh,
      changedFiles,
      notes,
    };
  }
  notes.push(`independent confirmation incomplete: verifier=${verifierVerdict ?? "n/a"}, adversarial high/critical=${advCriticalHigh}, fail-first=${failFirstConfirmed}`);
  return {
    findingId: finding.id,
    status: "fixed_unverified",
    failFirstTestWritten: failFirstWritten,
    failFirstConfirmedByExecution: failFirstConfirmed,
    gatesPassedAfterFix: gatesPassed,
    verifierVerdict,
    adversarialNewCriticalHigh: advCriticalHigh,
    changedFiles,
    notes,
  };
}

function addAdversarialFindings(ctx: RunContext, ledger: FindingLedger, output: ReviewOutput): number {
  let criticalHigh = 0;
  for (const item of output.findings) {
    if (item.severity === "critical" || item.severity === "high") criticalHigh++;
    const category = (
      ["logic", "race", "boundary", "security", "performance", "data-integrity", "regression", "spec-mismatch", "test-quality"].includes(item.category)
        ? item.category
        : "logic"
    ) as Finding["category"];
    const severity = (
      ["critical", "high", "medium", "low"].includes(item.severity) ? item.severity : "medium"
    ) as Finding["severity"];
    ledger.add(
      createFinding({
        run_id: ctx.runId,
        target: ctx.targetRoot,
        category,
        severity,
        title: `[adversarial-retest] ${item.title}`,
        claim: item.claim,
        evidence: `[adversarial-retest] ${item.evidence ?? ""}`,
        source_location: item.source_location,
        confidence: item.confidence ?? 0.5,
        deterministic_evidence: false,
        final_status: "suspected",
      }),
    );
  }
  return criticalHigh;
}

function writeAiArtifact(ctx: RunContext, role: string, data: unknown, raw?: string): void {
  ctx.writeArtifact(`ai/${role}.json`, JSON.stringify(data, null, 2));
  if (raw) ctx.writeArtifact(`ai/${role}.raw.txt`, raw);
}

function logGates(gates: readonly GateResult[]): void {  for (const g of gates) {
    if (g.skipped_reason) console.log(`[gate] ${g.name}: skipped (${g.skipped_reason})`);
    else console.log(`[gate] ${g.name}: ${g.passed ? "PASS" : "FAIL"} (${g.duration_ms}ms)`);
  }
}

function importFindingsFromRun(runsRoot: string, fromRunId: string, newRunId: string, target: string): Finding[] {
  const path = resolveRunDir(runsRoot, fromRunId);
  return readJsonl<Finding>(path)
    .filter((f) => !["rejected", "duplicate"].includes(f.final_status))
    .map((f) => ({
      ...f,
      run_id: newRunId,
      target,
      final_status: f.final_status === "verified" ? "confirmed" : f.final_status,
      status_history: [
        ...f.status_history,
        { status: f.final_status, at: new Date().toISOString(), note: `imported from run ${fromRunId}` },
      ],
    }));
}

function resolveRunDir(runsRoot: string, fromRunId: string): string {
  const direct = join(runsRoot, fromRunId, "findings.jsonl");
  if (existsSync(direct)) return direct;
  // nested layout e.g. runs/<label>/<runId>/findings.jsonl — search both the
  // requested runs root and the project-global ./runs directory
  for (const root of new Set([runsRoot, join(process.cwd(), "runs")])) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(root, entry.name, fromRunId, "findings.jsonl");
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // unreadable dir
    }
  }
  const asPath = existsSync(fromRunId) ? (existsSync(join(fromRunId, "findings.jsonl")) ? join(fromRunId, "findings.jsonl") : fromRunId) : null;
  if (asPath) return asPath;
  throw new Error(`run not found: ${fromRunId}`);
}
