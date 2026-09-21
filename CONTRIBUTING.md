# Contributing to Agentic-QA

Agentic-QA accepts contributions that make verification more reproducible, safer, or easier to use.

Core principle: **AI consensus is not correctness.** An AI claim is a hypothesis. Tests, executed invariants, static checks, mutation results, diffs, and other reproducible evidence decide what the project can assert.

## Development setup

Requirements:

- Node.js 24 is the primary development target. package.json permits Node 23.6 or newer.
- npm and Git.
- OpenCode is optional. Deterministic development and CI require no AI provider or API key.

Run these checks before a pull request:

    npm install
    npm run typecheck
    npm test
    npm run build
    npm run eval:deterministic
    npm run package:smoke
    npm run secret-scan

Source TypeScript remains directly executable during repository development. Installable npm artifacts are ordinary JavaScript under dist, and npm pack builds them automatically.

## Evidence expectations

For a bug fix, add the smallest deterministic reproduction that fails before the fix and passes after it. For verification logic, include a fixture or focused unit test that distinguishes the valid result from the failure mode being fixed.

Do not weaken tests to match an implementation. Do not change fixture golden data merely to improve a score. If a specification genuinely changes, explain the golden-data change and keep historical benchmark numbers separate from current numbers.

## Fixture benchmark policy

fixtures/expected represents specification-side expectations, not detector output. Detector changes are evaluated against the fixtures; fixtures are not tuned to make the detector look better.

The deterministic CI gate currently protects the nine-fixture baseline: at least 50.0% finding recall with zero false positives. This is a regression floor, not a claim that 50% is sufficient detection quality.

AI-backed measurements are model- and date-specific. Report the model identifier, date, fixture population, and AI/deterministic mode.

## Safety rules

- Never place real credentials in fixtures, logs, issues, or commits.
- Never make audit write to the original target tree.
- Repair work must remain inside an isolated workspace.
- Do not add automatic git push, package publication, release publication, production deployment, or production-data mutation.
- Preserve the distinction between fixed and verified.
- Never present verified as proof of program correctness.

See docs/SAFETY.md and docs/ARCHITECTURE.md.

## Pull requests

Keep PRs focused. State the failure mode, implementation change, deterministic evidence, benchmark/package impact, and remaining limitations. GitHub Actions is configured for Windows and Linux without AI credentials.

