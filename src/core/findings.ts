import { randomBytes } from "node:crypto";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding, FindingStatus, Severity, SourceLocation } from "../types.ts";
import { shortHash } from "../util/ids.ts";

const VALID_STATUSES: readonly FindingStatus[] = [
  "suspected",
  "reproduced",
  "confirmed",
  "fixing",
  "fixed_unverified",
  "verified",
  "rejected",
  "duplicate",
  "blocked",
];

export function findingKey(f: {
  category: string;
  source_location?: SourceLocation;
  title: string;
}): string {
  const file = (f.source_location?.file ?? "").replace(/\\/g, "/").toLowerCase();
  const titleWords = f.title.toLowerCase().split(/\s+/).slice(0, 6).join("-");
  return `${f.category}::${file}::${shortHash(titleWords)}`;
}

const STOPWORDS = new Set([
  "the", "a", "an", "for", "of", "in", "on", "at", "to", "is", "are", "was",
  "with", "and", "or", "not", "no", "missing", "test", "tests", "this", "that",
]);

/** Jaccard similarity over significant word tokens of two titles. */
export function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Near-duplicate decision threshold used by the ledger. */
export const NEAR_DUP_THRESHOLD = 0.35;

export function createFinding(input: Omit<Finding, "id" | "created_at" | "status_history">): Finding {
  return {
    ...input,
    id: `F-${shortHash(`${findingKey(input)}-${randomBytes(2).toString("hex")}`)}`,
    created_at: new Date().toISOString(),
    status_history: [{ status: input.final_status, at: new Date().toISOString() }],
  };
}

export class FindingLedger {
  private findings = new Map<string, Finding>();
  readonly filePath: string;

  constructor(runDir: string) {
    this.filePath = join(runDir, "findings.jsonl");
    if (existsSync(this.filePath)) this.load();
  }

  private load(): void {
    const lines = readFileSync(this.filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const f = JSON.parse(line) as Finding;
        this.findings.set(f.id, f);
      } catch {
        // resilient to partial writes
      }
    }
  }

  private persist(): void {
    const all = [...this.findings.values()].map((f) => JSON.stringify(f)).join("\n");
    writeFileSync(this.filePath, all + (all ? "\n" : ""), "utf8");
  }

  add(finding: Finding): { added: boolean; duplicateOf?: Finding } {
    for (const existing of this.findings.values()) {
      if (existing.final_status === "rejected") continue;
      const sameLoc =
        existing.category === finding.category &&
        normalizeLoc(existing.source_location) === normalizeLoc(finding.source_location);
      // near-duplicate: same category + same file + high title overlap
      let nearDup = false;
      if (existing.category === finding.category) {
        const locA = normalizeLoc(existing.source_location);
        const locB = normalizeLoc(finding.source_location);
        if (locA !== "" && locA === locB && titleSimilarity(existing.title, finding.title) >= NEAR_DUP_THRESHOLD) {
          nearDup = true;
        }
      }
      if (sameLoc || nearDup) {
        return { added: false, duplicateOf: existing };
      }
    }
    this.findings.set(finding.id, finding);
    appendFileSync(this.filePath, JSON.stringify(finding) + "\n", "utf8");
    return { added: true };
  }

  setStatus(id: string, status: FindingStatus, note?: string): Finding | undefined {
    const f = this.findings.get(id);
    if (!f) return undefined;
    if (!VALID_STATUSES.includes(status)) throw new Error(`invalid status ${status}`);
    f.final_status = status;
    f.status_history.push({ status, at: new Date().toISOString(), note });
    if (status === "verified") f.verified_at = new Date().toISOString();
    this.persist();
    return f;
  }

  patch(id: string, patch: Partial<Finding>): Finding | undefined {
    const f = this.findings.get(id);
    if (!f) return undefined;
    Object.assign(f, patch);
    this.persist();
    return f;
  }

  get(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  all(): Finding[] {
    return [...this.findings.values()];
  }

  byStatus(...statuses: FindingStatus[]): Finding[] {
    return this.all().filter((f) => statuses.includes(f.final_status));
  }
}

function normalizeLoc(loc?: SourceLocation): string {
  if (!loc?.file) return "";
  return loc.file.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
