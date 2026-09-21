# Agentic-QA 0.2.0

Release date: **2026-09-21**

This candidate focuses on making the project installable, independently verifiable, and easier for outside contributors to inspect.

## Highlights

- npm packages now execute ordinary built JavaScript instead of TypeScript under node_modules.
- package smoke packs a real tarball, installs it in a clean directory, checks the installed CLI help path, and audits a fixture.
- package contents use an allowlist so local runs, tests, source-only development files, and local artifacts are not shipped accidentally.
- Windows/Linux CI covers typecheck, unit tests, the deterministic fixture baseline, secret scan, and package smoke without AI credentials; the release-candidate workflow passed on both hosted OSes on 2026-09-21.
- contributor/security/release/troubleshooting and public-safe case-study documentation were added.
- repair-mode OpenCode role definitions are present as package assets instead of existing only in historical run sandboxes.
- fixture-i has a reproducible false-verification candidate/oracle harness; model-specific measurements remain explicitly separated by model/date.
- optional strict isolation physically copies node_modules for targets whose tests may write dependency caches.

## Benchmark context

Current deterministic benchmark (2026-09-21): nine fixtures, 9/18 expected findings, 50.0% finding recall, zero false positives.

Historical AI benchmark (2026-08-23): eight fixtures only, model-specific run using mimo-v2.5-free, 17/17 expected findings and zero true false positives. It does not include fixture-i and must not be compared as if it were the current deterministic population.

Fixture-i model-specific probe (2026-09-21, opencode/mimo-v2.5-free): finding recall 100%, finding precision 100%, false positives 0. The naive incorrect repair was accepted by the verifier but blocked by an adversarial High regression finding. The correct repair passed the independent oracle and verifier but remained fixed_unverified because adversarial structured output could not be parsed. Consequently FVR is undefined (zero verified denominator) and Repair Success is 0% for this two-candidate probe.

## Important limitation

verified still does **not** mean correctness proven. It means the verification steps available to that run passed. Specification behavior not represented by tests, invariants, or adversarial evidence may still be wrong.

The current fixture-i run also shows the fail-closed tradeoff: malformed verifier/adversarial output can reject a correct repair. This protects against false verification but can reduce successful verification throughput.

The default sandbox still favors speed by junction-sharing node_modules. Strict copy mode removes that shared-write path but costs disk space/copy time and is not an operating-system security sandbox.

The first hosted Linux CI attempt exposed a POSIX process-tree timeout bug and two Windows-centric test assumptions. The timeout implementation and tests were corrected, and the subsequent Windows/Ubuntu matrix run passed in full.
