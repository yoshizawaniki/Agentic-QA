# Troubleshooting

## Installed CLI fails before showing help

First confirm the installed package is using dist/cli.js rather than src/cli.ts. Agentic-QA deliberately ships JavaScript because current Node does not type-strip TypeScript inside node_modules.

Run the repository smoke test before publishing any package:

    npm run package:smoke

It packs the package, installs the tarball into a clean temporary directory, invokes the installed CLI, and runs a deterministic fixture audit.

## audit returns exit code 1

Exit code 1 is a QA result, not necessarily a tool crash. It means a deterministic gate failed or unresolved Critical/High findings remain. Exit code 2 means a tool/usage error.

Inspect final-report.md, summary.json, gates.jsonl, and findings.jsonl in the run directory.

## OpenCode / AI layer is unavailable

The AI layer is optional. Use --no-ai for deterministic-only operation.

Agentic-QA looks for OpenCode in this order:

1. AGENTIC_QA_OPENCODE_BIN;
2. the current project's node_modules/opencode-ai/bin;
3. an opencode executable on PATH.

If an AI provider is rate-limited or the selected model cannot use tools, the run records the failure instead of treating missing AI output as evidence.

## Repair says AI unavailable

repair requires an available AI runner for test design and implementation. audit can still operate deterministically. Do not interpret a blocked repair as a verified failure or verified fix.

## A target changed during an audit

Agentic-QA hashes the original target before and after a run. If the original tree changes while the isolated audit is running, a deterministic drift finding is recorded. That does not by itself mean Agentic-QA wrote the file; another process may have modified the target.

Stop concurrent editors/build jobs if you need a stable baseline, then rerun.

## node_modules isolation warning

The current fast sandbox mode copies source but links node_modules from the target. A test that writes into node_modules can therefore affect the shared dependency tree. This is a documented limitation; do not describe the mode as full filesystem isolation.

## Deterministic benchmark exits non-zero

The raw eval command exits 1 until every golden finding is detected. CI instead runs:

    npm run eval:deterministic

That command evaluates the documented regression floor: nine fixtures, 18 expected findings, at least 50.0% recall, and zero false positives.

## Secret scan flags a test fixture

The repository scanner allows only exact credential-shaped dummy literals used by redaction/scanner tests. Do not add real or realistic private credentials to the allowlist. Replace a new test credential with an obviously synthetic value and document why it is needed.

