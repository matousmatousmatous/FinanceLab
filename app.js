/* ─── FinanceLab — Client App ─────────────────────────────────────────────── */

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  progress: null,
  curricula: [],        // array of curricula loaded from /api/curriculum
  curriculum: null,     // first curriculum (Harrison) — kept for backward compat with session code
  config: null,         // { pdfPath }
  library: null,
  srsSchedule: [],      // due SRS entries from /api/srs/due
  srsReviewEntry: null, // SRS entry being reviewed (review mode)
  brealeyUnlocked: false, // manual override for Brealey prerequisite
  view: 'home',         // 'home' | 'session' | 'settings' | 'library' | 'sandbox'
  currentTopic: null,   // { id, title } — set from curriculum session
  currentSession: null, // { chapter, session } from curriculum
  phase: null,          // 'learn' | 'example' | 'quiz' | 'results'
  session: {
    learnContent: null,
    exampleContent: null,
    quiz: null,
    answers: {},
    gradingResults: null,
    difficultyRating: null,
    coreConceptsFound: [],
    chapterText: null,    // extracted PDF text for this session
    outline: null,        // Pass 1 outline from two-pass lesson generation
  },
  libraryQuiz: {
    questions: null,
    userAnswers: {},
    results: null,
    currentIdx: 0,
  },
};

// ─── API ──────────────────────────────────────────────────────────────────────

const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  async delete(path) {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};

// ─── Loading ──────────────────────────────────────────────────────────────────

function setLoading(active, message = 'Generating content…') {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  const msg = overlay.querySelector('.loading-message');
  if (msg) msg.textContent = message;
  overlay.classList.toggle('active', active);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(message, type = 'warn') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span style="flex:1">⚠ ${message}</span><button class="toast-close">✕</button>`;
  el.querySelector('.toast-close').addEventListener('click', () => el.remove());
  container.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

// ─── [[CORE]] Parser ──────────────────────────────────────────────────────────

function extractCoreConcepts(text) {
  const regex = /\[\[CORE:\s*([^\]]+?)\]\]/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    const sepIdx = raw.search(/[=—:]/);
    if (sepIdx > 0) {
      results.push({ concept: raw.slice(0, sepIdx).trim(), definition: raw.slice(sepIdx + 1).trim() });
    } else {
      results.push({ concept: raw, definition: raw });
    }
  }
  return results;
}

function renderWithCoreHighlights(text) {
  // Replace [[CORE: X = Y]] with highlighted mark + keep the readable text
  return text.replace(/\[\[CORE:\s*([^\]]+?)\]\]/g, (_, inner) => {
    const safe = inner.replace(/"/g, '&quot;');
    return `<mark class="core-concept" title="${safe}">${inner}</mark>`;
  });
}

// ─── Session State Save ───────────────────────────────────────────────────────

async function saveSessionState(patch) {
  try {
    await API.patch('/api/progress', patch);
  } catch (e) {
    // Non-fatal — session state saving is best-effort
    console.warn('Session state save failed:', e.message);
  }
}

// ─── beforeunload guard ───────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (state.view === 'session' && state.phase && state.phase !== 'results') {
    const patch = {
      sessionState: {
        topicId: state.currentTopic?.id,
        topicTitle: state.currentTopic?.title,
        sessionId: state.currentSession?.session?.id || null,
        chapterId: state.currentSession?.chapter?.id || null,
        phase: state.phase,
        answers: state.session.answers,
        timestamp: new Date().toISOString(),
      },
    };
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', '/api/progress', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    try { xhr.send(JSON.stringify(patch)); } catch {}
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [progress, curricula, library, config, srsData] = await Promise.all([
      API.get('/api/progress'),
      API.get('/api/curriculum'),
      API.get('/api/library'),
      API.get('/api/config'),
      API.get('/api/srs/due').catch(() => ({ entries: [] })),
    ]);
    state.progress     = progress;
    state.curricula    = Array.isArray(curricula) ? curricula : [curricula];
    state.curriculum   = state.curricula[0] || null;
    state.library      = library;
    state.config       = config;
    state.srsSchedule  = srsData.entries || [];
    if (!state.progress.sessions) state.progress.sessions = {};
    render();
  } catch (err) {
    document.getElementById('app').innerHTML = `
      <div class="fatal-error">
        <h2>Cannot connect to server</h2>
        <p>${err.message}</p>
        <p>Make sure the server is running: <code>npm start</code></p>
      </div>`;
  }
}

// ─── Render Router ────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  if (state.view === 'home') {
    app.innerHTML = buildHome();
    attachHomeListeners();
    checkForResume();
  } else if (state.view === 'settings') {
    app.innerHTML = buildSettings();
    attachSettingsListeners();
  } else if (state.view === 'library') {
    app.innerHTML = buildLibrary();
    attachLibraryListeners();
  } else if (state.view === 'sandbox') {
    app.innerHTML = buildSandbox();
    attachSandboxListeners();
  } else {
    app.innerHTML = buildSession();
    attachSessionListeners();
  }
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function buildNav(activeView) {
  const { completed, total } = getAllCurriculaProgress();
  const dueCount = state.srsSchedule.length;
  const dueBadge = dueCount ? `<span class="srs-due-badge">${dueCount}</span>` : '';

  const bottomTabs = [
    { id: 'home',     label: 'Curriculum', icon: '⊞', badge: dueCount ? `<span class="btab-badge">${dueCount}</span>` : '' },
    { id: 'sandbox',  label: 'Sandbox',    icon: '▦', badge: '' },
    { id: 'library',  label: 'Library',    icon: '≡', badge: '' },
    { id: 'settings', label: 'Settings',   icon: '⚙', badge: '' },
  ];

  return `
<nav class="app-nav">
  <span class="nav-brand" data-nav="home">◈ FinanceLab</span>
  <div class="nav-links">
    <button class="nav-link ${activeView === 'home'     ? 'active' : ''}" data-nav="home">Curriculum${dueBadge}</button>
    <button class="nav-link ${activeView === 'sandbox'  ? 'active' : ''}" data-nav="sandbox">Sandbox</button>
    <button class="nav-link ${activeView === 'settings' ? 'active' : ''}" data-nav="settings">Settings</button>
    <button class="nav-link ${activeView === 'library'  ? 'active' : ''}" data-nav="library">Library</button>
  </div>
  <div class="nav-right">
    <span class="nav-badge">${completed}/${total} sessions</span>
  </div>
</nav>
<div class="bottom-tab-bar">
  ${bottomTabs.map(t => `
  <button class="btab ${activeView === t.id ? 'active' : ''}" data-nav="${t.id}">
    <span class="btab-icon">${t.icon}</span>${t.badge}
    <span class="btab-label">${t.label}</span>
  </button>`).join('')}
</div>`;
}

function attachNavListeners() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const view = el.dataset.nav;
      if (state.view === 'session' && state.phase !== 'results') {
        if (!confirm('Leave session? Your current phase will be saved.')) return;
      }
      state.view = view;
      if (view === 'library') {
        API.get('/api/library').then(lib => { state.library = lib; render(); }).catch(() => render());
      } else {
        render();
      }
    });
  });
}

// ─── Curriculum Progress Helpers ──────────────────────────────────────────────

function getCurriculumProgress(curriculum) {
  const chapters = (curriculum || state.curriculum)?.chapters || [];
  const sessions = state.progress?.sessions || {};
  let total = 0, completed = 0;
  for (const ch of chapters) {
    for (const s of (ch.sessions || [])) {
      total++;
      if (sessions[s.id]?.completed) completed++;
    }
  }
  return { total, completed };
}

function getAllCurriculaProgress() {
  const sessions = state.progress?.sessions || {};
  let total = 0, completed = 0;
  for (const curr of state.curricula) {
    for (const ch of (curr.chapters || [])) {
      for (const s of (ch.sessions || [])) {
        total++;
        if (sessions[s.id]?.completed) completed++;
      }
    }
  }
  return { total, completed };
}

function isHarrisonComplete() {
  const harrison = state.curricula.find(c => !c.meta?.prerequisite);
  if (!harrison) return true;
  const { total, completed } = getCurriculumProgress(harrison);
  return total > 0 && completed === total;
}

function isBrealeyUnlocked() {
  return state.brealeyUnlocked || isHarrisonComplete();
}

function getNextCurriculumSession() {
  const sessions = state.progress?.sessions || {};
  for (const curriculum of state.curricula) {
    // Skip locked curricula
    if (curriculum.meta?.prerequisite && !isBrealeyUnlocked()) continue;
    for (const chapter of (curriculum.chapters || [])) {
      for (const session of (chapter.sessions || [])) {
        if (!sessions[session.id]?.completed) return { chapter, session, curriculum };
      }
    }
  }
  return null;
}

// ─── Resume check ────────────────────────────────────────────────────────────

function checkForResume() {
  const ss = state.progress?.sessionState;
  if (!ss || !ss.topicId || !ss.phase || ss.phase === 'results') return;

  const banner = document.createElement('div');
  banner.id = 'resume-banner';
  banner.className = 'resume-banner';
  banner.style.margin = '0 32px';
  banner.innerHTML = `
    <span class="resume-banner-icon">↩</span>
    <div class="resume-banner-text">
      <div class="resume-banner-title">Unfinished session: ${ss.topicTitle || ss.topicId}</div>
      <div class="resume-banner-sub">Phase: ${ss.phase} · Last saved ${formatDate(ss.timestamp)}</div>
    </div>
    <div class="resume-banner-actions">
      <button class="btn btn-primary btn-sm" id="resume-yes">Continue</button>
      <button class="btn btn-ghost btn-sm" id="resume-no">Dismiss</button>
    </div>`;

  const main = document.querySelector('.home-main');
  if (main) main.prepend(banner);

  document.getElementById('resume-yes')?.addEventListener('click', () => {
    resumeSession(ss);
    banner.remove();
  });
  document.getElementById('resume-no')?.addEventListener('click', async () => {
    banner.remove();
    await API.patch('/api/progress', { sessionState: null });
    state.progress.sessionState = null;
  });
}

async function resumeSession(ss) {
  // Try to locate the curriculum session across all curricula
  if (ss.sessionId) {
    outer: for (const curriculum of state.curricula) {
      for (const ch of (curriculum.chapters || [])) {
        const sessionDef = (ch.sessions || []).find(s => s.id === ss.sessionId);
        if (sessionDef) {
          state.currentSession = { chapter: ch, session: sessionDef, curriculum };
          break outer;
        }
      }
    }
  }
  state.currentTopic = { id: ss.topicId, title: ss.topicTitle || ss.topicId };
  state.phase = ss.phase || 'learn';
  state.session = { learnContent: null, exampleContent: null, quiz: null, answers: ss.answers || {}, gradingResults: null, difficultyRating: null, coreConceptsFound: [], chapterText: null };
  state.view = 'session';
  render();

  if (ss.phase === 'learn' || !ss.learnCompleted) {
    startLearnPhase(state.currentTopic);
  } else if (ss.phase === 'example' || !ss.exampleCompleted) {
    startExamplePhase(state.currentTopic);
  } else if (ss.phase === 'quiz') {
    startQuizPhase(state.currentTopic);
  }
}

// ─── ─── ─── HOME VIEW ─── ─── ───

function buildHome() {
  const next = getNextCurriculumSession();
  const sessions = state.progress?.sessions || {};
  const due = state.srsSchedule || [];

  const dueSectionHTML = due.length ? `
    <div class="srs-due-section" style="margin-bottom:24px">
      <div class="srs-due-header">
        <span class="srs-due-title">◷ Due for Review</span>
        <span class="srs-due-count">${due.length} session${due.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="srs-due-list">
        ${due.map(entry => {
          // Find session title from curricula
          let sessionTitle = entry.session_id;
          for (const curr of state.curricula) {
            for (const ch of (curr.chapters || [])) {
              const s = (ch.sessions || []).find(s => s.id === entry.session_id);
              if (s) { sessionTitle = s.title; break; }
            }
          }
          return `
          <div class="srs-due-card">
            <div class="srs-due-card-info">
              <div class="srs-due-session-title">${sessionTitle}</div>
              <div class="srs-due-meta">Review #${entry.review_count + 1} · Last score: ${entry.last_score !== null ? entry.last_score + '%' : '—'}</div>
            </div>
            <button class="btn btn-primary btn-sm srs-review-btn" data-session-id="${entry.session_id}">Review Now →</button>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
${buildNav('home')}
<div class="home-view">
  <main class="home-main">
    ${dueSectionHTML}
    ${next ? `
    <div class="active-chapter-banner" style="margin-bottom:24px">
      <div>
        <div class="active-chapter-label">Up Next</div>
        <div class="active-chapter-title">${next.session.title}</div>
        <div class="active-chapter-meta">Chapter ${next.chapter.number}: ${next.chapter.title}</div>
      </div>
      <button class="btn btn-primary btn-lg" id="start-next-btn">Start Session →</button>
    </div>` : ''}

    ${state.curricula.map(curr => buildCurriculumSection(curr, sessions)).join('')}
  </main>
</div>`;
}

function buildCurriculumSection(curriculum, sessions) {
  const { completed, total } = getCurriculumProgress(curriculum);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const meta = curriculum.meta || {};
  const isLocked = !!meta.prerequisite && !isBrealeyUnlocked();
  const chapters = curriculum.chapters || [];

  let lockBanner = '';
  if (isLocked) {
    lockBanner = `
    <div class="curriculum-locked-banner">
      <span>🔒 Complete ${meta.prerequisite.replace('curriculum_', '').replace('.json', '')} first to unlock this curriculum.</span>
      <button class="btn btn-ghost btn-sm" id="unlock-brealey-btn">Unlock anyway</button>
    </div>`;
  }

  return `
<div class="curriculum-section" style="margin-bottom:40px">
  <div class="progress-section">
    <div class="progress-header">
      <div>
        <h2>${meta.title || curriculum.title || 'Curriculum'}</h2>
        ${meta.textbook ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${meta.textbook}</div>` : ''}
      </div>
      <span class="progress-pct">${pct}%</span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width:${pct}%"></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${completed} of ${total} sessions completed</div>
  </div>
  ${lockBanner}
  ${isLocked ? '' : `
  <div class="curriculum-chapters">
    ${chapters.map(ch => buildChapterBlock(ch, sessions, meta.id || '')).join('')}
  </div>`}
</div>`;
}

function buildChapterBlock(chapter, sessions, curriculumId) {
  const chSessions = chapter.sessions || [];
  const completedCount = chSessions.filter(s => sessions[s.id]?.completed).length;
  const difficultyStars = '★'.repeat(chapter.difficulty || 1) + '☆'.repeat(3 - (chapter.difficulty || 1));
  const allDone = completedCount === chSessions.length;

  return `
<div class="chapter-block">
  <div class="chapter-block-header">
    <div>
      <div class="chapter-block-title">
        <span class="chapter-num-badge">Ch.${chapter.number}</span>
        ${chapter.title}
      </div>
      <div class="chapter-block-meta">
        ${chapter.spotlightCompany ? `<span>${chapter.spotlightCompany}</span> · ` : ''}
        <span title="Difficulty">${difficultyStars}</span> ·
        <span>${completedCount}/${chSessions.length} sessions</span>
      </div>
    </div>
    ${allDone ? '<span class="chapter-done-badge">✓ Complete</span>' : ''}
  </div>
  <div class="chapter-sessions-list">
    ${chSessions.map(s => buildSessionRow(s, chapter, sessions, curriculumId)).join('')}
  </div>
</div>`;
}

function buildSessionRow(session, chapter, progressSessions, curriculumId) {
  const sp = progressSessions[session.id];
  const done = sp?.completed;
  const score = done ? sp.quizScore : null;
  const next = getNextCurriculumSession();
  const isCurrent = next?.session?.id === session.id;

  const srsEntry = (state.srsSchedule || []).find(e => e.session_id === session.id);
  const reviewDateHTML = done && srsEntry
    ? `<span class="session-review-date" title="Next SRS review">◷ ${srsEntry.next_review_date}</span>`
    : '';

  const scoreHTML = score !== null
    ? `<span class="score-badge ${score >= 80 ? 'score-high' : score >= 65 ? 'score-mid' : 'score-low'}">${score}%</span>`
    : '';
  const dateHTML = sp?.lastStudied ? `<span class="session-date">${formatDate(sp.lastStudied)}</span>` : '';

  return `
<div class="session-row ${done ? 'session-done' : isCurrent ? 'session-current' : 'session-pending'}"
     data-session-id="${session.id}" data-chapter-id="${chapter.id}" data-curriculum-id="${curriculumId || ''}" style="cursor:pointer">
  <div class="session-row-status">
    ${done ? '<span class="status-dot done">✓</span>' : isCurrent ? '<span class="status-dot current">→</span>' : '<span class="status-dot pending">○</span>'}
  </div>
  <div class="session-row-info">
    <div class="session-row-title">${session.sessionNumber}. ${session.title}</div>
    <div class="session-row-pages">Pages ${session.focusPages?.book || ''}</div>
  </div>
  <div class="session-row-meta">
    ${scoreHTML}${dateHTML}${reviewDateHTML}
    ${isCurrent ? '<span class="next-badge">Next</span>' : ''}
  </div>
</div>`;
}

function attachHomeListeners() {
  attachNavListeners();

  document.getElementById('start-next-btn')?.addEventListener('click', () => {
    const next = getNextCurriculumSession();
    if (next) startCurriculumSession(next.chapter, next.session, next.curriculum);
  });

  document.getElementById('unlock-brealey-btn')?.addEventListener('click', () => {
    state.brealeyUnlocked = true;
    render();
  });

  document.querySelectorAll('.srs-review-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      const entry = state.srsSchedule.find(e => e.session_id === sessionId);
      if (entry) startSRSReview(entry);
    });
  });

  document.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', () => {
      const sessionId = row.dataset.sessionId;
      const chapterId = row.dataset.chapterId;
      const curriculumId = row.dataset.curriculumId;
      // Search all curricula for this chapter/session
      let chapter = null, session = null, curriculum = null;
      for (const curr of state.curricula) {
        chapter = curr.chapters?.find(c => c.id === chapterId);
        if (chapter) {
          session = chapter.sessions?.find(s => s.id === sessionId);
          curriculum = curr;
          break;
        }
      }
      if (chapter && session) startCurriculumSession(chapter, session, curriculum);
    });
  });
}

// ─── ─── ─── SESSION VIEW ─── ─── ───

function buildStepperHTML(pi) {
  const phases = ['learn', 'example', 'quiz', 'results'];
  const phaseLabels = ['Learn', 'Example', 'Quiz', 'Results'];
  const desktopSteps = phaseLabels.map((label, i) => `
    ${i > 0 ? '<div class="phase-connector"></div>' : ''}
    <div class="phase-step ${i < pi ? 'completed' : i === pi ? 'active' : 'pending'}">
      <span class="phase-dot"></span>
      <span class="phase-label">${label}</span>
    </div>`).join('');

  const mobileDots = phases.map((_, i) =>
    `<span class="pdot ${i < pi ? 'done' : i === pi ? 'now' : ''}"></span>`
  ).join('');

  return `
    <div class="phase-steps">${desktopSteps}</div>
    <div class="phase-stepper-mobile" id="phase-stepper-mobile">
      <div class="pdots">${mobileDots}</div>
      <span class="pcurrent">${phaseLabels[pi] || ''}</span>
    </div>`;
}

function buildSession() {
  const phases = ['learn', 'example', 'quiz', 'results'];
  const pi = phases.indexOf(state.phase);

  return `
<div class="session-view">
  <header class="session-header">
    <div class="session-header-top">
      <button class="btn btn-ghost btn-back" id="back-btn">← Back</button>
      <span class="session-topic-title-mobile">${state.currentTopic?.title || ''}</span>
    </div>
    <div class="session-header-bottom">
      <div class="session-topic-info">
        <span class="session-topic-label">Session</span>
        <span class="session-topic-title">${state.currentTopic?.title || ''}</span>
      </div>
      ${buildStepperHTML(pi)}
    </div>
  </header>
  <main class="session-main" id="session-main">
    ${buildPhaseContent()}
  </main>
</div>`;
}

function buildPhaseContent() {
  switch (state.phase) {
    case 'learn':   return buildLearn();
    case 'example': return buildExample();
    case 'quiz':    return buildQuiz();
    case 'results': return buildResults();
    default:        return '<div class="loading-inline">Loading…</div>';
  }
}

function refreshSessionMain() {
  const main = document.getElementById('session-main');
  if (main) main.innerHTML = buildPhaseContent();

  const phases = ['learn', 'example', 'quiz', 'results'];
  const phaseLabels = ['Learn', 'Example', 'Quiz', 'Results'];
  const pi = phases.indexOf(state.phase);

  // Update desktop stepper
  const steps = document.querySelector('.phase-steps');
  if (steps) {
    steps.innerHTML = phaseLabels.map((label, i) => `
      ${i > 0 ? '<div class="phase-connector"></div>' : ''}
      <div class="phase-step ${i < pi ? 'completed' : i === pi ? 'active' : 'pending'}">
        <span class="phase-dot"></span>
        <span class="phase-label">${label}</span>
      </div>`).join('');
  }

  // Update mobile stepper
  const mobileStepper = document.getElementById('phase-stepper-mobile');
  if (mobileStepper) {
    const dots = phases.map((_, i) =>
      `<span class="pdot ${i < pi ? 'done' : i === pi ? 'now' : ''}"></span>`
    ).join('');
    mobileStepper.innerHTML = `<div class="pdots">${dots}</div><span class="pcurrent">${phaseLabels[pi] || ''}</span>`;
  }

  attachSessionListeners();
}

function attachSessionListeners() {
  document.getElementById('back-btn')?.addEventListener('click', () => {
    if (state.phase === 'results' || confirm('Leave session? Progress will be saved.')) {
      state.view = 'home';
      state.phase = null;
      state.currentTopic = null;
      state.currentSession = null;
      render();
    }
  });

  document.getElementById('next-phase-btn')?.addEventListener('click', advancePhase);
  document.getElementById('quiz-form')?.addEventListener('submit', handleQuizSubmit);
  document.getElementById('finish-btn')?.addEventListener('click', () => {
    state.view = 'home';
    state.phase = null;
    state.currentTopic = null;
    state.currentChapter = null;
    render();
  });

  // Difficulty buttons
  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rating = btn.dataset.rating;
      state.session.difficultyRating = rating;
      document.querySelectorAll('.difficulty-btn').forEach(b => {
        b.className = b.className.replace(/selected-\w+/g, '');
      });
      btn.classList.add(`selected-${rating}`);

      // Persist difficulty rating
      const patch = { sessionState: { ...(state.progress.sessionState || {}), difficultyRating: rating } };
      if (state.currentSession?.session?.id) {
        patch.sessions = { [state.currentSession.session.id]: { difficultyRating: rating } };
      }
      await saveSessionState(patch);
    });
  });
}

// ─── Learn ────────────────────────────────────────────────────────────────────

function buildLearn() {
  const c = state.session.learnContent;
  if (!c) return '<div class="loading-inline">Preparing lesson…</div>';

  const htmlContent = renderWithCoreHighlights(marked.parse(c.content));
  const concepts = state.session.coreConceptsFound;

  return `
<div class="phase-content">
  <div class="content-card">
    <h1 class="content-title">${c.title}</h1>
    <div class="content-body markdown-body">${htmlContent}</div>
    ${concepts.length ? `
      <div class="core-concepts-box">
        <div class="core-concepts-label">◆ Core Concepts from this lesson</div>
        <div>${concepts.map(c => `<span class="core-concept-pill">${c.concept}</span>`).join('')}</div>
      </div>` : ''}
    ${c.keyTakeaways?.length ? `
      <div class="key-takeaways">
        <h3 class="takeaways-title">Key Takeaways</h3>
        <ul class="takeaways-list">
          ${c.keyTakeaways.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>` : ''}
  </div>

  <div class="difficulty-bar">
    <span class="difficulty-bar-label">How was this reading?</span>
    <div class="difficulty-options">
      <button class="difficulty-btn ${state.session.difficultyRating === 'easy' ? 'selected-easy' : ''}" data-rating="easy">Too Easy</button>
      <button class="difficulty-btn ${state.session.difficultyRating === 'ok'   ? 'selected-ok'   : ''}" data-rating="ok">Just Right</button>
      <button class="difficulty-btn ${state.session.difficultyRating === 'hard' ? 'selected-hard' : ''}" data-rating="hard">Too Hard</button>
    </div>
  </div>

  <div class="phase-nav">
    <button class="btn btn-primary btn-lg" id="next-phase-btn">Continue to Examples →</button>
  </div>
</div>`;
}

// ─── Example ──────────────────────────────────────────────────────────────────

function buildExample() {
  const c = state.session.exampleContent;
  if (!c) return '<div class="loading-inline">Generating examples…</div>';

  return `
<div class="phase-content">
  ${c.examples.map((ex, i) => `
    <div class="content-card example-card">
      <div class="example-header">
        <span class="example-num">Example ${i + 1}</span>
        <h2 class="example-title">${ex.title}</h2>
      </div>
      <div class="example-scenario markdown-body">${marked.parse(ex.scenario)}</div>
      <div class="example-divider"><span>Solution</span></div>
      <div class="example-solution markdown-body">${marked.parse(ex.solution)}</div>
      ${ex.analystInsight ? `
        <div class="analyst-insight">
          <span class="insight-icon">◆</span>
          <div><strong>Analyst Insight:</strong> ${ex.analystInsight}</div>
        </div>` : ''}
    </div>`).join('')}
  <div class="phase-nav">
    <button class="btn btn-primary btn-lg" id="next-phase-btn">Start Quiz →</button>
  </div>
</div>`;
}

// ─── Quiz ─────────────────────────────────────────────────────────────────────

function buildQuiz() {
  const q = state.session.quiz;
  if (!q) return '<div class="loading-inline">Generating quiz…</div>';

  return `
<div class="phase-content">
  <div class="quiz-header">
    <h2>Quiz: ${state.currentTopic.title}</h2>
    <p class="quiz-instructions">Answer all questions. Short answers are graded by AI — write in full sentences.</p>
  </div>
  <form class="quiz-form" id="quiz-form">
    ${q.questions.map(buildQuestion).join('')}
    <div class="quiz-submit-area">
      <button type="submit" class="btn btn-primary btn-lg">Submit Answers</button>
    </div>
  </form>
</div>`;
}

function buildQuestion(q) {
  const savedAnswer = state.session.answers[q.id];

  if (q.type === 'multiple_choice') {
    return `
<div class="question-card" data-qid="${q.id}" data-type="multiple_choice">
  <div class="question-header">
    <span class="question-type-badge">Multiple Choice</span>
    <span class="question-num">Q${q.id}</span>
  </div>
  <p class="question-text">${q.question}</p>
  <div class="mc-options">
    ${q.options.map((opt, i) => `
      <label class="mc-option">
        <input type="radio" name="q${q.id}" value="${i}" ${savedAnswer === i ? 'checked' : ''}>
        <span class="mc-option-letter">${String.fromCharCode(65 + i)}</span>
        <span class="mc-option-text">${opt}</span>
      </label>`).join('')}
  </div>
</div>`;
  }

  if (q.type === 'short_answer') {
    return `
<div class="question-card" data-qid="${q.id}" data-type="short_answer">
  <div class="question-header">
    <span class="question-type-badge">Short Answer</span>
    <span class="question-num">Q${q.id}</span>
  </div>
  <p class="question-text">${q.question}</p>
  <textarea class="short-answer-input" name="q${q.id}" rows="5"
    placeholder="Write your answer here…">${savedAnswer || ''}</textarea>
</div>`;
  }

  if (q.type === 'fill_in_blank') {
    const savedCells = savedAnswer || {};
    return `
<div class="question-card fill-in-blank-card" data-qid="${q.id}" data-type="fill_in_blank">
  <div class="question-header">
    <span class="question-type-badge">Fill in the Blank</span>
    <span class="question-num">Q${q.id}</span>
  </div>
  <h3 class="fib-title">${q.title}</h3>
  <p class="question-text">${q.context}</p>
  <div class="fib-table-wrapper">
    <table class="financial-table">
      <thead>
        <tr>${q.table.headers.map(h => `<th>${h}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${q.table.rows.map(row => `
          <tr class="${row.blank ? 'blank-row' : ''}">
            <td class="row-label">${row.label}</td>
            <td class="row-value">
              ${row.blank
                ? `<input type="text" class="fib-input"
                    data-qid="${q.id}" data-label="${row.label}"
                    placeholder="?" value="${savedCells[row.label] || ''}" />`
                : `<span class="given-value">${row.value}</span>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="fib-hint">Cells marked with ? require calculation.</div>
</div>`;
  }

  return '';
}

// Save quiz answers on change (continuous saving)
function attachQuizAutoSave() {
  const form = document.getElementById('quiz-form');
  if (!form) return;

  const saveAnswers = () => {
    const quiz = state.session.quiz;
    if (!quiz) return;
    const answers = {};
    quiz.questions.forEach(q => {
      if (q.type === 'multiple_choice') {
        const sel = form.querySelector(`input[name="q${q.id}"]:checked`);
        if (sel) answers[q.id] = parseInt(sel.value, 10);
      } else if (q.type === 'short_answer') {
        const ta = form.querySelector(`textarea[name="q${q.id}"]`);
        if (ta) answers[q.id] = ta.value.trim();
      } else if (q.type === 'fill_in_blank') {
        const inputs = form.querySelectorAll(`.fib-input[data-qid="${q.id}"]`);
        const cells = {};
        inputs.forEach(inp => { cells[inp.dataset.label] = inp.value.trim(); });
        answers[q.id] = cells;
      }
    });
    state.session.answers = answers;
    saveSessionState({ sessionState: { ...(state.progress.sessionState || {}), answers, timestamp: new Date().toISOString() } });
  };

  form.addEventListener('change', saveAnswers);
  form.addEventListener('input', saveAnswers);
}

// ─── Results ──────────────────────────────────────────────────────────────────

function buildResults() {
  const r = state.session.gradingResults;
  if (!r) return '<div class="loading-inline">Grading…</div>';

  const score = r.totalScore;
  const grade = getGrade(score);
  const quiz = state.session.quiz;

  return `
<div class="phase-content results-content">
  <div class="score-card">
    <div class="score-display">
      <div class="score-number ${score >= 80 ? 'score-high' : score >= 65 ? 'score-mid' : 'score-low'}">${score}</div>
      <div class="score-label">/ 100</div>
    </div>
    <div class="grade-display">
      <span class="grade-letter ${grade.cls}">${grade.letter}</span>
      <span class="grade-desc">${grade.desc}</span>
    </div>
    <div style="flex:1;padding-left:12px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Topic</div>
      <div style="font-weight:600;font-size:15px">${state.currentTopic.title}</div>
    </div>
  </div>

  ${r.nextStepAdvice ? `
    <div class="advice-card">
      <div class="advice-icon">→</div>
      <div>
        <strong>Next Steps</strong>
        <p>${r.nextStepAdvice}</p>
      </div>
    </div>` : ''}

  ${r.weakSpots?.length ? `
    <div class="weak-spots-card">
      <h3>Areas to Strengthen</h3>
      <div class="weak-spots-list">
        ${r.weakSpots.map(w => `<span class="weak-spot-tag">${w}</span>`).join('')}
      </div>
    </div>` : ''}

  <div class="question-breakdown">
    <h3>Question Breakdown</h3>
    ${r.results.map(res => buildQuestionResult(res, quiz)).join('')}
  </div>

  <div class="phase-nav results-nav">
    <button class="btn btn-primary btn-lg" id="finish-btn">Back to Home →</button>
  </div>
</div>`;
}

function buildQuestionResult(result, quiz) {
  const question = quiz.questions.find(q => q.id === result.id);
  if (!question) return '';

  const pct = Math.round((result.score || 0) * 100);
  const cls = pct >= 80 ? 'result-correct' : pct >= 50 ? 'result-partial' : 'result-wrong';

  let answerHTML = '';

  if (result.type === 'multiple_choice') {
    const ui = state.session.answers[question.id];
    answerHTML = `
      <div class="result-answer">
        <div class="user-answer">
          <strong>Your answer:</strong>
          ${ui !== undefined ? question.options[ui] : '(no answer)'}
          ${result.correct ? '<span class="correct-mark">✓</span>' : '<span class="wrong-mark">✗</span>'}
        </div>
        ${!result.correct ? `<div class="correct-answer"><strong>Correct:</strong> ${question.options[question.correct_index]}</div>` : ''}
        ${question.explanation ? `<div class="explanation">${question.explanation}</div>` : ''}
      </div>`;
  } else if (result.type === 'short_answer') {
    const ua = state.session.answers[question.id] || '(no answer)';
    answerHTML = `
      <div class="result-answer">
        <div class="user-answer-text"><strong>Your answer:</strong><p>${ua}</p></div>
        ${result.feedback ? `<div class="result-feedback">${result.feedback}</div>` : ''}
      </div>`;
  } else if (result.type === 'fill_in_blank') {
    answerHTML = `
      <div class="result-answer">
        ${result.cellResults ? `
          <div class="cell-results">
            ${result.cellResults.map(cr => `
              <div class="cell-result ${cr.correct ? 'cell-correct' : 'cell-wrong'}">
                <span class="cell-label">${cr.label}</span>
                <span class="cell-icon">${cr.correct ? '✓' : '✗'}</span>
                ${!cr.correct ? `<span class="cell-detail">You: <strong>${cr.userValue || '—'}</strong> · Correct: <strong>${cr.correctValue}</strong>${cr.feedback ? ' · ' + cr.feedback : ''}</span>` : ''}
              </div>`).join('')}
          </div>` : ''}
        ${result.feedback ? `<div class="result-feedback">${result.feedback}</div>` : ''}
      </div>`;
  }

  const typeLabel = { multiple_choice: 'MC', short_answer: 'SA', fill_in_blank: 'FIB' }[result.type] || '?';
  const preview = question.question.length > 80 ? question.question.slice(0, 80) + '…' : question.question;

  return `
<div class="question-result ${cls}">
  <div class="result-header">
    <div class="result-question-info">
      <span class="result-q-type">${typeLabel}</span>
      <span class="result-q-text">${preview}</span>
    </div>
    <div class="result-score">${pct}%</div>
  </div>
  ${answerHTML}
</div>`;
}

function getGrade(score) {
  if (score >= 90) return { letter: 'A', cls: 'grade-a', desc: 'Excellent' };
  if (score >= 80) return { letter: 'B', cls: 'grade-b', desc: 'Good' };
  if (score >= 70) return { letter: 'C', cls: 'grade-c', desc: 'Satisfactory' };
  if (score >= 60) return { letter: 'D', cls: 'grade-d', desc: 'Needs Work' };
  return { letter: 'F', cls: 'grade-f', desc: 'Review Required' };
}

// ─── Session Flow ─────────────────────────────────────────────────────────────

async function startCurriculumSession(chapter, session, curriculum) {
  state.currentSession = { chapter, session, curriculum: curriculum || state.curriculum };
  state.currentTopic = { id: session.id, title: session.title };
  state.phase = 'learn';
  state.session = { learnContent: null, exampleContent: null, quiz: null, answers: {}, gradingResults: null, difficultyRating: null, coreConceptsFound: [], chapterText: null };
  state.view = 'session';
  render();

  // Determine which PDF path to use (Brealey vs Harrison)
  const curriculumId = session.id;
  const isBrealey = curriculumId.startsWith('bm');
  const hasPdf = state.config?.supabaseEnabled
    ? (isBrealey ? (state.config?.brealeyStoragePath || true) : (state.config?.harrisonStoragePath || true))
    : (isBrealey ? state.config?.brealeyPdfPath : state.config?.pdfPath);

  // Extract PDF text for this session's focus pages
  let chapterText = null;
  if (session.focusPages?.pdf) {
    if (!hasPdf) {
      toast('No PDF path set — lesson will use general knowledge. Add your PDF path in Settings.', 'warn');
    } else {
      setLoading(true, 'Extracting textbook pages…');
      try {
        const pages = session.focusPages.pdf;
        const parts = pages.split(/[–—-]/);
        const start = parseInt(parts[0].trim(), 10);
        const end   = parseInt(parts[1]?.trim(), 10) || start;
        const result = await API.post('/api/extract-pages', { start, end, curriculumId });
        chapterText = result.text || null;
        if (!chapterText || chapterText.trim().length < 100) {
          toast(`PDF extraction returned very little text (${chapterText?.length || 0} chars). Check your PDF path in Settings.`, 'warn');
          chapterText = null;
        }
      } catch (e) {
        toast('PDF extraction failed: ' + e.message + ' — lesson will use general knowledge.', 'warn');
        console.warn('PDF extraction failed:', e.message);
      } finally {
        setLoading(false);
      }
    }
  }
  state.session.chapterText = chapterText;
  startLearnPhase(state.currentTopic, chapterText);
}

async function startLearnPhase(topic, chapterText) {
  setLoading(true, 'Loading lesson…');
  const stageTimer = setTimeout(() => setLoading(true, 'Writing lesson…'), 4000);
  try {
    const session = state.currentSession?.session;
    const chapter = state.currentSession?.chapter;
    const data = await API.post('/api/learn', {
      topicId: topic.id,
      topicTitle: topic.title,
      chapterText: chapterText || null,
      learningObjectives: session?.learningObjectives || null,
      analystNote: session?.analystNote || null,
      spotlightCompany: chapter?.spotlightCompany || null,
    });
    state.session.learnContent = data;
    if (data.outline) state.session.outline = data.outline;

    // Extract [[CORE]] concepts
    state.session.coreConceptsFound = extractCoreConcepts(data.content || '');

    // Save concepts to library
    if (state.session.coreConceptsFound.length > 0) {
      saveConceptsToLibrary(state.session.coreConceptsFound, topic.title);
    }
  } catch (err) {
    toast('Failed to generate lesson: ' + err.message);
  } finally {
    clearTimeout(stageTimer);
    setLoading(false);
    refreshSessionMain();
  }
}

async function saveConceptsToLibrary(concepts, source) {
  try {
    const lib = await API.get('/api/library');
    const existing = new Set((lib.entries || []).map(e => e.concept.toLowerCase()));
    const toAdd = concepts.filter(c => !existing.has(c.concept.toLowerCase()));
    for (const c of toAdd) {
      try {
        const entry = await API.post('/api/library', { concept: c.concept, definition: c.definition, source, is_manual: false });
        lib.entries = [...(lib.entries || []), entry];
      } catch {}
    }
    if (toAdd.length > 0) state.library = lib;
  } catch (e) {
    console.warn('Library save failed:', e.message);
  }
}

async function startExamplePhase(topic, chapterText) {
  setLoading(true, 'Generating examples…');
  try {
    const data = await API.post('/api/example', {
      topicId: topic.id,
      topicTitle: topic.title,
      chapterText: chapterText || state.session.chapterText || null,
    });
    state.session.exampleContent = data;
  } catch (err) {
    toast('Failed to generate examples: ' + err.message);
  } finally {
    setLoading(false);
    refreshSessionMain();
  }
}

async function startQuizPhase(topic, chapterText, isReview) {
  setLoading(true, isReview ? 'Generating review quiz…' : 'Generating quiz…');
  try {
    const reviewEntry = state.srsReviewEntry;
    const data = await API.post('/api/quiz/generate', {
      topicId: topic.id,
      topicTitle: topic.title,
      chapterText: chapterText || state.session.chapterText || null,
      reviewMode: isReview || false,
      weakSpots: isReview ? (reviewEntry?.weak_spots || []) : undefined,
      outline: state.session.outline || undefined,
    });
    state.session.quiz = data;
  } catch (err) {
    toast('Failed to generate quiz: ' + err.message);
  } finally {
    setLoading(false);
    refreshSessionMain();
    attachQuizAutoSave();
  }
}

async function advancePhase() {
  if (state.phase === 'learn') {
    state.phase = 'example';
    refreshSessionMain();
    await startExamplePhase(state.currentTopic);
  } else if (state.phase === 'example') {
    state.phase = 'quiz';
    refreshSessionMain();
    await startQuizPhase(state.currentTopic, null, false);
  }
}

async function handleQuizSubmit(e) {
  e.preventDefault();
  const quiz = state.session.quiz;
  const answers = {};

  quiz.questions.forEach(q => {
    if (q.type === 'multiple_choice') {
      const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
      answers[q.id] = sel ? parseInt(sel.value, 10) : undefined;
    } else if (q.type === 'short_answer') {
      const ta = document.querySelector(`textarea[name="q${q.id}"]`);
      answers[q.id] = ta ? ta.value.trim() : '';
    } else if (q.type === 'fill_in_blank') {
      const inputs = document.querySelectorAll(`.fib-input[data-qid="${q.id}"]`);
      const cells = {};
      inputs.forEach(inp => { cells[inp.dataset.label] = inp.value.trim(); });
      answers[q.id] = cells;
    }
  });

  const missing = quiz.questions.filter(q => {
    if (q.type === 'multiple_choice') return answers[q.id] === undefined;
    if (q.type === 'short_answer') return !answers[q.id];
    return false;
  });

  if (missing.length && !confirm(`${missing.length} question(s) unanswered. Submit anyway?`)) return;

  state.session.answers = answers;
  state.phase = 'results';
  refreshSessionMain();

  let elapsed = 0;
  setLoading(true, 'Grading written answers… (0s)');
  const timer = setInterval(() => {
    elapsed += 1;
    setLoading(true, `Grading written answers… (${elapsed}s)`);
  }, 1000);

  try {
    const results = await API.post('/api/quiz/grade', {
      topicId: state.currentTopic.id,
      topicTitle: state.currentTopic.title,
      quiz: state.session.quiz,
      answers,
      sessionId: state.currentSession?.session?.id || null,
      chapterId: state.currentSession?.chapter?.id || null,
    });
    state.session.gradingResults = results;

    // If this was an SRS review, update the schedule
    if (state.srsReviewEntry) {
      try {
        const updated = await API.patch(`/api/srs/${state.srsReviewEntry.session_id}`, { score: results.totalScore });
        // Remove from due list
        state.srsSchedule = state.srsSchedule.filter(e => e.session_id !== state.srsReviewEntry.session_id);
        state.srsReviewEntry = null;
      } catch (srsErr) {
        console.warn('SRS update failed:', srsErr.message);
      }
    }

    state.progress = await API.get('/api/progress');
  } catch (err) {
    toast('Failed to grade quiz: ' + err.message);
  } finally {
    clearInterval(timer);
    setLoading(false);
    refreshSessionMain();
  }
}

// ─── SRS Review ───────────────────────────────────────────────────────────────

async function startSRSReview(entry) {
  // Locate the session definition in curricula
  let chapter = null, sessionDef = null, curriculum = null;
  outer: for (const curr of state.curricula) {
    for (const ch of (curr.chapters || [])) {
      const s = (ch.sessions || []).find(s => s.id === entry.session_id);
      if (s) { chapter = ch; sessionDef = s; curriculum = curr; break outer; }
    }
  }
  if (!sessionDef) { toast('Could not find session for review.'); return; }

  state.srsReviewEntry = entry;
  state.currentSession = { chapter, session: sessionDef, curriculum };
  state.currentTopic = { id: sessionDef.id, title: sessionDef.title };
  state.phase = 'quiz';
  state.session = { learnContent: null, exampleContent: null, quiz: null, answers: {}, gradingResults: null, difficultyRating: null, coreConceptsFound: [], chapterText: null, outline: null };
  state.view = 'session';
  render();
  await startQuizPhase(state.currentTopic, null, true);
}

// ─── ─── ─── SANDBOX VIEW ─── ─── ───

const SANDBOX_TEMPLATES = [
  { id: 'is',  label: 'Income Statement', difficulty: 'Beginner' },
  { id: 'bs',  label: 'Balance Sheet',    difficulty: 'Intermediate' },
  { id: 'cf',  label: 'Cash Flow',        difficulty: 'Advanced' },
  { id: 'dcf', label: 'DCF Model',        difficulty: 'Advanced' },
];

const SANDBOX_FIELDS = {
  is: {
    given:  [
      { key: 'revenue',           label: 'Revenue',                    value: 500 },
      { key: 'cogs',              label: 'Cost of Goods Sold (COGS)',   value: 300 },
      { key: 'da',                label: 'D&A',                        value: 40 },
      { key: 'interest_expense',  label: 'Interest Expense',           value: 15 },
      { key: 'tax_rate_pct',      label: 'Tax Rate (%)',               value: 25 },
    ],
    blank: [
      { key: 'gross_profit',      label: 'Gross Profit' },
      { key: 'ebitda',            label: 'EBITDA' },
      { key: 'ebit',              label: 'EBIT' },
      { key: 'ebt',               label: 'EBT' },
      { key: 'tax',               label: 'Tax' },
      { key: 'net_income',        label: 'Net Income' },
      { key: 'gross_margin_pct',  label: 'Gross Margin (%)' },
      { key: 'ebitda_margin_pct', label: 'EBITDA Margin (%)' },
      { key: 'net_margin_pct',    label: 'Net Margin (%)' },
    ],
  },
  bs: {
    given: [
      { key: 'cash',               label: 'Cash',                value: 50 },
      { key: 'ar',                 label: 'Accounts Receivable', value: 80 },
      { key: 'inventory',          label: 'Inventory',           value: 120 },
      { key: 'ppe_net',            label: 'PP&E (Net)',          value: 400 },
      { key: 'intangibles',        label: 'Intangibles',         value: 100 },
      { key: 'ap',                 label: 'Accounts Payable',    value: 90 },
      { key: 'st_debt',            label: 'Short-Term Debt',     value: 60 },
      { key: 'lt_debt',            label: 'Long-Term Debt',      value: 200 },
      { key: 'common_stock',       label: 'Common Stock',        value: 150 },
      { key: 'retained_earnings',  label: 'Retained Earnings',   value: 250 },
    ],
    blank: [
      { key: 'total_current_assets',     label: 'Total Current Assets' },
      { key: 'total_noncurrent_assets',  label: 'Total Non-Current Assets' },
      { key: 'total_assets',             label: 'Total Assets' },
      { key: 'total_current_liabilities',label: 'Total Current Liabilities' },
      { key: 'total_equity',             label: 'Total Equity' },
      { key: 'total_liabilities_equity', label: 'Total Liabilities + Equity' },
      { key: 'working_capital',          label: 'Working Capital' },
      { key: 'current_ratio',            label: 'Current Ratio' },
      { key: 'debt_equity_ratio',        label: 'Debt/Equity Ratio' },
    ],
  },
  cf: {
    given: [
      { key: 'net_income',          label: 'Net Income',              value: 120 },
      { key: 'da',                  label: 'Add: D&A',                value: 40 },
      { key: 'delta_ar_raw',        label: 'ΔAccounts Receivable',    value: '+20 (increase)' },
      { key: 'delta_inventory_raw', label: 'ΔInventory',              value: '+10 (increase)' },
      { key: 'delta_ap_raw',        label: 'ΔAccounts Payable',       value: '+15 (increase)' },
      { key: 'capex',               label: 'CapEx',                   value: 80 },
      { key: 'debt_issued',         label: 'Debt Issued',             value: 30 },
      { key: 'dividends_paid',      label: 'Dividends Paid',          value: 50 },
      { key: 'beginning_cash',      label: 'Beginning Cash',          value: 50 },
    ],
    blank: [
      { key: 'delta_ar',       label: 'ΔAR (cash effect)' },
      { key: 'delta_inventory',label: 'ΔInventory (cash effect)' },
      { key: 'delta_ap',       label: 'ΔAP (cash effect)' },
      { key: 'cfo',            label: 'Cash from Operations (CFO)' },
      { key: 'cfi',            label: 'Cash from Investing (CFI)' },
      { key: 'cff',            label: 'Cash from Financing (CFF)' },
      { key: 'net_change',     label: 'Net Change in Cash' },
      { key: 'ending_cash',    label: 'Ending Cash' },
    ],
  },
  dcf: {
    given: [
      { key: 'revenue_1', label: 'Revenue Y1', value: 100 },
      { key: 'revenue_2', label: 'Revenue Y2', value: 110 },
      { key: 'revenue_3', label: 'Revenue Y3', value: 121 },
      { key: 'revenue_4', label: 'Revenue Y4', value: 133 },
      { key: 'revenue_5', label: 'Revenue Y5', value: 146 },
      { key: 'ebitda_margin_pct', label: 'EBITDA Margin (%)', value: 40 },
      { key: 'da',     label: 'D&A (all years)', value: 10 },
      { key: 'capex',  label: 'CapEx (all years)', value: 15 },
      { key: 'dnwc_1', label: 'ΔNWC Y1', value: 2 },
      { key: 'dnwc_2', label: 'ΔNWC Y2', value: 2 },
      { key: 'dnwc_3', label: 'ΔNWC Y3', value: 3 },
      { key: 'dnwc_4', label: 'ΔNWC Y4', value: 3 },
      { key: 'dnwc_5', label: 'ΔNWC Y5', value: 3 },
      { key: 'tax_rate_pct', label: 'Tax Rate (%)', value: 25 },
      { key: 'wacc_pct',     label: 'WACC (%)',     value: 10 },
      { key: 'tgr_pct',      label: 'Terminal Growth Rate (%)', value: 2.5 },
    ],
    blank: [
      { key: 'ebitda_1', label: 'EBITDA Y1' }, { key: 'ebit_1', label: 'EBIT Y1' },
      { key: 'nopat_1',  label: 'NOPAT Y1' },  { key: 'fcff_1', label: 'FCFF Y1' },
      { key: 'pv_fcff_1',label: 'PV(FCFF) Y1' },
      { key: 'ebitda_2', label: 'EBITDA Y2' }, { key: 'ebit_2', label: 'EBIT Y2' },
      { key: 'nopat_2',  label: 'NOPAT Y2' },  { key: 'fcff_2', label: 'FCFF Y2' },
      { key: 'pv_fcff_2',label: 'PV(FCFF) Y2' },
      { key: 'ebitda_3', label: 'EBITDA Y3' }, { key: 'ebit_3', label: 'EBIT Y3' },
      { key: 'nopat_3',  label: 'NOPAT Y3' },  { key: 'fcff_3', label: 'FCFF Y3' },
      { key: 'pv_fcff_3',label: 'PV(FCFF) Y3' },
      { key: 'ebitda_4', label: 'EBITDA Y4' }, { key: 'ebit_4', label: 'EBIT Y4' },
      { key: 'nopat_4',  label: 'NOPAT Y4' },  { key: 'fcff_4', label: 'FCFF Y4' },
      { key: 'pv_fcff_4',label: 'PV(FCFF) Y4' },
      { key: 'ebitda_5', label: 'EBITDA Y5' }, { key: 'ebit_5', label: 'EBIT Y5' },
      { key: 'nopat_5',  label: 'NOPAT Y5' },  { key: 'fcff_5', label: 'FCFF Y5' },
      { key: 'pv_fcff_5',label: 'PV(FCFF) Y5' },
      { key: 'sum_pv_fcf',        label: 'Sum PV(FCF)' },
      { key: 'terminal_value',    label: 'Terminal Value' },
      { key: 'pv_tv',             label: 'PV(Terminal Value)' },
      { key: 'enterprise_value',  label: 'Enterprise Value' },
      { key: 'ev_ebitda_multiple',label: 'EV/EBITDA Multiple' },
    ],
  },
};

// Track per-cell fail counts for "Show Answer" gating
const sandboxFailCounts = {};

function getSandboxActiveId() {
  return localStorage.getItem('sandbox_active') || 'is';
}

function setSandboxActiveId(id) {
  localStorage.setItem('sandbox_active', id);
}

function getSandboxCompleted() {
  try { return JSON.parse(localStorage.getItem('sandbox_completed') || '[]'); } catch { return []; }
}

function setSandboxCompleted(ids) {
  localStorage.setItem('sandbox_completed', JSON.stringify(ids));
}

function buildSandbox() {
  const activeId = getSandboxActiveId();
  const completed = getSandboxCompleted();
  const tmpl = SANDBOX_TEMPLATES.find(t => t.id === activeId) || SANDBOX_TEMPLATES[0];
  const fields = SANDBOX_FIELDS[activeId];

  const tabsHTML = SANDBOX_TEMPLATES.map(t => {
    const isDone = completed.includes(t.id);
    return `<button class="sandbox-tab ${t.id === activeId ? 'active' : ''}" data-sandbox-tab="${t.id}">
      ${t.label}
      <span class="sandbox-tab-badge ${t.difficulty.toLowerCase()}">${t.difficulty}</span>
      ${isDone ? '<span class="sandbox-done-mark">✓</span>' : ''}
    </button>`;
  }).join('');

  const givenRowsHTML = fields.given.map(f => `
    <tr class="sandbox-given-row">
      <td class="sandbox-label">${f.label}</td>
      <td class="sandbox-value given">${f.value}</td>
    </tr>`).join('');

  const blankRowsHTML = fields.blank.map(f => `
    <tr class="sandbox-blank-row">
      <td class="sandbox-label">${f.label}</td>
      <td class="sandbox-value">
        <input type="text" class="sandbox-input" data-template="${activeId}" data-key="${f.key}"
          placeholder="?" autocomplete="off" />
      </td>
    </tr>`).join('');

  return `
${buildNav('sandbox')}
<div class="sandbox-view">
  <main class="sandbox-main">
    <div class="section-header" style="margin-bottom:16px">
      <div>
        <div class="page-title">Modelling Sandbox</div>
        <div class="page-subtitle">Client-side practice — no AI involved. Answers validated to ±0.5%.</div>
      </div>
    </div>

    <div class="sandbox-tabs">${tabsHTML}</div>

    <div class="sandbox-panel">
      <div class="sandbox-panel-header">
        <div>
          <div class="sandbox-panel-title">${tmpl.label}</div>
          <div class="sandbox-panel-subtitle">All figures in €M unless stated</div>
        </div>
        <div class="sandbox-actions">
          <button class="btn btn-ghost btn-sm" id="sandbox-reset">Reset</button>
          <button class="btn btn-ghost btn-sm" id="sandbox-check-all">Check All</button>
        </div>
      </div>

      <div class="sandbox-table-wrap">
        <table class="sandbox-table">
          <thead>
            <tr>
              <th>Line Item</th>
              <th>Value (€M)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="2" class="sandbox-section-divider">Given</td></tr>
            ${givenRowsHTML}
            <tr><td colspan="2" class="sandbox-section-divider">Calculate</td></tr>
            ${blankRowsHTML}
          </tbody>
        </table>
      </div>
    </div>
  </main>
</div>`;
}

function attachSandboxListeners() {
  attachNavListeners();

  // Tab switching
  document.querySelectorAll('[data-sandbox-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      setSandboxActiveId(btn.dataset.sandboxTab);
      render();
    });
  });

  // Per-cell blur validation
  document.querySelectorAll('.sandbox-input').forEach(input => {
    input.addEventListener('blur', () => validateSandboxCell(input));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validateSandboxCell(input); } });
  });

  // Check All
  document.getElementById('sandbox-check-all')?.addEventListener('click', () => {
    document.querySelectorAll('.sandbox-input').forEach(input => validateSandboxCell(input, true));
    checkSandboxCompletion();
  });

  // Reset
  document.getElementById('sandbox-reset')?.addEventListener('click', () => {
    document.querySelectorAll('.sandbox-input').forEach(input => {
      input.value = '';
      input.className = 'sandbox-input';
    });
    // Clear fail counts for this template
    const activeId = getSandboxActiveId();
    Object.keys(sandboxFailCounts).forEach(k => { if (k.startsWith(activeId + ':')) delete sandboxFailCounts[k]; });
    // Remove show-answer buttons
    document.querySelectorAll('.sandbox-show-answer').forEach(el => el.remove());
  });
}

function validateSandboxCell(input, isBulk) {
  const { template, key } = input.dataset;
  const value = input.value.trim();
  if (!value && !isBulk) return;

  const result = SandboxModule.checkCell(template, key, value);
  const failKey = `${template}:${key}`;

  if (result === true) {
    input.className = 'sandbox-input correct';
    delete sandboxFailCounts[failKey];
    removeShowAnswerBtn(input);
  } else if (result === false) {
    input.className = 'sandbox-input incorrect';
    sandboxFailCounts[failKey] = (sandboxFailCounts[failKey] || 0) + 1;
    if (sandboxFailCounts[failKey] >= 2) addShowAnswerBtn(input, template, key);
  }
}

function addShowAnswerBtn(input, template, key) {
  const td = input.parentElement;
  if (td.querySelector('.sandbox-show-answer')) return;
  const btn = document.createElement('button');
  btn.className = 'sandbox-show-answer btn btn-ghost btn-sm';
  btn.textContent = 'Show Answer';
  btn.addEventListener('click', () => {
    const answer = SandboxModule.TEMPLATE_ANSWERS[template]?.[key];
    if (answer !== undefined) {
      input.value = answer;
      input.className = 'sandbox-input revealed';
      btn.remove();
    }
  });
  td.appendChild(btn);
}

function removeShowAnswerBtn(input) {
  const btn = input.parentElement?.querySelector('.sandbox-show-answer');
  if (btn) btn.remove();
}

function checkSandboxCompletion() {
  const activeId = getSandboxActiveId();
  const inputs = document.querySelectorAll('.sandbox-input');
  const allCorrect = [...inputs].every(i => i.classList.contains('correct') || i.classList.contains('revealed'));
  if (allCorrect && inputs.length > 0) {
    const completed = getSandboxCompleted();
    if (!completed.includes(activeId)) {
      setSandboxCompleted([...completed, activeId]);
      toast(`${SANDBOX_TEMPLATES.find(t => t.id === activeId)?.label} complete! ✓`, 'success');
    }
  }
}

// ─── ─── ─── SETTINGS VIEW ─── ─── ───

function buildSettings() {
  const config = state.config || {};
  const supabaseEnabled = !!config.supabaseEnabled;

  function uploadCard({ curriculumId, title, subtitle, statusId, isUploaded }) {
    return `
    <div class="content-card" style="max-width:600px;margin-bottom:16px">
      <h3 style="margin:0 0 4px">${title}</h3>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">${subtitle}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <label class="btn btn-ghost" style="cursor:pointer;margin:0">
          Choose PDF
          <input type="file" accept="application/pdf,.pdf"
            data-upload-curriculum="${curriculumId}"
            style="display:none" />
        </label>
        <span id="${statusId}-filename" style="font-size:13px;color:var(--text-muted);font-family:var(--font-mono)">
          ${isUploaded ? 'PDF uploaded ✓' : 'No file chosen'}
        </span>
      </div>
      <div id="${statusId}" style="margin-top:10px">
        ${isUploaded
          ? `<div style="font-size:12px;color:var(--green)">Uploaded to cloud storage. Sessions will extract pages automatically.</div>`
          : `<div style="font-size:12px;color:var(--text-muted)">No PDF uploaded — sessions will rely on Claude's built-in knowledge.</div>`}
      </div>
    </div>`;
  }

  function pathCard({ id, title, subtitle, value, placeholder, statusId }) {
    const set = !!value;
    return `
    <div class="content-card" style="max-width:600px;margin-bottom:16px">
      <h3 style="margin:0 0 4px">${title}</h3>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">${subtitle}</p>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input type="text" id="${id}" class="text-input"
          style="flex:1;font-family:var(--font-mono);font-size:13px"
          value="${value}" placeholder="${placeholder}" />
        <button class="btn btn-primary" data-save-pdf="${id}">Save</button>
      </div>
      <div id="${statusId}" style="margin-top:8px;font-size:12px;color:var(--text-muted)">
        ${set ? 'PDF path is set. Sessions will extract pages automatically.' : "No PDF path set \u2014 sessions will rely on Claude's built-in knowledge."}
      </div>
    </div>`;
  }

  const harrisonUploaded = !!(config.harrisonStoragePath);
  const brealeyUploaded  = !!(config.brealeyStoragePath);

  return `
${buildNav('settings')}
<div class="textbooks-view">
  <main class="textbooks-main">
    <div class="section-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">${supabaseEnabled ? 'Upload textbook PDFs to cloud storage' : 'Configure textbook PDF paths for in-context study sessions'}</div>
      </div>
    </div>

    ${supabaseEnabled
      ? uploadCard({
          curriculumId: 'harrison',
          title: 'Harrison — Financial Accounting PDF',
          subtitle: 'Used for Harrison curriculum sessions (ch01-s01, ch02-s01, …)',
          statusId: 'pdf-upload-status',
          isUploaded: harrisonUploaded,
        })
      : pathCard({
          id: 'pdf-path-input',
          title: 'Harrison — Financial Accounting PDF',
          subtitle: 'Used for Harrison curriculum sessions (ch01-s01, ch02-s01, …)',
          value: config.pdfPath || '',
          placeholder: '/Users/yourname/Documents/harrison-financial-accounting.pdf',
          statusId: 'pdf-path-status',
        })}

    ${supabaseEnabled
      ? uploadCard({
          curriculumId: 'bm',
          title: 'Brealey &amp; Myers — Principles of Corporate Finance PDF',
          subtitle: 'Used for Brealey curriculum sessions (bm01-s01, bm02-s01, …)',
          statusId: 'brealey-upload-status',
          isUploaded: brealeyUploaded,
        })
      : pathCard({
          id: 'brealey-path-input',
          title: 'Brealey &amp; Myers — Principles of Corporate Finance PDF',
          subtitle: 'Used for Brealey curriculum sessions (bm01-s01, bm02-s01, …)',
          value: config.brealeyPdfPath || '',
          placeholder: '/Users/yourname/Documents/brealey-principles-corporate-finance.pdf',
          statusId: 'brealey-path-status',
        })}

  </main>
</div>`;
}

function attachSettingsListeners() {
  attachNavListeners();

  // ── Cloud upload (Supabase mode) ──────────────────────────────────────────
  document.querySelectorAll('[data-upload-curriculum]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;

      const curriculumId = input.dataset.uploadCurriculum;
      const isBrealey = curriculumId && curriculumId.startsWith('bm');
      const statusId   = isBrealey ? 'brealey-upload-status' : 'pdf-upload-status';
      const filenameId = statusId + '-filename';
      const statusEl   = document.getElementById(statusId);
      const nameEl     = document.getElementById(filenameId);

      if (nameEl) nameEl.textContent = file.name;
      if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted)">Uploading… <span id="${statusId}-pct">0%</span></div>`;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('curriculumId', curriculumId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-pdf');

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          const pctEl = document.getElementById(`${statusId}-pct`);
          if (pctEl) pctEl.textContent = pct + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const storageKey = isBrealey ? 'brealeyStoragePath' : 'harrisonStoragePath';
          state.config = { ...state.config, [storageKey]: `pdfs/${isBrealey ? 'brealey' : 'harrison'}.pdf` };
          if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--green)">Uploaded to cloud storage. Sessions will extract pages automatically.</div>`;
        } else {
          let msg = 'Upload failed.';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--red)">${msg}</div>`;
        }
        input.value = '';
      });

      xhr.addEventListener('error', () => {
        if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--red)">Network error during upload.</div>`;
        input.value = '';
      });

      xhr.send(formData);
    });
  });

  // ── Local path save (non-Supabase mode) ──────────────────────────────────
  document.querySelectorAll('[data-save-pdf]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const inputId   = btn.dataset.savePdf;
      const configKey = inputId === 'brealey-path-input' ? 'brealeyPdfPath' : 'pdfPath';
      const statusId  = inputId === 'brealey-path-input' ? 'brealey-path-status' : 'pdf-path-status';
      const value     = document.getElementById(inputId)?.value.trim() || '';
      const statusEl  = document.getElementById(statusId);
      try {
        await API.post('/api/config', { [configKey]: value });
        state.config = { ...state.config, [configKey]: value };
        if (statusEl) {
          statusEl.textContent = value ? 'Saved. Sessions will extract pages automatically.' : "Cleared. Sessions will rely on Claude's built-in knowledge.";
          statusEl.style.color = 'var(--green)';
        }
      } catch (err) {
        if (statusEl) { statusEl.textContent = 'Save failed: ' + err.message; statusEl.style.color = 'var(--red)'; }
      }
    });
  });
}
// ─── ─── ─── LIBRARY VIEW ─── ─── ───

function buildLibrary() {
  const entries = state.library?.entries || [];
  const lq = state.libraryQuiz;

  if (lq.questions && !lq.results) {
    return buildLibraryQuizInProgress();
  }
  if (lq.results) {
    return buildLibraryQuizResults();
  }

  // Group entries by source
  const grouped = {};
  entries.forEach(e => {
    const src = e.source || 'General';
    if (!grouped[src]) grouped[src] = [];
    grouped[src].push(e);
  });

  return `
${buildNav('library')}
<div class="library-view">
  <main class="library-main">
    <div class="library-header-row">
      <div>
        <div class="page-title">Concepts Library</div>
        <div class="page-subtitle">${entries.length} concept${entries.length !== 1 ? 's' : ''} · Auto-saved from lessons</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="library-search-bar">
          <input type="text" class="library-search-input" id="library-search"
            placeholder="Search concepts…" />
        </div>
        <button class="btn btn-ghost btn-sm" id="add-term-btn">Add Term +</button>
        ${entries.length >= 3 ? `
          <button class="btn btn-primary btn-sm" id="library-quiz-btn">Library Quiz</button>` : ''}
      </div>
    </div>

    <div id="add-term-form" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:12px">Add Term</div>
      <input id="add-term-concept" class="form-input" placeholder="Term / Concept" style="margin-bottom:8px;width:100%;box-sizing:border-box" />
      <textarea id="add-term-definition" class="form-input" placeholder="Definition" rows="2" style="margin-bottom:8px;width:100%;box-sizing:border-box;resize:vertical"></textarea>
      <input id="add-term-source" class="form-input" placeholder="Source (optional)" style="margin-bottom:12px;width:100%;box-sizing:border-box" />
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="add-term-save">Save</button>
        <button class="btn btn-ghost btn-sm" id="add-term-cancel">Cancel</button>
      </div>
    </div>

    <div id="library-entries">
      ${entries.length === 0
        ? `<div class="library-empty">
             <div class="library-empty-icon">◈</div>
             <div class="library-empty-text">Library is empty</div>
             <div class="library-empty-sub">Complete a Learn session to start building your library. Concepts tagged with [[CORE: ...]] appear here automatically.</div>
           </div>`
        : Object.entries(grouped).map(([src, srcEntries]) => `
            <div class="library-group">
              <div class="library-group-label">${src}</div>
              ${srcEntries.map(buildLibraryEntry).join('')}
            </div>`).join('')}
    </div>
  </main>
</div>`;
}

function buildLibraryEntry(entry) {
  const icon = entry.is_manual ? '✏️' : entry.concept.slice(0, 2).toUpperCase();
  return `
<div class="library-entry" data-entry-id="${entry.id}">
  <div class="library-entry-icon">${icon}</div>
  <div class="library-entry-body">
    <div class="library-entry-concept">${entry.concept}</div>
    <div class="library-entry-definition">${entry.definition}</div>
    <div class="library-entry-source">${entry.source || ''} · ${formatDate(entry.dateAdded)}</div>
  </div>
  <button class="library-entry-delete btn-ghost" data-delete-id="${entry.id}" title="Delete entry" style="margin-left:auto;padding:4px 8px;cursor:pointer;border:none;background:none;color:var(--text-muted);font-size:16px">×</button>
</div>`;
}

function buildLibraryQuizInProgress() {
  const lq = state.libraryQuiz;
  const q = lq.questions[lq.currentIdx];
  const total = lq.questions.length;
  const current = lq.currentIdx + 1;

  return `
${buildNav('library')}
<div class="library-view">
  <main class="library-main">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="page-title">Library Quiz</div>
      <div style="font-size:13px;color:var(--text-muted)">Question ${current} / ${total}</div>
    </div>
    <div class="progress-bar-track" style="margin-bottom:24px">
      <div class="progress-bar-fill" style="width:${(current/total)*100}%"></div>
    </div>
    <div class="library-quiz-panel">
      <div class="library-quiz-q">${q.question}</div>
      <div class="mc-options">
        ${q.options.map((opt, i) => `
          <label class="mc-option">
            <input type="radio" name="lq" value="${i}" ${lq.userAnswers[lq.currentIdx] === i ? 'checked' : ''}>
            <span class="mc-option-letter">${String.fromCharCode(65 + i)}</span>
            <span class="mc-option-text">${opt}</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="phase-nav" style="margin-top:16px">
      <button class="btn btn-primary btn-lg" id="lq-next-btn">
        ${current < total ? 'Next Question →' : 'See Results →'}
      </button>
    </div>
  </main>
</div>`;
}

function buildLibraryQuizResults() {
  const lq = state.libraryQuiz;
  const correct = lq.questions.filter((q, i) => lq.userAnswers[i] === q.correct_index).length;
  const total = lq.questions.length;
  const pct = Math.round((correct / total) * 100);

  return `
${buildNav('library')}
<div class="library-view">
  <main class="library-main">
    <div class="page-title" style="margin-bottom:24px">Library Quiz — Results</div>
    <div class="library-quiz-panel">
      <div class="library-quiz-score">
        ${pct}%
        <span class="library-quiz-score-label">${correct} of ${total} correct</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        ${lq.questions.map((q, i) => {
          const ua = lq.userAnswers[i];
          const correct = ua === q.correct_index;
          return `
            <div>
              <div style="font-size:14px;font-weight:500;margin-bottom:6px">${q.question}</div>
              <div class="library-quiz-result ${correct ? 'correct' : 'wrong'}">
                ${correct ? '✓' : '✗'}
                ${ua !== undefined ? q.options[ua] : '(skipped)'}
                ${!correct ? ` — Correct: ${q.options[q.correct_index]}` : ''}
              </div>
              ${q.explanation ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;padding-left:4px">${q.explanation}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>
    <div class="phase-nav" style="margin-top:16px">
      <button class="btn btn-primary btn-lg" id="lq-back-btn">Back to Library</button>
    </div>
  </main>
</div>`;
}

function attachLibraryListeners() {
  attachNavListeners();

  // Search
  const searchInput = document.getElementById('library-search');
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    document.querySelectorAll('.library-entry').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
    document.querySelectorAll('.library-group').forEach(grp => {
      const anyVisible = [...grp.querySelectorAll('.library-entry')].some(e => e.style.display !== 'none');
      grp.style.display = anyVisible ? '' : 'none';
    });
  });

  // Add Term — toggle form
  document.getElementById('add-term-btn')?.addEventListener('click', () => {
    const form = document.getElementById('add-term-form');
    if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('add-term-cancel')?.addEventListener('click', () => {
    document.getElementById('add-term-form').style.display = 'none';
  });

  document.getElementById('add-term-save')?.addEventListener('click', async () => {
    const concept = document.getElementById('add-term-concept')?.value.trim();
    const definition = document.getElementById('add-term-definition')?.value.trim();
    const source = document.getElementById('add-term-source')?.value.trim() || 'Manual';
    if (!concept || !definition) { toast('Term and definition are required.'); return; }
    try {
      const entry = await API.post('/api/library', { concept, definition, source, is_manual: true });
      if (!state.library) state.library = { entries: [] };
      state.library.entries = [...(state.library.entries || []), entry];
      render();
    } catch (e) {
      toast('Failed to save term: ' + e.message);
    }
  });

  // Delete entry
  document.querySelectorAll('.library-entry-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      if (!confirm('Delete this entry?')) return;
      try {
        await API.delete(`/api/library/${id}`);
        state.library.entries = (state.library.entries || []).filter(e => e.id !== id);
        render();
      } catch (err) {
        toast('Delete failed: ' + err.message);
      }
    });
  });

  // Library Quiz — start
  document.getElementById('library-quiz-btn')?.addEventListener('click', async () => {
    const entries = state.library?.entries || [];
    if (entries.length < 3) { toast('Need at least 3 library entries to generate a quiz.'); return; }
    setLoading(true, 'Generating library quiz…');
    try {
      const data = await API.post('/api/library/quiz', { entries });
      state.libraryQuiz = { questions: data.questions, userAnswers: {}, results: null, currentIdx: 0 };
      render();
    } catch (err) {
      toast('Failed to generate quiz: ' + err.message);
    } finally {
      setLoading(false);
    }
  });

  // Library Quiz — next question
  document.getElementById('lq-next-btn')?.addEventListener('click', () => {
    const lq = state.libraryQuiz;
    const sel = document.querySelector('input[name="lq"]:checked');
    if (sel) lq.userAnswers[lq.currentIdx] = parseInt(sel.value, 10);

    if (lq.currentIdx < lq.questions.length - 1) {
      lq.currentIdx += 1;
      render();
    } else {
      lq.results = true;
      render();
    }
  });

  // Library Quiz — back to library
  document.getElementById('lq-back-btn')?.addEventListener('click', () => {
    state.libraryQuiz = { questions: null, userAnswers: {}, results: null, currentIdx: 0 };
    render();
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
