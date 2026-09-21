import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { detectConfig } from "./detect.ts";
import { validate } from "../util/schema.ts";
import type { TargetConfig, GateConfig, InvariantConfig } from "./detect.ts";

export interface ConfigOverrides {
  aiEnabled?: boolean;
  reviewerModel?: string;
  verifierModel?: string;
  implementerModel?: string;
  reviewTimeoutSec?: number;
  maxMutants?: number;
  mutationEnabled?: boolean;
  sandboxNodeModulesMode?: "junction" | "copy";
}

const CONFIG_FILE_NAMES = ["qa.config.json", "agentic-qa.config.json"];

export const CONFIG_EXAMPLE = `{
  "target": { "root": "." },
  "rules": ["AGENTS.md", "SPEC.md", "docs"],
  "gates": {
    "typecheck": { "cmd": "npm run typecheck", "timeout_sec": 180 },
    "lint":      { "cmd": "npm run lint" },
    "build":     { "cmd": "npm run build" },
    "test":      { "cmd": "npm test", "timeout_sec": 300 },
    "integration_test": { "cmd": "npm run test:integration" }
  },
  "invariants": [
    { "name": "pagination-no-dup-or-loss", "cmd": "node scripts/invariants/pagination.js" }
  ],
  "forbidden_paths": [".env", "*.db"],
  "sandbox": { "exclude_globs": [], "node_modules_mode": "junction" },
  "environment": {},
  "secrets_env": ["EXAMPLE_API_KEY"],
  "ai": {
    "enabled": true,
    "reviewer_model": "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    "verifier_model": null,
    "implementer_model": null,
    "concurrency": 2,
    "review_timeout_sec": 600
  },
  "mutation": { "enabled": true, "max_mutants": 8, "timeout_sec": 120, "include": ["src/**"] },
  "limits": { "max_fix_rounds": 2, "campaign_max_rounds": 3 }
}`;

function mergeGate(base: GateConfig | undefined, over: Partial<GateConfig> | undefined): GateConfig | undefined {
  if (!base && !over) return undefined;
  return {
    cmd: over?.cmd ?? base?.cmd ?? "",
    cwd: over?.cwd ?? base?.cwd,
    timeout_sec: over?.timeout_sec ?? base?.timeout_sec,
  };
}

export function resolveConfig(targetRootInput: string, overrides: ConfigOverrides = {}): {
  config: TargetConfig;
  detected: string[];
} {
  const targetRoot = resolve(targetRootInput);
  const { config: detectedCfg, detected } = detectConfig(targetRoot);

  let fileCfg: Record<string, unknown> = {};
  for (const name of CONFIG_FILE_NAMES) {
    const p = join(targetRoot, name);
    if (existsSync(p)) {
      let rawText = "";
      try {
        rawText = readFileSync(p, "utf8");
        fileCfg = JSON.parse(rawText) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`failed to parse QA config ${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
      validateConfigShape(fileCfg, p);
      detected.push(`config-file:${name}`);
      break;
    }
  }

  const cfg: TargetConfig = {
    target: {
      root: targetRoot,
      name:
        (fileTargetName(fileCfg)) ??
        detectedCfg.target.name ??
        basename(targetRoot),
    },
    rules: stringArray(fileCfg["rules"]) ?? detectedCfg.rules,
    gates: {
      build: mergeGate(detectedCfg.gates.build, objPart(fileCfg, "gates", "build")),
      typecheck: mergeGate(detectedCfg.gates.typecheck, objPart(fileCfg, "gates", "typecheck")),
      lint: mergeGate(detectedCfg.gates.lint, objPart(fileCfg, "gates", "lint")),
      test: mergeGate(detectedCfg.gates.test, objPart(fileCfg, "gates", "test")),
      integration_test: mergeGate(detectedCfg.gates.integration_test, objPart(fileCfg, "gates", "integration_test")),
    },
    invariants: invariantArray(fileCfg["invariants"]),
    forbidden_paths: stringArray(fileCfg["forbidden_paths"]) ?? detectedCfg.forbidden_paths,
    sandbox: {
      exclude_globs: [
        ...detectedCfg.sandbox.exclude_globs,
        ...(stringArray(objGet(fileCfg, "sandbox", "exclude_globs")) ?? []),
      ],
      node_modules_mode:
        overrides.sandboxNodeModulesMode ??
        sandboxNodeModulesMode(objGet(fileCfg, "sandbox", "node_modules_mode")) ??
        detectedCfg.sandbox.node_modules_mode,
    },
    environment: {
      ...detectedCfg.environment,
      ...((objGet(fileCfg, "environment") as Record<string, string>) ?? {}),
    },
    secrets_env: stringArray(fileCfg["secrets_env"]) ?? detectedCfg.secrets_env,
    ai: {
      enabled: overrides.aiEnabled ?? boolOr(objGet(fileCfg, "ai", "enabled"), true),
      reviewer_model:
        overrides.reviewerModel ?? strOrNull(objGet(fileCfg, "ai", "reviewer_model")) ?? undefined,
      verifier_model:
        overrides.verifierModel ?? strOrNull(objGet(fileCfg, "ai", "verifier_model")) ?? undefined,
      implementer_model:
        overrides.implementerModel ?? strOrNull(objGet(fileCfg, "ai", "implementer_model")) ?? undefined,
      concurrency: numOr(objGet(fileCfg, "ai", "concurrency"), 2),
      review_timeout_sec: overrides.reviewTimeoutSec ?? numOr(objGet(fileCfg, "ai", "review_timeout_sec"), 600),
    },
    mutation: {
      enabled: overrides.mutationEnabled ?? boolOr(objGet(fileCfg, "mutation", "enabled"), true),
      max_mutants: overrides.maxMutants ?? numOr(objGet(fileCfg, "mutation", "max_mutants"), 8),
      timeout_sec: numOr(objGet(fileCfg, "mutation", "timeout_sec"), 120),
      include: stringArray(objGet(fileCfg, "mutation", "include")) ?? [],
    },
    limits: {
      max_fix_rounds: numOr(objGet(fileCfg, "limits", "max_fix_rounds"), 2),
      campaign_max_rounds: numOr(objGet(fileCfg, "limits", "campaign_max_rounds"), 3),
    },
  };

  assertSafety(cfg);
  return { config: cfg, detected };
}

const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    target: { type: "object", properties: {}, required: [] },
    rules: { type: "array", items: { type: "string" } },
    gates: { type: "object", properties: {}, required: [] },
    invariants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          cmd: { type: "string" },
          timeout_sec: { type: "number" },
          category: { type: "string" },
        },
        required: ["name", "cmd"],
      },
    },
    forbidden_paths: { type: "array", items: { type: "string" } },
    sandbox: { type: "object", properties: {}, required: [] },
    environment: { type: "object", properties: {}, required: [] },
    secrets_env: { type: "array", items: { type: "string" } },
    ai: { type: "object", properties: {}, required: [] },
    mutation: { type: "object", properties: {}, required: [] },
    limits: { type: "object", properties: {}, required: [] },
  },
  required: [],
} as const;

function validateConfigShape(value: unknown, file: string): void {
  const errs = validate(CONFIG_SCHEMA, value, file);
  if (errs.length > 0) {
    throw new Error(`Invalid QA config ${file}: ${errs.join("; ")}`);
  }
  const raw = value as { gates?: unknown; secrets?: unknown };
  if (raw.gates !== undefined && typeof raw.gates !== "object")
    throw new Error("gates must be an object");
}

function assertSafety(cfg: TargetConfig): void {
  for (const gate of Object.values(cfg.gates)) {
    if (!gate) continue;
    if (cfg.forbidden_paths.some((f) => gate.cmd.includes(f))) continue;
  }
  const banned = /\b(git\s+push|docker\s+push|npm\s+publish|gh\s+release)\b/;
  for (const gate of Object.values(cfg.gates)) {
    if (!gate) continue;
    if (banned.test(gate.cmd))
      throw new Error(`SAFETY: refusing to run publishing command as a gate: ${gate.cmd}`);
  }
}

function fileTargetName(cfg: Record<string, unknown>): string | undefined {
  const t = cfg["target"];
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const name = (t as Record<string, unknown>)["name"];
    if (typeof name === "string") return name;
  }
  return undefined;
}

function objGet(cfg: Record<string, unknown>, section: string, key?: string): unknown {
  const sec = cfg[section];
  if (!sec || typeof sec !== "object" || Array.isArray(sec)) return undefined;
  if (key === undefined) return sec;
  return (sec as Record<string, unknown>)[key];
}

function objPart(cfg: Record<string, unknown>, section: string, key: string): Partial<GateConfig> | undefined {
  const v = objGet(cfg, section, key);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Partial<GateConfig>;
}

function stringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error("expected array of strings");
  return v as string[];
}

function sandboxNodeModulesMode(v: unknown): "junction" | "copy" | undefined {
  if (v === undefined) return undefined;
  if (v === "junction" || v === "copy") return v;
  throw new Error("sandbox.node_modules_mode must be junction or copy");
}

function invariantArray(v: unknown): InvariantConfig[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("invariants must be an array");
  return v.map((entry, i): InvariantConfig => {
    if (typeof entry === "string") return { name: `invariant-${i + 1}`, cmd: entry };
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o["cmd"] !== "string") throw new Error(`invariants[${i}]: missing cmd`);
      return {
        name: typeof o["name"] === "string" ? o["name"] : `invariant-${i + 1}`,
        cmd: o["cmd"],
        timeout_sec: typeof o["timeout_sec"] === "number" ? o["timeout_sec"] : undefined,
        category: typeof o["category"] === "string" ? o["category"] : undefined,
      };
    }
    throw new Error(`invariants[${i}]: must be a command string or {name, cmd} object`);
  });
}

function boolOr(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function numOr(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx === -1 ? norm : norm.slice(idx + 1);
}
