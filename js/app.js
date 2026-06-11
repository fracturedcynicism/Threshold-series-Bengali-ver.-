/* ═══════════════════════════════════════════════
   FC READER — APP.JS
   Zero-config reader. Driven by data/books.json
   (a plain list of .txt filenames). All metadata
   — title, chapters, word count — auto-extracted
   from the .txt files themselves.
   ═══════════════════════════════════════════════ */

'use strict';

const State = {
  books: [],          // populated after scanning books.json + reading each file header
  currentBookIndex: -1,
  currentChapters: [],
  scrollPositions: {},
};

const DOM = {};

// ── INIT ──────────────────────────────────────────
async function init() {
  cacheDOMRefs();
  setupFontControls();
  setupMobileControls();
  setupNavButtons();
  setupScrollTracking();
  document.body.classList.add('font-md');

  try {
    // books.json is just an array of filenames e.g. ["book-one.txt","book-two.txt"]
    const filenames = await fetchJSON('data/books.json');
    if (!Array.isArray(filenames) || filenames.length === 0) {
      throw new Error('books.json is empty or not an array.');
    }

    // Read the first ~40 lines of each file to extract metadata
    State.books = await Promise.all(
      filenames.map((fname, i) => extractBookMeta(fname, i))
    );

    applySeriesBranding();
    renderBookNav();
    buildWelcomeScreen();
    showWelcome();
  } catch (e) {
    console.error('Reader init failed:', e);
    showError('Initialisation failed. Check that data/books.json exists and lists your .txt files.');
  }
}

// ── META EXTRACTION FROM .TXT ─────────────────────
/*
  Reads the first 40 lines of a .txt file to extract:
  - TITLE: line (first non-empty line, or line starting with TITLE:)
  - AUTHOR: line
  - SUBTITLE: line
  - SETTING: line
  - TAGLINE: line
  - SYNOPSIS: line(s) — everything after a SYNOPSIS: marker until a blank line

  If none of these markers exist, the filename is used as the title.

  Example header format (optional — all fields are optional):
  ════════════════════════════
  TITLE: Injury Time
  AUTHOR: Fractured Cynicism
  SUBTITLE: Being the first night of Bikram Dey
  SETTING: Salt City Arena, Kolkata — one night
  TAGLINE: The result stands.
  SYNOPSIS: A football match ends in a city-wide chase after Bikram makes three controversial calls.
  ════════════════════════════
*/
async function extractBookMeta(filename, index) {
  const path = `books/${filename}`;
  let rawText = '';

  try {
    // Fetch only enough to read the header — we'll re-fetch the full text when loading
    rawText = await fetchText(path);
  } catch (e) {
    console.warn(`Could not fetch ${path}:`, e);
    return {
      slug: slugify(filename),
      title: titleFromFilename(filename),
      subtitle: '',
      setting: '',
      tagline: '',
      synopsis: '',
      author: '',
      file: path,
      index,
    };
  }

  const lines = rawText.split('\n').slice(0, 60);
  const meta = {
    slug:     slugify(filename),
    title:    titleFromFilename(filename),
    subtitle: '',
    setting:  '',
    tagline:  '',
    synopsis: '',
    author:   '',
    file:     path,
    index,
    _raw:     rawText,   // cache so we don't re-fetch when loading
  };

  // Look for key: value header lines
  const keyRx = /^(TITLE|AUTHOR|SUBTITLE|SETTING|TAGLINE|SYNOPSIS)\s*[:：]\s*(.+)$/i;
  let inSynopsis = false;
  const synopsisLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Decorative separator lines — skip
    if (/^[═=─\-*]{4,}$/.test(trimmed)) { inSynopsis = false; continue; }

    if (inSynopsis) {
      if (trimmed === '') { inSynopsis = false; }
      else synopsisLines.push(trimmed);
      continue;
    }

    const match = trimmed.match(keyRx);
    if (match) {
      const key = match[1].toUpperCase();
      const val = match[2].trim();
      if (key === 'TITLE')    meta.title    = val;
      if (key === 'AUTHOR')   meta.author   = val;
      if (key === 'SUBTITLE') meta.subtitle = val;
      if (key === 'SETTING')  meta.setting  = val;
      if (key === 'TAGLINE')  meta.tagline  = val;
      if (key === 'SYNOPSIS') { synopsisLines.push(val); inSynopsis = true; }
    }
  }

  if (synopsisLines.length) meta.synopsis = synopsisLines.join(' ');

  return meta;
}

function titleFromFilename(filename) {
  return filename
    .replace(/\.txt$/i, '')
    .replace(/^\d+[-_]/, '')       // strip leading "01-"
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function slugify(filename) {
  return filename.replace(/\.txt$/i, '').toLowerCase().replace(/\s+/g, '-');
}

// ── BRANDING ──────────────────────────────────────
function applySeriesBranding() {
  const books = State.books;
  const isMulti = books.length > 1;

  // Derive series title: if multi-book, use shared author or a generic label
  // If all books share the same author, use that as the series author line
  const authors = [...new Set(books.map(b => b.author).filter(Boolean))];
  const seriesAuthor = authors.length === 1 ? authors[0] : authors.join(' / ');

  const seriesTitle = isMulti
    ? (seriesAuthor ? `${seriesAuthor} — Archive` : 'Reading Archive')
    : books[0].title;

  const seriesSub = isMulti
    ? `${books.length} BOOK${books.length > 1 ? 'S' : ''}${seriesAuthor ? ' / ' + seriesAuthor.toUpperCase() : ''}`
    : (books[0].author ? books[0].author.toUpperCase() : '');

  document.title = seriesTitle;

  setText('sidebarBadge',       isMulti ? 'SERIES ARCHIVE' : 'STANDALONE');
  setText('sidebarSeriesTitle', seriesTitle);
  setText('sidebarSeriesSub',   seriesSub);
  setText('mobileSeriesTitle',  isMulti ? seriesTitle : books[0].title);
  setText('mobileBadge',        isMulti ? 'SERIES ARCHIVE' : 'STANDALONE');
  setText('mobileSeriesHeader', seriesTitle);
  setText('mobileSeriesSub',    seriesSub);
  setText('topbarLocation',     seriesTitle);
  setText('welcomeEyebrow',     isMulti ? 'SERIES ARCHIVE' : (books[0].author || ''));
  setText('welcomeTitle',       isMulti ? seriesTitle : books[0].title);
  setText('welcomeTagline',     isMulti ? seriesAuthor : (books[0].tagline || ''));
  setText('welcomeSynopsis',    isMulti ? '' : (books[0].synopsis || ''));
  setText('footerTagline',      isMulti ? seriesTitle : (books[0].tagline || ''));
}

function setText(domKey, value) {
  if (DOM[domKey]) DOM[domKey].textContent = value || '';
}

// ── WELCOME SCREEN ────────────────────────────────
function buildWelcomeScreen() {
  const grid = DOM.welcomeSeriesGrid;
  if (!grid) return;

  if (State.books.length === 1) {
    grid.style.display = 'none';
    if (DOM.welcomeBeginBtn) {
      DOM.welcomeBeginBtn.textContent = `BEGIN READING`;
      DOM.welcomeBeginBtn.onclick = () => loadBook(0);
    }
    return;
  }

  grid.innerHTML = State.books.map((book, i) => `
    <div class="welcome-book-row" onclick="loadBook(${i})">
      <div class="wb-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="wb-info">
        <div class="wb-title">${escapeHtml(book.title)}</div>
        ${book.subtitle ? `<div class="wb-sub">${escapeHtml(book.subtitle)}</div>` : ''}
        ${book.synopsis  ? `<div class="wb-synopsis">${escapeHtml(book.synopsis)}</div>` : ''}
      </div>
      <div class="wb-arrow">→</div>
    </div>
  `).join('');

  if (DOM.welcomeBeginBtn) {
    DOM.welcomeBeginBtn.textContent = 'BEGIN READING — BOOK ONE';
    DOM.welcomeBeginBtn.onclick = () => loadBook(0);
  }
}

// ── BOOK NAV ──────────────────────────────────────
function renderBookNav() {
  const html = State.books.map((book, i) => `
    <div class="book-nav-item" data-book-index="${i}" onclick="loadBook(${i})">
      <div class="book-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="book-nav-content">
        <div class="book-nav-title">${escapeHtml(book.title)}</div>
        ${book.subtitle ? `<div class="book-nav-sub">${escapeHtml(book.subtitle)}</div>` : ''}
      </div>
    </div>
  `).join('');

  if (DOM.bookNavList)       DOM.bookNavList.innerHTML = html;
  if (DOM.mobileBookNavList) {
    DOM.mobileBookNavList.innerHTML = html;
    DOM.mobileBookNavList.querySelectorAll('.book-nav-item').forEach(el => {
      el.onclick = () => loadBook(parseInt(el.dataset.bookIndex));
    });
  }
}

function updateBookNavActive(index) {
  document.querySelectorAll('.book-nav-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

// ── LOAD BOOK ─────────────────────────────────────
async function loadBook(index) {
  if (index < 0 || index >= State.books.length) return;
  if (index === State.currentBookIndex) return;

  if (State.currentBookIndex >= 0 && DOM.readerPanel) {
    State.scrollPositions[State.currentBookIndex] = DOM.readerPanel.scrollTop;
  }

  const book = State.books[index];
  State.currentBookIndex = index;

  updateBookNavActive(index);
  closeMobileDrawers();
  showLoading();

  try {
    // Use cached raw text if available (from meta extraction), else fetch
    const rawText = book._raw || await fetchText(book.file);
    State.currentChapters = [];

    renderBookContent(book, rawText, index);
    renderChapterNav(State.currentChapters);
    syncMobileChapterNav();
    updateTopbarLocation(book);
    updateNavButtons();

    const savedPos = State.scrollPositions[index] || 0;
    if (DOM.readerPanel) DOM.readerPanel.scrollTop = savedPos;

    showBookContent();
    if (DOM.readerPanel) {
      DOM.readerPanel.classList.add('book-transition');
      setTimeout(() => DOM.readerPanel.classList.remove('book-transition'), 500);
    }
  } catch (e) {
    console.error('Failed to load book:', e);
    showError(`Failed to load "${book.title}". Check the file exists in books/.`);
  }
}

// ── TEXT RENDERING ────────────────────────────────
function renderBookContent(book, rawText, index) {
  const total = State.books.length;

  if (DOM.bookHeader) {
    DOM.bookHeader.innerHTML = `
      <div class="book-header-inner">
        ${total > 1 ? `<div class="book-number-label">Book ${index + 1} of ${total}</div>` : ''}
        <div class="book-main-title">${escapeHtml(book.title)}</div>
        ${book.subtitle ? `<div class="book-subtitle-line">${escapeHtml(book.subtitle)}</div>` : ''}
        ${book.author   ? `<div class="book-author-line">${escapeHtml(book.author)}</div>` : ''}
        ${book.setting  ? `<div class="book-meta-row"><div class="book-meta-item"><strong>Setting</strong>${escapeHtml(book.setting)}</div></div>` : ''}
      </div>
    `;
  }

  // Strip metadata header lines before rendering prose
  const cleanText = stripMetaHeader(rawText);
  const html = processBookText(cleanText);
  if (DOM.bookText) DOM.bookText.innerHTML = html;

  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const ert = Math.ceil(wordCount / 230);
  if (DOM.readingStatTotal) DOM.readingStatTotal.textContent = `~${ert} min`;
}

// Remove the metadata header block from the top of the file before rendering
function stripMetaHeader(rawText) {
  const lines = rawText.split('\n');
  const metaKeyRx = /^(TITLE|AUTHOR|SUBTITLE|SETTING|TAGLINE|SYNOPSIS)\s*[:：]/i;
  const separatorRx = /^[═=─\-*]{4,}$/;
  let headerEnd = 0;
  let inHeader = false;

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const t = lines[i].trim();
    if (separatorRx.test(t) || metaKeyRx.test(t)) {
      inHeader = true;
      headerEnd = i + 1;
    } else if (inHeader && t === '') {
      headerEnd = i + 1;
    } else if (inHeader && !metaKeyRx.test(t) && !separatorRx.test(t) && t !== '') {
      // First non-meta, non-separator, non-empty line after header = content starts
      break;
    }
  }

  return lines.slice(headerEnd).join('\n');
}

// ── TEXT PROCESSING ───────────────────────────────
function processBookText(rawText) {
  const lines = rawText.split('\n');
  let html = '';
  let chapterCount = 0;
  let paraBuffer = [];

  const flushPara = () => {
    const text = paraBuffer.join(' ').trim();
    if (text) html += `<p class="book-para">${escapeHtml(text)}</p>\n`;
    paraBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Chapter / Part headings ──────────────────
    // Matches: CHAPTER 1, CHAPTER ONE, Chapter 1:, PART ONE, PART 1, PART TWO, etc.
    if (isStructuralHeading(trimmed)) {
      flushPara();
      const clean = stripMarkdown(trimmed);
      const chapterId = `chapter-${++chapterCount}`;
      State.currentChapters.push({ id: chapterId, title: clean });
      html += `<span id="${chapterId}" class="chapter-anchor chapter-heading">${escapeHtml(clean)}</span>\n`;
      continue;
    }

    // ── Scene break markers ──────────────────────
    if (/^(\*{3,}|—{3,}|—\s*\*\s*—|\*\s*\*\s*\*|#{3,}|-{3,}|·{3,})$/.test(trimmed)) {
      flushPara();
      html += `<div class="scene-break">· · ·</div>\n`;
      continue;
    }

    // ── Timestamp / location lines *…* ──────────
    if (/^\*[^*]{2,}\*$/.test(trimmed) && trimmed.length < 120) {
      flushPara();
      const clean = trimmed.replace(/^\*/, '').replace(/\*$/, '').trim();
      html += `<span class="timestamp-line">${escapeHtml(clean)}</span>\n`;
      continue;
    }

    // ── Empty line = paragraph break ────────────
    if (trimmed === '') { flushPara(); continue; }

    // ── Normal prose ────────────────────────────
    paraBuffer.push(trimmed);
  }

  flushPara();
  return html;
}

function isStructuralHeading(line) {
  if (!line || line.length > 120) return false;
  // CHAPTER 1 / CHAPTER ONE / CHAPTER 1: Title / Chapter One — Title
  if (/^(CHAPTER|Chapter)\s+(\d+|[IVXLC]+|[A-Za-z]+)(\s*[:\-—].*)?$/.test(line)) return true;
  // PART 1 / PART ONE / PART TWO / Part III
  if (/^(PART|Part)\s+(\d+|[IVXLC]+|[A-Za-z]+)(\s*[:\-—].*)?$/.test(line)) return true;
  // PROLOGUE / EPILOGUE / INTERLUDE / CODA
  if (/^(PROLOGUE|EPILOGUE|INTERLUDE|CODA|PREFACE|FOREWORD|AFTERWORD|INTRODUCTION)$/i.test(line)) return true;
  return false;
}

// ── CHAPTER NAV ───────────────────────────────────
function renderChapterNav(chapters) {
  const list = DOM.chapterNavList;
  if (!list) return;
  if (chapters.length === 0) {
    list.innerHTML = `<div class="chapter-nav-item" style="cursor:default;color:var(--text-dim)">No chapters detected</div>`;
    return;
  }
  list.innerHTML = chapters.map(ch => `
    <div class="chapter-nav-item" data-chapter-id="${ch.id}" onclick="scrollToChapter('${ch.id}')">
      ${escapeHtml(ch.title)}
    </div>
  `).join('');
}

function syncMobileChapterNav() {
  const mobile = DOM.mobileChapterNavList;
  const desktop = DOM.chapterNavList;
  if (desktop && mobile) {
    mobile.innerHTML = desktop.innerHTML;
    mobile.querySelectorAll('.chapter-nav-item').forEach(el => {
      const id = el.dataset.chapterId;
      if (id) el.onclick = () => { scrollToChapter(id); closeMobileDrawers(); };
    });
  }
}

function scrollToChapter(chapterId) {
  const el = document.getElementById(chapterId);
  const panel = DOM.readerPanel;
  if (!el || !panel) return;
  const offset = 80;
  const panelRect = panel.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  panel.scrollTop += elRect.top - panelRect.top - offset;
}

// ── SCROLL TRACKING ───────────────────────────────
function setupScrollTracking() {
  const panel = DOM.readerPanel;
  if (!panel) return;
  panel.addEventListener('scroll', () => {
    const scrollTop = panel.scrollTop;
    const scrollHeight = panel.scrollHeight - panel.clientHeight;
    const pct = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    if (DOM.progressFill)       DOM.progressFill.style.width = pct + '%';
    if (DOM.readingStatCurrent) DOM.readingStatCurrent.textContent = pct + '%';
    updateActiveChapter(scrollTop);
  });
}

function updateActiveChapter(scrollTop) {
  let activeId = null;
  const panel = DOM.readerPanel;
  if (!panel) return;
  State.currentChapters.forEach(ch => {
    const el = document.getElementById(ch.id);
    if (!el) return;
    const top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    if (top <= scrollTop + 100) activeId = ch.id;
  });
  document.querySelectorAll('.chapter-nav-item').forEach(el => {
    el.classList.toggle('active-chapter', el.dataset.chapterId === activeId);
  });
}

// ── TOPBAR & NAV BUTTONS ──────────────────────────
function updateTopbarLocation(book) {
  if (!DOM.topbarLocation) return;
  DOM.topbarLocation.innerHTML = State.books.length > 1
    ? `<span style="color:var(--text-muted)">${escapeHtml(State.books.length + ' Books')}</span><span style="margin:0 8px;opacity:0.3">·</span><span class="current-book-label">${escapeHtml(book.title)}</span>`
    : `<span>${escapeHtml(book.title)}</span>`;
}

function setupNavButtons() {
  if (DOM.prevBtn)     DOM.prevBtn.onclick     = () => loadBook(State.currentBookIndex - 1);
  if (DOM.nextBtn)     DOM.nextBtn.onclick     = () => loadBook(State.currentBookIndex + 1);
  if (DOM.prevBookBtn) DOM.prevBookBtn.onclick = () => loadBook(State.currentBookIndex - 1);
  if (DOM.nextBookBtn) DOM.nextBookBtn.onclick = () => loadBook(State.currentBookIndex + 1);
}

function updateNavButtons() {
  const idx = State.currentBookIndex;
  const max = State.books.length - 1;
  const single = State.books.length === 1;
  [DOM.prevBtn, DOM.prevBookBtn].forEach(b => { if (b) b.style.visibility = (idx <= 0 || single) ? 'hidden' : 'visible'; });
  [DOM.nextBtn, DOM.nextBookBtn].forEach(b => { if (b) b.style.visibility = (idx >= max || single) ? 'hidden' : 'visible'; });
}

// ── FONT SIZE ─────────────────────────────────────
function setupFontControls() {
  const sizes = ['font-sm', 'font-md', 'font-lg', 'font-xl'];
  let current = 1;
  const step = d => {
    const n = current + d;
    if (n < 0 || n >= sizes.length) return;
    document.body.classList.remove(sizes[current]);
    current = n;
    document.body.classList.add(sizes[current]);
  };
  if (DOM.fontDecrease) DOM.fontDecrease.addEventListener('click', () => step(-1));
  if (DOM.fontIncrease) DOM.fontIncrease.addEventListener('click', () => step(1));
}

// ── MOBILE ────────────────────────────────────────
function setupMobileControls() {
  if (DOM.mobileNavBtn) {
    DOM.mobileNavBtn.addEventListener('click', () => {
      const isOpen = DOM.mobileNavDrawer.classList.contains('open');
      closeMobileDrawers();
      if (!isOpen) {
        DOM.mobileNavDrawer.classList.add('open');
        DOM.drawerOverlay.classList.add('visible');
        DOM.mobileNavBtn.classList.add('active');
      }
    });
  }
  if (DOM.drawerOverlay) DOM.drawerOverlay.addEventListener('click', closeMobileDrawers);
}

function closeMobileDrawers() {
  if (DOM.mobileNavDrawer) DOM.mobileNavDrawer.classList.remove('open');
  if (DOM.drawerOverlay)   DOM.drawerOverlay.classList.remove('visible');
  if (DOM.mobileNavBtn)    DOM.mobileNavBtn.classList.remove('active');
}

// ── KEYBOARD ──────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'ArrowRight') loadBook(State.currentBookIndex + 1);
  if (e.altKey && e.key === 'ArrowLeft')  loadBook(State.currentBookIndex - 1);
  if (e.key === 'Escape') closeMobileDrawers();
});

// ── DOM CACHE ─────────────────────────────────────
function cacheDOMRefs() {
  const ids = [
    'app','sidebar','reader-panel',
    'book-nav-list','chapter-nav-wrap','chapter-nav-list','progress-fill',
    'loading-state','welcome-screen','book-content',
    'book-header','reading-content','book-text',
    'topbar-location','reading-stat-current','reading-stat-total',
    'mobile-nav-drawer','drawer-overlay','mobile-nav-btn',
    'mobile-book-nav-list','mobile-chapter-nav-list',
    'sidebar-badge','sidebar-series-title','sidebar-series-sub',
    'mobile-badge','mobile-series-header','mobile-series-sub','mobile-series-title',
    'welcome-eyebrow','welcome-title','welcome-tagline',
    'welcome-synopsis','welcome-series-grid','welcome-begin-btn',
    'footer-tagline','prev-btn','next-btn','prev-book-btn','next-book-btn',
    'font-decrease','font-increase',
  ];
  ids.forEach(id => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    DOM[key] = document.getElementById(id);
  });
}

// ── UI STATE ──────────────────────────────────────
function showLoading() {
  if (DOM.loadingState)  DOM.loadingState.style.display  = 'flex';
  if (DOM.welcomeScreen) DOM.welcomeScreen.style.display = 'none';
  if (DOM.bookContent)   DOM.bookContent.style.display   = 'none';
}
function showWelcome() {
  if (DOM.loadingState)  DOM.loadingState.style.display  = 'none';
  if (DOM.welcomeScreen) DOM.welcomeScreen.style.display = 'block';
  if (DOM.bookContent)   DOM.bookContent.style.display   = 'none';
}
function showBookContent() {
  if (DOM.loadingState)  DOM.loadingState.style.display  = 'none';
  if (DOM.welcomeScreen) DOM.welcomeScreen.style.display = 'none';
  if (DOM.bookContent) {
    DOM.bookContent.style.display = 'block';
    DOM.bookContent.classList.add('fade-in');
    setTimeout(() => DOM.bookContent.classList.remove('fade-in'), 400);
  }
}
function showError(msg) {
  if (DOM.loadingState) {
    DOM.loadingState.innerHTML = `<div class="loading-text" style="color:var(--status-red);max-width:320px;text-align:center;line-height:1.7">${msg}</div>`;
    DOM.loadingState.style.display = 'flex';
  }
}

// ── FETCH ─────────────────────────────────────────
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.text();
}

// ── UTILS ─────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function stripMarkdown(str) {
  return str.replace(/\*\*(.+?)\*\*/g,'$1').replace(/\*(.+?)\*/g,'$1').replace(/^#+\s*/,'').trim();
}

// ── GLOBALS & START ───────────────────────────────
window.loadBook        = loadBook;
window.scrollToChapter = scrollToChapter;

document.addEventListener('DOMContentLoaded', init);
