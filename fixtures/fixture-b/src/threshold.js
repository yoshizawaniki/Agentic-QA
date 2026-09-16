"use strict";

/**
 * Free shipping threshold.
 *
 * Contract (README.md): carts of at least 50 (inclusive) ship free.
 */
const FREE_SHIPPING_MIN = 50;

function isFreeShipping(cartTotal) {
  return cartTotal >= FREE_SHIPPING_MIN;
}

module.exports = { isFreeShipping, FREE_SHIPPING_MIN };
