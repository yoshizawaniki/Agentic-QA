import type { Schema } from "../util/schema.ts";

export const REVIEW_FINDINGS_ITEM_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [
        "logic",
        "test-quality",
        "race",
        "data-integrity",
        "spec-mismatch",
        "boundary",
        "security",
        "performance",
        "regression",
        "other",
      ],
    },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    title: { type: "string", minLength: 8 },
    claim: { type: "string", minLength: 10 },
    evidence: { type: "string" },
    source_location: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "number" },
        symbol: { type: "string" },
      },
      required: [],
    },
    reproduction: { type: "string" },
    expected: { type: "string" },
    actual: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["category", "severity", "title", "claim"],
} as const satisfies Schema;

export const REVIEW_OUTPUT_SCHEMA: Schema = {
  type: "object",
  properties: {
    findings: { type: "array", items: REVIEW_FINDINGS_ITEM_SCHEMA, minItems: 0 },
  },
  required: ["findings"],
  additionalProperties: false,
};

export const SPEC_CONTRACTS_SCHEMA: Schema = {
  type: "object",
  properties: {
    contracts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          requirement: { type: "string", minLength: 8 },
          source: { type: "string" },
          explicit: { type: "boolean" },
        },
        required: ["requirement", "explicit"],
      },
      minItems: 0,
    },
  },
  required: ["contracts"],
  additionalProperties: false,
};

export const ARCHITECTURE_SCHEMA: Schema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 20 },
    entry_points: { type: "array", items: { type: "string" }, minItems: 0 },
    dangerous_paths: { type: "array", items: { type: "string" }, minItems: 0 },
    state_stores: { type: "array", items: { type: "string" }, minItems: 0 },
  },
  required: ["summary", "entry_points", "dangerous_paths", "state_stores"],
  additionalProperties: false,
};

export const VERIFIER_OUTPUT_SCHEMA: Schema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["verified", "refuted"] },
    reasoning_brief: { type: "string", minLength: 15 },
    checks_performed: { type: "array", items: { type: "string" }, minItems: 1 },
    regression_risk: { type: "string", enum: ["none", "low", "medium", "high"] },
  },
  required: ["verdict", "reasoning_brief", "checks_performed", "regression_risk"],
  additionalProperties: false,
};

export const JUDGE_OUTPUT_SCHEMA: Schema = {
  type: "object",
  properties: {
    accepted_finding_ids: { type: "array", items: { type: "string" }, minItems: 0 },
    rejected_finding_ids: { type: "array", items: { type: "string" }, minItems: 0 },
    rationale: { type: "string", minLength: 15 },
    remaining_risks: { type: "array", items: { type: "string" }, minItems: 0 },
  },
  required: ["accepted_finding_ids", "rejected_finding_ids", "rationale", "remaining_risks"],
  additionalProperties: false,
};
