const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
const multer = require('multer');
const supabase = require('./supabase');
const srsModule = require('./srs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf'));
  },
});

const app = express();
const PORT = process.env.PORT || 3000;
const PROGRESS_FILE  = process.env.PROGRESS_FILE  || path.join(__dirname, 'progress.json');
const TEXTBOOKS_FILE = process.env.TEXTBOOKS_FILE || path.join(__dirname, 'textbooks.json');
const LIBRARY_FILE   = process.env.LIBRARY_FILE   || path.join(__dirname, 'library.json');
const SRS_FILE        = process.env.SRS_FILE        || path.join(__dirname, 'srs.json');
const CURRICULUM_FILE = process.env.CURRICULUM_FILE || path.join(__dirname, 'curriculum.json');
const BREALEY_CURRICULUM_FILE = process.env.BREALEY_CURRICULUM_FILE || path.join(__dirname, 'curriculum_brealey.json');
const CONFIG_FILE     = process.env.CONFIG_FILE     || path.join(__dirname, 'config.json');

const isSupabase = () => !!supabase;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '16mb' }));
app.use(express.static(__dirname));

// ─── File Helpers ─────────────────────────────────────────────────────────────

function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { topics: [], totalSessionsCompleted: 0, adaptiveMode: false, chapters: {}, sessionState: null, createdAt: new Date().toISOString() };
  }
}

function writeProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function readTextbooks() {
  try {
    const data = JSON.parse(fs.readFileSync(TEXTBOOKS_FILE, 'utf8'));
    // Support both an array directly and a legacy { textbooks: [...] } envelope
    return Array.isArray(data) ? data : (data.textbooks || []);
  } catch {
    return [];
  }
}

function writeTextbooks(data) {
  fs.writeFileSync(TEXTBOOKS_FILE, JSON.stringify(data, null, 2));
}

function readLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function writeLibrary(data) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data, null, 2));
}

function readSRS() {
  try { return JSON.parse(fs.readFileSync(SRS_FILE, 'utf8')); }
  catch { return { entries: [] }; }
}

function writeSRS(data) {
  fs.writeFileSync(SRS_FILE, JSON.stringify(data, null, 2));
}

function readCurriculum() {
  try { return JSON.parse(fs.readFileSync(CURRICULUM_FILE, 'utf8')); }
  catch { return null; }
}

function readAllCurricula() {
  const curricula = [];
  const harrison = readCurriculum();
  if (harrison) curricula.push(harrison);
  try {
    const brealey = JSON.parse(fs.readFileSync(BREALEY_CURRICULUM_FILE, 'utf8'));
    curricula.push(brealey);
  } catch {}
  return curricula;
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────

async function getProgressFromSupabase() {
  const { data, error } = await supabase.from('progress').select('*');
  if (error) throw new Error(error.message);
  const sessions = {};
  let sessionState = null;
  for (const row of (data || [])) {
    sessions[row.session_id] = {
      completed: row.completed,
      quizScore: row.quiz_scores?.slice(-1)[0] ?? null,
      quizScores: row.quiz_scores || [],
      weakSpots: row.weak_spots || [],
      difficultyRating: row.difficulty_rating,
      lastStudied: row.last_studied,
    };
    if (row.session_state) sessionState = row.session_state;
  }
  const totalCompleted = (data || []).filter(r => r.completed).length;
  return { sessions, sessionState, totalSessionsCompleted: totalCompleted, adaptiveMode: totalCompleted >= 5 };
}

async function upsertSessionToSupabase(sessionId, chapterId, curriculum, fields) {
  const row = { session_id: sessionId, chapter_id: chapterId || '', curriculum: curriculum || 'harrison', ...fields };
  const { error } = await supabase.from('progress').upsert(row, { onConflict: 'session_id' });
  if (error) throw new Error(error.message);
}

async function getLibraryFromSupabase() {
  const { data, error } = await supabase.from('library').select('*').order('created_at');
  if (error) throw new Error(error.message);
  const entries = (data || []).map(row => ({
    id: row.id,
    concept: row.concept,
    definition: row.definition,
    source: row.source,
    sessionId: row.source_session_id,
    dateAdded: row.created_at,
    is_manual: row.is_manual,
  }));
  return { entries };
}

async function addLibraryEntryToSupabase(entry) {
  const row = {
    concept: entry.concept,
    definition: entry.definition,
    source: entry.source || null,
    source_session_id: entry.sessionId || entry.source_session_id || null,
    is_manual: entry.is_manual || false,
  };
  const { data, error } = await supabase.from('library').insert(row).select().single();
  if (error) throw new Error(error.message);
  return { ...entry, id: data.id, dateAdded: data.created_at };
}

async function deleteLibraryEntryFromSupabase(id) {
  const { error } = await supabase.from('library').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function getSRSDueFromSupabase() {
  const { data, error } = await supabase
    .from('srs_schedule')
    .select('*')
    .lte('next_review_date', srsModule.today());
  if (error) throw new Error(error.message);
  return data || [];
}

async function upsertSRSToSupabase(entry) {
  const row = {
    session_id:       entry.session_id,
    chapter_id:       entry.chapter_id || '',
    curriculum:       entry.curriculum || 'harrison',
    next_review_date: entry.next_review_date,
    interval_days:    entry.interval_days,
    ease_factor:      entry.ease_factor,
    review_count:     entry.review_count,
    last_score:       entry.last_score ?? null,
    weak_spots:       entry.weak_spots || [],
  };
  const { data, error } = await supabase
    .from('srs_schedule')
    .upsert(row, { onConflict: 'session_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateSRSInSupabase(sessionId, updatedEntry) {
  const { data, error } = await supabase
    .from('srs_schedule')
    .update({
      next_review_date: updatedEntry.next_review_date,
      interval_days:    updatedEntry.interval_days,
      ease_factor:      updatedEntry.ease_factor,
      review_count:     updatedEntry.review_count,
      last_score:       updatedEntry.last_score ?? null,
      weak_spots:       updatedEntry.weak_spots || [],
    })
    .eq('session_id', sessionId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { pdfPath: '' }; }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ─── Pure Helpers (exported for tests) ───────────────────────────────────────

/**
 * Parse [[CORE: concept = definition]] tags from text.
 * Returns array of { concept, definition } objects.
 */
function extractCoreConceptsFromText(text) {
  if (!text) return [];
  const regex = /\[\[CORE:\s*([^\]]+?)\]\]/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    const sepIdx = raw.search(/[=—:]/);
    if (sepIdx > 0) {
      results.push({
        concept:    raw.slice(0, sepIdx).trim(),
        definition: raw.slice(sepIdx + 1).trim(),
      });
    } else {
      results.push({ concept: raw, definition: raw });
    }
  }
  return results;
}

/**
 * Determine next chapter to study.
 * Requires: sessionsCompleted >= 1 AND avgScore >= 70.
 * "Hard" chapters with avgScore < 75 require 2 sessions.
 */
function getNextChapter(textbooks, progress) {
  if (!textbooks || !textbooks.length) return null;
  const chaptersProgress = (progress && progress.chapters) ? progress.chapters : {};

  for (const tb of textbooks) {
    // Sort chapters by their declared order if available
    const sorted = [...(tb.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const ch of sorted) {
      const cp = chaptersProgress[ch.id] || { sessionsCompleted: 0, quizScores: [], difficultyRatings: [] };
      const avgScore = cp.quizScores.length
        ? cp.quizScores.reduce((a, b) => a + b, 0) / cp.quizScores.length
        : 0;
      const isHard = (cp.difficultyRatings || []).includes('hard');
      // Hard chapter with score < 75 requires 2 sessions before advancing
      const requiredSessions = (isHard && avgScore < 75) ? 2 : 1;

      if (cp.sessionsCompleted < requiredSessions || avgScore < 70) {
        return ch;   // return the chapter object directly
      }
    }
  }
  return null;
}

/**
 * Truncate chapter text to ~28k chars (~7k tokens) to fit context.
 * Takes first 65% + last 35% of the allowed budget.
 */
function truncateChapterText(text, maxChars = 28000) {
  if (!text || text.length <= maxChars) return text;
  const firstPart = text.slice(0, Math.floor(maxChars * 0.65));
  const lastPart  = text.slice(-Math.floor(maxChars * 0.35));
  return firstPart + '\n\n[...content truncated...]\n\n' + lastPart;
}

// ─── Prompt Helpers ───────────────────────────────────────────────────────────

const PERSONA = `You are a sharp, no-nonsense finance tutor preparing a student for PE and IB interviews. You teach like a senior analyst — practical, precise, never patronizing. Your job is to ensure the student genuinely understands concepts, not just memorizes definitions.`;

function buildProgressSummary(progress) {
  const topics = progress.topics || [];
  const completed = topics.filter(t => t.completed);
  let s = `STUDENT PROGRESS SNAPSHOT:\n`;
  s += `Completed: ${completed.length}/${topics.length} topics | Sessions: ${progress.totalSessionsCompleted || 0} | Adaptive mode: ${progress.adaptiveMode ? 'ON' : 'OFF'}\n`;

  if (completed.length > 0) {
    s += `Topics covered:\n`;
    completed.forEach(t => {
      const avg = t.quizScores.length
        ? Math.round(t.quizScores.reduce((a, b) => a + b) / t.quizScores.length)
        : 'N/A';
      const ws = t.weakSpots && t.weakSpots.length ? ` | weak spots: ${t.weakSpots.join(', ')}` : '';
      s += `  • ${t.title} — avg ${avg}%${ws}\n`;
    });
  }

  const incomplete = topics.filter(t => !t.completed);
  if (incomplete.length) {
    s += `Coming up: ${incomplete.slice(0, 3).map(t => t.title).join(', ')}\n`;
  }
  return s;
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 2048) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return msg.content[0].text;
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) { try { return JSON.parse(brace[1]); } catch {} }
  throw new Error('Could not parse JSON from Claude response. Raw: ' + text.slice(0, 300));
}

// ─── Progress Routes ──────────────────────────────────────────────────────────

app.get('/api/progress', async (req, res) => {
  try {
    if (isSupabase()) return res.json(await getProgressFromSupabase());
    res.json(readProgress());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/progress', (req, res) => {
  try { writeProgress(req.body); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Partial merge-update — used for session state, difficulty ratings, phase saves
app.patch('/api/progress', (req, res) => {
  try {
    const progress = readProgress();
    const patch = req.body;

    Object.keys(patch).forEach(key => {
      if (key === 'chapters' && typeof patch.chapters === 'object') {
        if (!progress.chapters) progress.chapters = {};
        Object.keys(patch.chapters).forEach(chId => {
          progress.chapters[chId] = { ...(progress.chapters[chId] || {}), ...patch.chapters[chId] };
        });
      } else if (key === 'sessions' && typeof patch.sessions === 'object') {
        if (!progress.sessions) progress.sessions = {};
        Object.keys(patch.sessions).forEach(sessionId => {
          progress.sessions[sessionId] = { ...(progress.sessions[sessionId] || {}), ...patch.sessions[sessionId] };
        });
      } else {
        progress[key] = patch[key];
      }
    });

    writeProgress(progress);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-session upsert (Supabase-optimised; falls back to JSON merge)
app.patch('/api/progress/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { chapterId, curriculum, ...fields } = req.body;

    if (isSupabase()) {
      const supabaseFields = {};
      if (fields.completed !== undefined) supabaseFields.completed = fields.completed;
      if (fields.quizScore !== undefined) {
        const { data } = await supabase.from('progress').select('quiz_scores').eq('session_id', sessionId).single();
        supabaseFields.quiz_scores = [...(data?.quiz_scores || []), fields.quizScore];
      }
      if (fields.weakSpots !== undefined) supabaseFields.weak_spots = fields.weakSpots;
      if (fields.difficultyRating !== undefined) supabaseFields.difficulty_rating = fields.difficultyRating;
      if (fields.lastStudied !== undefined) supabaseFields.last_studied = fields.lastStudied;
      if (fields.sessionState !== undefined) supabaseFields.session_state = fields.sessionState;
      await upsertSessionToSupabase(sessionId, chapterId, curriculum, supabaseFields);
      return res.json({ success: true });
    }

    const progress = readProgress();
    if (!progress.sessions) progress.sessions = {};
    progress.sessions[sessionId] = { ...(progress.sessions[sessionId] || {}), ...req.body };
    writeProgress(progress);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Textbook Routes ──────────────────────────────────────────────────────────

app.get('/api/textbooks', (req, res) => {
  try { res.json(readTextbooks()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/textbooks', (req, res) => {
  try {
    const incoming = req.body;
    // If the body is an array, replace the whole collection
    if (Array.isArray(incoming)) {
      writeTextbooks(incoming);
    } else {
      // Upsert a single textbook by id
      const books = readTextbooks();
      const idx = books.findIndex(b => b.id === incoming.id);
      if (idx !== -1) { books[idx] = incoming; } else { books.push(incoming); }
      writeTextbooks(books);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Library Routes ───────────────────────────────────────────────────────────

app.get('/api/library', async (req, res) => {
  try {
    if (isSupabase()) return res.json(await getLibraryFromSupabase());
    res.json(readLibrary());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/library', async (req, res) => {
  try {
    const body = req.body;
    // Single-entry add (manual or auto) — body has 'concept' key
    if (body.concept) {
      if (isSupabase()) {
        const entry = await addLibraryEntryToSupabase(body);
        return res.json(entry);
      }
      const lib = readLibrary();
      const newEntry = {
        id: Math.random().toString(36).slice(2),
        concept: body.concept,
        definition: body.definition,
        source: body.source || 'Manual',
        sessionId: body.sessionId || null,
        dateAdded: new Date().toISOString(),
        is_manual: body.is_manual || false,
      };
      lib.entries = [...(lib.entries || []), newEntry];
      writeLibrary(lib);
      return res.json(newEntry);
    }
    // Full-replace (legacy: body has 'entries' key)
    if (isSupabase()) {
      for (const entry of (body.entries || [])) {
        try { await addLibraryEntryToSupabase(entry); } catch {}
      }
      return res.json({ success: true });
    }
    writeLibrary(body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/library/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isSupabase()) {
      await deleteLibraryEntryFromSupabase(id);
      return res.json({ success: true });
    }
    const lib = readLibrary();
    lib.entries = (lib.entries || []).filter(e => e.id !== id);
    writeLibrary(lib);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/library/quiz', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!entries || entries.length === 0) {
      return res.status(400).json({ error: 'No library entries provided.' });
    }

    const entryList = entries
      .slice(0, 50)
      .map(e => `- ${e.concept}: ${e.definition}`)
      .join('\n');

    const user = `[Library Quiz] Generate a 10-question multiple-choice drill based on these finance concepts and formulas:

${entryList}

Rules:
- Each question tests a specific concept from the list above
- 4 options per question; only one is correct
- Distractors must be plausible, not obviously wrong
- Cover a range of concepts — don't cluster on one topic

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": 1,
      "question": "string",
      "options": ["A","B","C","D"],
      "correct_index": 0,
      "explanation": "string — why correct, why the others are wrong"
    }
  ]
}`;

    const raw = await callClaude(PERSONA, user, 2000);
    const result = extractJSON(raw);
    res.json(result);
  } catch (err) {
    console.error('[/api/library/quiz]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Learn (two-pass: outline → lesson) ──────────────────────────────────────

const OUTLINE_SYSTEM = `You are a curriculum designer preparing a lesson outline for a finance student targeting PE/IB/M&A roles. You will be given textbook chapter text and a list of learning objectives. Your job is to produce a structured lesson plan — not the lesson itself. Be precise and concrete. Every example you list must come directly from the provided chapter text. Do not invent examples or companies not present in the text.`;

const LESSON_SYSTEM = `You are a sharp, no-nonsense finance tutor preparing a student for PE and IB interviews. You teach like a senior analyst — practical, precise, never patronizing. You are writing a lesson based on a pre-approved outline. Do not deviate from the outline. Every section must be grounded in the textbook passages provided in the outline. After writing each paragraph, ask yourself: is this grounded in the textbook text provided, or am I drawing on general knowledge? If the latter, find the relevant passage from the outline's source_passage fields or omit the claim entirely. Use [[CORE: term = definition]] tags only for formulas, analytical concepts, and decision rules. Never tag job titles, company names, or organisational roles. Target length: 1800–2200 words total.`;

app.post('/api/learn', async (req, res) => {
  try {
    const { topicId, topicTitle, chapterText, learningObjectives, analystNote, spotlightCompany } = req.body;

    const charCount = chapterText ? chapterText.length : 0;
    console.log(`[/api/learn] topic="${topicTitle}" chapterText=${charCount} chars${charCount === 0 ? ' ⚠ NO PDF TEXT' : ''}`);

    let outline = null;

    // ── Pass 1: Generate outline (only when chapter text is available) ────────
    if (chapterText) {
      const objectivesText = (learningObjectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') || '(none specified)';
      const outlineUser = `Textbook chapter text:\n${truncateChapterText(chapterText)}\n\nSession title: ${topicTitle}\nLearning objectives:\n${objectivesText}\n\nProduce a lesson outline in this exact JSON format:\n{\n  "hook": "one sentence opening hook drawn from the chapter text",\n  "sections": [\n    {\n      "concept": "concept name",\n      "source_passage": "a short direct quote or paraphrase from the chapter text that grounds this section",\n      "explanation_angle": "how to explain this concept clearly",\n      "example": "specific example to use — must come from the chapter text or the textbook own numbers"\n    }\n  ],\n  "worked_example": {\n    "scenario": "description of the numerical example to work through",\n    "data": "the specific numbers or data to use",\n    "source": "where in the chapter this comes from"\n  },\n  "formulas_to_tag": ["formula 1", "formula 2"],\n  "deal_perspective": "2-3 sentence angle connecting this chapter to PE/IB/M&A — only use concepts from this chapter"\n}\n\nReturn only valid JSON, no other text.`;

      // Try up to twice; fall back to single-pass on persistent failure
      for (let attempt = 1; attempt <= 2 && !outline; attempt++) {
        try {
          console.log(`[/api/learn] Pass 1 attempt ${attempt}`);
          const rawOutline = await callClaude(OUTLINE_SYSTEM, outlineUser, 2000);
          outline = extractJSON(rawOutline);
          console.log(`[/api/learn] Pass 1 OK — ${outline.sections?.length || 0} sections`);
        } catch (e) {
          console.warn(`[/api/learn] Pass 1 attempt ${attempt} failed: ${e.message}`);
          outline = null;
        }
      }
      if (!outline) console.warn('[/api/learn] Pass 1 exhausted — falling back to single-pass');
    }

    // ── Pass 2 (or single-pass fallback) ─────────────────────────────────────
    let raw;
    if (outline) {
      const sectionHeadings = (outline.sections || [])
        .map(s => `## ${s.concept} (~150–200 words)\nExplain the concept, use the specified example, stay grounded in the source_passage.`)
        .join('\n\n');
      const lessonUser = `Write a complete lesson using this outline:\n${JSON.stringify(outline, null, 2)}\n\nStructure:\n## Overview (~150 words)\nUse the hook from the outline. Set up why this topic matters.\n\n${sectionHeadings}\n\n## Worked Example (~400 words)\nWork through outline.worked_example step by step with full calculations shown.\n\n## Deal Perspective (~150 words)\nUse outline.deal_perspective as the basis. Keep it to concepts taught in this lesson only.\n\n## Key Takeaways\n4–5 bullet points. Precise, memorable, actionable.\n\nReturn ONLY valid JSON:\n{\n  "title": "string",\n  "content": "string (markdown, 1800–2200 words, with [[CORE:...]] tags)",\n  "keyTakeaways": ["string", "string", "string", "string", "string"]\n}`;
      raw = await callClaude(LESSON_SYSTEM, lessonUser, 5000);
    } else {
      // Single-pass fallback
      const system = chapterText
        ? `You are teaching from specific textbook pages provided below. Ground your explanation entirely in the textbook content.`
        : `You are a finance tutor. Build from first principles using clear definitions and simple examples.`;
      const objectivesBlock = learningObjectives?.length
        ? `\nThis session must cover these learning objectives:\n${learningObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n`
        : '';
      const refBlock = chapterText ? `\n\nTEXTBOOK PAGES:\n${truncateChapterText(chapterText)}` : '';
      const companyHint = spotlightCompany ? ` Use ${spotlightCompany} as the primary real-world example.` : '';
      const user = `Generate a comprehensive lesson titled "${topicTitle}".${objectivesBlock}\nTARGET LENGTH: 1,800–2,200 words.${companyHint}\n\nUSE THIS EXACT SECTION STRUCTURE:\n## Overview (~150 words)\n## Core Concepts (~800–1,000 words)\nTag each major formula with [[CORE: concept = definition]].\n## Worked Example (~400–500 words)\n## Deal Perspective (~150–200 words)\n## Key Takeaways\n4–5 bullet points.${refBlock}\n\nReturn ONLY valid JSON:\n{\n  "title": "string",\n  "content": "string (markdown, 1800–2200 words, with [[CORE:...]] tags and all five ## sections)",\n  "keyTakeaways": ["string", "string", "string", "string", "string"]\n}`;
      raw = await callClaude(system, user, 5000);
    }

    const result = extractJSON(raw);

    // Persist session state (include outline for quiz reuse)
    const prog = readProgress();
    if (!prog.sessionState) prog.sessionState = {};
    prog.sessionState.topicId = topicId;
    prog.sessionState.phase = 'learn';
    prog.sessionState.learnCompleted = true;
    prog.sessionState.timestamp = new Date().toISOString();
    if (outline) prog.sessionState.outline = outline;
    writeProgress(prog);

    res.json({ ...result, outline: outline || null });
  } catch (err) {
    console.error('[/api/learn]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Example ─────────────────────────────────────────────────────────────────

app.post('/api/example', async (req, res) => {
  try {
    const { topicId, topicTitle, chapterText } = req.body;
    const progress = readProgress();

    const chapterContext = chapterText
      ? `\n\nREFERENCE MATERIAL (from the student's textbook):\n${truncateChapterText(chapterText)}`
      : '';

    const system = `${PERSONA}\n\n${buildProgressSummary(progress)}`;

    const user = `Generate 1–2 worked examples for "${topicTitle}" that a PE/IB analyst would recognize from real deal work.${chapterContext}

REQUIREMENTS:
- At least one example must use actual numbers (mini P&L, ratio calculation, valuation bridge, etc.)
- Show complete, step-by-step solution
- Use realistic company names and plausible numbers
- End each example with the "analyst angle" — what does this number tell you about the business?

Return ONLY valid JSON:
{
  "examples": [
    {
      "title": "string",
      "scenario": "string (markdown)",
      "solution": "string (markdown — full step-by-step with calculations)",
      "analystInsight": "string (1–2 sentences on what this means in practice)"
    }
  ]
}`;

    const raw = await callClaude(system, user, 2500);
    const result = extractJSON(raw);

    // Persist example-phase session state
    const prog = readProgress();
    if (!prog.sessionState) prog.sessionState = {};
    prog.sessionState.phase = 'example';
    prog.sessionState.exampleCompleted = true;
    prog.sessionState.timestamp = new Date().toISOString();
    writeProgress(prog);

    res.json(result);
  } catch (err) {
    console.error('[/api/example]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Quiz Generate ────────────────────────────────────────────────────────────

app.post('/api/quiz/generate', async (req, res) => {
  try {
    const { topicId, topicTitle, chapterText, reviewMode, weakSpots: reviewWeakSpots, outline } = req.body;
    const progress = readProgress();
    const topicProgress = progress.topics && progress.topics.find(t => t.id === topicId);

    // In review mode, use weak spots from the request (stored SRS entry); otherwise use topic progress
    const effectiveWeakSpots = reviewMode
      ? (reviewWeakSpots || [])
      : (topicProgress?.weakSpots || []);

    let weakSpotNote = '';
    if (effectiveWeakSpots.length) {
      weakSpotNote = reviewMode
        ? `\nFocus questions on these weak areas: ${effectiveWeakSpots.join(', ')}. Weight questions toward these concepts.`
        : `\nThis student previously struggled with: ${effectiveWeakSpots.join(', ')}. Target those areas.`;
    }

    const questionCount = reviewMode ? 5 : 4;

    const chapterContext = chapterText
      ? `\n\nREFERENCE MATERIAL (base all questions on this material):\n${truncateChapterText(chapterText)}`
      : '';

    const outlineContext = outline?.worked_example
      ? `\n\nWORKED EXAMPLE DATA (use these specific numbers for the fill-in-blank question):\nScenario: ${outline.worked_example.scenario}\nData: ${outline.worked_example.data}`
      : '';

    const system = `${PERSONA}\n\n${buildProgressSummary(progress)}`;

    const reviewNote = reviewMode
      ? `\nThis is a REVIEW SESSION. Generate ${questionCount} targeted questions to reinforce the student's weaker areas. No new examples — use the same concepts from the original lesson.`
      : '';

    const user = `Generate a quiz for "${topicTitle}".${reviewNote}${weakSpotNote}${outlineContext}${chapterContext}

The quiz MUST contain EXACTLY:
- Question 1: multiple choice
- Question 2: multiple choice
- Question 3: short written answer (requires real explanation)
- Question 4: fill-in-the-blank financial statement (partial table, student computes missing values)
  - Leave exactly 4–5 rows blank (blank: true); non-blank rows have values as strings; blank rows have value: "" and answer: "number as string"${reviewMode ? '\n- Question 5: multiple choice (additional review question targeting weak spots)' : ''}

Return ONLY valid JSON:
{
  "questions": [
    { "id": 1, "type": "multiple_choice", "question": "string", "options": ["A","B","C","D"], "correct_index": 0, "explanation": "string" },
    { "id": 2, "type": "multiple_choice", "question": "string", "options": ["A","B","C","D"], "correct_index": 0, "explanation": "string" },
    { "id": 3, "type": "short_answer", "question": "string", "model_answer": "string" },
    { "id": 4, "type": "fill_in_blank", "title": "string", "context": "string",
      "table": { "headers": ["Line Item","Amount ($M)"], "rows": [
        { "label": "string", "value": "string", "blank": false, "answer": null },
        { "label": "string", "value": "", "blank": true, "answer": "string" }
      ]}
    }${reviewMode ? ',\n    { "id": 5, "type": "multiple_choice", "question": "string", "options": ["A","B","C","D"], "correct_index": 0, "explanation": "string" }' : ''}
  ]
}`;

    const raw = await callClaude(system, user, 3000);
    const result = extractJSON(raw);
    res.json(result);
  } catch (err) {
    console.error('[/api/quiz/generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Quiz Grade ───────────────────────────────────────────────────────────────

app.post('/api/quiz/grade', async (req, res) => {
  try {
    const { topicId, topicTitle, quiz, answers, chapterId, sessionId } = req.body;
    const progress = readProgress();

    // ── Step 1: Grade MC instantly ────────────────────────────────────────────
    const mcResults = [];
    const aiQuestions = [];

    quiz.questions.forEach(q => {
      const answer = answers[q.id];
      if (q.type === 'multiple_choice') {
        const correct = answer === q.correct_index;
        mcResults.push({ id: q.id, type: 'multiple_choice', correct, score: correct ? 1.0 : 0.0, feedback: q.explanation || '' });
      } else if (q.type === 'short_answer') {
        aiQuestions.push({ id: q.id, type: 'short_answer', question: q.question, model_answer: q.model_answer, student_answer: answer || '(no answer)' });
      } else if (q.type === 'fill_in_blank') {
        const cellAnswers = answer || {};
        aiQuestions.push({
          id: q.id, type: 'fill_in_blank', title: q.title,
          rows: q.table.rows.filter(r => r.blank).map(r => ({
            label: r.label, correct_value: r.answer, student_value: cellAnswers[r.label] || '',
          })),
        });
      }
    });

    // ── Step 2: AI grades SA + FIB only ──────────────────────────────────────
    const system = `${PERSONA}\n\n${buildProgressSummary(progress)}`;
    const user = `Grade these ${aiQuestions.length} question(s) for "${topicTitle}". Be fair but demanding.

${JSON.stringify(aiQuestions, null, 2)}

Rules:
- short_answer: score 0.0–1.0. 0.8+ requires covering key points with precision.
- fill_in_blank: check each row (allow ±2 rounding). Score = correct_count / total_rows.

Return ONLY valid JSON:
{
  "aiResults": [
    { "id": 3, "type": "short_answer", "score": 0.0, "feedback": "string" },
    { "id": 4, "type": "fill_in_blank", "score": 0.0, "feedback": "string",
      "cellResults": [{ "label": "string", "correct": true, "userValue": "string", "correctValue": "string", "feedback": "" }] }
  ],
  "weakSpots": ["string"],
  "nextStepAdvice": "string"
}`;

    const raw = await callClaude(system, user, 1000);
    const aiData = extractJSON(raw);

    // ── Step 3: Merge + score ─────────────────────────────────────────────────
    const allResults = [...mcResults, ...(aiData.aiResults || [])].sort((a, b) => a.id - b.id);
    let earned = 0, possible = 0;
    allResults.forEach(r => {
      const w = r.type === 'multiple_choice' ? 1 : 2;
      earned += (r.score || 0) * w; possible += w;
    });
    const totalScore = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    const result = { results: allResults, totalScore, weakSpots: aiData.weakSpots || [], nextStepAdvice: aiData.nextStepAdvice || '' };

    // ── Step 4: Persist ───────────────────────────────────────────────────────
    if (!progress.topics) progress.topics = [];
    const topicIdx = progress.topics.findIndex(t => t.id === topicId);
    if (topicIdx !== -1) {
      progress.topics[topicIdx].completed = true;
      progress.topics[topicIdx].quizScores.push(result.totalScore);
      progress.topics[topicIdx].weakSpots = result.weakSpots || [];
      progress.topics[topicIdx].lastStudied = new Date().toISOString();
    }

    if (chapterId) {
      if (!progress.chapters) progress.chapters = {};
      if (!progress.chapters[chapterId]) {
        progress.chapters[chapterId] = { sessionsCompleted: 0, quizScores: [], difficultyRatings: [], weakSpots: [], lastStudied: null };
      }
      progress.chapters[chapterId].sessionsCompleted += 1;
      progress.chapters[chapterId].quizScores.push(result.totalScore);
      progress.chapters[chapterId].weakSpots = result.weakSpots || [];
      progress.chapters[chapterId].lastStudied = new Date().toISOString();
    }

    // ── Curriculum session progress ──────────────────────────────────────────
    if (sessionId) {
      if (!progress.sessions) progress.sessions = {};
      progress.sessions[sessionId] = {
        ...(progress.sessions[sessionId] || {}),
        completed: true,
        quizScore: result.totalScore,
        weakSpots: result.weakSpots || [],
        lastStudied: new Date().toISOString(),
      };

      // Auto-populate library with coreFormulasForLibrary from this session
      const curricula = readAllCurricula();
      if (curricula.length) {
        let sessionDef = null;
        for (const curriculum of curricula) {
          for (const ch of (curriculum.chapters || [])) {
            sessionDef = (ch.sessions || []).find(s => s.id === sessionId);
            if (sessionDef) break;
          }
          if (sessionDef) break;
        }
        if (sessionDef?.coreFormulasForLibrary?.length) {
          const lib = readLibrary();
          const existing = new Set((lib.entries || []).map(e => e.concept.toLowerCase().trim()));
          const now = new Date().toISOString();
          const newEntries = sessionDef.coreFormulasForLibrary
            .map(formula => {
              const sepIdx = formula.search(/[=—:]/);
              if (sepIdx > 0) {
                return { concept: formula.slice(0, sepIdx).trim(), definition: formula.slice(sepIdx + 1).trim() };
              }
              return { concept: formula, definition: formula };
            })
            .filter(e => !existing.has(e.concept.toLowerCase().trim()))
            .map(e => ({
              id: Math.random().toString(36).slice(2),
              concept: e.concept,
              definition: e.definition,
              source: sessionDef.title,
              sessionId,
              dateAdded: now,
            }));
          if (newEntries.length > 0) {
            lib.entries = [...(lib.entries || []), ...newEntries];
            writeLibrary(lib);
          }
        }
      }
    }

    progress.totalSessionsCompleted = (progress.totalSessionsCompleted || 0) + 1;
    if (progress.totalSessionsCompleted >= 5) progress.adaptiveMode = true;
    progress.sessionState = null;  // clear session state on completion

    writeProgress(progress);

    // ── Auto-create SRS entry for newly completed sessions ────────────────────
    if (sessionId) {
      try {
        const curricula = readAllCurricula();
        let curriculum = 'harrison';
        for (const c of curricula) {
          for (const ch of (c.chapters || [])) {
            if ((ch.sessions || []).some(s => s.id === sessionId)) {
              curriculum = c.id || 'harrison';
              break;
            }
          }
        }
        if (isSupabase()) {
          const { data: existing } = await supabase
            .from('srs_schedule').select('id').eq('session_id', sessionId).single();
          if (!existing) {
            const entry = srsModule.createEntry(sessionId, chapterId || '', curriculum, result.totalScore, result.weakSpots || []);
            await upsertSRSToSupabase(entry);
          }
        } else {
          const srsData = readSRS();
          if (!(srsData.entries || []).find(e => e.session_id === sessionId)) {
            const entry = srsModule.createEntry(sessionId, chapterId || '', curriculum, result.totalScore, result.weakSpots || []);
            srsData.entries = [...(srsData.entries || []), entry];
            writeSRS(srsData);
          }
        }
      } catch (srsErr) {
        console.warn('[/api/quiz/grade] SRS write failed:', srsErr.message);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[/api/quiz/grade]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── SRS Routes ───────────────────────────────────────────────────────────────

app.get('/api/srs/due', async (req, res) => {
  try {
    if (isSupabase()) {
      const due = await getSRSDueFromSupabase();
      return res.json({ entries: due });
    }
    const srsData = readSRS();
    const due = (srsData.entries || []).filter(e => e.next_review_date <= srsModule.today());
    res.json({ entries: due });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/srs', async (req, res) => {
  try {
    const { sessionId, chapterId, curriculum, score, weakSpots } = req.body;
    if (isSupabase()) {
      // Check for existing entry first (idempotent)
      const { data: existing } = await supabase
        .from('srs_schedule').select('*').eq('session_id', sessionId).single();
      if (existing) return res.json(existing);
      const entry = srsModule.createEntry(sessionId, chapterId, curriculum, score, weakSpots);
      const created = await upsertSRSToSupabase(entry);
      return res.json(created);
    }
    const srsData = readSRS();
    const existing = (srsData.entries || []).find(e => e.session_id === sessionId);
    if (existing) return res.json(existing);
    const entry = srsModule.createEntry(sessionId, chapterId, curriculum, score, weakSpots);
    srsData.entries = [...(srsData.entries || []), entry];
    writeSRS(srsData);
    res.json(entry);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/srs/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { score } = req.body;
    if (isSupabase()) {
      const { data: existing, error } = await supabase
        .from('srs_schedule').select('*').eq('session_id', sessionId).single();
      if (error || !existing) return res.status(404).json({ error: 'SRS entry not found' });
      const updated = srsModule.updateSchedule(existing, score);
      const saved = await updateSRSInSupabase(sessionId, updated);
      return res.json(saved);
    }
    const srsData = readSRS();
    const idx = (srsData.entries || []).findIndex(e => e.session_id === sessionId);
    if (idx === -1) return res.status(404).json({ error: 'SRS entry not found' });
    srsData.entries[idx] = srsModule.updateSchedule(srsData.entries[idx], score);
    writeSRS(srsData);
    res.json(srsData.entries[idx]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PDF Upload ───────────────────────────────────────────────────────────────

app.post('/api/upload-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file received.' });

    const { curriculumId } = req.body;
    const isBrealey = curriculumId && curriculumId.startsWith('bm');
    const storageKey = isBrealey ? 'pdfs/brealey.pdf' : 'pdfs/harrison.pdf';
    const configKey  = isBrealey ? 'brealeyStoragePath' : 'harrisonStoragePath';

    if (isSupabase()) {
      const { error } = await supabase.storage
        .from('pdfs')
        .upload(storageKey, req.file.buffer, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (error) throw new Error(error.message);

      const config = readConfig();
      config[configKey] = storageKey;
      writeConfig(config);

      console.log(`[/api/upload-pdf] Uploaded "${req.file.originalname}" → Supabase Storage: ${storageKey}`);
      return res.json({ success: true, path: storageKey, storage: 'supabase' });
    }

    // Local fallback: save to uploads/
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const destFilename = isBrealey ? 'brealey.pdf' : 'harrison.pdf';
    const destPath = path.join(uploadsDir, destFilename);
    fs.writeFileSync(destPath, req.file.buffer);

    const config = readConfig();
    const localKey = isBrealey ? 'brealeyPdfPath' : 'pdfPath';
    config[localKey] = destPath;
    writeConfig(config);

    console.log(`[/api/upload-pdf] Saved "${req.file.originalname}" → ${destPath}`);
    res.json({ success: true, path: destPath, storage: 'local' });
  } catch (err) {
    console.error('[/api/upload-pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Curriculum ───────────────────────────────────────────────────────────────

app.get('/api/curriculum', (req, res) => {
  try {
    const curricula = readAllCurricula();
    if (!curricula.length) return res.status(404).json({ error: 'No curriculum files found' });
    res.json(curricula);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Config ───────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  try { res.json({ ...readConfig(), supabaseEnabled: isSupabase() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/config', (req, res) => {
  try {
    const updated = { ...readConfig(), ...req.body };
    writeConfig(updated);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PDF Page Extraction ──────────────────────────────────────────────────────

app.post('/api/extract-pages', async (req, res) => {
  try {
    const config = readConfig();
    const { start, end, curriculumId } = req.body;

    if (!start || !end) return res.status(400).json({ error: 'start and end page numbers required' });

    const isBrealey = curriculumId && curriculumId.startsWith('bm');

    let buffer;

    // ── Try Supabase Storage first ────────────────────────────────────────────
    if (isSupabase()) {
      const storageKey = isBrealey
        ? (config.brealeyStoragePath || 'pdfs/brealey.pdf')
        : (config.harrisonStoragePath || 'pdfs/harrison.pdf');

      console.log(`[/api/extract-pages] Downloading from Supabase Storage: ${storageKey}`);
      const { data: blob, error } = await supabase.storage.from('pdfs').download(storageKey);
      if (error) {
        return res.status(400).json({ error: 'PDF not found in cloud storage. Upload your PDF in Settings first.' });
      }
      buffer = Buffer.from(await blob.arrayBuffer());
    } else {
      // ── Local filesystem fallback ─────────────────────────────────────────
      const pdfPath = isBrealey
        ? (process.env.BREALEY_PDF_PATH || config.brealeyPdfPath)
        : (process.env.TEXTBOOK_PDF_PATH || config.pdfPath);

      console.log(`[/api/extract-pages] pdfPath="${pdfPath || '(not set)'}" curriculum="${curriculumId || 'harrison'}"`);

      if (!pdfPath) {
        return res.status(400).json({ error: 'No PDF path configured. Add your PDF path in Settings.' });
      }
      if (!fs.existsSync(pdfPath)) {
        console.warn(`[/api/extract-pages] File not found: ${pdfPath}`);
        return res.status(400).json({ error: `PDF file not found: ${pdfPath}` });
      }
      buffer = fs.readFileSync(pdfPath);
    }

    console.log(`[/api/extract-pages] Extracting pages ${start}–${end}`);
    let currentPage = 0;
    const pageTexts = [];

    await pdfParse(buffer, {
      max: end,
      pagerender: async (pageData) => {
        currentPage++;
        if (currentPage < start) return '';
        const content = await pageData.getTextContent();
        const text = content.items
          .map(item => item.str + (item.hasEOL ? '\n' : ' '))
          .join('');
        pageTexts.push(text);
        return text;
      },
    });

    const text = pageTexts.join('\n\n');
    const charCount = text.length;
    console.log(`[/api/extract-pages] Extracted ${charCount} chars from pages ${start}–${end}${charCount < 200 ? ' ⚠ very short — check page numbers' : ''}`);

    res.json({ text });
  } catch (err) {
    console.error('[/api/extract-pages]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  FinanceLab → http://localhost:${PORT}\n`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('  WARNING: ANTHROPIC_API_KEY is not set.\n');
    }
  });
}

/**
 * Apply minimum-page-gap filter and chapter-number deduplication to a raw
 * list of chapter candidates (sorted by ascending pageNum).
 *
 * Rules:
 *  - Two consecutive candidates must be at least minGap pages apart.
 *  - If the same chapter number appears more than once, only the first is kept.
 *
 * @param {{ pageNum: number, number: number, title: string }[]} candidates
 * @param {number} minGap
 * @returns {{ pageNum: number, number: number, title: string }[]}
 */
function applyGapAndDedup(candidates, minGap = 30) {
  // Gap filter — process in pageNum order
  const gapped = [];
  for (const ch of candidates) {
    const prev = gapped[gapped.length - 1];
    if (!prev || ch.pageNum - prev.pageNum >= minGap) {
      gapped.push(ch);
    }
  }

  // Deduplicate by chapter number — keep first occurrence only
  const seen = new Set();
  return gapped.filter(ch => {
    if (seen.has(ch.number)) return false;
    seen.add(ch.number);
    return true;
  });
}

module.exports = { app, readProgress, writeProgress, extractCoreConceptsFromText, getNextChapter, applyGapAndDedup, readCurriculum, readAllCurricula, readConfig, writeConfig, readLibrary, writeLibrary, readSRS, writeSRS };
