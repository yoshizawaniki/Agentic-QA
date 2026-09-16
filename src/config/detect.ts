import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GateConfig {
  cmd: string;
  cwd?: string;
  timeout_sec?: number;
}

export interface InvariantConfig {
  name: string;
  cmd: string;
  timeout_sec?: number;
  /** Finding category to use when this invariant is violated (default "data-integrity") */
  category?: string;
}

export interface TargetConfig {
  target: { root: string; name?: string };
  rules: string[];
  gates: {
    build?: GateConfig;
    typecheck?: GateConfig;
    lint?: GateConfig;
    test?: GateConfig;
    integration_test?: GateConfig;
  };
  invariants: InvariantConfig[];
  forbidden_paths: string[];
  sandbox: { exclude_globs: string[] };
  environment: Record<string, string>;
  secrets_env: string[];
  ai: {
    enabled: boolean;
    reviewer_model?: string;
    verifier_model?: string;
    implementer_model?: string;
    concurrency: number;
    review_timeout_sec: number;
  };
  mutation: { enabled: boolean; max_mutants: number; timeout_sec: number; include: string[] };
  limits: { max_fix_rounds: number; campaign_max_rounds: number };
}

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "_trash",
  "_data-sync",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".cache",
  "*.log",
  ".env",
  ".env.*",
  "__pycache__",
  "runs",
];

export function defaultConfig(targetRoot: string): TargetConfig {
  return {
    target: { root: targetRoot },
    rules: ["AGENTS.md", "CLAUDE.md", "README.md", "SPEC.md", "docs"],
    gates: {},
    invariants: [],
    forbidden_paths: [],
    sandbox: { exclude_globs: DEFAULT_EXCLUDES },
    environment: {},
    secrets_env: [],
    ai: {
      enabled: true,
      concurrency: 1,
      review_timeout_sec: 600,
    },
    mutation: { enabled: true, max_mutants: 8, timeout_sec: 120, include: [] },
    limits: { max_fix_rounds: 2, campaign_max_rounds: 3 },
  };
}

interface RawPackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

function detectNodeGates(root: string): Pick<TargetConfig, "gates" | "target"> & { detected: string[] } {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return { gates: {}, target: { root }, detected: [] };
  let pkg: RawPackageJson = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as RawPackageJson;
  } catch {
    return { gates: {}, target: { root, name: undefined }, detected: [] };
  }
  const scripts = pkg.scripts ?? {};
  const gates: TargetConfig["gates"] = {};
  const detected: string[] = [];
  const hasLocalTsc =
    existsSync(join(root, "node_modules", ".bin", "tsc.cmd")) ||
    existsSync(join(root, "node_modules", ".bin", "tsc"));
  if (scripts.typecheck) {
    gates.typecheck = { cmd: `npm run typecheck` };
    detected.push("typecheck:npm-script");
  } else if (hasLocalTsc && (existsSync(join(root, "tsconfig.json")) || existsSync(join(root, "jsconfig.json")))) {
    gates.typecheck = { cmd: `npx --no-install tsc --noEmit` };
    detected.push("typecheck:tsc");
  }
  if (scripts.lint) {
    gates.lint = { cmd: `npm run lint` };
    detected.push("lint:npm-script");
  }
  if (scripts.build) {
    gates.build = { cmd: `npm run build` };
    detected.push("build:npm-script");
  }
  if (scripts.test) {
    gates.test = { cmd: `npm test` };
    detected.push("test:npm-script");
  }
  return { gates, target: { root, name: pkg.name }, detected };
}

function detectPlainJsGates(root: string): TargetConfig["gates"] {
  // No package.json: syntax-check every top-level .js/.mjs/.cjs file with node --check
  try {
    const entries = readFileSync(root, { encoding: "utf8" });
    void entries;
  } catch {
    // not readable; fall through
  }
  return {};
}

export function detectConfig(targetRoot: string): { config: TargetConfig; detected: string[] } {
  const base = defaultConfig(targetRoot);
  const nodeInfo = detectNodeGates(targetRoot);
  const merged: TargetConfig = {
    ...base,
    gates: nodeInfo.gates,
    target: nodeInfo.target,
  };
  let detected = [...nodeInfo.detected];
  if (!existsSync(join(targetRoot, "package.json"))) {
    merged.gates = detectPlainJsGates(targetRoot);
    detected.push("plain-dir");
  }
  if (!merged.target.name) merged.target.name = basename(targetRoot);
  return { config: merged, detected };
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx === -1 ? norm : norm.slice(idx + 1);
}
