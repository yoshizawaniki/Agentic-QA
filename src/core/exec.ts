import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Redactor } from "../util/redact.ts";

export interface ExecResult {
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  stdout_file: string;
  stderr_file: string;
  stdout_preview: string;
  stderr_preview: string;
}

export interface ExecOptions {
  cmd: string;
  cwd: string;
  env?: Record<string, string>;
  timeout_sec?: number;
  log_dir?: string;
  file_prefix?: string;
  redactor?: Redactor;
  max_stdin?: boolean;
}

const PREVIEW_LIMIT = 4000;

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      spawn("kill", ["-9", "-" + pid], { stdio: "ignore" });
    }
  } catch {
    // best effort
  }
}

export async function runCommand(opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const timeoutMs = (opts.timeout_sec ?? 300) * 1000;
  const isWin = process.platform === "win32";
  // On Windows we must control quoting ourselves: cmd.exe /S removes only the
  // OUTER quote pair, preserving embedded quotes. Node's default arg quoting
  // would add an extra layer and corrupt commands like: -m "two words".
  const shell = isWin ? process.env["ComSpec"] ?? "cmd.exe" : "/bin/sh";
  const child = isWin
    ? spawn(shell, ["/d", "/s", "/c", `"${opts.cmd}"`], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawn(shell, ["-c", opts.cmd], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) killTree(child.pid);
  }, timeoutMs);

  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => {
    outChunks.push(c);
  });
  child.stderr.on("data", (c: Buffer) => {
    errChunks.push(c);
  });

  const code: number | null = await new Promise((resolvePromise) => {
    child.on("error", () => resolvePromise(-1));
    child.on("close", (c) => resolvePromise(c));
  });
  clearTimeout(timer);
  stdout = Buffer.concat(outChunks).toString("utf8");
  stderr = Buffer.concat(errChunks).toString("utf8");

  const redact = opts.redactor?.redact ?? ((s: string) => s);
  const stdoutR = redact(stdout);
  const stderrR = redact(stderr);

  let stdoutFile = "";
  let stderrFile = "";
  if (opts.log_dir) {
    mkdirSync(opts.log_dir, { recursive: true });
    const prefix = opts.file_prefix ?? "cmd";
    stdoutFile = join(opts.log_dir, `${prefix}.out.log`);
    stderrFile = join(opts.log_dir, `${prefix}.err.log`);
    writeFileSync(stdoutFile, stdoutR, "utf8");
    writeFileSync(stderrFile, stderrR, "utf8");
  }

  return {
    exit_code: code,
    timed_out: timedOut,
    duration_ms: Date.now() - started,
    stdout_file: stdoutFile,
    stderr_file: stderrFile,
    stdout_preview: stdoutR.slice(0, PREVIEW_LIMIT),
    stderr_preview: stderrR.slice(0, PREVIEW_LIMIT),
  };
}
