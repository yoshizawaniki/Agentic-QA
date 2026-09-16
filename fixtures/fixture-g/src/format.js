"use strict";

/**
 * Formats an ISO instant as "YYYY-MM-DD" in the given UTC offset (minutes east of UTC).
 * Contract (README): offset shifts the instant BEFORE extracting the calendar date,
 * so 2026-01-01T23:30:00Z at +09:00 is 2026-01-02.
 */
function formatDate(iso, offsetMinutes = 0) {
  const ts = Date.parse(iso);
  return new Date(ts).toISOString().slice(0, 10); // date part
}

/** Formats as "YYYY-MM-DD HH:mm" at the given offset. Shares parsing with formatDate. */
function formatDateTime(iso, offsetMinutes = 0) {
  const ts = Date.parse(iso);
  const d = new Date(ts + offsetMinutes * 60000);
  const datePart = d.toISOString().slice(0, 10);
  const timePart = d.toISOString().slice(11, 16);
  return `${datePart} ${timePart}`;
}

module.exports = { formatDate, formatDateTime };
