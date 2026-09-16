"use strict";

/**
 * Clamps a numeric value into the inclusive range [min, max].
 *
 * Contract (see SPEC.md):
 *   clamp(v, min, max)
 *     - returns v            when min <= v <= max
 *     - returns min          when v < min
 *     - returns max          when v > max
 */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return min; // upper bound
  return value;
}

module.exports = { clamp };
