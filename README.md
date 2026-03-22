# FinanceLab

A finance study app for PE, IB, and M&A interview prep. Structured sessions (Learn → Example → Quiz) grounded in your actual textbook material, with adaptive review and a self-building concepts library.

---

## Setup

**Prerequisites:** Node.js 18+, an Anthropic API key

```bash
cd FinanceLab
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# → http://localhost:3000
```

---

## Session Flow

Each session covers one topic (or textbook chapter) in three phases:

1. **Learn** — Claude generates a 600–800 word lesson grounded in your textbook chapter (or its own knowledge). Key formulas are tagged with `[[CORE: ...]]` and highlighted inline.
2. **Difficulty rating** — Rate the reading: Too Easy / Just Right / Too Hard. Used by adaptive logic.
3. **Example** — 1–2 worked examples with real numbers and analyst commentary.
4. **Quiz** — 2 multiple choice + 1 short answer + 1 fill-in-the-blank financial table. MC graded instantly; written answers graded by Claude.
5. **Results** — Score, question-by-question feedback, weak spots, and next steps.

Progress saves at every phase. If you close mid-session, you'll be offered to resume next time.

---

## How to Upload Textbooks

1. Click **Textbooks** in the top nav.
2. Click **Select PDF** (or drag & drop) to upload a finance textbook.
3. The app extracts text **client-side** using pdf.js — nothing is uploaded externally.
4. Chapter boundaries are **auto-detected** by scanning for "Chapter X" headers. Review and edit the detected titles.
5. If auto-detection finds nothing, enter chapter titles and start pages manually.
6. Click **Save Textbook**.

Once a textbook is saved, the curriculum switches to **chapter-by-chapter mode**:
- Each chapter gets its full text injected into every Claude call (Learn, Example, Quiz).
- Chapters advance when you score ≥ 70% and complete at least 1 session.
- Chapters rated "Hard" with a score < 75% require 2 sessions before advancing.

Textbooks are stored in `textbooks.json` (text included). Multiple textbooks are supported; the app works through Textbook 1 → Textbook 2 in order.

---

## Concepts Library

During the Learn phase, Claude tags key formulas with `[[CORE: concept = definition]]`. The frontend:
- Highlights these inline in the lesson text
- Displays a "Core Concepts" pill bar below the lesson
- Automatically saves new concepts to `library.json`

**Library page** (top nav): searchable, grouped by topic/chapter.

**Library Quiz**: generates a 10-question MCQ drill from your saved concepts. Results are shown immediately — this doesn't affect `progress.json`.

---

## Progress & Adaptive Mode

`progress.json` tracks:
- Per topic: `completed`, `quizScores[]`, `weakSpots[]`, `lastStudied`
- Per chapter: `sessionsCompleted`, `quizScores[]`, `difficultyRatings[]`, `weakSpots[]`
- `sessionState` — exact position in any in-progress session (phase, answers so far)
- `adaptiveMode` — activates after 5 completed sessions

In adaptive mode, topics with an average score below 65% are automatically re-queued before moving forward.

---

## Running Tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

**Test coverage (48 tests):**
- `tests/progress.test.js` — Unit tests: `readProgress`/`writeProgress` round-trip, `extractCoreConceptsFromText` parser, `getNextChapter` advancement logic (all edge cases including "hard" chapters), adaptive topic selection
- `tests/server.test.js` — API endpoint tests via supertest with Anthropic SDK mocked: all routes including `/api/learn`, `/api/example`, `/api/quiz/generate`, `/api/quiz/grade`, `/api/textbooks`, `/api/library`, `/api/library/quiz`, `PATCH /api/progress`

---

## File Structure

```
index.html          Frontend shell (loads pdf.js from CDN)
app.js              Client-side app (routing, all views, API calls)
style.css           White WSJ/FT-style theme
server.js           Express backend (Claude API calls, file I/O)
progress.json       Per-topic and per-chapter progress
textbooks.json      Uploaded textbooks and chapter text
library.json        Saved core concepts and formulas
tests/
  progress.test.js  Unit tests (progress logic, parser, advancement)
  server.test.js    API integration tests (all endpoints, mocked SDK)
```

---

## progress.json Schema

```json
{
  "topics": [
    {
      "id": "income_statement",
      "title": "The Income Statement",
      "order": 1,
      "completed": false,
      "quizScores": [],
      "weakSpots": [],
      "lastStudied": null
    }
  ],
  "chapters": {
    "chapter_abc123": {
      "sessionsCompleted": 0,
      "quizScores": [],
      "difficultyRatings": [],
      "weakSpots": [],
      "lastStudied": null
    }
  },
  "totalSessionsCompleted": 0,
  "adaptiveMode": false,
  "sessionState": null,
  "activeTextbookId": null,
  "activeChapterId": null,
  "createdAt": "2026-03-22T00:00:00.000Z"
}
```
