import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface AiRunRequest {
  cwd: string;
  agent: string;
  model?: string;
  title: string;
  prompt: string;
  timeoutSec: number;
}

export interface AiRunResult {
  ok: boolean;
  output: string;
  error?: string;
  duration_ms: number;
}

export interface AgentRunner {
  run(req: AiRunRequest): Promise<AiRunResult>;
  readonly name: string;
  readonly available: boolean;
}

function findOpencodeBinary(): string | null {
  const envBin = process.env["AGENTIC_QA_OPENCODE_BIN"];
  if (envBin && existsSync(envBin)) return envBin;
  const pkgRoot = process.cwd();
  for (const candidate of [
    join(pkgRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    join(pkgRoot, "node_modules", "opencode-ai", "bin", "opencode"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface RunProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnCapture(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<RunProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (r: RunProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolvePromise(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // best effort
      }
      // guarantee resolution even if the tree refuses to die
      forceTimer = setTimeout(() => finish({ code: null, stdout, stderr, timedOut }), 15000);
    }, timeoutMs);
    let forceTimer: NodeJS.Timeout | undefined;
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (err) => {
      finish({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

export class OpencodeRunner implements AgentRunner {
  readonly name = "opencode-cli";
  private binPath: string | null;

  constructor() {
    this.binPath = findOpencodeBinary();
  }

  get available(): boolean {
    return this.binPath !== null;
  }

  async run(req: AiRunRequest): Promise<AiRunResult> {
    if (!this.binPath) return { ok: false, output: "", error: "opencode binary not found", duration_ms: 0 };
    const started = Date.now();
    const args = ["run", "--dir", req.cwd, "--agent", req.agent, "--title", req.title];
    if (req.model) args.push("--model", req.model);
    args.push(req.prompt);
    const res = await spawnCapture(this.binPath, args, req.cwd, req.timeoutSec * 1000);
    const ok = res.code === 0 && !res.timedOut;
    const combined = res.stdout + "\n" + res.stderr;
    if (/rate.?limit|quota.*exceeded|429/i.test(combined)) {
      return {
        ok: false,
        output: "",
        error: `model rate-limited/quota exceeded (${req.model ?? "default"})`,
        duration_ms: Date.now() - started,
      };
    }
    if (/no endpoints found|support tool use/i.test(combined)) {
      const firstLine =
        combined.split(/\r?\n/).find((l) => /error|endpoint|tool use/i.test(l))?.trim() ?? "";
      return {
        ok: false,
        output: "",
        error: `model cannot run tools — the resolved default model may be non-tool-capable. Pass --model explicitly. (${firstLine.slice(0, 160)})`,
        duration_ms: Date.now() - started,
      };
    }
    if (ok && res.stdout.trim().length < 25 && !res.stderr.trim()) {
      return {
        ok: false,
        output: "",
        error: "empty agent response (provider throttling or model produced nothing)",
        duration_ms: Date.now() - started,
      };
    }
    return {
      ok,
      output: res.stdout || res.stderr,
      error: res.timedOut
        ? `timed out after ${req.timeoutSec}s`
        : ok
          ? undefined
          : `exit ${res.code}: ${res.stderr.slice(0, 500)}`,
      duration_ms: Date.now() - started,
    };
  }
}

export class NoopRunner implements AgentRunner {
  readonly name = "noop";
  readonly available = false;
  async run(_req: AiRunRequest): Promise<AiRunResult> {
    return { ok: false, output: "", error: "AI disabled (--no-ai)", duration_ms: 0 };
  }
}
