import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawnSync(process.execPath, ["src/cli.ts", "eval"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});

// `agentic-qa eval` intentionally exits 1 while recall is below 100%.
// CI evaluates the documented deterministic baseline instead of pretending
// that partial recall is a tool failure.
if (child.error || child.status === null || ![0, 1].includes(child.status)) {
  throw child.error ?? new Error(`deterministic eval failed to execute (exit ${child.status})`);
}

const runsDir = join(root, "runs");
const candidates = readdirSync(runsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^eval-.*-det$/.test(e.name))
  .map((e) => {
    const summary = join(runsDir, e.name, "eval-summary.json");
    return { summary, mtime: existsSync(summary) ? statSync(summary).mtimeMs : 0 };
  })
  .filter((e) => e.mtime > 0)
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) throw new Error("deterministic eval produced no eval-summary.json");
const latest = candidates[0].summary;
const summary = JSON.parse(readFileSync(latest, "utf8"));

const failures = [];
if (summary.mode !== "deterministic") failures.push(`mode=${summary.mode}`);
if (!Array.isArray(summary.fixtures) || summary.fixtures.length < 9) failures.push(`fixtures=${summary.fixtures?.length ?? 0} (<9)`);
if (summary.total_expected < 18) failures.push(`total_expected=${summary.total_expected} (<18)`);
if (summary.macro_recall < 0.5) failures.push(`macro_recall=${summary.macro_recall} (<0.5)`);
if (summary.total_false_positives !== 0) failures.push(`false_positives=${summary.total_false_positives} (!=0)`);

if (failures.length > 0) {
  throw new Error(`deterministic benchmark regression: ${failures.join(", ")} (${latest})`);
}

console.log(
  `[eval-gate] PASS fixtures=${summary.fixtures.length} recall=${(summary.macro_recall * 100).toFixed(1)}% fp=${summary.total_false_positives} (${latest})`,
);
