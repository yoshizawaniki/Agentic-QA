import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { runAudit } from "../pipeline/audit.ts";
import type { Finding } from "../types.ts";
import { SEVERITY_ORDER } from "../types.ts";

export interface ExpectedFinding {
  category: string;
  file?: string;
  keyword?: string;
  deterministic?: boolean;
}

export interface GoldenFile {
  fixture: string;
  description: string;
  expected: ExpectedFinding[];
  /**
   * Findings that are genuinely valid but not part of the planted-bug contract
   * (e.g. adjacent test-gap observations). They count toward neither recall nor
   * false positives — they are tracked as `adjacent_valid`.
   */
  expected_adjacent?: ExpectedFinding[];
  /** finding categories that may legitimately appear and are not counted as false positives */
  ignore_categories?: string[];
}

export interface FixtureScore {
  fixture: string;
  detected: number;
  expected: number;
  recall: number;
  matched: Array<{ category: string; file?: string; by: Finding["id"] }>;
  missed: ExpectedFinding[];
  falsePositives: Array<{ id: string; category: string; title: string }>;
  adjacentValid: Array<{ id: string; category: string; title: string }>;
}

export interface EvalSummary {
  generated_at: string;
  mode: "deterministic" | "ai";
  fixtures: FixtureScore[];
  total_expected: number;
  total_detected: number;
  macro_recall: number;
  total_false_positives: number;
  allDetected: boolean;
}

const FIXTURES_DIR = join(projectRoot(), "fixtures");

function projectRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

function fileURLToPath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:)/, "");
}

export function loadGoldens(): GoldenFile[] {
  const expectedDir = join(FIXTURES_DIR, "expected");
  if (!existsSync(expectedDir)) return [];
  return readdirSync(expectedDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      // strip UTF-8 BOM if present (Windows tooling tends to add it)
      const text = readFileSync(join(expectedDir, f), "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(text) as GoldenFile;
    });
}

export function matchesExpected(f: Finding, e: ExpectedFinding): boolean {
  const loc = (f.source_location?.file ?? "").replace(/\\/g, "/").toLowerCase();
  const wantLoc = e.file ? e.file.replace(/\\/g, "/").toLowerCase() : "";
  const locHit = wantLoc ? loc.includes(wantLoc) : false;
  const catHit = f.category === e.category || (e.category === "logic" && f.category === "boundary");
  // (a) category + location
  if (catHit && (!wantLoc || locHit)) return true;
  // (b) location anchor with any category (category wording varies across models)
  if (wantLoc && locHit && !e.keyword && !e.deterministic) return true;
  // (c) keyword anchor
  if (e.keyword) {
    const hay = `${f.title} ${f.claim}`.toLowerCase();
    if (hay.includes(e.keyword.toLowerCase()) && (!e.category || catHit)) return true;
  }
  return false;
}

export function scoreFindings(findings: readonly Finding[], golden: GoldenFile): FixtureScore {
  const ignore = new Set(golden.ignore_categories ?? []);
  const matched: FixtureScore["matched"] = [];
  const missed: ExpectedFinding[] = [];
  for (const e of golden.expected) {
    const hit = findings.find((f) => matchesExpected(f, e));
    if (hit) matched.push({ category: e.category, file: e.file, by: hit.id });
    else missed.push(e);
  }
  const isAdjacent = (f: Finding): boolean =>
    (golden.expected_adjacent ?? []).some((e) => matchesExpected(f, e));
  const fps = findings
    .filter((f) => !golden.expected.some((e) => matchesExpected(f, e)))
    .filter((f) => !isAdjacent(f))
    .filter((f) => !ignore.has(f.category))
    .filter((f) => !f.title.startsWith("[adversarial-retest]"));
  const adjacent = findings
    .filter((f) => !golden.expected.some((e) => matchesExpected(f, e)))
    .filter(isAdjacent);
  return {
    fixture: golden.fixture,
    detected: matched.length,
    expected: golden.expected.length,
    recall: golden.expected.length === 0 ? 1 : matched.length / golden.expected.length,
    matched,
    missed,
    falsePositives: fps.map((f) => ({ id: f.id, category: f.category, title: f.title })),
    adjacentValid: adjacent.map((f) => ({ id: f.id, category: f.category, title: f.title })),
  };
}

export async function runEvaluation(opts: {
  aiEnabled: boolean;
  fixturesDir?: string;
  only?: readonly string[];
  model?: string;
  reviewTimeoutSec?: number;
}): Promise<EvalSummary> {
  let goldens = loadGoldens();
  if (opts.only && opts.only.length > 0) {
    const wanted = new Set(opts.only.map((s) => s.toLowerCase()));
    goldens = goldens.filter((g) => wanted.has(g.fixture.toLowerCase()));
    if (goldens.length === 0) throw new Error(`no goldens matched: ${opts.only.join(", ")}`);
  }
  if (goldens.length === 0) throw new Error(`no golden files in ${join(FIXTURES_DIR, "expected")}`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const runsRoot = join(projectRoot(), "runs", `eval-${stamp}-${opts.aiEnabled ? "ai" : "det"}`);
  mkdirSync(runsRoot, { recursive: true });

  const scores: FixtureScore[] = [];
  for (const golden of goldens) {
    const fixtureDir = opts.fixturesDir ?? join(FIXTURES_DIR, golden.fixture);
    if (!existsSync(fixtureDir)) {
      scores.push(emptyScore(golden.fixture));
      continue;
    }
    console.log(`\n[eval] ===== ${golden.fixture} (${opts.aiEnabled ? "AI" : "deterministic"} mode) =====`);
    const audit = await runAudit(
      fixtureDir,
      { aiEnabled: opts.aiEnabled, reviewerModel: opts.model, reviewTimeoutSec: opts.reviewTimeoutSec },
      runsRoot,
    );
    const findings = readFindings(audit.runDir);
    scores.push(scoreFindings(findings, golden));
  }

  const totalExpected = scores.reduce((n, s) => n + s.expected, 0);
  const totalDetected = scores.reduce((n, s) => n + s.detected, 0);
  const summary: EvalSummary = {
    generated_at: new Date().toISOString(),
    mode: opts.aiEnabled ? "ai" : "deterministic",
    fixtures: scores,
    total_expected: totalExpected,
    total_detected: totalDetected,
    macro_recall: totalExpected === 0 ? 1 : totalDetected / totalExpected,
    total_false_positives: scores.reduce((n, s) => n + s.falsePositives.length, 0),
    allDetected: totalDetected === totalExpected,
  };
  const outPath = join(runsRoot, "eval-summary.json");
  mkdirSync(runsRoot, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  printSummary(summary, outPath);
  return summary;
}

function readFindings(runDir: string): Finding[] {
  const p = join(runDir, "findings.jsonl");
  if (!existsSync(p)) return [];
  const out: Finding[] = [];
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Finding);
    } catch {
      // skip
    }
  }
  return out.filter((f) => f.final_status !== "rejected" && f.final_status !== "duplicate");
}

/**
 * Re-score previously produced AI audit runs against the CURRENT goldens
 * without executing anything new (quota-free).
 */
export async function rescoreLatestAiRuns(): Promise<EvalSummary> {
  const goldens = loadGoldens();
  const goldenByName = new Map(goldens.map((g) => [g.fixture, g]));
  const latestByFixture = new Map<string, { dir: string; runName: string }>();
  const runsRoot = join(projectRoot(), "runs");
  for (const evalRoot of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!evalRoot.isDirectory() || !evalRoot.name.startsWith("eval-") || !evalRoot.name.endsWith("-ai")) continue;
    for (const run of readdirSync(join(runsRoot, evalRoot.name), { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const runDir = join(runsRoot, evalRoot.name, run.name);
      const manifestPath = join(runDir, "manifest.json");
      if (!existsSync(manifestPath) || !existsSync(join(runDir, "findings.jsonl"))) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as { target_root?: string };
        const target = manifest.target_root ?? "";
        const name = basename(target);
        if (!goldenByName.has(name)) continue;
        const prev = latestByFixture.get(name);
        if (!prev || run.name > prev.runName) latestByFixture.set(name, { dir: runDir, runName: run.name });
      } catch {
        // unreadable manifest
      }
    }
  }
  const scores: FixtureScore[] = [];
  for (const golden of goldens) {
    const entry = latestByFixture.get(golden.fixture);
    if (!entry) {
      scores.push(emptyScore(golden.fixture));
      continue;
    }
    scores.push(scoreFindings(readFindings(entry.dir), golden));
  }
  const totalExpected = scores.reduce((n, s) => n + s.expected, 0);
  const totalDetected = scores.reduce((n, s) => n + s.detected, 0);
  const summary: EvalSummary = {
    generated_at: new Date().toISOString(),
    mode: "ai",
    fixtures: scores,
    total_expected: totalExpected,
    total_detected: totalDetected,
    macro_recall: totalExpected === 0 ? 1 : totalDetected / totalExpected,
    total_false_positives: scores.reduce((n, s) => n + s.falsePositives.length, 0),
    allDetected: totalDetected === totalExpected,
  };
  const outPath = join(runsRoot, `eval-rescore-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  printSummary(summary, outPath);
  console.log(`rescored runs: ${[...latestByFixture.entries()].map(([k, v]) => `${k}=${v.dir}`).join(", ")}`);
  return summary;
}

function emptyScore(name: string): FixtureScore {
  return { fixture: name, detected: 0, expected: 0, recall: 0, matched: [], missed: [], falsePositives: [], adjacentValid: [] };
}

function printSummary(s: EvalSummary, outPath: string): void {
  console.log("\n================ EVALUATION SUMMARY ================");
  console.log(`mode: ${s.mode}`);
  for (const f of s.fixtures) {
    console.log(
      `${f.fixture.padEnd(28)} recall ${(f.recall * 100).toFixed(0).padStart(3)}%  (${f.detected}/${f.expected})  fp=${f.falsePositives.length}  adjacent_valid=${f.adjacentValid.length}`,
    );
    for (const m of f.missed) console.log(`   MISS: ${m.category}${m.file ? " @ " + m.file : ""}${m.keyword ? ' ~"' + m.keyword + '"' : ""}`);
    for (const fp of f.falsePositives) console.log(`   FP:   [${fp.category}] ${fp.title.slice(0, 80)}`);
    for (const av of f.adjacentValid) console.log(`   ADJ:  [${av.category}] ${av.title.slice(0, 80)}`);
  }
  console.log(`macro recall: ${(s.macro_recall * 100).toFixed(1)}%`);
  console.log(`false positives: ${s.total_false_positives}`);
  console.log(`details: ${outPath}`);
}
