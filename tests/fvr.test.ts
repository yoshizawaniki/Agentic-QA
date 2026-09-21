import test from "node:test";
import assert from "node:assert/strict";
import { scoreFalseVerification } from "../src/eval/falseVerification.ts";
import type { CandidateVerificationResult } from "../src/eval/falseVerification.ts";

function result(
  candidate: "naive" | "correct",
  oracleCorrect: boolean,
  status: CandidateVerificationResult["final_status"],
): CandidateVerificationResult {
  return {
    candidate,
    intended_correct: candidate === "correct",
    fail_first_confirmed: true,
    post_fix_tests_passed: true,
    oracle_correct: oracleCorrect,
    adversarial_findings: [],
    adversarial_critical_high: 0,
    final_status: status,
  };
}

test("FVR scoring: incorrect verified candidate counts as false verification", () => {
  const metrics = scoreFalseVerification([
    result("naive", false, "verified"),
    result("correct", true, "verified"),
  ]);
  assert.equal(metrics.verified_fixes, 2);
  assert.equal(metrics.false_verified_fixes, 1);
  assert.equal(metrics.false_verification_rate, 0.5);
  assert.equal(metrics.repair_success, 1);
});

test("FVR scoring: rejected naive + verified correct is ideal probe result", () => {
  const metrics = scoreFalseVerification([
    result("naive", false, "fixed_unverified"),
    result("correct", true, "verified"),
  ]);
  assert.equal(metrics.false_verification_rate, 0);
  assert.equal(metrics.repair_success, 1);
});

test("FVR scoring: no verified candidates keeps denominator explicit", () => {
  const metrics = scoreFalseVerification([
    result("naive", false, "fixed_unverified"),
    result("correct", true, "fixed_unverified"),
  ]);
  assert.equal(metrics.false_verification_rate, null);
  assert.equal(metrics.repair_success, 0);
});

