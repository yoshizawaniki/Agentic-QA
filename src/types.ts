export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Definition of `verified` (normative):
 * NOT a proof of correctness. It means: every verification step available to this
 * system passed — deterministic gates green, fail-first test reproduced the bug
 * pre-fix and passes post-fix, an independent (context-separated) reviewer judged
 * the diff sufficient, and adversarial retest surfaced no new critical/high issue.
 * Spec aspects not covered by existing tests/invariants may still be broken.
 */


export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type FindingStatus =
  | "suspected"
  | "reproduced"
  | "confirmed"
  | "fixing"
  | "fixed_unverified"
  | "verified"
  | "rejected"
  | "duplicate"
  | "blocked";

export interface StatusEvent {
  status: FindingStatus;
  at: string;
  note?: string;
}

export interface SourceLocation {
  file?: string;
  line?: number;
  symbol?: string;
}

export interface Finding {
  id: string;
  run_id: string;
  target: string;
  category:
    | "logic"
    | "test-quality"
    | "race"
    | "data-integrity"
    | "spec-mismatch"
    | "boundary"
    | "security"
    | "performance"
    | "regression"
    | "gate-failure"
    | "secret-exposure"
    | "doc-integrity"
    | "other";
  severity: Severity;
  title: string;
  claim: string;
  evidence?: string;
  source_location?: SourceLocation;
  reproduction?: string;
  expected?: string;
  actual?: string;
  confidence?: number;
  deterministic_evidence?: boolean;
  suggested_fix?: string;
  implementer_status?: "pending" | "attempted" | "claimed_fixed" | "could_not_fix";
  verifier_status?: "not_verified" | "verified" | "refuted";
  final_status: FindingStatus;
  regression_test?: string;
  created_at: string;
  verified_at?: string;
  status_history: StatusEvent[];
}

export interface GateResult {
  name: string;
  cmd: string;
  exit_code: number | null;
  passed: boolean;
  timed_out: boolean;
  duration_ms: number;
  skipped_reason?: string;
}

export interface RunManifest {
  run_id: string;
  kind: "audit" | "repair" | "campaign" | "verify";
  target_root: string;
  sandbox_root?: string;
  started_at: string;
  finished_at?: string;
  agentic_qa_version: string;
  ai_enabled: boolean;
  models?: Partial<Record<string, string>>;
  gates: GateResult[];
  rounds?: number[];
}
