"use strict";

/**
 * Applies a percentage discount to a price.
 *
 * Contract (README.md):
 *   pct is expressed in PERCENT, 0..100. e.g. applyDiscount(100, 20) === 80
 */
function applyDiscount(price, pct) {
  return price * (1 - pct); // discount factor
}

module.exports = { applyDiscount };
