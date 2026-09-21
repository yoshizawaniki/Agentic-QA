## What changes?

Describe the problem and the smallest relevant change.

## Evidence

- [ ] npm run typecheck
- [ ] npm test
- [ ] npm run eval:deterministic (when detection/verification behavior can change)
- [ ] npm run package:smoke (when packaging/CLI behavior can change)
- [ ] npm run secret-scan

Paste concise deterministic evidence. Do not rely on AI agreement alone.

## Safety / compatibility

- [ ] Original-target read-only behavior is unchanged or stronger.
- [ ] No secret, token, private source, identifying local path, or run artifact was added.
- [ ] Golden fixture expectations were not changed, or the reason is explained below.
- [ ] No publishing/deployment behavior was introduced.

### Golden-data change rationale

N/A

