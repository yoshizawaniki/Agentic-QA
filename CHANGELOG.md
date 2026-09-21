# Changelog

Notable user-visible changes are recorded here. Agentic-QA intends to follow Semantic Versioning for release tags.

## 0.2.0 - Unreleased release candidate

### Added

- Build-to-JavaScript packaging path for an installable npm CLI.
- Clean-install package smoke covering CLI help and deterministic fixture audit.
- Deterministic benchmark regression gate and repository secret scan.
- Windows/Linux GitHub Actions CI with no AI credentials.
- Contributor, security, conduct, issue/PR, troubleshooting, release, and case-study documentation.
- Packaged OpenCode test-designer and implementer permission definitions used by repair mode.
- PATH discovery for an externally installed OpenCode CLI.
- Reproducible fixture-i false-verification harness with naive/correct candidate oracle and model-specific FVR/Repair Success accounting.
- Optional strict isolation mode that physically copies node_modules instead of junction-sharing it.

### Changed

- Package metadata now declares repository, issue tracker, homepage, keywords, engine, and an explicit package file allowlist.
- CLI run-directory path handling is cross-platform.
- Evaluation documentation separates current nine-fixture deterministic measurements from historical eight-fixture AI measurements.
- Run manifests resolve Agentic-QA's own package version instead of the consumer process working directory.

### Fixed

- npm-installed CLI no longer points at TypeScript under node_modules.
- Emitted dist/cli.js is recognized as a direct CLI entry point.

## 0.1.0 - 2026-09-19

- Initial repository baseline for audit, repair, campaign, verify, deterministic gates, fixture evaluation, and optional OpenCode-backed AI layers.
