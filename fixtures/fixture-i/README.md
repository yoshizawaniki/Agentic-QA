# fixture-i

Tag normalization helpers.

## API contract

- `normalizeTags(tags)`:
  1. **Deduplicates case-insensitively**: `"React"` and `"react"` are the same tag. The FIRST spelling encountered is kept.
  2. **Preserves first-occurrence order** of the retained (original-spelling) tags.
  3. Returns `[]` when `tags` is not an array (never throws, never echoes the input).

Example: `normalizeTags(["React", "node", "react", "NODE"])` → `["React", "node"]`
Example: `normalizeTags("react")` → `[]`

## Status

Unit tests pass (`npm test`).
