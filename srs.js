'use strict';

/** Returns today's date as YYYY-MM-DD (UTC). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Adds `days` to a YYYY-MM-DD string, returns a new YYYY-MM-DD string. */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build an initial SRS entry for a newly completed session.
 * next_review_date = today + 3 days (Review 1).
 */
function createEntry(sessionId, chapterId, curriculum, score, weakSpots) {
  return {
    session_id:       sessionId,
    chapter_id:       chapterId  || '',
    curriculum:       curriculum || 'harrison',
    next_review_date: addDays(today(), 3),
    interval_days:    3,
    ease_factor:      2.5,
    review_count:     0,
    last_score:       score !== undefined ? score : null,
    weak_spots:       weakSpots || [],
  };
}

/**
 * Update an SRS entry after a review quiz using a simplified SM-2 algorithm.
 * score is 0–100.
 *
 *   ≥ 80 → increase interval × ease_factor, bump ease_factor (cap 2.5)
 *   60–79 → increase interval × 1.2
 *   < 60  → reset interval to 3, decrease ease_factor (floor 1.3)
 */
function updateSchedule(entry, score) {
  const e = { ...entry };
  if (score >= 80) {
    e.interval_days = Math.round(e.interval_days * e.ease_factor);
    e.ease_factor   = Math.min(2.5, +(e.ease_factor + 0.1).toFixed(4));
  } else if (score >= 60) {
    e.interval_days = Math.round(e.interval_days * 1.2);
  } else {
    e.interval_days = 3;
    e.ease_factor   = Math.max(1.3, +(e.ease_factor - 0.2).toFixed(4));
  }
  e.next_review_date = addDays(today(), e.interval_days);
  e.review_count     = (e.review_count || 0) + 1;
  e.last_score       = score;
  return e;
}

module.exports = { today, addDays, createEntry, updateSchedule };
