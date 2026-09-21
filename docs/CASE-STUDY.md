# Public-safe case study: AI claim versus executed evidence

This case study is derived from a real Agentic-QA audit of a larger development project. Identifying local paths, private source, and project-specific implementation details are intentionally omitted.

## What happened

During an AI-backed audit, an adversarial reviewer proposed a concurrency/race finding. The claim was plausible, but it did not carry deterministic evidence. The final judge rejected that finding rather than promoting an AI hypothesis to fact.

During the same audit window, a separate event occurred: the original target tree changed while Agentic-QA was working from its isolated copy. The before/after SHA-256 baseline comparison detected that drift. That finding was marked confirmed because it had direct deterministic evidence.

## Evidence classification

| Observation | Evidence | Final treatment |
|---|---|---|
| AI reviewer suspected a race condition | AI analysis and a proposed reproduction only | rejected |
| Original target changed during the run | before/after SHA-256 baseline comparison | confirmed |

The two observations were not merged. A plausible AI claim did not become true because another real issue happened nearby.

## Why this matters

The case demonstrates two intended properties:

1. **AI consensus is not correctness.** An AI-originated finding can be rejected when the evidence does not justify confirmation.
2. **Isolation and drift are separate questions.** Agentic-QA can run gates against a copy while independently detecting that the original tree changed because of an outside process.

## What this case does not prove

It does not prove that all false-positive AI findings will be rejected, that SHA-256 baselines identify which outside process wrote a file, or that the sandbox is a hardened OS security boundary. It is one observed real-project case, not a universal reliability statistic.

For a fully public and reproducible analogue, the fixture suite exercises deterministic-vs-AI finding accounting, and fixture-i is reserved for false-verification probing.

The repository also contains public isolation tests in tests/workspace.test.ts. They demonstrate the documented boundary directly: ordinary source writes in the sandbox do not alter the target; fast mode intentionally shares node_modules; strict mode physically copies node_modules so the same cache write no longer reaches the target.
