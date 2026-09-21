# EVALUATION — fixture benchmark

## Purpose

Agentic-QA measures itself against intentionally bug-injected fixtures. The benchmark is evaluated from recorded findings and executed evidence, not from whether an AI says the run looked good.

The most important accounting rule is: **do not mix populations or modes**. An eight-fixture historical AI run, a nine-fixture deterministic run, and a fixture-i false-verification probe answer different questions.

## Current fixture population

| Fixture | Embedded problem | Deterministic path | AI-reasoning target |
|---|---|---|---|
| A | clamp upper bound returns min | invariant | logic location |
| B | implementation-aligned test contradicts percent contract; weak threshold boundary | mutation | spec mismatch + test-quality issue |
| C | async read/modify/write lost update | invariant | race location |
| D | partial transfer state + poisoned retry id | invariant | data-integrity location |
| E | ascending score versus descending spec + tie break | invariant | spec mismatch |
| F | February fixed to 29 days | invariant | boundary location |
| G | formatDate ignores offset | invariant | logic/regression analysis |
| H | test suite fails while README claims all tests pass | gate + doc integrity | none required |
| I | case-sensitive tag dedup with hidden repair traps | no current deterministic finding detector | logic finding + false-verification probe |

Golden data lives under fixtures/expected. Changing it requires an explicit specification-side reason. Golden expectations must never be edited merely to make a detector or model score better.

## Finding benchmark

Run:

    npm run eval

The raw eval command audits every fixture in deterministic mode and writes:

    runs/eval-<stamp>-det/eval-summary.json

The raw command returns exit code 1 while not every expected finding is detected. That is a benchmark result, not a process crash.

CI uses:

    npm run eval:deterministic

The CI wrapper protects the current regression floor rather than pretending current recall is 100%: at least nine fixtures, at least 18 expected findings, macro recall at least 50.0%, and zero false positives.

### Current deterministic measurement — 2026-09-21

Population: **9 fixtures / 18 expected findings**.

| Fixture | Recall | False positives |
|---|---:|---:|
| A | 1/2 = 50% | 0 |
| B | 1/3 = 33% | 0 |
| C | 1/2 = 50% | 0 |
| D | 1/2 = 50% | 0 |
| E | 1/2 = 50% | 0 |
| F | 1/2 = 50% | 0 |
| G | 1/2 = 50% | 0 |
| H | 2/2 = 100% | 0 |
| I | 0/1 = 0% | 0 |

**Current deterministic macro recall: 50.0%. Total false positives: 0.**

This is the current baseline. It supersedes 52.9% as the current deterministic number because fixture-i changed the benchmark population.

### Historical deterministic measurement — 2026-08-22

Population: **8 fixtures / 17 expected findings (A-H only)**.

Macro recall was **52.9%**, false positives **0**.

Keep this value as history only. It must not be described as the current nine-fixture result.

### Historical AI measurement — 2026-08-23

Population: **8 fixtures / 17 expected findings (A-H only)**.

Model: **opencode/mimo-v2.5-free**.

Result recorded after the A-H run completed:

- expected findings detected: **17/17**;
- true false positives: **0**;
- additional valid adjacent findings: 16, accounted separately rather than silently added to the golden denominator.

This directly resolves an older stale note that said fixture-c through fixture-h were still unmeasured. That statement described an earlier interrupted round and is no longer current.

The result is model/date/population specific. It is not evidence that every model obtains 100%, and it does not include fixture-i.

## Core KPIs

| KPI | Definition |
|---|---|
| Finding Recall | Expected embedded findings detected / expected embedded findings |
| Finding Precision | Expected findings detected / detected expected findings plus true false positives |
| Repair Success | Correct candidate repairs that reach verified / correct candidate repair attempts |
| **False Verification Rate** | verified fixes that the independent oracle says are wrong / all verified fixes |

False Verification Rate is the key repair KPI. High recall is useful, but a system that confidently verifies an incorrect fix is more dangerous than one that admits it did not verify.

## Meaning of verified

verified is **not** a proof of correctness.

For the normal repair pipeline it means the available chain satisfied its required evidence: post-fix deterministic gates passed, a fail-first test was executed and observed failing before the fix, an independent verifier returned verified, and adversarial retest produced no new Critical/High finding.

The limitation is fundamental: a contract clause absent from the executed tests/invariants can still be broken. fixture-i measures exactly this risk.

## False-verification benchmark — fixture-i

fixture-i is not modified to make the detector pass. The benchmark uses the existing fixture and golden contract, then creates candidate repairs in a temporary workspace.

Run the no-model structural probe:

    npm run eval:false-verification -- --no-ai

The 2026-09-21 probe established:

- original implementation + fail-first case-insensitive test: **FAIL**, so the bug is reproduced;
- naive candidate: ordinary fixture tests + fail-first **PASS**, but independent contract oracle **FAIL**;
- correct candidate: ordinary fixture tests + fail-first **PASS**, and contract oracle **PASS**.

The naive candidate deliberately preserves first spelling/order but returns a non-array input unchanged. That makes it look fixed to the narrow fail-first/public test set while violating the documented non-array contract. The correct candidate returns an empty array for non-array input.

This structural probe proves the benchmark can distinguish an incorrect and correct candidate without changing fixture-i or its golden data. In --no-ai mode FVR is intentionally reported as null because no verifier/adversarial decision happened.

For a model-specific run:

    npm run eval:false-verification -- --model provider/model-id --review-timeout 120

The command:

1. confirms the same fail-first behavior;
2. applies the naive and correct candidates independently in temporary copies;
3. runs normal tests after each candidate;
4. sends the artifact/evidence to the same verifier prompt contract used by repair;
5. runs the same adversarial-retest prompt class;
6. applies the repair acceptance rule;
7. independently executes the full fixture-i oracle after the AI decision;
8. reports FVR and Repair Success;
9. runs a fixture-i AI finding evaluation to report model-specific Finding Precision and Finding Recall when provider access succeeds.

The command requires an explicit model when AI is enabled so a benchmark cannot accidentally invoke a default paid provider.

Model-specific results belong here only after the run actually completes. Provider quota/availability failure is recorded as **unverified**, not converted into a favorable score.

### Model-specific fixture-i result — 2026-09-21

Model: **opencode/mimo-v2.5-free** for both verifier and adversarial roles.

Finding evaluation on fixture-i:

- Finding Recall: **100% (1/1)**;
- Finding Precision: **100%**;
- true false positives: **0**;
- one additional valid test-quality finding was tracked as adjacent-valid and excluded from the planted-bug denominator.

Repair-candidate probe:

| Candidate | Oracle | Verifier | Adversarial | Final status |
|---|---|---|---|---|
| naive / incorrect | FAIL | verified | High regression found: non-array input echoed instead of returning [] | fixed_unverified |
| correct | PASS | verified | structured-output parse failed | fixed_unverified |

Measured repair metrics:

- verified fixes: **0**;
- false verified fixes: **0**;
- **False Verification Rate: n/a / null**, because the denominator (verified fixes) is zero;
- correct candidates: 1;
- correct candidates verified: 0;
- **Repair Success: 0%**.

The naive result is an important safety observation: verifier approval alone would have been wrong, but the adversarial layer found the hidden-contract regression and prevented final verified status.

The correct result exposes the opposite tradeoff. The code was correct according to the independent oracle and the verifier accepted it, but malformed adversarial output prevented verification. The pipeline failed closed, which protects precision, but reduces Repair Success/availability. Improving structured-output reliability without weakening the evidence requirement is a follow-up item.

## Historical repair E2E

On 2026-08-22, fixture-a was repaired with opencode/mimo-v2.5-free:

- invariant violation;
- fail-first test designed;
- test observed failing before the fix;
- sandbox source fixed;
- regression gates passed;
- independent verifier returned verified;
- adversarial retest completed;
- original fixture remained unchanged.

That run helped expose and harden several Agentic-QA defects, including Windows command quoting, the no-diff evidence guard, competing-workspace promotion, repair manifest finalization, model/tool failure classification, finding deduplication, and failed-AI-output persistence.

## Real-project audit evidence

Historical runs against a larger development project produced a useful contrast:

- an AI reviewer suspected a race condition but the final finding was rejected because deterministic evidence was insufficient;
- the original target tree changed concurrently, and SHA-256 before/after comparison confirmed that separate drift event.

The sanitized public account is docs/CASE-STUDY.md. Local paths/private code are intentionally omitted.

## Benchmark interpretation rules

- Do not target 100% by weakening golden expectations.
- Do not merge expected-adjacent findings into the golden denominator after seeing model output.
- Report AI model, date, fixture population, and mode.
- Report unavailable/quota-blocked/malformed AI work as unmeasured or unverified; never convert it into a favorable score.
- Keep deterministic, AI-finding, and false-verification measurements separate.
- After changing model prompts, verification semantics, matching logic, or mutation/invariant behavior, rerun the relevant fixed benchmark before comparing results.
