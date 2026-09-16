import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "../config/load.ts";
import { createRedactor } from "../util/redact.ts";
import { FindingLedger } from "../core/findings.ts";
import { RunContext } from "../core/evidence.ts";
import { runGates } from "../gates/index.ts";
import { sandboxDiff } from "../core/sandbox.ts";
import { OpencodeRunner } from "../ai/runner.ts";
import { runRole } from "../ai/invoke.ts";
import type { VerifierOutput } from "../ai/parse.ts";
import { SCHEMAS } from "../ai/parse.ts";
import { verifierPrompt } from "../ai/prompts.ts";
import type { Finding } from "../types.ts";

export interface VerifyResult {
  runId: string;
  gatesAllPassed: boolean;
  reconfirmed: string[];
  downgraded: string[];
  refuted: string[];
}

/**
 * Re-run EXECUTED verification for an existing repair run:
 * 1. deterministic gates in the stored isolated workspace (fresh execution)
 * 2. independent verifier re-judgment of each fixed finding against the current diff
 */
export async function runVerify(runIdOrPath: string): Promise<VerifyResult> {
  const runDir = resolveRunDir(runIdOrPath);
  const workspaceRoot = join(runDir, "workspace");
  if (!existsSync(workspaceRoot)) throw new Error(`no workspace stored in run: ${runDir}`);

  const ledger = new FindingLedger(runDir);
  // target root recorded at repair time; config comes from the ORIGINAL target
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readManifest(runDir)) as Record<string, unknown>;
  } catch {
    throw new Error(`manifest.json unreadable in ${runDir}`);
  }
  const targetRoot = String(manifest["target_root"] ?? "");
  if (!targetRoot || !existsSync(targetRoot)) throw new Error("original target root no longer exists");

  const { config } = resolveConfig(targetRoot, {});
  const redactor = createRedactor(config.secrets_env);
  const ctx = new RunContext({
    runsRoot: join(runDir, ".."),
    kind: "verify",
    targetRoot,
    redactor,
    existingRunId: basename(runDir),
  });

  console.log(`[verify] re-running deterministic gates on ${runDir}`);
  const gateResults = await runGates({ config, cwd: workspaceRoot, ctx, phase: "verify" });
  const gatesAllPassed = gateResults.filter((g) => !g.skipped_reason).every((g) => g.passed);
  ctx.writeArtifact("verify/gates.json", JSON.stringify(gateResults, null, 2));
  logGates(gateResults);

  const diffText = await sandboxDiff(workspaceRoot, (s) => ctx.redact(s));

  const result: VerifyResult = {
    runId: basename(runDir),
    gatesAllPassed,
    reconfirmed: [],
    downgraded: [],
    refuted: [],
  };

  const fixedFindings = ledger.all().filter((f) =>
    ["verified", "fixed_unverified"].includes(f.final_status),
  );

  if (!gatesAllPassed) {
    // executed evidence overrides any earlier status
    for (const f of fixedFindings) {
      ledger.setStatus(f.id, "fixed_unverified", `reverification: regression detected — gates now FAIL`);
      result.downgraded.push(f.id);
    }
    console.error("[verify] REGRESSION: post-fix gates fail. All fixed findings downgraded to fixed_unverified.");
    return result;
  }

  const runner = new OpencodeRunner();
  for (const f of fixedFindings) {
    if (!runner.available) break;
    console.log(`[verify] independent re-verification of ${f.id}`);
    const res = await runRole<VerifierOutput>(runner, {
      cwd: workspaceRoot,
      agent: "plan",
      model: config.ai.verifier_model ?? config.ai.reviewer_model,
      title: `aq-reverify-${f.id}`,
      promptBody: verifierPrompt({
        findingTitle: f.title,
        findingClaim: f.claim,
        diffSummary: diffText.slice(0, 12000),
        testEvidence: `fresh re-execution after storage: ALL GATES PASS\n${gateResults
          .filter((g) => !g.skipped_reason)
          .map((g) => `${g.name}: PASS`)
          .join("\n")}`,
        changedFiles: changedFilesHint(f),
      }),
      schema: SCHEMAS.verifier,
      timeoutSec: config.ai.review_timeout_sec,
    });
    if (res.ok && res.data) {
      if (res.data.verdict === "verified" && f.final_status !== "verified") {
        ledger.setStatus(f.id, "verified", "reverification passed");
        result.reconfirmed.push(f.id);
      } else if (res.data.verdict === "refuted") {
        ledger.setStatus(f.id, "rejected", `reverification refuted: ${res.data.reasoning_brief.slice(0, 200)}`);
        result.refuted.push(f.id);
      }
    } else {
      console.warn(`[verify] re-verification of ${f.id} failed: ${res.error?.slice(0, 160)}`);
    }
  }

  ctx.writeArtifact("verify/result.json", JSON.stringify(result, null, 2));
  console.log(
    `[verify] done — gates:${gatesAllPassed ? "PASS" : "FAIL"} reconfirmed=${result.reconfirmed.length} downgraded=${result.downgraded.length} refuted=${result.refuted.length}`,
  );
  return result;
}

function changedFilesHint(f: Finding): string[] {
  return f.source_location?.file ? [f.source_location.file] : [];
}

function resolveRunDir(input: string): string {
  const asPath = resolve(input);
  if (existsSync(join(asPath, "findings.jsonl"))) return asPath;
  const runsDir = join(process.cwd(), "runs");
  const byId = join(runsDir, input);
  if (existsSync(join(byId, "findings.jsonl"))) return byId;
  // one-level nesting (e.g. runs/repair-smoke/<id>, runs/eval-*/<id>)
  try {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(runsDir, entry.name, input);
      if (existsSync(join(candidate, "findings.jsonl"))) return candidate;
    }
  } catch {
    // runs dir missing
  }
  throw new Error(`run not found (pass a run id under ./runs or a run directory path): ${input}`);
}

function readManifest(runDir: string): string {
  try {
    return readFileSync(join(runDir, "manifest.json"), "utf8");
  } catch {
    return "";
  }
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx === -1 ? norm : norm.slice(idx + 1);
}

function logGates(gates: readonly import("../types.ts").GateResult[]): void {
  for (const g of gates) {
    if (g.skipped_reason) continue;
    console.log(`[gate] ${g.name}: ${g.passed ? "PASS" : "FAIL"} (${g.duration_ms}ms)`);
  }
}
