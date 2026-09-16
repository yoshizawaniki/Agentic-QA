import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../types.ts";
import type { RunContext } from "../core/evidence.ts";
import { createFinding } from "../core/findings.ts";

const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json", ".md",
  ".yml", ".yaml", ".env.example", ".txt", ".html", ".css", ".py", ".sh", ".ps1",
  ".sql", ".toml", ".xml", "",
]);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, "OpenAI-style API key literal"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id literal"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, "GitHub token literal"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, "JWT literal in source"],
];

const PLACEHOLDER_OK = /(your[_-]?key|xxx+|example|placeholder|<[^>]+>|\$\{|\bprocess\.env\b|changeme|dummy)/i;

export function scanSecrets(targetRoot: string, ctx: RunContext, isExcluded?: (rel: string) => boolean): Finding[] {
  const findings: Finding[] = [];
  const files = collectTextFiles(targetRoot, "", isExcluded);
  for (const rel of files) {
    const lower = rel.toLowerCase();
    if (lower.endsWith(".env") || /(^|\/)\.env\./.test(lower)) continue; // never read .env contents
    let content: string;
    try {
      content = readFileSync(join(targetRoot, rel), "utf8");
    } catch {
      continue;
    }
    for (const [re, label] of SECRET_PATTERNS) {
      const m = re.exec(content);
      if (m && !PLACEHOLDER_OK.test(m[0])) {
        const line = content.slice(0, m.index ?? 0).split(/\r?\n/).length;
        // Context awareness: a file that tests the redactor itself legitimately
        // contains fake key literals. Keep visibility, drop severity/confidence.
        const looksLikeRedactorSelfTest =
          /\[REDACTED/i.test(content) || /util\/redact/.test(content);
        findings.push(
          createFinding({
            run_id: ctx.runId,
            target: ctx.targetRoot,
            category: "secret-exposure",
            severity: looksLikeRedactorSelfTest ? "low" : "critical",
            title: `${looksLikeRedactorSelfTest ? "[likely self-test] " : ""}Possible ${label} committed in ${rel}`,
            claim: `Source file contains what looks like a ${label}.${looksLikeRedactorSelfTest ? " File appears to be a redactor self-test with fixture literals." : ""}`,
            evidence: "static secret scan (deterministic pattern match)",
            source_location: { file: rel, line },
            confidence: looksLikeRedactorSelfTest ? 0.3 : 0.8,
            deterministic_evidence: true,
            final_status: "confirmed",
          }),
        );
        break;
      }
    }
  }
  return findings;
}

export function checkReadmeClaims(targetRoot: string, gatesPassed: boolean, ctx: RunContext): Finding | null {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const p = join(targetRoot, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const claimsPass = /(all tests? pass(ed|ing)?|テスト(は)?(全て|すべて)?合格|tests? .*green|100%\s*pass)/i;
    if (!gatesPassed && claimsPass.test(text)) {
      return createFinding({
        run_id: ctx.runId,
        target: ctx.targetRoot,
        category: "doc-integrity",
        severity: "high",
        title: `README claims passing tests but deterministic gates fail`,
        claim: `${name} asserts test success while the executed test gate fails. Documentation contradicts executable evidence.`,
        evidence: "gate execution result vs README text (deterministic)",
        source_location: { file: name },
        confidence: 1,
        deterministic_evidence: true,
        final_status: "confirmed",
      });
    }
    void text;
  }
  return null;
}

export function collectTextFiles(root: string, relPrefix: string, isExcluded?: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const absDir = join(root, relPrefix);
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (["node_modules", ".git", "_trash", "_data-sync", "dist", "build", "runs"].includes(entry.name)) continue;
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (isExcluded?.(rel)) continue;
    if (entry.isDirectory()) out.push(...collectTextFiles(root, rel, isExcluded));
    else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      if (TEXT_EXT.has(ext.toLowerCase())) out.push(rel);
    } else if (entry.isSymbolicLink()) {
      try {
        statSync(join(root, rel));
      } catch {
        // broken symlink
      }
    }
  }
  return out;
}
