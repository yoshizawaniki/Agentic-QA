# Agentic-QA

**An autonomous QA orchestration platform that independently verifies AI-generated code.** Repository-agnostic, model-swappable.

Core principle: **AI consensus is not correctness**. A finding or fix becomes `verified` only with deterministic evidence (execution results, tests, diffs, static checks).

## What it does

```text
Understand project -> baseline -> Layer 1: deterministic gates (build/typecheck/test/invariant/mutation)
-> Layer 2: independent AI review (spec/explorer/test-adversarial/security/perf)
-> dedup/prioritize -> (repair) fail-first test -> sandboxed fix -> independent verifier -> adversarial retest
-> judge -> evidence-backed report
```

- The target project is executed and modified **only inside an isolated sandbox copy** (the original tree is read-only)
- `fixed` and `verified` are separate states. Implementer self-claims are never accepted
- Every command log is recorded under `runs/<run-id>/commands.jsonl` with secrets masked

## Requirements

- Node.js >= 23.6 (TypeScript runs directly, no build step)
- (Optional) OpenCode CLI for the AI layer. Works in deterministic mode with `--no-ai` even without it

## Quick start

```powershell
npm install
npm run typecheck
npm test

# Deterministic-only audit (no model needed)
node src/cli.ts audit <path-to-target-project> --no-ai

# Audit with AI review (OpenCode configured)
node src/cli.ts audit <target> --model "openrouter/<model-id>:free"

# Fail-first test -> fix -> independent verification inside sandbox
node src/cli.ts repair <target> --from-run <previous-run-id>
```

## Commands

| Command | Description |
|---|---|
| `audit <target>` | Read-focused full audit. Original tree untouched |
| `repair <target>` | Fix findings in isolated sandbox. Use `--from-run` to carry over audit findings |
| `campaign <target>` | Multi-round autonomous verification. Evidence-based stop conditions |
| `verify <runId>` | Re-run deterministic gates + independent verifier on a saved sandbox |
| `init-config <target>` | Generate a `qa.config.json` template for the target |
| `eval` | Fixture A-I benchmark (detection recall / false positives) |

Common options: `--no-ai` `--model` `--verifier-model` `--max-mutants` `--no-mutation` `--from-run` `--max-fixes` `--competing N` `--rounds` `--runs-dir`

Exit codes: `0`=pass / `1`=gate failure or unresolved Critical/High / `2`=tool error

## Output (`runs/<run-id>/`)

```text
manifest.json      run metadata
commands.jsonl     full command log (secrets masked)
gates.jsonl        deterministic gate results
findings.jsonl     finding ledger (suspected -> ... -> verified)
baseline/          sha256 hash baseline and drift detection
logs/              stdout/stderr per command
ai/                AI role outputs (JSON + raw)
verifier/          independent verifier records
patches/           fix diffs (repair mode)
final-report.md    final report
summary.json       machine-readable summary
workspace/         isolated sandbox copy (repair mode)
```

## Fixture benchmark

```powershell
node src/cli.ts eval            # deterministic mode
node src/cli.ts eval --ai       # with AI layer
```

Measures detection recall / false positives against 9 intentionally bug-injected fixtures (A-I). Details: `docs/EVALUATION.md`.

## Safety

- No write-back to the original project (even patch application is manual)
- Forbidden: git push / npm publish / production operations / secret output
- Explorer/Reviewer/Judge/Verifier are read-only. Only Implementer/Test Designer write, and only inside the sandbox
- Details: `docs/SAFETY.md`

## Documentation

- `docs/ARCHITECTURE.md` - agent layout, trust boundary, data flow
- `docs/SAFETY.md` - prohibitions and permissions
- `docs/TARGET_ADAPTER.md` - how to add a new target project
- `docs/EVALUATION.md` - fixture benchmark and evaluation method

## License

MIT
