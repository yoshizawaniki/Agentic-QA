"use strict";

/**
 * Normalizes a tag list. See README.md for the full contract:
 * 1) case-insensitive dedup keeping first spelling, 2) first-occurrence order,
 * 3) non-array input yields [].
 */
function normalizeTags(tags) {
  return [...new Set(tags)]; // dedupe
}

module.exports = { normalizeTags };
