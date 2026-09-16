import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../core/exec.ts";
import type { RunContext } from "../core/evidence.ts";
import type { Finding } from "../types.ts";
import { createFinding } from "../core/findings.ts";
import { collectTextFiles } from "./static.ts";

interface MutationRule {
  name: string;
  re: RegExp;
  replacement: string;
}

const RULES: readonly MutationRule[] = [
  { name: "=== -> !==", re: /===/g, replacement: "!==" },
  { name: "!== -> ===", re: /!==/g, replacement: "===" },
  { name: "<= -> <", re: /<=/g, replacement: "<" },
  { name: "< -> <=", re: /(?<![<!=<>])<(?![<=])/g, replacement: "<=" },
  { name: ">= -> >", re: />=/g, replacement: ">" },
  { name: "> -> >=", re: /(?<![>!=<>-])>(?![>=])/g, replacement: ">=" },
  { name: "&& -> ||", re: /&&/g, replacement: "||" },
  { name: "|| -> &&", re: /\|\|/g, replacement: "&&" },
];

export interface MutationOptions {
  workspaceRoot: string;
  includeGlobs?: readonly string[];
  excludeTests?: boolean;
  maxMutants: number;
  timeoutSec: number;
  testCmd: string;
  ctx: RunContext;
}

export interface SurvivedMutant {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

export async function runMutationTesting(opts: MutationOptions): Promise<Finding[]> {
  const srcFiles = selectSourceFiles(opts.workspaceRoot, opts.includeGlobs ?? []);
  const candidates = enumerateCandidates(srcFiles);
  if (candidates.length === 0) return [];

  const selected = pickSpread(candidates, opts.maxMutants);
  const survived: SurvivedMutant[] = [];

  for (const cand of selected) {
    let original = "";
    try {
      original = readFileSync(cand.absPath, "utf8");
    } catch {
      continue;
    }
    const mutated =
      original.slice(0, cand.index) +
      cand.replacement +
      original.slice(cand.index + cand.matchLength);
    if (!isPlausiblyValid(mutated)) continue;
    try {
      writeFileSync(cand.absPath, mutated, "utf8");
      const res = await runCommand({
        cmd: opts.testCmd,
        cwd: opts.workspaceRoot,
        timeout_sec: opts.timeoutSec,
        log_dir: opts.ctx.path("logs"),
        file_prefix: `mutation-${cand.file.replace(/[\\/]/g, "_")}-${cand.line}`,
        redactor: { redact: (s) => opts.ctx.redact(s) },
      });
      opts.ctx.logCommand({
        phase: "mutation",
        cmd: `${opts.testCmd}  [mutant: ${cand.rule} @ ${cand.file}:${cand.line}]`,
        cwd: opts.workspaceRoot,
        exit_code: res.exit_code,
        timed_out: res.timed_out,
        duration_ms: res.duration_ms,
      });
      // mutant SURVIVED if suite still green => tests don't cover this behavior
      const killed = res.exit_code !== 0 || res.timed_out;
      if (!killed) {
        survived.push({
          file: cand.file,
          line: cand.line,
          rule: cand.rule,
          snippet: extractLine(original, cand.index),
        });
      }
    } finally {
      writeFileSync(cand.absPath, original, "utf8");
    }
  }

  return survived.map((m) =>
    createFinding({
      run_id: opts.ctx.runId,
      target: opts.ctx.targetRoot,
      category: "test-quality",
      severity: "medium",
      title: `Test suite does not detect behavioral change (${m.rule}) at ${m.file}:${m.line}`,
      claim: `Mutating \`${m.snippet}\` (${m.rule}) leaves the entire test suite green. Tests do not pin this behavior.`,
      evidence: `mutation executed against ${opts.testCmd}; mutant survived`,
      source_location: { file: m.file, line: m.line },
      confidence: 0.95,
      deterministic_evidence: true,
      suggested_fix: "Add a failing-first assertion covering this branch/boundary.",
      final_status: "confirmed",
    }),
  );
}

interface Candidate {
  absPath: string;
  file: string;
  index: number;
  matchLength: number;
  replacement: string;
  rule: string;
  line: number;
}

function enumerateCandidates(files: Array<{ rel: string; abs: string }>): Candidate[] {
  const out: Candidate[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(f.abs, "utf8");
    } catch {
      continue;
    }
    if (content.length > 300_000) continue;
    for (const rule of RULES) {
      const re = new RegExp(rule.re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const line = content.slice(0, m.index).split(/\r?\n/).length;
        const lineText = extractLine(content, m.index);
        if (/^\s*(\/\/|\*|#)/.test(lineText)) continue;
        out.push({
          absPath: f.abs,
          file: f.rel,
          index: m.index,
          matchLength: m[0].length,
          replacement: rule.replacement,
          rule: rule.name,
          line,
        });
        if (out.length > 5000) return out;
      }
    }
  }
  return out;
}

function pickSpread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const picked: T[] = [];
  for (let i = 0; i < count; i++) picked.push(items[Math.floor(i * step)]);
  return picked;
}

function extractLine(content: string, index: number): string {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  let lineEnd = content.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = content.length;
  return content.slice(lineStart, lineEnd).trim().slice(0, 120);
}

function isPlausiblyValid(_src: string): boolean {
  return true;
}

function matchesInclude(rel: string, includes: readonly string[]): boolean {
  if (includes.length === 0) return true;
  const norm = rel.replace(/\\/g, "/");
  return includes.some((inc) => {
    const pattern = inc.replace(/\\/g, "/").replace(/^\.\//, "");
    if (pattern.endsWith("/**")) return norm.startsWith(pattern.slice(0, -3));
    if (pattern.includes("*")) {
      const rx = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
      return rx.test(norm);
    }
    return norm.startsWith(pattern);
  });
}

function looksLikeTestFile(rel: string): boolean {
  const n = rel.toLowerCase();
  return (
    n.includes("/__tests__/") ||
    n.startsWith("test/") ||
    n.startsWith("tests/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(n)
  );
}

export function selectSourceFiles(root: string, includeGlobs: readonly string[]): Array<{ rel: string; abs: string }> {
  const all = collectTextFiles(root, "").filter((rel) => /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(rel));
  return all
    .filter((rel) => matchesInclude(rel, includeGlobs) && !looksLikeTestFile(rel))
    .map((rel) => ({ rel, abs: join(root, rel) }));
}
