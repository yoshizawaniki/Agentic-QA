#!/usr/bin/env node
import { runAudit, resolveTargetRoot, defaultRunsRoot } from "./pipeline/audit.ts";
import { runRepair } from "./pipeline/repair.ts";
import type { RepairOptions } from "./pipeline/repair.ts";
import { runCampaign } from "./pipeline/campaign.ts";
import type { CampaignOptions } from "./pipeline/campaign.ts";
import { runVerify } from "./pipeline/verifyRun.ts";

const USAGE = `agentic-qa — autonomous QA orchestration with deterministic evidence

Usage:
  agentic-qa audit <target>       read-only audit (deterministic gates + AI review)
  agentic-qa repair <target>      isolated fix pipeline in sandbox
  agentic-qa campaign <target>    multi-round verify+fix until stop conditions
  agentic-qa verify <runId>       re-run executed verification for a stored run
  agentic-qa init-config <target> write a qa.config.json template into target

Common options:
  --no-ai                  deterministic layers only (no model calls)
  --model <provider/id>    reviewer model override (e.g. openrouter/qwen3-coder:free)
  --verifier-model <id>    independent verifier model
  --implementer-model <id> implementer model
  --max-mutants <n>        mutation testing budget (default 8)
  --no-mutation            skip mutation testing
  --from-run <runId>       seed repair findings from a previous audit/repair run
  --max-fixes <n>          max findings to attempt per repair round (default 3)
  --competing <n>          competing fix candidates for the top finding (default 1)
  --rounds <n>             campaign round cap
`;

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      if (!flags["command"]) flags["command"] = arg;
      else positional.push(arg);
      i += 1;
    }
  }
  return { command: flags["command"] as string | undefined, positional, flags };
}

function overridesFromFlags(flags: Record<string, string | boolean>): RepairOptions & CampaignOptions {
  const o: RepairOptions & CampaignOptions = {};
  if (flags["no-ai"] === true) o.aiEnabled = false;
  if (typeof flags["model"] === "string") o.reviewerModel = flags["model"];
  if (typeof flags["verifier-model"] === "string") o.verifierModel = flags["verifier-model"];
  if (typeof flags["implementer-model"] === "string") o.implementerModel = flags["implementer-model"];
  if (typeof flags["review-timeout"] === "string") o.reviewTimeoutSec = Number(flags["review-timeout"]);
  if (typeof flags["max-mutants"] === "string") o.maxMutants = Number(flags["max-mutants"]);
  if (flags["no-mutation"] === true) o.mutationEnabled = false;
  if (typeof flags["from-run"] === "string") o.fromRun = flags["from-run"];
  if (typeof flags["max-fixes"] === "string") o.maxFixes = Number(flags["max-fixes"]);
  if (typeof flags["competing"] === "string") o.competing = Number(flags["competing"]);
  if (typeof flags["rounds"] === "string") o.rounds = Number(flags["rounds"]);
  return o;
}

function requireTarget(args: ParsedArgs): string {
  const t = args.positional[0];
  if (!t) throw new Error("missing <target> argument");
  return resolveTargetRoot(t);
}

export function repairExitCode(verified: number, notFixed: number): 0 | 1 {
  return notFixed > 0 && verified === 0 ? 1 : 0;
}

export function auditExitCode(verdict: string): 0 | 1 {
  return verdict === "pass" ? 0 : 1;
}

export function resolveRunsRoot(flags: Record<string, string | boolean>, cwdDefault: string): string {
  return typeof flags["runs-dir"] === "string" ? String(flags["runs-dir"]) : joinPath(cwdDefault, "runs");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const overrides = overridesFromFlags(args.flags);
  const runsRoot = resolveRunsRoot(args.flags, process.cwd());

  switch (args.command) {
    case "audit": {
      const res = await runAudit(requireTarget(args), overrides, runsRoot);
      return auditExitCode(res.verdict);
    }
    case "repair": {
      const res = await runRepair(requireTarget(args), overrides, runsRoot);
      const verified = res.outcomes.filter((o) => o.status === "verified").length;
      const failed = res.outcomes.filter((o) => o.status === "failed" || o.status === "blocked").length;
      console.log(`[repair] summary: ${verified} verified / ${res.outcomes.length} attempted (${failed} not fixed)`);
      return repairExitCode(verified, failed);
    }
    case "campaign": {
      const res = await runCampaign(requireTarget(args), overrides, runsRoot);
      const last = res.rounds[res.rounds.length - 1];
      return last && last.unresolved_critical_high === 0 ? 0 : 1;
    }
    case "verify": {
      const id = args.positional[0];
      if (!id) throw new Error("missing <runId> argument");
      const res = await runVerify(id);
      return res.gatesAllPassed ? 0 : 1;
    }
    case "init-config": {
      const target = requireTarget(args);
      const { CONFIG_EXAMPLE } = await import("./config/load.ts");
      const dest = joinPath(target, "qa.config.json");
      const { writeFileSync, existsSync } = await import("node:fs");
      if (existsSync(dest)) {
        console.error(`already exists: ${dest}`);
        return 1;
      }
      writeFileSync(dest, CONFIG_EXAMPLE, "utf8");
      console.log(`wrote ${dest}`);
      return 0;
    }
    case "eval": {
      const mod = await import("./eval/evaluate.ts");
      const aiEnabled = args.flags["ai"] === true;
      if (aiEnabled && typeof args.flags["model"] !== "string") {
        console.warn(
          "[eval] WARNING: --model not set. The opencode default model may be non-tool-capable and fail every role. Recommended: --model opencode/mimo-v2.5-free",
        );
      }
      const only = typeof args.flags["fixtures"] === "string"
        ? String(args.flags["fixtures"]).split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const summary = await mod.runEvaluation({
        aiEnabled,
        only,
        model: typeof args.flags["model"] === "string" ? String(args.flags["model"]) : undefined,
        reviewTimeoutSec: typeof args.flags["review-timeout"] === "string" ? Number(args.flags["review-timeout"]) : undefined,
      });
      return summary.allDetected ? 0 : 1;
    }
    case "eval-rescore": {
      const mod = await import("./eval/evaluate.ts");
      await mod.rescoreLatestAiRuns();
      return 0;
    }
    case "help":
    case undefined:
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${args.command}\n`);
      console.log(USAGE);
      return 2;
  }
}

function joinPath(a: string, b: string): string {
  // small helper to avoid importing path in the switch body
  return a.endsWith("/") || a.endsWith("\\") ? a + b : `${a}\\${b}`.replace(/\\\\/g, "\\");
}

const isDirectRun = process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("agentic-qa"));
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    });
}
