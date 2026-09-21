# Release process

No release action in this document is automatic. A maintainer explicitly decides when to publish.

## Versioning

Agentic-QA intends to use Semantic Versioning:

- patch: compatible bug fix or documentation-only correction;
- minor: backward-compatible capability, CLI command/option, or material packaging improvement;
- major: incompatible CLI/config/evidence-format or verification-semantics change.

For the current unreleased hardening work, the prepared version candidate is **0.2.0** because the npm CLI distribution path and OSS operational surface materially change while preserving the existing command model.

## Pre-release evidence

From a clean worktree, run:

    npm run typecheck
    npm test
    npm run eval:deterministic
    npm audit
    npm audit --omit=dev
    npm run secret-scan
    npm run package:smoke
    npm pack --dry-run

Then inspect the package file list, CHANGELOG.md, release notes, git diff, and git status.

AI-backed benchmark results are not release gates because they can require provider access, quota, or payment. If quoted in release notes, attach model/date/population and keep them separate from deterministic measurements.

## Publication boundary

The following are explicit maintainer actions and must never happen merely because tests passed:

- version bump commit;
- git tag;
- git push;
- GitHub Release publication;
- npm publish;
- announcements or third-party application updates.

## Prepared next-release metadata

- version candidate: 0.2.0
- tag candidate: v0.2.0
- draft notes: docs/RELEASE-NOTES-0.2.0.md

