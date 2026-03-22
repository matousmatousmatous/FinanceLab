'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Point server at a temp progress file BEFORE requiring server ─────────────
const tmpProgressFile = path.join(os.tmpdir(), `financelab-progress-unit-${process.pid}.json`);
process.env.PROGRESS_FILE = tmpProgressFile;

const BLANK_PROGRESS = {
  topics: [],
  totalSessionsCompleted: 0,
  adaptiveMode: false,
  createdAt: new Date().toISOString(),
  sessionState: null,
  chapters: {},
  activeTextbookId: null,
  activeChapterId: null,
};

// Write a clean file before loading server so readProgress() doesn't fail on
// module-load side effects
fs.writeFileSync(tmpProgressFile, JSON.stringify(BLANK_PROGRESS, null, 2));

const {
  readProgress,
  writeProgress,
  extractCoreConceptsFromText,
  getNextChapter,
  applyGapAndDedup,
} = require('../server');

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(() => {
  try { fs.unlinkSync(tmpProgressFile); } catch {}
});

beforeEach(() => {
  // Reset file to a known blank state before every test
  fs.writeFileSync(tmpProgressFile, JSON.stringify({ ...BLANK_PROGRESS }, null, 2));
});

// ─── readProgress / writeProgress round-trip ─────────────────────────────────

describe('readProgress / writeProgress', () => {
  test('round-trip: data written is identical to data read back', () => {
    const data = {
      ...BLANK_PROGRESS,
      totalSessionsCompleted: 7,
      adaptiveMode: true,
      topics: [
        { id: 'wacc', title: 'WACC', completed: true, quizScores: [85, 90], weakSpots: [], lastStudied: '2026-01-01T00:00:00.000Z' },
      ],
    };

    writeProgress(data);
    const result = readProgress();

    expect(result).toEqual(data);
  });

  test('writeProgress overwrites previous content', () => {
    writeProgress({ ...BLANK_PROGRESS, totalSessionsCompleted: 1 });
    writeProgress({ ...BLANK_PROGRESS, totalSessionsCompleted: 99 });
    const result = readProgress();
    expect(result.totalSessionsCompleted).toBe(99);
  });

  test('readProgress returns plain object (not a string)', () => {
    const result = readProgress();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  test('round-trip preserves chapters and sessionState', () => {
    const data = {
      ...BLANK_PROGRESS,
      sessionState: { phase: 'quiz', topicId: 'dcf_valuation' },
      chapters: {
        chapter_abc123: {
          sessionsCompleted: 2,
          quizScores: [72, 80],
          difficultyRatings: ['hard'],
          weakSpots: ['IRR vs NPV'],
          lastStudied: '2026-03-01T00:00:00.000Z',
        },
      },
    };
    writeProgress(data);
    expect(readProgress()).toEqual(data);
  });
});

// ─── extractCoreConceptsFromText ──────────────────────────────────────────────

describe('extractCoreConceptsFromText', () => {
  test('extracts two [[CORE: ...]] tags from a string', () => {
    const text = 'Some intro text with [[CORE: EBITDA = X + Y]] and [[CORE: FCF = EBIT - capex]] here.';
    const result = extractCoreConceptsFromText(text);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    expect(result[0]).toMatchObject({ concept: expect.any(String), definition: expect.any(String) });
    expect(result[1]).toMatchObject({ concept: expect.any(String), definition: expect.any(String) });

    // The combined text of each entry should include the original tag content
    const raw0 = result[0].concept + ' ' + result[0].definition;
    const raw1 = result[1].concept + ' ' + result[1].definition;
    expect(raw0).toMatch(/EBITDA/);
    expect(raw1).toMatch(/FCF/);
  });

  test('returns empty array when no [[CORE: ...]] tags are present', () => {
    const text = 'This text has no core concept tags at all.';
    const result = extractCoreConceptsFromText(text);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('returns empty array for an empty string', () => {
    expect(extractCoreConceptsFromText('')).toEqual([]);
  });

  test('handles a single tag correctly', () => {
    const text = 'Only one: [[CORE: WACC = weighted average of debt and equity costs]]';
    const result = extractCoreConceptsFromText(text);
    expect(result).toHaveLength(1);
    const combined = result[0].concept + ' ' + result[0].definition;
    expect(combined).toMatch(/WACC/);
  });

  test('handles tags with colons inside the content', () => {
    const text = '[[CORE: P/E Ratio: price divided by earnings per share]]';
    const result = extractCoreConceptsFromText(text);
    expect(result).toHaveLength(1);
  });
});

// ─── getNextChapter advancement logic ────────────────────────────────────────

describe('getNextChapter', () => {
  // Helper to build a textbooks array with a simple chapter sequence
  function makeTextbooks(chapterIds) {
    return [
      {
        id: 'book1',
        title: 'Finance Fundamentals',
        chapters: chapterIds.map((id, i) => ({
          id,
          title: `Chapter ${i + 1}`,
          order: i + 1,
        })),
      },
    ];
  }

  // Helper to build a progress object
  function makeProgress(overrides = {}) {
    return {
      ...BLANK_PROGRESS,
      activeTextbookId: 'book1',
      activeChapterId: 'ch_1',
      chapters: {},
      ...overrides,
    };
  }

  test('chapter with sessionsCompleted=0 → does NOT advance (stays on current)', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2', 'ch_3']);
    const progress = makeProgress({
      chapters: {
        ch_1: { sessionsCompleted: 0, quizScores: [], difficultyRatings: [], weakSpots: [], lastStudied: null },
      },
    });

    const next = getNextChapter(textbooks, progress);
    // Should stay on ch_1 (not advance to ch_2)
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_1');
  });

  test('sessionsCompleted=1 and avg quizScore=80 → advances to next chapter', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2', 'ch_3']);
    const progress = makeProgress({
      chapters: {
        ch_1: { sessionsCompleted: 1, quizScores: [80], difficultyRatings: [], weakSpots: [], lastStudied: null },
      },
    });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_2');
  });

  test('sessionsCompleted=1 and avg quizScore=60 → does NOT advance (score below 70)', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2', 'ch_3']);
    const progress = makeProgress({
      chapters: {
        ch_1: { sessionsCompleted: 1, quizScores: [60], difficultyRatings: [], weakSpots: [], lastStudied: null },
      },
    });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_1');
  });

  test('sessionsCompleted=1, score=72, difficultyRating="hard" → does NOT advance (hard requires 2 sessions when score < 75)', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2', 'ch_3']);
    const progress = makeProgress({
      chapters: {
        ch_1: {
          sessionsCompleted: 1,
          quizScores: [72],
          difficultyRatings: ['hard'],
          weakSpots: [],
          lastStudied: null,
        },
      },
    });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_1');
  });

  test('sessionsCompleted=2, score=72, difficultyRating="hard" → advances (2 sessions completed, requirement met)', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2', 'ch_3']);
    const progress = makeProgress({
      chapters: {
        ch_1: {
          sessionsCompleted: 2,
          quizScores: [72, 74],
          difficultyRatings: ['hard'],
          weakSpots: [],
          lastStudied: null,
        },
      },
    });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_2');
  });

  test('returns first chapter when no chapters have been started', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2']);
    const progress = makeProgress({ chapters: {} });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_1');
  });

  test('returns null (or last chapter) when all chapters are completed', () => {
    const textbooks = makeTextbooks(['ch_1']);
    const progress = makeProgress({
      chapters: {
        ch_1: { sessionsCompleted: 1, quizScores: [90], difficultyRatings: [], weakSpots: [], lastStudied: null },
      },
    });

    const next = getNextChapter(textbooks, progress);
    // All chapters done — should return null or undefined (no next chapter)
    expect(next == null || next.id === 'ch_1').toBe(true);
  });

  test('hard chapter with score >= 75 after 1 session → advances', () => {
    const textbooks = makeTextbooks(['ch_1', 'ch_2']);
    const progress = makeProgress({
      chapters: {
        ch_1: {
          sessionsCompleted: 1,
          quizScores: [76],
          difficultyRatings: ['hard'],
          weakSpots: [],
          lastStudied: null,
        },
      },
    });

    const next = getNextChapter(textbooks, progress);
    expect(next).toBeTruthy();
    expect(next.id).toBe('ch_2');
  });
});

// ─── Adaptive mode topic selection ───────────────────────────────────────────

describe('Adaptive mode topic selection (getNextTopic logic)', () => {
  // This replicates the client-side getNextTopic logic but the server's
  // progress data is the source-of-truth input, so we test the expected
  // output given a progress object.

  function getNextTopicFromProgress(progress) {
    const TOPIC_ORDER = [
      'income_statement', 'balance_sheet', 'cash_flow_statement',
      'three_statements', 'key_metrics', 'time_value_money',
      'wacc', 'dcf_valuation', 'comps', 'lbo_mechanics',
    ];
    const topics = progress.topics || [];

    if (progress.adaptiveMode) {
      const weak = topics
        .filter(t => {
          if (!t.completed || !t.quizScores.length) return false;
          const avg = t.quizScores.reduce((a, b) => a + b, 0) / t.quizScores.length;
          return avg < 65;
        })
        .sort((a, b) => {
          const as = a.quizScores.reduce((x, y) => x + y, 0) / a.quizScores.length;
          const bs = b.quizScores.reduce((x, y) => x + y, 0) / b.quizScores.length;
          return as - bs;
        });

      if (weak.length) return weak[0];
    }

    return topics.find(t => !t.completed) || null;
  }

  test('adaptive mode OFF → returns first incomplete topic in order', () => {
    const progress = {
      adaptiveMode: false,
      topics: [
        { id: 'income_statement', completed: true, quizScores: [30], weakSpots: [] },
        { id: 'balance_sheet',    completed: false, quizScores: [],   weakSpots: [] },
        { id: 'wacc',             completed: false, quizScores: [],   weakSpots: [] },
      ],
    };

    const next = getNextTopicFromProgress(progress);
    expect(next.id).toBe('balance_sheet');
  });

  test('adaptive mode ON → lowest-scoring completed topic (score < 65) is prioritized', () => {
    const progress = {
      adaptiveMode: true,
      topics: [
        { id: 'income_statement', completed: true,  quizScores: [55],     weakSpots: [] },
        { id: 'balance_sheet',    completed: true,  quizScores: [40],     weakSpots: [] },
        { id: 'wacc',             completed: false, quizScores: [],       weakSpots: [] },
      ],
    };

    const next = getNextTopicFromProgress(progress);
    // balance_sheet has the lowest avg (40) so it should be first
    expect(next.id).toBe('balance_sheet');
  });

  test('adaptive mode ON but all completed topics score >= 65 → falls back to first incomplete', () => {
    const progress = {
      adaptiveMode: true,
      topics: [
        { id: 'income_statement', completed: true,  quizScores: [80], weakSpots: [] },
        { id: 'balance_sheet',    completed: false, quizScores: [],   weakSpots: [] },
      ],
    };

    const next = getNextTopicFromProgress(progress);
    expect(next.id).toBe('balance_sheet');
  });

  test('adaptive mode ON with multiple weak topics → worst score returned first', () => {
    const progress = {
      adaptiveMode: true,
      topics: [
        { id: 'income_statement',    completed: true, quizScores: [60], weakSpots: [] },
        { id: 'balance_sheet',       completed: true, quizScores: [50], weakSpots: [] },
        { id: 'cash_flow_statement', completed: true, quizScores: [55], weakSpots: [] },
        { id: 'wacc',                completed: false, quizScores: [],  weakSpots: [] },
      ],
    };

    const next = getNextTopicFromProgress(progress);
    expect(next.id).toBe('balance_sheet'); // lowest at 50
  });

  test('adaptive mode ON but no weak topics and no incomplete → returns null', () => {
    const progress = {
      adaptiveMode: true,
      topics: [
        { id: 'income_statement', completed: true, quizScores: [90], weakSpots: [] },
      ],
    };

    const next = getNextTopicFromProgress(progress);
    expect(next).toBeNull();
  });
});

// ─── applyGapAndDedup ─────────────────────────────────────────────────────────

describe('applyGapAndDedup', () => {
  test('gap filter: drops candidates fewer than 30 pages apart, keeps first', () => {
    const candidates = [
      { number: 1, pageNum: 1,  title: 'Chapter 1' },
      { number: 2, pageNum: 20, title: 'Chapter 2' }, // only 19 pages after prev → dropped
      { number: 3, pageNum: 50, title: 'Chapter 3' }, // 30 pages after ch1 → kept
    ];
    const result = applyGapAndDedup(candidates, 30);
    expect(result.map(c => c.number)).toEqual([1, 3]);
  });

  test('dedup: keeps first occurrence when same chapter number appears twice', () => {
    const candidates = [
      { number: 1, pageNum: 1,   title: 'Chapter 1 first' },
      { number: 2, pageNum: 40,  title: 'Chapter 2' },
      { number: 1, pageNum: 80,  title: 'Chapter 1 duplicate' }, // same number → dropped
    ];
    const result = applyGapAndDedup(candidates, 30);
    const ch1 = result.find(c => c.number === 1);
    expect(ch1.title).toBe('Chapter 1 first');
    expect(result.filter(c => c.number === 1)).toHaveLength(1);
  });
});
