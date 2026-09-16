"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createLedger } = require("../src/store.js");

test("happy transfer moves funds", () => {
  const ledger = createLedger({ a: 100, b: 0 });
  ledger.transfer({ from: "a", to: "b", amount: 40, transferId: "t1" });
  assert.strictEqual(ledger.balance("a"), 60);
  assert.strictEqual(ledger.balance("b"), 40);
});
