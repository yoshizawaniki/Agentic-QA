import { resolveConfig } from "../config/load.ts";
import type { ConfigOverrides } from "../config/load.ts";
import { createRedactor } from "../util/redact.ts";
import { FindingLedger } from "../core/findings.ts";
import { RunContext } from "../core/evidence.ts";
import { runRepair } from "./repair.ts";
import type { FixOutcome } from "./repair.ts";
import { resolveTargetRoot, defaultRunsRoot, version } from "./audit.ts";

export interface CampaignOptions extends ConfigOverrides {
  rounds?: number;
  maxFixes?: number;
}

export interface RoundSummary {
  round: number;
  run_id: string;
  verified_this_round: number;
  unresolved_critical_high: number;
  open_candidates_left: number;
  stopped_reason?: string;
}

export async function runCampaign(
  targetRootInput: string,
  opts: CampaignOptions = {},
  runsRoot = defaultRunsRoot(),
): Promise<{ runId: string; rounds: RoundSummary[] }> {
  const targetRoot = resolveTargetRoot(targetRootInput);
  const { config } = resolveConfig(targetRoot, opts);
  const redactor = createRedactor(config.secrets_env);
  const ctx = new RunContext({ runsRoot, kind: "campaign", targetRoot, redactor });
  const maxRounds = Math.max(1, opts.rounds ?? config.limits.campaign_max_rounds);
  console.log(`[campaign] ${ctx.runId} target=${ctx.redact(targetRoot)} max_rounds=${maxRounds}`);

  ctx.writeManifest({
    run_id: ctx.runId,
    kind: "campaign",
    target_root: ctx.redact(targetRoot),
    started_at: new Date().toISOString(),
    agentic_qa_version: version(),
    ai_enabled: config.ai.enabled,
    max_rounds: maxRounds,
  });

  const summaries: RoundSummary[] = [];
  let prevRunId: string | undefined;

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n[campaign] ===== ROUND ${round}/${maxRounds} =====`);
    const repairRes = await runRepair(
      targetRoot,
      { ...opts, fromRun: prevRunId },
      runsRoot,
    );
    prevRunId = repairRes.runId;

    const ledger = new FindingLedger(repairRes.runDir);
    const unresolvedCriticalHigh = ledger.all().filter(
      (f) =>
        (f.severity === "critical" || f.severity === "high") &&
        !["rejected", "duplicate", "verified"].includes(f.final_status),
    ).length;
    const verifiedThisRound = repairRes.outcomes.filter((o) => o.status === "verified").length;
    const openLeft = ledger.byStatus("suspected", "confirmed", "reproduced").length;

    const summary: RoundSummary = {
      round,
      run_id: repairRes.runId,
      verified_this_round: verifiedThisRound,
      unresolved_critical_high: unresolvedCriticalHigh,
      open_candidates_left: openLeft,
    };

    // ---- evidence-based stop conditions (never consensus-based) ----
    if (unresolvedCriticalHigh === 0 && openLeft === 0) {
      summary.stopped_reason = "no unresolved findings remain";
      summaries.push(summary);
      break;
    }
    if (unresolvedCriticalHigh === 0 && verifiedThisRound === 0) {
      summary.stopped_reason = "no progress this round and no unresolved critical/high";
      summaries.push(summary);
      break;
    }
    if (round === maxRounds) {
      summary.stopped_reason = "round cap reached";
      summaries.push(summary);
      break;
    }
    summaries.push(summary);
  }

  ctx.writeArtifact("campaign-summary.json", JSON.stringify(summaries, null, 2));
  ctx.writeManifest({
    run_id: ctx.runId,
    kind: "campaign",
    target_root: ctx.redact(targetRoot),
    started_at: ctx.path("manifest.json") ? new Date().toISOString() : new Date().toISOString(),
    agentic_qa_version: version(),
    rounds_completed: summaries.length,
    rounds: summaries,
  });

  const totalVerified = summaries.reduce((n, s) => n + s.verified_this_round, 0);
  console.log(`\n[campaign] finished after ${summaries.length} round(s); verified fixes total: ${totalVerified}`);
  return { runId: ctx.runId, rounds: summaries };
}
