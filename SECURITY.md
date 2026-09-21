# Security Policy

## Supported code

Security fixes target the current master branch and the most recent published release once release tags exist. The repository currently has no published release tag.

## Reporting a vulnerability

Do not put real credentials, exploitable private-repository details, or sensitive target source code in a public issue.

Use the repository's GitHub security reporting surface when private vulnerability reporting is available. If it is unavailable, open only a minimal public issue asking for a private contact, without exploit details, secrets, or private source.

Include, when safe:

- affected Agentic-QA version or commit;
- OS and Node version;
- affected command or boundary;
- a public-safe minimal reproduction;
- expected versus observed behavior;
- whether original-tree isolation, sandboxing, redaction, command execution, or verification state is involved.

Especially important reports include writes escaping the run workspace, original-target mutation during audit, secret leakage, command injection through target configuration, a path to verified without required evidence, repair-agent permission bypass, and package/install behavior that performs unexpected external actions.

Agentic-QA is a QA tool, not a hardened operating-system sandbox. Documented isolation limits in docs/SAFETY.md are not automatically vulnerabilities unless the implementation exceeds or contradicts that boundary.

