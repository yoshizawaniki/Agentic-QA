import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendJsonl } from "../util/jsonl.ts";
import type { Redactor } from "../util/redact.ts";
import { runId } from "../util/ids.ts";
import type { GateResult } from "../types.ts";

export interface CommandLogEntry {
  at: string;
  phase: string;
  cmd: string;
  cwd: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  stdout_file?: string;
  stderr_file?: string;
}

export class RunContext {
  readonly runId: string;
  readonly runsRootDir: string;
  readonly runDir: string;
  readonly kind: string;
  readonly targetRoot: string;
  private redactor: Redactor;
  private commandLogPath: string;

  constructor(opts: {
    runsRoot: string;
    kind: string;
    targetRoot: string;
    redactor: Redactor;
    existingRunId?: string;
  }) {
    this.runId = opts.existingRunId ?? runId();
    // absolute paths are mandatory: spawned agents chdir into these
    this.runsRootDir = resolve(opts.runsRoot);
    this.targetRoot = resolve(opts.targetRoot);
    this.runDir = join(this.runsRootDir, this.runId);
    this.kind = opts.kind;
    this.redactor = opts.redactor;
    mkdirSync(this.runDir, { recursive: true });
    for (const sub of ["logs", "findings", "ai", "patches", "verifier", "baseline"]) {
      mkdirSync(join(this.runDir, sub), { recursive: true });
    }
    this.commandLogPath = join(this.runDir, "commands.jsonl");
  }

  redact(text: string): string {
    return this.redactor.redact(text);
  }

  logCommand(entry: Omit<CommandLogEntry, "at" | "cmd"> & { cmd: string }): void {
    appendJsonl(this.commandLogPath, {
      ...entry,
      at: new Date().toISOString(),
      cmd: this.redactor.redact(entry.cmd),
      cwd: entry.cwd,
    });
  }

  path(...parts: string[]): string {
    return join(this.runDir, ...parts);
  }

  writeArtifact(relPath: string, content: string): string {
    const abs = this.path(...relPath.split("/"));
    const dir = abs.slice(0, Math.max(abs.lastIndexOf("\\"), abs.lastIndexOf("/")));
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, content, "utf8");
    return abs;
  }

  readArtifact(relPath: string): string | null {
    const abs = this.path(...relPath.split("/"));
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }

  writeManifest(manifest: Record<string, unknown>): void {
    writeFileSync(join(this.runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  recordGate(gate: GateResult): void {
    appendJsonl(join(this.runDir, "gates.jsonl"), gate);
  }

  /** Persist failed AI role invocations for post-mortem (never silent). */
  saveAiFailure(role: string, error: string | undefined, raw?: string): void {
    const safe = role.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60);
    writeFileSync(
      join(this.runDir, "ai", `${safe}.failed.json`),
      JSON.stringify({ role, error: error ?? "unknown", at: new Date().toISOString() }, null, 2),
      "utf8",
    );
    if (raw) {
      const redacted = this.redactor.redact(raw);
      writeFileSync(join(this.runDir, "ai", `${safe}.failed.txt`), redacted, "utf8");
    }
  }
}
