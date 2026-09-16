"use strict";

// Invariants for transfer():
//  1. failed transfers leave balances untouched (atomicity)
//  2. replaying a transferId does not double-move funds (idempotency)
const assert = require("node:assert");
const { createLedger } = require("../src/store.js");

const ledger = createLedger({ alice: 100, bob: 50 });

// atomicity
try {
  ledger.transfer({ from: "alice", to: "unknown", amount: 30, transferId: "fail-1" });
} catch {
  // expected failure
}
assert.strictEqual(ledger.balance("alice"), 100, "ATOMICITY BROKEN: debit persisted after failed transfer");

// idempotency
ledger.transfer({ from: "alice", to: "bob", amount: 10, transferId: "ok-1" });
assert.strictEqual(ledger.balance("bob"), 60, "first transfer did not apply");
ledger.transfer({ from: "alice", to: "bob", amount: 10, transferId: "ok-1" });
assert.strictEqual(ledger.balance("bob"), 60, `IDEMPOTENCY BROKEN: replay changed bob to ${ledger.balance("bob")}`);

// retry after failure must be allowed to complete (a failed attempt must NOT consume the id)
try {
  ledger.transfer({ from: "alice", to: "unknown", amount: 5, transferId: "fail-2" });
} catch {
  // expected
}
ledger.transfer({ from: "alice", to: "bob", amount: 5, transferId: "fail-2" });
assert.strictEqual(ledger.balance("bob"), 65, `RETRY BROKEN: failed attempt consumed the transferId (bob=${ledger.balance("bob")})`);
console.log("invariant OK");
