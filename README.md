# Agentic-QA

**Evidence-first QA orchestration for code changed by AI or humans.**

Agentic-QA exists for a specific failure mode: an agent can produce a plausible finding, another agent can agree, and both can still be wrong. Its core rule is therefore:

> **AI consensus is not correctness.**

AI findings are hypotheses. Agentic-QA combines deterministic gates, explicit invariants, mutation testing, isolated repair, independent verification, and adversarial retesting so that claims are backed by inspectable evidence.

## What the four main commands mean

| Command | Purpose |
|---|---|
| audit target | Inspect a target through deterministic gates and optional independent AI review. The original tree is not written by the audit pipeline. |
| repair target | Reproduce and fix selected findings inside an isolated run workspace, then independently verify the result. |
| campaign target | Repeat evidence-based audit/repair rounds until a configured stop condition is reached. |
| verify runId | Re-run verification against a saved run workspace and downgrade a previously verified state if regression evidence appears. |

The AI layer is optional. audit and the deterministic fixture benchmark work with --no-ai and require no API key.

## What verified means

verified is deliberately narrower than “correct”.

A repair reaches verified only when the available repair chain has the required evidence: post-fix deterministic gates pass, a fail-first test was observed failing before the fix, the independent verifier accepts the artifact, and the adversarial retest finds no new Critical/High issue.

That still does **not** prove full program correctness. A specification edge case absent from tests/invariants can remain wrong. fixture-i exists specifically to measure this false-verification risk.

## Original-tree safety

The target is copied into runs/run-id/workspace for execution and repair. Agentic-QA does not automatically apply repair patches back to the original target. A SHA-256 baseline is also compared before/after a run so outside changes to the original tree can be reported separately.

Current fast isolation shares node_modules with the target when available. That avoids reinstall cost but is not a hardened filesystem sandbox; tests that write inside node_modules can affect the shared dependency tree. Use --strict-isolation (or sandbox.node_modules_mode=copy) to physically copy dependencies when that risk matters.

## 30-60 second Quick Start

The package has not been published to npm yet. From a clone:

    npm install
    npm run typecheck
    npm test
    node src/cli.ts audit ./fixtures/fixture-a --no-ai

To test the exact artifact that an npm consumer would receive:

    npm run package:smoke

That command builds dist JavaScript, creates a real tarball, installs it in a clean temporary directory, runs the installed agentic-qa --help shim, and audits fixture-a from the installed CLI.

Development remains convenient: supported Node versions execute the erasable TypeScript source directly. Distribution is different by design: npm packages point at dist/cli.js so Node is never asked to type-strip TypeScript from node_modules.

## Optional AI layer

OpenCode is used as the current AgentRunner implementation. Agentic-QA discovers it from AGENTIC_QA_OPENCODE_BIN, a project-local opencode-ai install, or PATH.

Example:

    node src/cli.ts audit ./path/to/project --model provider/model-id

AI/provider failures are recorded as failures or skipped work; missing AI output is never converted into deterministic evidence.

## Configuration

Generate a starting configuration:

    node src/cli.ts init-config ./path/to/project

qa.config.json can declare build/typecheck/lint/test/integration gates, executable invariants, forbidden paths, secret environment variable names, AI role models, mutation settings, and limits. See docs/TARGET_ADAPTER.md and the repository qa.config.json example.

## Commands

| Command | Description |
|---|---|
| audit target | Deterministic gates plus optional independent AI review |
| repair target | Isolated fail-first/fix/verify flow; --from-run imports eligible findings |
| campaign target | Multi-round evidence-based verification and repair |
| verify runId | Re-run gates/verifier against a stored workspace |
| init-config target | Write a qa.config.json template |
| eval | Fixture A-I finding-recall / false-positive benchmark |
| eval-fvr --no-ai | Deterministic fixture-i candidate/oracle probe |
| eval-fvr --model id | Model-specific false-verification probe |

Common options include --no-ai, --model, --verifier-model, --review-timeout, --max-mutants, --no-mutation, --from-run, --max-fixes, --competing, --rounds, and --runs-dir.

Exit codes: 0 means the command-specific acceptance condition passed; 1 means a QA/regression/benchmark condition was not met; 2 means usage or tool failure.

## Current benchmark evidence

Measurements are never mixed across fixture populations or AI modes.

| Measurement | Population | Result | Context |
|---|---:|---:|---|
| Deterministic finding benchmark, 2026-09-21 | 9 fixtures / 18 expected findings | 9/18, macro recall 50.0%, false positives 0 | Current baseline |
| fixture-i AI finding benchmark, 2026-09-21 | 1 fixture / 1 expected finding | recall 100%, precision 100%, false positives 0 | opencode/mimo-v2.5-free |
| fixture-i false-verification probe, 2026-09-21 | naive + correct repair candidates | FVR = n/a (0 verified); Repair Success = 0% | same model; naive was blocked by adversarial High finding, correct was fail-closed after adversarial output parse failure |
| Historical AI finding benchmark, 2026-08-23 | 8 fixtures / 17 expected findings | 17/17, true false positives 0 | mimo-v2.5-free; fixture-i did not yet belong to this population |
| Historical deterministic benchmark, 2026-08-22 | 8 fixtures / 17 expected findings | macro recall 52.9%, false positives 0 | Historical only; do not compare as the current nine-fixture value |

The deterministic 50.0% value is a transparent capability measurement, not a target to celebrate. Its main current strength is zero measured false positives on this fixture set; AI is intended to raise recall while the verification layers protect precision.

False Verification Rate is treated as a more important repair KPI than raw finding recall. The reproducible fixture-i candidate/oracle harness distinguishes a naive fix that passes ordinary tests but violates a hidden contract from a correct fix. Model-specific verifier/adversarial results must be reported with the model and date.

The current model-specific fixture-i probe is deliberately not reported as FVR=0: neither candidate reached final verified, so the FVR denominator is zero. The naive incorrect candidate was initially accepted by the independent verifier but then stopped by an adversarial High regression finding. The correct candidate passed the oracle and verifier, but malformed adversarial structured output caused the run to fail closed at fixed_unverified. This is evidence that the safety chain can reject an incorrect fix, while also exposing a current availability/Repair Success weakness.

Full methodology: docs/EVALUATION.md.

## Real-project evidence

A real audit produced two different classes of result:

- an AI reviewer proposed a plausible race-condition finding, but the evidence was insufficient and the finding was rejected;
- during that same audit window, the original target tree changed externally, and the before/after SHA-256 baseline confirmed that drift.

This is the intended distinction: an AI claim does not become fact because it sounds plausible, while directly measured tree drift can be confirmed independently. The public-safe account contains no private source or identifying local path: docs/CASE-STUDY.md.

## Output

Runs create evidence under runs/run-id, including:

- manifest.json — run metadata;
- commands.jsonl — executed command log with redaction;
- gates.jsonl — deterministic gate outcomes;
- findings.jsonl — finding/status ledger;
- baseline — SHA-256 baseline and drift evidence;
- logs — command stdout/stderr;
- ai — structured/raw AI-role artifacts when AI is enabled;
- verifier — repair verification records;
- patches — sandbox diffs;
- final-report.md and summary.json;
- workspace — isolated working copy when applicable.

## Known limitations

- Fast sandbox mode junction-shares node_modules. Optional strict mode physically copies the dependency tree, avoiding shared node_modules writes at the cost of disk/copy time; neither mode is an OS-level security sandbox.
- Mutation testing primarily covers JS/TS comparison and logical operators; constant, return-value, statement-removal, and broader language mutations remain future work.
- AI quality and availability vary by model/provider. Historical AI benchmark results are not model-independent guarantees.
- verified is bounded by the evidence available to that run and is not a correctness proof.
- Local validation was performed on Windows, and GitHub-hosted CI also passed on both windows-latest and ubuntu-latest on 2026-09-21.
- Large real-project repair has less empirical coverage than audit; repair should continue to be reviewed through generated evidence and patches.

## CI and contributing

The CI definition uses Node 24 on Windows and Linux and requires no AI secret. It runs typecheck, unit tests, deterministic benchmark regression checks, repository secret scan, and real package/install smoke. The 2026-09-21 release-candidate CI completed successfully on both hosted operating systems.

See CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, docs/TROUBLESHOOTING.md, and docs/RELEASING.md.

## Architecture and safety documentation

- docs/ARCHITECTURE.md — data flow, roles, trust boundary
- docs/SAFETY.md — prohibited operations and isolation model
- docs/TARGET_ADAPTER.md — adapting a new target/config
- docs/EVALUATION.md — benchmark populations, metrics, historical results
- docs/CASE-STUDY.md — sanitized real-project evidence case
- docs/TROUBLESHOOTING.md — installation/run failure diagnosis

## License

MIT
