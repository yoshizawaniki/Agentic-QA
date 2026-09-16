# SPEC — clamp

- `clamp(value, min, max)` clamps `value` into the inclusive range `[min, max]`.
- Below range: result is exactly `min`.
- Above range: result is exactly `max`.
- Inside range: result is exactly `value`.
- Works for negative bounds and non-integer values.
