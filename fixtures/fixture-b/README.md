# fixture-b

Cart pricing helpers.

## API contract

- `applyDiscount(price, pct)` — `pct` is a **percentage in the range 0..100**.
  Example: `applyDiscount(100, 20)` returns `80` (20% off).
- `isFreeShipping(cartTotal)` — returns `true` when the cart total is **at least 50** (the boundary value 50 itself qualifies).

## Status

All unit tests pass (`npm test`).
