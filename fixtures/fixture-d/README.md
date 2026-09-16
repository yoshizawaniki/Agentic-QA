# fixture-d

Toy ledger used by the billing demo.

## Guarantees (README contract)

- `transfer()` is **atomic**: if any part fails, both account balances are unchanged.
- `transfer()` is **idempotent per `transferId`**: replaying the same successful id never moves money twice, and failed attempts never block a later retry.

## Status

Unit tests pass (`npm test`).
