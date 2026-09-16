import { runCommand } from "../core/exec.ts";
import type { RunContext } from "../core/evidence.ts";
import { createFinding } from "../core/findings.ts";
import type { FindingLedger } from "../core/findings.ts";
import type { Finding } from "../types.ts";
import type { TargetConfig } from "../config/detect.ts";

const INVARIANT_CATEGORIES = ["logic", "race", "data-integrity", "boundary", "security", "performance", "spec-mismatch"];

/**
 * Execute the target's declared invariant scripts (metamorphic/property checks).
 * A non-zero exit or timeout becomes a deterministic, confirmed finding.
 */
export async function runInvariants(
  ctx: RunContext,
  cwd: string,
  config: TargetConfig,
  ledger: FindingLedger,
): Promise<{ passed: number; violated: number }> {
  let passed = 0;
  let violated = 0;
  for (const inv of config.invariants) {
    const slug = inv.name.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    const res = await runCommand({
      cmd: inv.cmd,
      cwd,
      env: config.environment,
      timeout_sec: inv.timeout_sec ?? 180,
      log_dir: ctx.path("logs"),
      file_prefix: `invariant-${slug}`,
      redactor: { redact: (s) => ctx.redact(s) },
    });
    ctx.logCommand({
      phase: "invariant",
      cmd: inv.cmd,
      cwd,
      exit_code: res.exit_code,
      timed_out: res.timed_out,
      duration_ms: res.duration_ms,
      stdout_file: res.stdout_file || undefined,
      stderr_file: res.stderr_file || undefined,
    });
    const ok = res.exit_code === 0 && !res.timed_out;
    console.log(`[invariant] ${inv.name}: ${ok ? "PASS" : "VIOLATED"}`);
    if (ok) {
      passed++;
      continue;
    }
    violated++;
    ledger.add(
      createFinding({
        run_id: ctx.runId,
        target: ctx.targetRoot,
        category: (INVARIANT_CATEGORIES.includes(inv.category ?? "") ? inv.category : "data-integrity") as Finding["category"],
        severity: "high",
        title: `Invariant violated: ${inv.name}`,
        claim: `The declared invariant \`${inv.name}\` fails when executed against the current code.`,
        evidence: `exit=${res.exit_code}${res.timed_out ? " TIMED_OUT" : ""}; stderr: ${res.stderr_preview.slice(0, 600)}`,
        reproduction: inv.cmd,
        confidence: 1,
        deterministic_evidence: true,
        final_status: "confirmed",
      }),
    );
  }
  return { passed, violated };
}
