import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../core/exec.ts";
import type { RunContext } from "../core/evidence.ts";
import type { GateConfig, TargetConfig } from "../config/detect.ts";
import type { GateResult } from "../types.ts";

const GATE_ORDER: ReadonlyArray<keyof TargetConfig["gates"]> = [
  "typecheck",
  "lint",
  "build",
  "test",
  "integration_test",
];

export async function runGates(opts: {
  config: TargetConfig;
  cwd: string;
  ctx?: RunContext;
  phase?: string;
  selected?: ReadonlyArray<keyof TargetConfig["gates"]>;
  extraTimeoutSec?: number;
}): Promise<GateResult[]> {
  const results: GateResult[] = [];
  const keys = opts.selected ?? GATE_ORDER;
  for (const key of keys) {
    const gate: GateConfig | undefined = opts.config.gates[key];
    if (!gate) {
      results.push({
        name: key,
        cmd: "",
        exit_code: null,
        passed: true,
        timed_out: false,
        duration_ms: 0,
        skipped_reason: "not_configured",
      });
      continue;
    }
    if (!commandExists(gate.cmd, gate.cwd ?? opts.cwd)) {
      results.push({
        name: key,
        cmd: gate.cmd,
        exit_code: null,
        passed: false,
        timed_out: false,
        duration_ms: 0,
        skipped_reason: "command_not_found",
      });
      continue;
    }
    const res = await runCommand({
      cmd: gate.cmd,
      cwd: gate.cwd ? join(opts.cwd, gate.cwd) : opts.cwd,
      env: opts.config.environment,
      timeout_sec: (gate.timeout_sec ?? 300) + (opts.extraTimeoutSec ?? 0),
      log_dir: opts.ctx?.path("logs"),
      file_prefix: `${opts.phase ?? "gate"}-${key}`,
      redactor: opts.ctx ? { redact: (s) => opts.ctx!.redact(s) } : undefined,
    });
    const result: GateResult = {
      name: key,
      cmd: opts.ctx ? opts.ctx.redact(gate.cmd) : gate.cmd,
      exit_code: res.exit_code,
      passed: res.exit_code === 0 && !res.timed_out,
      timed_out: res.timed_out,
      duration_ms: res.duration_ms,
    };
    results.push(result);
    opts.ctx?.logCommand({
      phase: opts.phase ?? "gates",
      cmd: gate.cmd,
      cwd: gate.cwd ?? opts.cwd,
      exit_code: res.exit_code,
      timed_out: res.timed_out,
      duration_ms: res.duration_ms,
      stdout_file: res.stdout_file || undefined,
      stderr_file: res.stderr_file || undefined,
    });
    opts.ctx?.recordGate(result);
  }
  return results;
}

export function gatesAllPassed(results: readonly GateResult[]): boolean {
  return results.every((r) => r.passed);
}

function commandExists(cmd: string, cwd: string): boolean {
  // npm/npx/node/git are expected on PATH; local .bin scripts resolved by shell.
  void cwd;
  const bin = cmd.trim().split(/\s+/)[0];
  if (!bin) return false;
  if (["npm", "npx", "node", "git", "python", "python3", "py"].includes(bin)) return true;
  if (existsSync(join(cwd, "node_modules", ".bin", bin))) return true;
  return true; // let the shell report missing commands as failures with stderr captured
}
