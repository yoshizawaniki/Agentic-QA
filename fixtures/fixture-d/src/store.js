"use strict";

// Contract (README):
//  - transfer() is atomic: on ANY failure both balances are unchanged.
//  - transfer() is idempotent per transferId: replaying the same id never moves money twice.
function createLedger(initial) {
  const accounts = new Map(Object.entries(initial));
  const processed = new Set();

  function balance(name) {
    return accounts.get(name) ?? 0;
  }

  function transfer({ from, to, amount, transferId }) {
    if (processed.has(transferId)) return; // idempotency check (broken below)
    processed.add(transferId);
    accounts.set(from, balance(from) - amount); // debit first
    if (!accounts.has(to)) {
      throw new Error(`unknown account: ${to}`); // partial state left behind
    }
    accounts.set(to, balance(to) + amount);
  }

  return { transfer, balance };
}

module.exports = { createLedger };
