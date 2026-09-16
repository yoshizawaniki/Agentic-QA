"use strict";

// Contract: every call to increment() must increase the total by exactly 1,
// regardless of interleaving or concurrency.
function createCounter() {
  let count = 0;

  async function increment(delayMs = 5) {
    const current = count; // read
    await new Promise((resolve) => setTimeout(resolve, delayMs)); // simulated I/O window
    count = current + 1; // write
  }

  function value() {
    return count;
  }

  return { increment, value };
}

module.exports = { createCounter };
