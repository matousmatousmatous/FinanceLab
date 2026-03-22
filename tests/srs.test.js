'use strict';

const { today, addDays, createEntry, updateSchedule } = require('../srs');

// ─── today() ──────────────────────────────────────────────────────────────────

describe('today()', () => {
  test('returns a string in YYYY-MM-DD format', () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── addDays() ────────────────────────────────────────────────────────────────

describe('addDays()', () => {
  test('adds 3 days correctly', () => {
    expect(addDays('2026-01-01', 3)).toBe('2026-01-04');
  });

  test('handles month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  test('handles year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  test('adding 0 days returns same date', () => {
    expect(addDays('2026-03-15', 0)).toBe('2026-03-15');
  });
});

// ─── createEntry() ────────────────────────────────────────────────────────────

describe('createEntry()', () => {
  test('returns correct initial structure', () => {
    const entry = createEntry('ch01-s01', 'ch01', 'harrison', 85, ['EBITDA']);
    expect(entry.session_id).toBe('ch01-s01');
    expect(entry.chapter_id).toBe('ch01');
    expect(entry.curriculum).toBe('harrison');
    expect(entry.interval_days).toBe(3);
    expect(entry.ease_factor).toBe(2.5);
    expect(entry.review_count).toBe(0);
    expect(entry.last_score).toBe(85);
    expect(entry.weak_spots).toEqual(['EBITDA']);
  });

  test('next_review_date is 3 days from today', () => {
    const entry = createEntry('ch01-s01', 'ch01', 'harrison', 80, []);
    expect(entry.next_review_date).toBe(addDays(today(), 3));
  });

  test('uses defaults when optional params are omitted', () => {
    const entry = createEntry('ch01-s01');
    expect(entry.chapter_id).toBe('');
    expect(entry.curriculum).toBe('harrison');
    expect(entry.last_score).toBeNull();
    expect(entry.weak_spots).toEqual([]);
  });
});

// ─── updateSchedule() ─────────────────────────────────────────────────────────

const BASE_ENTRY = {
  session_id: 'ch01-s01',
  chapter_id: 'ch01',
  curriculum: 'harrison',
  next_review_date: '2026-03-22',
  interval_days: 3,
  ease_factor: 2.5,
  review_count: 0,
  last_score: 80,
  weak_spots: [],
};

describe('updateSchedule() — score ≥ 80', () => {
  test('interval grows (multiplied by ease_factor)', () => {
    const updated = updateSchedule(BASE_ENTRY, 85);
    expect(updated.interval_days).toBe(Math.round(3 * 2.5)); // 8
  });

  test('ease_factor increases by 0.1 when below cap', () => {
    const updated = updateSchedule({ ...BASE_ENTRY, ease_factor: 2.3 }, 85);
    expect(updated.ease_factor).toBeCloseTo(2.4, 4);
  });

  test('ease_factor caps at 2.5 when already at max', () => {
    const updated = updateSchedule({ ...BASE_ENTRY, ease_factor: 2.5 }, 95);
    expect(updated.ease_factor).toBe(2.5);
  });

  test('review_count increments by 1', () => {
    const updated = updateSchedule(BASE_ENTRY, 80);
    expect(updated.review_count).toBe(1);
  });

  test('last_score is updated', () => {
    const updated = updateSchedule(BASE_ENTRY, 90);
    expect(updated.last_score).toBe(90);
  });

  test('next_review_date is pushed forward by new interval', () => {
    const updated = updateSchedule(BASE_ENTRY, 85);
    const expected = addDays(today(), updated.interval_days);
    expect(updated.next_review_date).toBe(expected);
  });

  test('original entry is not mutated', () => {
    updateSchedule(BASE_ENTRY, 85);
    expect(BASE_ENTRY.interval_days).toBe(3);
    expect(BASE_ENTRY.ease_factor).toBe(2.5);
  });
});

describe('updateSchedule() — score 60–79', () => {
  test('interval grows by ×1.2', () => {
    const updated = updateSchedule(BASE_ENTRY, 70);
    expect(updated.interval_days).toBe(Math.round(3 * 1.2)); // 4
  });

  test('ease_factor is unchanged', () => {
    const updated = updateSchedule(BASE_ENTRY, 70);
    expect(updated.ease_factor).toBe(2.5);
  });

  test('review_count increments', () => {
    const updated = updateSchedule(BASE_ENTRY, 65);
    expect(updated.review_count).toBe(1);
  });
});

describe('updateSchedule() — score < 60', () => {
  test('interval resets to 3', () => {
    const updated = updateSchedule({ ...BASE_ENTRY, interval_days: 20 }, 50);
    expect(updated.interval_days).toBe(3);
  });

  test('ease_factor decreases by 0.2', () => {
    const updated = updateSchedule(BASE_ENTRY, 40);
    expect(updated.ease_factor).toBeCloseTo(2.3, 4);
  });

  test('ease_factor floors at 1.3', () => {
    const updated = updateSchedule({ ...BASE_ENTRY, ease_factor: 1.3 }, 30);
    expect(updated.ease_factor).toBe(1.3);
  });

  test('review_count increments', () => {
    const updated = updateSchedule(BASE_ENTRY, 0);
    expect(updated.review_count).toBe(1);
  });
});
