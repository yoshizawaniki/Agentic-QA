import type { Schema } from "../util/schema.ts";
import { validate } from "../util/schema.ts";
import {
  REVIEW_OUTPUT_SCHEMA,
  SPEC_CONTRACTS_SCHEMA,
  ARCHITECTURE_SCHEMA,
  VERIFIER_OUTPUT_SCHEMA,
  JUDGE_OUTPUT_SCHEMA,
} from "./schemas.ts";

export interface AiFindingItem {
  category: string;
  severity: string;
  title: string;
  claim: string;
  evidence?: string;
  source_location?: { file?: string; line?: number; symbol?: string };
  reproduction?: string;
  expected?: string;
  actual?: string;
  confidence?: number;
}

export interface ReviewOutput {
  findings: AiFindingItem[];
}

export interface SpecContractsOutput {
  contracts: Array<{ requirement: string; source?: string; explicit: boolean }>;
}

export interface ArchitectureOutput {
  summary: string;
  entry_points: string[];
  dangerous_paths: string[];
  state_stores: string[];
}

export interface VerifierOutput {
  verdict: "verified" | "refuted";
  reasoning_brief: string;
  checks_performed: string[];
  regression_risk: "none" | "low" | "medium" | "high";
}

export interface JudgeOutput {
  accepted_finding_ids: string[];
  rejected_finding_ids: string[];
  rationale: string;
  remaining_risks: string[];
}

export interface ImplementerOutput {
  changed_files: string[];
  summary: string;
  tests_run: string;
  honest_uncertainties?: string;
}

export interface TestDesignerOutput {
  test_files: string[];
  fail_confirmed: boolean;
  notes: string;
}

export const OUTPUT_CONTRACT = `
OUTPUT CONTRACT (mandatory):
- End your FINAL message with a single fenced code block containing ONLY JSON.
- The JSON must match the schema given below. No commentary inside the block.
- If you found nothing, return an empty list. Never invent findings to look thorough.
- Every finding must cite a concrete file (and line if possible) as source_location.
`;

function extractLastJsonBlock(text: string): unknown | undefined {
  const fence = String.fromCharCode(96, 96, 96);
  const fenced = new RegExp(`${fence}{3}(?:json)?\\s*([\\s\\S]*?)${fence}{3}`, "g");
  let lastValid: unknown | undefined;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    try {
      lastValid = JSON.parse(m[1].trim());
    } catch {
      // keep scanning
    }
  }
  if (lastValid !== undefined) return lastValid;
  // fallback: balanced-brace scan from the end
  for (let end = text.length; end > 0; end--) {
    if (text[end - 1] !== "}") continue;
    const windowStart = Math.max(0, end - 40000);
    for (let start = end - 1; start >= windowStart; start--) {
      if (text[start] !== "{") continue;
      try {
        lastValid = JSON.parse(text.slice(start, end));
        break;
      } catch {
        // try next
      }
    }
    if (lastValid !== undefined) break;
  }
  return lastValid;
}

export interface ParsedAiResult<T> {
  ok: boolean;
  data?: T;
  errors?: string[];
}

export function parseStructured<T>(rawText: string, schema: Schema): ParsedAiResult<T> {
  let parsed = extractLastJsonBlock(rawText);
  if (parsed === undefined) {
    return { ok: false, errors: ["no JSON block found in agent output"] };
  }
  parsed = normalizePayload(parsed, schema);
  const errs = validate(schema, parsed);
  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, data: parsed as T };
}

/**
 * Tolerant normalization for weaker models:
 * a bare findings array or a single finding object is wrapped into the
 * expected {findings:[...]} envelope before validation.
 */
function normalizePayload(parsed: unknown, schema: Schema): unknown {
  const root = schema as { type?: string; properties?: Record<string, unknown> };
  if (root?.type !== "object" || !root.properties || !("findings" in root.properties)) {
    return parsed;
  }
  if (Array.isArray(parsed)) return { findings: parsed };
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (!("findings" in o) && ("category" in o || "title" in o) && !("contracts" in o)) {
      return { findings: [o] };
    }
  }
  return parsed;
}

export const SCHEMAS = {
  review: REVIEW_OUTPUT_SCHEMA,
  specContracts: SPEC_CONTRACTS_SCHEMA,
  architecture: ARCHITECTURE_SCHEMA,
  verifier: VERIFIER_OUTPUT_SCHEMA,
  judge: JUDGE_OUTPUT_SCHEMA,
};
