'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Temp files — must be set BEFORE requiring server ────────────────────────

const tmpProgressFile  = path.join(os.tmpdir(), `financelab-progress-api-${process.pid}.json`);
const tmpTextbooksFile = path.join(os.tmpdir(), `financelab-textbooks-api-${process.pid}.json`);
const tmpLibraryFile   = path.join(os.tmpdir(), `financelab-library-api-${process.pid}.json`);
const tmpSrsFile       = path.join(os.tmpdir(), `financelab-srs-api-${process.pid}.json`);

process.env.PROGRESS_FILE  = tmpProgressFile;
process.env.TEXTBOOKS_FILE = tmpTextbooksFile;
process.env.LIBRARY_FILE   = tmpLibraryFile;
process.env.SRS_FILE       = tmpSrsFile;

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_PROGRESS = {
  topics: [
    {
      id: 'income_statement',
      title: 'The Income Statement',
      order: 1,
      completed: false,
      quizScores: [],
      weakSpots: [],
      lastStudied: null,
    },
  ],
  totalSessionsCompleted: 0,
  adaptiveMode: false,
  createdAt: new Date().toISOString(),
  sessionState: null,
  chapters: {},
  activeTextbookId: null,
  activeChapterId: null,
};

const SEED_TEXTBOOKS = [];
const SEED_LIBRARY   = { entries: [] };
const SEED_SRS       = { entries: [] };

function resetFiles() {
  fs.writeFileSync(tmpProgressFile,  JSON.stringify(SEED_PROGRESS,  null, 2));
  fs.writeFileSync(tmpTextbooksFile, JSON.stringify(SEED_TEXTBOOKS, null, 2));
  fs.writeFileSync(tmpLibraryFile,   JSON.stringify(SEED_LIBRARY,   null, 2));
  fs.writeFileSync(tmpSrsFile,       JSON.stringify(SEED_SRS,       null, 2));
}

resetFiles();

// ─── Mock @supabase/supabase-js (disabled — SUPABASE_URL not set in tests) ───
// Supabase client is null when SUPABASE_URL is absent, so no network calls occur.
// We mock the module to confirm it can be required without error.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({})),
}));

// ─── Mock @anthropic-ai/sdk ───────────────────────────────────────────────────

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(({ system, messages }) => {
        const userContent = messages[0].content;
        let responseText = '{}';

        // NOTE: library/quiz check must come before the generic quiz check because
        // "Generate a Library quiz" contains both 'Library' and 'quiz'.
        if (userContent.includes('library') || userContent.includes('Library')) {
          responseText = JSON.stringify({
            questions: [
              {
                id: 1,
                type: 'multiple_choice',
                question: 'What is EBITDA?',
                options: ['A', 'B', 'C', 'D'],
                correct_index: 0,
                explanation: 'A',
              },
            ],
          });
        } else if (userContent.includes('Produce a lesson outline')) {
          // Pass 1 — outline generation
          responseText = JSON.stringify({
            hook: 'Why accounting matters for PE analysts',
            sections: [
              {
                concept: 'Accounting Equation',
                source_passage: 'Assets = Liabilities + Equity',
                explanation_angle: 'Start with the balance sheet identity',
                example: 'Simple T-account example',
              },
            ],
            worked_example: {
              scenario: 'Build a simple P&L',
              data: 'Revenue 100, COGS 60, D&A 10',
              source: 'Chapter 3, page 45',
            },
            formulas_to_tag: ['EBITDA = EBIT + D&A'],
            deal_perspective: 'PE analysts focus on EBITDA as a proxy for cash flow.',
          });
        } else if (userContent.includes('lesson') || userContent.includes('Learn') || userContent.includes('Write a complete lesson')) {
          // Generate mock content that meets the 1,800–2,200 word target
          const para = 'This is a detailed explanation of the accounting concept with precise definitions and worked examples. ' +
            'The accounting equation states that assets equal liabilities plus equity at all times. ' +
            'Every business transaction affects at least two accounts, keeping the equation in balance. ' +
            'Financial statements are prepared in a specific order: income statement first, then equity statement, then balance sheet, then cash flow statement. ';
          const mockContent = [
            '## Overview\n\n' + para.repeat(3),
            '## Core Concepts\n\n[[CORE: Accounting Equation = Assets = Liabilities + Equity]]\n\n' + para.repeat(12),
            '## Worked Example\n\n' + para.repeat(8),
            '## Deal Perspective\n\n' + para.repeat(3),
            '## Key Takeaways\n\n- Assets equal liabilities plus equity at all times.\n- Every transaction is recorded with equal debits and credits.\n- Financial statements follow a strict preparation order.\n- Accrual accounting records revenue when earned, not when cash is received.\n- The income statement covers a period; the balance sheet is a snapshot.',
          ].join('\n\n');
          responseText = JSON.stringify({
            title: 'Test Topic',
            content: mockContent,
            keyTakeaways: ['Point 1', 'Point 2', 'Point 3', 'Point 4', 'Point 5'],
          });
        } else if (userContent.includes('examples')) {
          responseText = JSON.stringify({
            examples: [
              {
                title: 'Ex 1',
                scenario: 'Scenario',
                solution: 'Solution',
                analystInsight: 'Insight',
              },
            ],
          });
        } else if (userContent.includes('quiz') || userContent.includes('Quiz')) {
          responseText = JSON.stringify({
            questions: [
              {
                id: 1,
                type: 'multiple_choice',
                question: 'Q1?',
                options: ['A', 'B', 'C', 'D'],
                correct_index: 0,
                explanation: 'Because A',
              },
              {
                id: 2,
                type: 'multiple_choice',
                question: 'Q2?',
                options: ['A', 'B', 'C', 'D'],
                correct_index: 1,
                explanation: 'Because B',
              },
              {
                id: 3,
                type: 'short_answer',
                question: 'Q3?',
                model_answer: 'Model answer',
              },
              {
                id: 4,
                type: 'fill_in_blank',
                title: 'P&L',
                context: 'Context',
                table: {
                  headers: ['Item', 'Value'],
                  rows: [
                    { label: 'Revenue',  value: '100', blank: false, answer: null },
                    { label: 'EBITDA',   value: '',    blank: true,  answer: '30'  },
                  ],
                },
              },
            ],
          });
        } else if (userContent.includes('Grade')) {
          responseText = JSON.stringify({
            aiResults: [
              { id: 3, type: 'short_answer',  score: 0.8, feedback: 'Good' },
              {
                id: 4,
                type: 'fill_in_blank',
                score: 1.0,
                feedback: 'Correct',
                cellResults: [
                  {
                    label: 'EBITDA',
                    correct: true,
                    userValue: '30',
                    correctValue: '30',
                    feedback: '',
                  },
                ],
              },
            ],
            weakSpots: [],
            nextStepAdvice: 'Keep going',
          });
        }

        return Promise.resolve({ content: [{ text: responseText }] });
      }),
    },
  }));
});

// ─── Load server AFTER env + mocks are set up ─────────────────────────────────

const request = require('supertest');
const { app } = require('../server');

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetFiles();
  jest.clearAllMocks();
});

afterAll(() => {
  try { fs.unlinkSync(tmpProgressFile);  } catch {}
  try { fs.unlinkSync(tmpTextbooksFile); } catch {}
  try { fs.unlinkSync(tmpLibraryFile);   } catch {}
  try { fs.unlinkSync(tmpSrsFile);       } catch {}
});

// ─── GET /api/progress ────────────────────────────────────────────────────────

describe('GET /api/progress', () => {
  test('returns 200 with valid progress schema', async () => {
    const res = await request(app).get('/api/progress');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('topics');
    expect(res.body).toHaveProperty('totalSessionsCompleted');
    expect(res.body).toHaveProperty('adaptiveMode');
    expect(Array.isArray(res.body.topics)).toBe(true);
  });

  test('topics array entries have required fields', async () => {
    const res = await request(app).get('/api/progress');
    const topic = res.body.topics[0];

    expect(topic).toHaveProperty('id');
    expect(topic).toHaveProperty('title');
    expect(topic).toHaveProperty('completed');
    expect(topic).toHaveProperty('quizScores');
    expect(topic).toHaveProperty('weakSpots');
  });
});

// ─── POST /api/progress ───────────────────────────────────────────────────────

describe('POST /api/progress', () => {
  test('returns 200 with { success: true }', async () => {
    const payload = { ...SEED_PROGRESS, totalSessionsCompleted: 5 };
    const res = await request(app)
      .post('/api/progress')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('persists data: subsequent GET reflects posted changes', async () => {
    const payload = { ...SEED_PROGRESS, totalSessionsCompleted: 42 };
    await request(app)
      .post('/api/progress')
      .send(payload)
      .set('Content-Type', 'application/json');

    const get = await request(app).get('/api/progress');
    expect(get.body.totalSessionsCompleted).toBe(42);
  });
});

// ─── PATCH /api/progress ──────────────────────────────────────────────────────

describe('PATCH /api/progress', () => {
  test('merges sessionState into existing progress', async () => {
    const sessionState = { phase: 'quiz', topicId: 'wacc', timestamp: '2026-03-22T00:00:00.000Z' };

    const res = await request(app)
      .patch('/api/progress')
      .send({ sessionState })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);

    const get = await request(app).get('/api/progress');
    expect(get.body.sessionState).toEqual(sessionState);
  });

  test('does not overwrite unrelated fields when patching sessionState', async () => {
    // Seed a known totalSessionsCompleted
    await request(app)
      .post('/api/progress')
      .send({ ...SEED_PROGRESS, totalSessionsCompleted: 7 })
      .set('Content-Type', 'application/json');

    await request(app)
      .patch('/api/progress')
      .send({ sessionState: { phase: 'learn' } })
      .set('Content-Type', 'application/json');

    const get = await request(app).get('/api/progress');
    expect(get.body.totalSessionsCompleted).toBe(7);
    expect(get.body.sessionState).toEqual({ phase: 'learn' });
  });

  test('can clear sessionState by patching with null', async () => {
    // First set a sessionState
    await request(app)
      .patch('/api/progress')
      .send({ sessionState: { phase: 'quiz' } })
      .set('Content-Type', 'application/json');

    // Then clear it
    await request(app)
      .patch('/api/progress')
      .send({ sessionState: null })
      .set('Content-Type', 'application/json');

    const get = await request(app).get('/api/progress');
    expect(get.body.sessionState).toBeNull();
  });
});

// ─── POST /api/learn ─────────────────────────────────────────────────────────

describe('POST /api/learn', () => {
  test('returns 200 with { title, content, keyTakeaways }', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('keyTakeaways');
    expect(Array.isArray(res.body.keyTakeaways)).toBe(true);
  });

  test('works with optional chapterText in body', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({
        topicId: 'wacc',
        topicTitle: 'WACC and Cost of Capital',
        chapterText: 'WACC = (E/V) * Re + (D/V) * Rd * (1 - Tc)',
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title');
  });

  test('content is at least 1,500 words', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    const wordCount = res.body.content.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(1500);
  });

  test('keyTakeaways has at least 4 entries', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keyTakeaways)).toBe(true);
    expect(res.body.keyTakeaways.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── POST /api/example ────────────────────────────────────────────────────────

describe('POST /api/example', () => {
  test('returns 200 with { examples: [...] }', async () => {
    const res = await request(app)
      .post('/api/example')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('examples');
    expect(Array.isArray(res.body.examples)).toBe(true);
    expect(res.body.examples.length).toBeGreaterThan(0);
  });

  test('each example has title, scenario, solution, analystInsight', async () => {
    const res = await request(app)
      .post('/api/example')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    const ex = res.body.examples[0];
    expect(ex).toHaveProperty('title');
    expect(ex).toHaveProperty('scenario');
    expect(ex).toHaveProperty('solution');
    expect(ex).toHaveProperty('analystInsight');
  });
});

// ─── POST /api/quiz/generate ──────────────────────────────────────────────────

describe('POST /api/quiz/generate', () => {
  test('returns 200 with { questions: [...] }', async () => {
    const res = await request(app)
      .post('/api/quiz/generate')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('questions');
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(res.body.questions.length).toBeGreaterThan(0);
  });

  test('questions include multiple_choice, short_answer, and fill_in_blank types', async () => {
    const res = await request(app)
      .post('/api/quiz/generate')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    const types = res.body.questions.map(q => q.type);
    expect(types).toContain('multiple_choice');
    expect(types).toContain('short_answer');
    expect(types).toContain('fill_in_blank');
  });
});

// ─── POST /api/quiz/grade ─────────────────────────────────────────────────────

describe('POST /api/quiz/grade', () => {
  const MOCK_QUIZ = {
    questions: [
      {
        id: 1,
        type: 'multiple_choice',
        question: 'Q1?',
        options: ['A', 'B', 'C', 'D'],
        correct_index: 0,
        explanation: 'Because A',
      },
      {
        id: 2,
        type: 'multiple_choice',
        question: 'Q2?',
        options: ['A', 'B', 'C', 'D'],
        correct_index: 1,
        explanation: 'Because B',
      },
      {
        id: 3,
        type: 'short_answer',
        question: 'Q3?',
        model_answer: 'Model answer here',
      },
      {
        id: 4,
        type: 'fill_in_blank',
        title: 'P&L',
        context: 'Context',
        table: {
          headers: ['Item', 'Value'],
          rows: [
            { label: 'Revenue', value: '100', blank: false, answer: null },
            { label: 'EBITDA',  value: '',    blank: true,  answer: '30' },
          ],
        },
      },
    ],
  };

  const MOCK_ANSWERS = {
    1: 0,              // correct MC answer
    2: 0,              // wrong MC answer
    3: 'EBITDA is earnings before interest, taxes, depreciation and amortisation.',
    4: { EBITDA: '30' },
  };

  test('returns 200 with { results, totalScore, weakSpots }', async () => {
    const res = await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: MOCK_ANSWERS,
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(res.body).toHaveProperty('totalScore');
    expect(res.body).toHaveProperty('weakSpots');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(Array.isArray(res.body.weakSpots)).toBe(true);
    expect(typeof res.body.totalScore).toBe('number');
  });

  test('totalScore is between 0 and 100', async () => {
    const res = await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: MOCK_ANSWERS,
      })
      .set('Content-Type', 'application/json');

    expect(res.body.totalScore).toBeGreaterThanOrEqual(0);
    expect(res.body.totalScore).toBeLessThanOrEqual(100);
  });

  test('results array contains one entry per question', async () => {
    const res = await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: MOCK_ANSWERS,
      })
      .set('Content-Type', 'application/json');

    expect(res.body.results).toHaveLength(MOCK_QUIZ.questions.length);
  });

  test('grading a correct MC answer gives score=1.0', async () => {
    const res = await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: { ...MOCK_ANSWERS, 1: 0 },
      })
      .set('Content-Type', 'application/json');

    const q1Result = res.body.results.find(r => r.id === 1);
    expect(q1Result.score).toBe(1.0);
    expect(q1Result.correct).toBe(true);
  });

  test('grading a wrong MC answer gives score=0.0', async () => {
    const res = await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: { ...MOCK_ANSWERS, 2: 0 }, // correct_index is 1, so 0 is wrong
      })
      .set('Content-Type', 'application/json');

    const q2Result = res.body.results.find(r => r.id === 2);
    expect(q2Result.score).toBe(0.0);
    expect(q2Result.correct).toBe(false);
  });

  test('grading persists score to progress file', async () => {
    await request(app)
      .post('/api/quiz/grade')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        quiz: MOCK_QUIZ,
        answers: MOCK_ANSWERS,
      })
      .set('Content-Type', 'application/json');

    const progress = JSON.parse(fs.readFileSync(tmpProgressFile, 'utf8'));
    const topic = progress.topics.find(t => t.id === 'income_statement');
    expect(topic.completed).toBe(true);
    expect(topic.quizScores.length).toBeGreaterThan(0);
    expect(progress.totalSessionsCompleted).toBe(1);
  });
});

// ─── GET /api/textbooks ───────────────────────────────────────────────────────

describe('GET /api/textbooks', () => {
  test('returns 200 with an array', async () => {
    const res = await request(app).get('/api/textbooks');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── POST /api/textbooks ──────────────────────────────────────────────────────

describe('POST /api/textbooks', () => {
  test('returns 200 and saves a new textbook', async () => {
    const textbook = {
      id: 'book_test_001',
      title: 'Principles of Corporate Finance',
      chapters: [
        { id: 'ch_1', title: 'Introduction', order: 1, text: 'Chapter text here.' },
      ],
    };

    const res = await request(app)
      .post('/api/textbooks')
      .send(textbook)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);

    // Verify it was persisted
    const get = await request(app).get('/api/textbooks');
    const saved = get.body.find(b => b.id === 'book_test_001');
    expect(saved).toBeTruthy();
    expect(saved.title).toBe('Principles of Corporate Finance');
  });
});

// ─── GET /api/library ─────────────────────────────────────────────────────────

describe('GET /api/library', () => {
  test('returns 200', async () => {
    const res = await request(app).get('/api/library');
    expect(res.status).toBe(200);
  });

  test('response body is an object or array', async () => {
    const res = await request(app).get('/api/library');
    expect(typeof res.body === 'object').toBe(true);
  });
});

// ─── POST /api/library ────────────────────────────────────────────────────────

describe('POST /api/library', () => {
  test('returns 200 when saving library entries', async () => {
    const payload = {
      entries: [
        {
          concept: 'EBITDA',
          definition: 'Earnings Before Interest, Taxes, Depreciation and Amortisation',
          chapterId: 'ch_1',
          topicId: 'income_statement',
        },
      ],
    };

    const res = await request(app)
      .post('/api/library')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
  });
});

// ─── POST /api/library/quiz ───────────────────────────────────────────────────

describe('POST /api/library/quiz', () => {
  test('returns 200 with { questions: [...] }', async () => {
    const payload = {
      entries: [
        {
          concept: 'EBITDA',
          definition: 'Earnings Before Interest, Taxes, Depreciation and Amortisation',
        },
        {
          concept: 'FCF',
          definition: 'Free Cash Flow = EBIT - capex +/- working capital changes',
        },
      ],
    };

    const res = await request(app)
      .post('/api/library/quiz')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('questions');
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(res.body.questions.length).toBeGreaterThan(0);
  });

  test('each question has required fields', async () => {
    const payload = {
      entries: [
        { concept: 'WACC', definition: 'Weighted Average Cost of Capital' },
      ],
    };

    const res = await request(app)
      .post('/api/library/quiz')
      .send(payload)
      .set('Content-Type', 'application/json');

    const q = res.body.questions[0];
    expect(q).toHaveProperty('id');
    expect(q).toHaveProperty('type');
    expect(q).toHaveProperty('question');
  });
});

// ─── DELETE /api/library/:id ──────────────────────────────────────────────────

describe('DELETE /api/library/:id', () => {
  test('returns 200 and removes the entry from the library', async () => {
    // Seed a library entry
    const { readLibrary, writeLibrary } = require('../server');
    const lib = readLibrary();
    lib.entries = [{ id: 'test-del-001', concept: 'FCF', definition: 'Free Cash Flow', source: 'Manual', dateAdded: new Date().toISOString() }];
    writeLibrary(lib);

    const res = await request(app).delete('/api/library/test-del-001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Confirm it was removed
    const after = readLibrary();
    expect(after.entries.find(e => e.id === 'test-del-001')).toBeUndefined();
  });

  test('returns 200 even when id does not exist (idempotent)', async () => {
    const res = await request(app).delete('/api/library/nonexistent-id');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// ─── POST /api/library (single entry with is_manual) ─────────────────────────

describe('POST /api/library — single entry', () => {
  test('adds a manual entry and returns it with an id', async () => {
    const payload = {
      concept: 'IRR',
      definition: 'Internal Rate of Return — discount rate that makes NPV = 0',
      source: 'Manual',
      is_manual: true,
    };

    const res = await request(app)
      .post('/api/library')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.concept).toBe('IRR');
    expect(res.body.is_manual).toBe(true);
  });

  test('manual entry is persisted and retrievable via GET', async () => {
    const payload = { concept: 'NPV', definition: 'Net Present Value', source: 'Manual', is_manual: true };
    await request(app).post('/api/library').send(payload).set('Content-Type', 'application/json');

    const get = await request(app).get('/api/library');
    const found = get.body.entries.find(e => e.concept === 'NPV');
    expect(found).toBeTruthy();
    expect(found.is_manual).toBe(true);
  });

  test('legacy full-replace (body with entries array) still works', async () => {
    const payload = { entries: [{ id: 'x1', concept: 'WACC', definition: 'Weighted Avg Cost of Capital', source: 'Session 1', dateAdded: new Date().toISOString() }] };
    const res = await request(app).post('/api/library').send(payload).set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// ─── POST /api/learn — two-pass ───────────────────────────────────────────────

describe('POST /api/learn — two-pass', () => {
  test('when chapterText is provided, response includes outline field', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({
        topicId: 'income_statement',
        topicTitle: 'The Income Statement',
        chapterText: 'Assets = Liabilities + Equity. Revenue is recognised when earned.',
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('outline');
    expect(res.body.outline).not.toBeNull();
    expect(res.body.outline).toHaveProperty('sections');
  });

  test('without chapterText, outline is null and lesson is still returned', async () => {
    const res = await request(app)
      .post('/api/learn')
      .send({ topicId: 'income_statement', topicTitle: 'The Income Statement' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('content');
    expect(res.body.outline).toBeNull();
  });
});

// ─── GET /api/srs/due ─────────────────────────────────────────────────────────

describe('GET /api/srs/due', () => {
  test('returns 200 with { entries: [...] }', async () => {
    const res = await request(app).get('/api/srs/due');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('returns only entries due today or earlier', async () => {
    const { writeSRS } = require('../server');
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    writeSRS({
      entries: [
        { session_id: 'due-today',   next_review_date: today,  review_count: 1, last_score: 80, weak_spots: [], curriculum: 'harrison', chapter_id: '' },
        { session_id: 'not-yet-due', next_review_date: future, review_count: 0, last_score: 90, weak_spots: [], curriculum: 'harrison', chapter_id: '' },
      ],
    });

    const res = await request(app).get('/api/srs/due');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].session_id).toBe('due-today');
  });
});

// ─── POST /api/srs ────────────────────────────────────────────────────────────

describe('POST /api/srs', () => {
  test('creates a new SRS entry and returns it', async () => {
    const res = await request(app)
      .post('/api/srs')
      .send({ sessionId: 'ch01-s01', chapterId: 'ch01', curriculum: 'harrison', score: 85, weakSpots: [] })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('session_id', 'ch01-s01');
    expect(res.body).toHaveProperty('next_review_date');
    expect(res.body).toHaveProperty('interval_days', 3);
  });

  test('is idempotent — posting twice returns the same entry', async () => {
    await request(app)
      .post('/api/srs')
      .send({ sessionId: 'ch01-s01', chapterId: 'ch01', curriculum: 'harrison', score: 85, weakSpots: [] })
      .set('Content-Type', 'application/json');

    const res2 = await request(app)
      .post('/api/srs')
      .send({ sessionId: 'ch01-s01', chapterId: 'ch01', curriculum: 'harrison', score: 70, weakSpots: [] })
      .set('Content-Type', 'application/json');

    expect(res2.status).toBe(200);
    expect(res2.body.last_score).toBe(85); // original score, not overwritten
  });
});

// ─── PATCH /api/srs/:sessionId ────────────────────────────────────────────────

describe('PATCH /api/srs/:sessionId', () => {
  test('updates schedule after a review and returns updated entry', async () => {
    const { writeSRS } = require('../server');
    const today = new Date().toISOString().slice(0, 10);
    writeSRS({
      entries: [
        { session_id: 'ch01-s01', next_review_date: today, interval_days: 3, ease_factor: 2.5, review_count: 0, last_score: 80, weak_spots: [], curriculum: 'harrison', chapter_id: 'ch01' },
      ],
    });

    const res = await request(app)
      .patch('/api/srs/ch01-s01')
      .send({ score: 90 })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.review_count).toBe(1);
    expect(res.body.last_score).toBe(90);
    expect(res.body.interval_days).toBeGreaterThan(3); // should have grown
  });

  test('returns 404 for unknown sessionId', async () => {
    const res = await request(app)
      .patch('/api/srs/nonexistent-session')
      .send({ score: 80 })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/curriculum (returns array) ─────────────────────────────────────

describe('GET /api/curriculum', () => {
  test('returns 200 with an array', async () => {
    const res = await request(app).get('/api/curriculum');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('first element is the Harrison curriculum', async () => {
    const res = await request(app).get('/api/curriculum');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const harrison = res.body[0];
    expect(harrison).toHaveProperty('chapters');
    expect(harrison).toHaveProperty('meta');
  });

  test('Brealey curriculum is included when curriculum_brealey.json exists', async () => {
    const res = await request(app).get('/api/curriculum');
    expect(res.status).toBe(200);
    // Brealey file was copied to project root — should be in the array
    const brealey = res.body.find(c => c.meta?.prerequisite);
    expect(brealey).toBeTruthy();
    expect(brealey.meta.prerequisite).toBe('curriculum_harrison.json');
  });

  test('Brealey curriculum has chapters with bm-prefixed session IDs', async () => {
    const res = await request(app).get('/api/curriculum');
    const brealey = res.body.find(c => c.meta?.prerequisite);
    if (brealey) {
      const firstChapter = brealey.chapters[0];
      expect(firstChapter).toBeTruthy();
      const firstSession = firstChapter.sessions[0];
      expect(firstSession.id).toMatch(/^bm/);
    }
  });
});
