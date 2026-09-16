# fixture-g

Date formatting utilities.

## Contract

- `formatDate(iso, offsetMinutes = 0)` — the UTC offset is applied **before** extracting
  the calendar date. An instant like `2026-01-01T23:30:00Z` viewed at +09:00 (540) is `2026-01-02`.
- `formatDateTime(iso, offsetMinutes = 0)` — same offset semantics, output "YYYY-MM-DD HH:mm".

## Status

Unit tests pass (`npm test`).
