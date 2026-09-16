"use strict";

function divide(a, b) {
  if (b === 0) throw new RangeError("division by zero");
  return a / b;
}

function mean(values) {
  if (values.length === 0) throw new RangeError("empty input");
  return values.reduce((s, v) => s + v, 0) / values.length;
}

module.exports = { divide, mean };
