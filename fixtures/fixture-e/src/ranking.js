"use strict";

// Implements the documented ranking contract (SPEC.md).
function rankVideos(videos) {
  return [...videos].sort((a, b) => a.score - b.score); // by score
}

module.exports = { rankVideos };
