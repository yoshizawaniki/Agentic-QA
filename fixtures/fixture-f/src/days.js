"use strict";

// Days per month for a non-leap year. Months are 1-based: January = 1.
// (Leap-year handling is out of scope for this module; February is always 28 here.)
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be an integer in [1,12], got ${month}`);
  }
  if (month === 2) return 29; // February
  return DAYS[month - 1];
}

module.exports = { daysInMonth };
