import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runRole } from "../ai/invoke.ts";
import type { ReviewOutput, VerifierOutput } from "../ai/parse.ts";
import { SCHEMAS } from "../ai/parse.ts";
import { OpencodeRunner, NoopRunner } from "../ai/runner.ts";
import type { AgentRunner } from "../ai/runner.ts";
import { ADVERSARIAL_PROMPT, adversarialRetestPrompt, verifierPrompt } from "../ai/prompts.ts";
import { runCommand } from "../core/exec.ts";
import { runEvaluation } from "./evaluate.ts";

export interface CandidateVerificationResult {
  candidate: "naive" | "correct";
  intended_correct: boolean;
  fail_first_confirmed: boolean;
  post_fix_tests_passed: boolean;
  oracle_correct: boolean;
  verifier_verdict?: "verified" | "refuted";
  verifier_error?: string;
  adversarial_findings: ReviewOutput["findings"];
  adversarial_error?: string;
  adversarial_critical_high: number;
  final_status: "verified" | "fixed_unverified" | "failed" | "unmeasured";
}

export interface FalseVerificationMetrics {
  verified_fixes: number;
  false_verified_fixes: number;
  false_verification_rate: number | null;
  correct_candidates: number;
  correct_candidates_verified: number;
  repair_success: number | null;
}

export interface FalseVerificationSummary {
  generated_at: string;
  fixture: "fixture-i";
  model: string | null;
  verifier_model: string | null;
  ai_measured: boolean;
  candidate_results: CandidateVerificationResult[];
  metrics: FalseVerificationMetrics;
  finding_precision: number | null;
  finding_recall: number | null;
  finding_false_positives: number | null;
  finding_eval_error?: string;
  output_file: string;
}

const NAIVE_SOURCE = [
  "\"use strict\";",
  "",
  "function normalizeTags(tags) {",
  "  if (!Array.isArray(tags)) return tags;",
  "  const seen = new Set();",
  "  const out = [];",
  "  for (const tag of tags) {",
  "    const key = String(tag).toLowerCase();",
  "    if (!seen.has(key)) {",
  "      seen.add(key);",
  "      out.push(tag);",
  "    }",
  "  }",
  "  return out;",
  "}",
  "",
  "module.exports = { normalizeTags };",
  "",
].join("\n");

const CORRECT_SOURCE = [
  "\"use strict\";",
  "",
  "function normalizeTags(tags) {",
  "  if (!Array.isArray(tags)) return [];",
  "  const seen = new Set();",
  "  const out = [];",
  "  for (const tag of tags) {",
  "    const key = String(tag).toLowerCase();",
  "    if (!seen.has(key)) {",
  "      seen.add(key);",
  "      out.push(tag);",
  "    }",
  "  }",
  "  return out;",
  "}",
  "",
  "module.exports = { normalizeTags };",
  "",
].join("\n");

const FAIL_FIRST_TEST = [
  "\"use strict\";",
  "const test = require(\"node:test\");",
  "const assert = require(\"node:assert/strict\");",
  "const { normalizeTags } = require(\"../src/normalize.js\");",
  "test(\"deduplicates case-insensitively while keeping first spelling\", () => {",
  "  assert.deepStrictEqual(normalizeTags([\"React\", \"react\"]), [\"React\"]);",
  "});",
  "",
].join("\n");

const ORACLE_PROBE = [
  "\"use strict\";",
  "const assert = require(\"node:assert/strict\");",
  "const { normalizeTags } = require(\"./src/normalize.js\");",
  "assert.deepStrictEqual(normalizeTags([\"React\", \"react\"]), [\"React\"]);",
  "assert.deepStrictEqual(normalizeTags([\"React\", \"node\", \"react\", \"NODE\"]), [\"React\", \"node\"]);",
  "assert.deepStrictEqual(normalizeTags(\"react\"), []);",
  "",
].join("\n");

function projectRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

export function scoreFalseVerification(
  results: readonly CandidateVerificationResult[],
): FalseVerificationMetrics {
  const verified = results.filter((r) => r.final_status === "verified");
  const falseVerified = verified.filter((r) => !r.oracle_correct);
  const correct = results.filter((r) => r.intended_correct);
  const correctVerified = correct.filter((r) => r.final_status === "verified" && r.oracle_correct);
  return {
    verified_fixes: verified.length,
    false_verified_fixes: falseVerified.length,
    false_verification_rate: verified.length === 0 ? null : falseVerified.length / verified.length,
    correct_candidates: correct.length,
    correct_candidates_verified: correctVerified.length,
    repair_success: correct.length === 0 ? null : correctVerified.length / correct.length,
  };
}

async function verifyCandidate(opts: {
  candidate: "naive" | "correct";
  source: string;
  intendedCorrect: boolean;
  runner: AgentRunner;
  model?: string;
  verifierModel?: string;
  timeoutSec: number;
  aiEnabled: boolean;
  artifactDir: string;
}): Promise<CandidateVerificationResult> {
  const fixture = join(projectRoot(), "fixtures", "fixture-i");
  const ws = mkdtempSync(join(tmpdir(), "agentic-qa-fvr-" + opts.candidate + "-"));
  try {
    cpSync(fixture, ws, { recursive: true });
    const failFirstPath = join(ws, "test", "fvr-fail-first.test.js");
    writeFileSync(failFirstPath, FAIL_FIRST_TEST, "utf8");

    const pre = await runCommand({ cmd: "npm test", cwd: ws, timeout_sec: 60 });
    const failFirstConfirmed = pre.exit_code !== 0 && !pre.timed_out;

    const original = readFileSync(join(ws, "src", "normalize.js"), "utf8");
    writeFileSync(join(ws, "src", "normalize.js"), opts.source, "utf8");
    const post = await runCommand({ cmd: "npm test", cwd: ws, timeout_sec: 60 });
    const postPassed = post.exit_code === 0 && !post.timed_out;
    writeFileSync(join(ws, "fvr-oracle.cjs"), ORACLE_PROBE, "utf8");
    const oracle = await runCommand({ cmd: "node fvr-oracle.cjs", cwd: ws, timeout_sec: 30 });
    const oracleCorrect = oracle.exit_code === 0 && !oracle.timed_out;

    const base: CandidateVerificationResult = {
      candidate: opts.candidate,
      intended_correct: opts.intendedCorrect,
      fail_first_confirmed: failFirstConfirmed,
      post_fix_tests_passed: postPassed,
      oracle_correct: oracleCorrect,
      adversarial_findings: [],
      adversarial_critical_high: 0,
      final_status: opts.aiEnabled ? "failed" : "unmeasured",
    };

    if (!opts.aiEnabled || !opts.runner.available || !postPassed || !failFirstConfirmed) {
      if (opts.aiEnabled && !opts.runner.available) base.verifier_error = "OpenCode runner unavailable";
      if (opts.aiEnabled && (!postPassed || !failFirstConfirmed)) base.final_status = "failed";
      return base;
    }

    const changedFiles = ["src/normalize.js", "test/fvr-fail-first.test.js"];
    const diffSummary = [
      "--- src/normalize.js (original)",
      original,
      "+++ src/normalize.js (" + opts.candidate + " candidate)",
      opts.source,
      "+++ test/fvr-fail-first.test.js",
      FAIL_FIRST_TEST,
    ].join("\n");
    const testEvidence = [
      "fail-first test failed before candidate: " + String(failFirstConfirmed),
      "full npm test after candidate: " + (postPassed ? "PASS" : "FAIL"),
    ].join("\n");
    const title = "normalizeTags does not deduplicate tags case-insensitively";
    const claim = "The implementation violates the documented case-insensitive deduplication contract.";

    const verifier = await runRole<VerifierOutput>(opts.runner, {
      cwd: ws,
      agent: "plan",
      model: opts.verifierModel ?? opts.model,
      title: "aq-fvr-verifier-" + opts.candidate,
      promptBody: verifierPrompt({
        findingTitle: title,
        findingClaim: claim,
        diffSummary,
        testEvidence,
        changedFiles,
      }),
      schema: SCHEMAS.verifier,
      timeoutSec: opts.timeoutSec,
    });
    base.verifier_verdict = verifier.data?.verdict;
    if (!verifier.ok) base.verifier_error = verifier.error;

    const adversarial = await runRole<ReviewOutput>(opts.runner, {
      cwd: ws,
      agent: "plan",
      model: opts.model,
      title: "aq-fvr-adversarial-" + opts.candidate,
      promptBody:
        adversarialRetestPrompt({
          findingTitle: title,
          findingClaim: claim,
          changedFiles,
        }) +
        "\n\nReference on general attack classes:\n" +
        ADVERSARIAL_PROMPT.split("JSON SCHEMA")[0],
      schema: SCHEMAS.review,
      timeoutSec: opts.timeoutSec,
    });
    base.adversarial_findings = adversarial.data?.findings ?? [];
    if (!adversarial.ok) base.adversarial_error = adversarial.error;
    base.adversarial_critical_high = base.adversarial_findings.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    ).length;

    if (!verifier.ok || !adversarial.ok) {
      base.final_status = "fixed_unverified";
    } else if (
      base.verifier_verdict === "verified" &&
      base.adversarial_critical_high === 0 &&
      failFirstConfirmed &&
      postPassed
    ) {
      base.final_status = "verified";
    } else {
      base.final_status = "fixed_unverified";
    }

    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, opts.candidate + ".json"),
      JSON.stringify(
        {
          result: base,
          verifier: verifier.data ?? { error: verifier.error },
          adversarial: adversarial.data ?? { error: adversarial.error },
        },
        null,
        2,
      ),
      "utf8",
    );
    return base;
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

export async function runFalseVerificationBenchmark(opts: {
  aiEnabled: boolean;
  model?: string;
  verifierModel?: string;
  reviewTimeoutSec?: number;
}): Promise<FalseVerificationSummary> {
  if (opts.aiEnabled && !opts.model) {
    throw new Error("eval-fvr requires explicit --model when AI is enabled; use --no-ai for the deterministic probe");
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const outputDir = join(process.cwd(), "runs", "fvr-" + stamp);
  mkdirSync(outputDir, { recursive: true });
  const artifactDir = join(outputDir, "candidates");
  const runner: AgentRunner = opts.aiEnabled ? new OpencodeRunner() : new NoopRunner();
  const timeoutSec = opts.reviewTimeoutSec ?? 180;

  const candidateResults = [];
  candidateResults.push(
    await verifyCandidate({
      candidate: "naive",
      source: NAIVE_SOURCE,
      intendedCorrect: false,
      runner,
      model: opts.model,
      verifierModel: opts.verifierModel,
      timeoutSec,
      aiEnabled: opts.aiEnabled,
      artifactDir,
    }),
  );
  candidateResults.push(
    await verifyCandidate({
      candidate: "correct",
      source: CORRECT_SOURCE,
      intendedCorrect: true,
      runner,
      model: opts.model,
      verifierModel: opts.verifierModel,
      timeoutSec,
      aiEnabled: opts.aiEnabled,
      artifactDir,
    }),
  );

  let findingPrecision: number | null = null;
  let findingRecall: number | null = null;
  let findingFalsePositives: number | null = null;
  let findingEvalError: string | undefined;
  if (opts.aiEnabled && runner.available) {
    try {
      const evalSummary = await runEvaluation({
        aiEnabled: true,
        only: ["fixture-i"],
        model: opts.model,
        reviewTimeoutSec: timeoutSec,
      });
      findingRecall =
        evalSummary.total_expected === 0 ? null : evalSummary.total_detected / evalSummary.total_expected;
      findingFalsePositives = evalSummary.total_false_positives;
      const reported = evalSummary.total_detected + evalSummary.total_false_positives;
      findingPrecision = reported === 0 ? null : evalSummary.total_detected / reported;
    } catch (err) {
      findingEvalError = err instanceof Error ? err.message : String(err);
    }
  } else if (opts.aiEnabled) {
    findingEvalError = "OpenCode runner unavailable";
  }

  const outputFile = join(outputDir, "false-verification-summary.json");
  const summary: FalseVerificationSummary = {
    generated_at: new Date().toISOString(),
    fixture: "fixture-i",
    model: opts.model ?? null,
    verifier_model: opts.verifierModel ?? opts.model ?? null,
    ai_measured: opts.aiEnabled && runner.available,
    candidate_results: candidateResults,
    metrics: scoreFalseVerification(candidateResults),
    finding_precision: findingPrecision,
    finding_recall: findingRecall,
    finding_false_positives: findingFalsePositives,
    finding_eval_error: findingEvalError,
    output_file: outputFile,
  };
  writeFileSync(outputFile, JSON.stringify(summary, null, 2), "utf8");
  console.log("[fvr] summary: " + outputFile);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
