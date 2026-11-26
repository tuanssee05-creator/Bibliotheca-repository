/**
 * /js/app.js
 * Pengendali utama antarmuka Bibliotheca Sophia: tema gelap/terang, pencarian real-time,
 * pengambilan koleksi nyata (Lokal, Gutendex, Open Library, Internet Archive) dengan cache sessionStorage,
 * modal pembaca, akun pembaca lokal, dan formulir kontak.
 */

import {
  addOrToggleBookmark,
  debounce,
  filterBooks,
  getAllBookmarks,
  getAllReadingProgress,
  getSessionCache,
  normalizeGutendexBook,
  normalizeInternetArchiveBook,
  normalizeLocalBook,
  normalizeOpenLibraryBook,
  safeLocalGet,
  safeLocalRemove,
  safeLocalSet,
  setSessionCache,
  STORAGE_KEYS,
} from './core.js';
import { createEbookReader } from './reader.js';

const PAGE_SIZE = 12;

// State aplikasi
const state = {
  localBooks: [],
  remoteBooks: [],
  allBooks: [],
  filteredBooks: [],
  visibleCount: PAGE_SIZE,
  query: '',
  category: 'Semua',
  language: 'Semua',
  source: 'Semua',
  loading: false,
  error: '',
  cacheHit: false,
  gutendexPage: 1,
  hasMoreRemote: true,
};

// Elemen DOM utama
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIconMoon = document.getElementById('theme-icon-moon');
const themeIconSun = document.getElementById('theme-icon-sun');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileDrawer = document.getElementById('mobile-drawer');

const heroSearchForm = document.getElementById('hero-search-form');
const heroSearchInput = document.getElementById('hero-search-input');
const suggestionLinks = Array.from(document.querySelectorAll('[data-quick-query]'));
const categoryCards = Array.from(document.querySelectorAll('#category-cards .category-card'));

const filterSearchInput = document.getElementById('filter-search');
const filterCategorySelect = document.getElementById('filter-category');
const filterLanguageSelect = document.getElementById('filter-language');
const filterSourceSelect = document.getElementById('filter-source');
const filterResetBtn = document.getElementById('filter-reset-btn');

const catalogCountEl = document.getElementById('catalog-count');
const catalogCacheNoteEl = document.getElementById('catalog-cache-note');
const booksGridEl = document.getElementById('books-grid');
const loadMoreBtn = document.getElementById('load-more-btn');

const statIndexedEl = document.getElementById('stat-indexed');
const statBookmarksEl = document.getElementById('stat-bookmarks');

// Modal Masuk / Akun
const authOpenBtn = document.getElementById('auth-open-btn');
const authModal = document.getElementById('auth-modal');
const authCloseBtn = document.getElementById('auth-close-btn');
const authForm = document.getElementById('auth-form');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authFeedback = document.getElementById('auth-feedback');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authLogoutBtn = document.getElementById('auth-logout-btn');
const authBookmarksList = document.getElementById('auth-bookmarks-list');

// Formulir Kontak
const contactForm = document.getElementById('contact-form');
const contactNameInput = document.getElementById('contact-name');
const contactEmailInput = document.getElementById('contact-email');
const contactMessageInput = document.getElementById('contact-message');
const contactFeedback = document.getElementById('contact-feedback');

const toastEl = document.getElementById('app-toast');
let toastTimer = null;

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2600);
}

// ============================================================================
// Tema Gelap / Terang (persisten di localStorage dibungkus try/catch)
// ============================================================================
function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', isDark);
  themeToggleBtn.setAttribute('aria-pressed', String(isDark));
  themeIconMoon.hidden = isDark;
  themeIconSun.hidden = !isDark;
  safeLocalSet(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
}

function initTheme() {
  const saved = safeLocalGet(STORAGE_KEYS.theme, 'light');
  applyTheme(saved === 'dark' ? 'dark' : 'light');
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// ============================================================================
// Pembaca E-Book
// ============================================================================
const reader = createEbookReader({
  showToast,
  onBookmarksChanged: () => {
    updateStats();
    renderBooksGrid();
    renderAuthBookmarks();
  },
  onProgressChanged: () => {
    renderBooksGrid();
  },
});

// ============================================================================
// Pengambilan Data Nyata (Lokal + Gutendex + Open Library + Internet Archive)
// ============================================================================
async function fetchJsonWithTimeout(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocalCatalog() {
  try {
    const items = await fetchJsonWithTimeout('/data/koleksi-lokal.json', 4000);
    return Array.isArray(items) ? items.map(normalizeLocalBook) : [];
  } catch {
    return [];
  }
}

async function fetchGutendexBooks(query, language, page = 1) {
  const params = new URLSearchParams();
  if (query) params.set('search', query);
  if (language && language !== 'Semua') params.set('languages', language);
  params.set('page', String(page));

  const url = `https://gutendex.com/books/?${params.toString()}`;
  const cacheKey = `bs_gutendex_${url}`;
  const cached = getSessionCache(cacheKey);
  if (cached) {
    return { items: cached.items, hasNext: cached.hasNext, fromCache: true };
  }

  const data = await fetchJsonWithTimeout(url, 7000);
  const items = (data.results || [])
    .filter((b) => b.copyright === false)
    .map(normalizeGutendexBook)
    .filter((b) => Boolean(b.readUrl));

  const hasNext = Boolean(data.next);
  setSessionCache(cacheKey, { items, hasNext });
  return { items, hasNext, fromCache: false };
}

async function fetchOpenLibraryAndIA(query, page = 1) {
  const searchTerm = query || 'science history literature';
  const params = new URLSearchParams({
    q: searchTerm,
    has_fulltext: 'true',
    limit: '12',
    page: String(page),
    fields: 'key,title,author_name,cover_i,ia,ebook_access,public_scan_b,first_publish_year,language,subject',
  });
  const url = `https://openlibrary.org/search.json?${params.toString()}`;
  const cacheKey = `bs_openlib_${url}`;
  const cached = getSessionCache(cacheKey);
  if (cached) {
    return { items: cached, fromCache: true };
  }

  const data = await fetchJsonWithTimeout(url, 7000);
  const items = (data.docs || [])
    .map(normalizeOpenLibraryBook)
    .filter(Boolean);

  setSessionCache(cacheKey, items);
  return { items, fromCache: false };
}

async function fetchInternetArchiveDirect(query, page = 1) {
  const baseFilter = query
    ? `(${query}) AND mediatype:(texts) AND (licenseurl:*publicdomain* OR collection:(gutenberg OR americana))`
    : 'mediatype:(texts) AND collection:(gutenberg OR americana) AND (subject:science OR subject:history OR subject:literature OR subject:philosophy)';
  const params = new URLSearchParams({
    q: baseFilter,
    output: 'json',
    rows: '8',
    page: String(page),
  });
  params.append('sort[]', 'downloads desc');
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'creator');
  params.append('fl[]', 'language');
  params.append('fl[]', 'subject');
  params.append('fl[]', 'year');
  params.append('fl[]', 'description');

  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  const cacheKey = `bs_ia_${url}`;
  const cached = getSessionCache(cacheKey);
  if (cached) {
    return { items: cached, fromCache: true };
  }

  const data = await fetchJsonWithTimeout(url, 7000);
  const docs = data?.response?.docs || [];
  const items = docs.map(normalizeInternetArchiveBook).filter(Boolean);
  setSessionCache(cacheKey, items);
  return { items, fromCache: false };
}

const SOURCE_PRIORITY = {
  'Koleksi Lokal': 0,
  'Project Gutenberg': 1,
  'Open Library & Internet Archive': 2,
  'Internet Archive': 3,
};

function deduplicateBooks(list) {
  const seen = new Set();
  const unique = list.filter((b) => {
    const key = `${b.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => (SOURCE_PRIORITY[a.sumber] ?? 9) - (SOURCE_PRIORITY[b.sumber] ?? 9));
}

let activeLoadToken = 0;

async function loadCatalog({ append = false } = {}) {
  const loadToken = ++activeLoadToken;
  if (!append) {
    state.gutendexPage = 1;
    state.visibleCount = PAGE_SIZE;
    state.remoteBooks = [];
  }

  state.loading = true;
  state.error = '';

  if (state.localBooks.length === 0) {
    state.localBooks = await fetchLocalCatalog();
  }

  if (loadToken !== activeLoadToken) return;

  // Tampilkan koleksi lokal seketika sambil mengambil sumber eksternal
  state.allBooks = deduplicateBooks([...state.localBooks, ...state.remoteBooks]);
  applyClientFilters();

  if (state.source === 'Koleksi Lokal') {
    state.loading = false;
    state.hasMoreRemote = false;
    state.cacheHit = false;
    renderBooksGrid();
    return;
  }

  const targetQuery = state.query || (state.category !== 'Semua' ? state.category : '');
  const tasks = [];

  if (state.source === 'Semua' || state.source === 'Project Gutenberg') {
    tasks.push(fetchGutendexBooks(targetQuery, state.language, state.gutendexPage));
  }
  if (state.source === 'Semua' || state.source === 'Open Library') {
    tasks.push(fetchOpenLibraryAndIA(targetQuery, state.gutendexPage));
  }
  if (state.source === 'Semua' || state.source === 'Internet Archive') {
    tasks.push(fetchInternetArchiveDirect(targetQuery, state.gutendexPage));
  }

  let settledCount = 0;
  let successCount = 0;
  let anyCache = false;
  let anyNext = false;

  await Promise.all(
    tasks.map((p) =>
      p
        .then((result) => {
          if (loadToken !== activeLoadToken) return;
          successCount += 1;
          if (result.fromCache) anyCache = true;
          if (result.hasNext) anyNext = true;
          const incoming = result.items || [];
          state.remoteBooks = deduplicateBooks([...state.remoteBooks, ...incoming]);
          state.allBooks = deduplicateBooks([...state.localBooks, ...state.remoteBooks]);
          state.cacheHit = anyCache;
          state.hasMoreRemote = anyNext || state.remoteBooks.length >= 10;
          applyClientFilters();
        })
        .catch(() => {})
        .finally(() => {
          settledCount += 1;
          if (loadToken !== activeLoadToken) return;
          if (settledCount === tasks.length) {
            state.loading = false;
            if (successCount === 0 && state.localBooks.length === 0) {
              state.error = 'Tidak dapat terhubung ke katalog eksternal. Periksa koneksi jaringan Anda.';
            }
            applyClientFilters();
          }
        })
    )
  );
}

function applyClientFilters() {
  state.filteredBooks = filterBooks(state.allBooks, {
    query: state.query,
    category: state.category,
    language: state.language,
    source: state.source,
  });
  renderBooksGrid();
  updateStats();
}

// ============================================================================
// Render Kartu Buku & State UI
// ============================================================================
function createCoverElement(book) {
  const wrap = document.createElement('div');
  wrap.className = 'book-cover-wrap';

  const makeFallback = () => {
    const fb = document.createElement('div');
    fb.className = 'book-cover-fallback';

    const kicker = document.createElement('span');
    kicker.className = 'book-cover-fallback-kicker';
    kicker.textContent = book.kategori;

    const title = document.createElement('div');
    title.className = 'book-cover-fallback-title';
    title.textContent = book.judul;

    const author = document.createElement('div');
    author.className = 'book-cover-fallback-author';
    author.textContent = book.penulis;

    fb.append(kicker, title, author);
    return fb;
  };

  if (book.sampul) {
    const img = document.createElement('img');
    img.className = 'book-cover-img';
    img.src = book.sampul;
    img.alt = `Sampul buku ${book.judul}`;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      wrap.innerHTML = '';
      wrap.appendChild(makeFallback());
    });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(makeFallback());
  }

  return wrap;
}

function renderBooksGrid() {
  booksGridEl.innerHTML = '';
  const progressMap = getAllReadingProgress();
  const bookmarks = getAllBookmarks();
  const bookmarkedIds = new Set(bookmarks.map((b) => b.bookId));

  if (state.loading && state.allBooks.length === 0) {
    catalogCountEl.textContent = 'Memuat koleksi buku...';
    for (let i = 0; i < 8; i++) {
      const skel = document.createElement('div');
      skel.className = 'skeleton-card';
      skel.setAttribute('aria-hidden', 'true');
      skel.innerHTML = `
        <div class="skeleton-cover"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line" style="width: 65%"></div>
          <div class="skeleton-line" style="width: 90%"></div>
          <div class="skeleton-line" style="width: 50%"></div>
        </div>
      `;
      booksGridEl.appendChild(skel);
    }
    loadMoreBtn.hidden = true;
    return;
  }

  if (state.error && state.filteredBooks.length === 0) {
    catalogCountEl.textContent = 'Gagal memuat katalog';
    const panel = document.createElement('div');
    panel.className = 'state-panel is-error';
    panel.innerHTML = `
      <h3>Katalog Gagal Dimuat</h3>
      <p></p>
      <button type="button" class="btn btn-primary" id="retry-catalog-btn">Coba Lagi</button>
    `;
    panel.querySelector('p').textContent = state.error;
    panel.querySelector('#retry-catalog-btn').addEventListener('click', () => loadCatalog());
    booksGridEl.appendChild(panel);
    loadMoreBtn.hidden = true;
    return;
  }

  const totalMatches = state.filteredBooks.length;
  const visibleSlice = state.filteredBooks.slice(0, state.visibleCount);

  catalogCountEl.textContent = `Menampilkan ${visibleSlice.length} dari ${totalMatches} buku tersedia`;
  if (state.loading) {
    catalogCacheNoteEl.textContent = 'Menyinkronkan katalog Project Gutenberg, Open Library & Internet Archive...';
  } else if (state.cacheHit) {
    catalogCacheNoteEl.textContent = 'Sebagian hasil dimuat cepat dari cache sesi';
  } else {
    catalogCacheNoteEl.textContent = '';
  }

  if (totalMatches === 0) {
    const empty = document.createElement('div');
    empty.className = 'state-panel';
    empty.innerHTML = `
      <h3>Tidak Ada Buku yang Cocok</h3>
      <p>Coba gunakan kata kunci lain atau atur ulang filter kategori, bahasa, dan sumber.</p>
      <button type="button" class="btn btn-secondary" id="empty-reset-btn">Atur Ulang Filter</button>
    `;
    empty.querySelector('#empty-reset-btn').addEventListener('click', resetFilters);
    booksGridEl.appendChild(empty);
    loadMoreBtn.hidden = true;
    return;
  }

  visibleSlice.forEach((book) => {
    const card = document.createElement('article');
    card.className = 'book-card';

    const cover = createCoverElement(book);
    const body = document.createElement('div');
    body.className = 'book-body';

    const meta = document.createElement('div');
    meta.className = 'book-meta-line';
    meta.textContent = `${book.kategori} · ${book.bahasaLabel} · ${book.sumber}`;

    const title = document.createElement('h3');
    title.className = 'book-title';
    title.textContent = book.judul;
    title.title = book.judul;

    const author = document.createElement('p');
    author.className = 'book-author';
    author.textContent = book.penulis;

    body.append(meta, title, author);

    const savedProg = progressMap[book.id];
    if (savedProg && typeof savedProg.percent === 'number' && savedProg.percent > 0) {
      const progEl = document.createElement('p');
      progEl.className = 'book-progress-text tabular-nums';
      progEl.textContent = `Progres baca: ${savedProg.percent}%`;
      body.appendChild(progEl);
    }

    const actions = document.createElement('div');
    actions.className = 'book-actions';

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'btn btn-primary';
    readBtn.textContent = 'Baca Sekarang';
    readBtn.addEventListener('click', () => reader.openBook(book));

    const isSaved = bookmarkedIds.has(book.id);
    const bmBtn = document.createElement('button');
    bmBtn.type = 'button';
    bmBtn.className = 'icon-btn';
    bmBtn.setAttribute('aria-label', isSaved ? `Hapus penanda ${book.judul}` : `Simpan ${book.judul}`);
    bmBtn.setAttribute('aria-pressed', String(isSaved));
    bmBtn.title = isSaved ? 'Tersimpan di penanda' : 'Simpan buku';
    bmBtn.innerHTML = `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
    `;
    bmBtn.addEventListener('click', () => {
      const res = addOrToggleBookmark({
        bookId: book.id,
        judul: book.judul,
        penulis: book.penulis,
        sampul: book.sampul,
        readerType: book.readerType,
        readUrl: book.readUrl,
        location: 'start',
        label: 'Simpanan Katalog',
        bookSnapshot: book,
      });
      renderBooksGrid();
      renderAuthBookmarks();
      updateStats();
      showToast(res.added ? `"${book.judul}" ditambahkan ke penanda.` : `"${book.judul}" dihapus dari penanda.`);
    });

    actions.append(readBtn, bmBtn);
    body.appendChild(actions);
    card.append(cover, body);
    booksGridEl.appendChild(card);
  });

  const canRevealMoreLocal = state.visibleCount < totalMatches;
  loadMoreBtn.hidden = !(canRevealMoreLocal || state.hasMoreRemote);
  loadMoreBtn.disabled = state.loading;
  loadMoreBtn.textContent = state.loading ? 'Memuat buku berikutnya...' : 'Muat Lebih Banyak Buku';
}

function updateStats() {
  if (statIndexedEl) {
    statIndexedEl.textContent = String(state.allBooks.length || state.localBooks.length || 3);
  }
  if (statBookmarksEl) {
    statBookmarksEl.textContent = String(getAllBookmarks().length);
  }
}

// ============================================================================
// Sinkronisasi Filter & Pencarian Debounce
// ============================================================================
function syncCategoryHighlight() {
  categoryCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.category === state.category);
  });
}

function resetFilters() {
  state.query = '';
  state.category = 'Semua';
  state.language = 'Semua';
  state.source = 'Semua';
  heroSearchInput.value = '';
  filterSearchInput.value = '';
  filterCategorySelect.value = 'Semua';
  filterLanguageSelect.value = 'Semua';
  filterSourceSelect.value = 'Semua';
  syncCategoryHighlight();
  loadCatalog();
}

const triggerRemoteSearch = debounce(() => {
  loadCatalog();
}, 420);

function handleSearchChange(value, immediate = false) {
  state.query = value.trim();
  heroSearchInput.value = value;
  filterSearchInput.value = value;
  if (immediate) {
    loadCatalog();
  } else {
    applyClientFilters();
    triggerRemoteSearch();
  }
}

// ============================================================================
// Akun Pembaca Lokal & Daftar Penanda
// ============================================================================
function renderAuthState() {
  const user = safeLocalGet(STORAGE_KEYS.user, null);
  if (user && user.name) {
    authOpenBtn.textContent = user.name.split(' ')[0];
    authNameInput.value = user.name;
    authEmailInput.value = user.email || '';
    authSubmitBtn.textContent = 'Perbarui Profil';
    authLogoutBtn.hidden = false;
  } else {
    authOpenBtn.textContent = 'Masuk';
    authNameInput.value = '';
    authEmailInput.value = '';
    authSubmitBtn.textContent = 'Masuk';
    authLogoutBtn.hidden = true;
  }
  renderAuthBookmarks();
}

function renderAuthBookmarks() {
  const list = getAllBookmarks();
  authBookmarksList.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.style.fontSize = '0.86rem';
    li.style.color = 'var(--text-muted)';
    li.textContent = 'Belum ada buku yang ditandai. Klik ikon penanda pada kartu buku atau di dalam pembaca.';
    authBookmarksList.appendChild(li);
    return;
  }

  list.forEach((bm) => {
    const li = document.createElement('li');
    li.className = 'saved-item';

    const info = document.createElement('div');
    info.className = 'saved-item-info';

    const title = document.createElement('div');
    title.className = 'saved-item-title';
    title.textContent = bm.judul;

    const meta = document.createElement('div');
    meta.className = 'saved-item-meta';
    meta.textContent = `${bm.penulis} · ${bm.label}`;

    info.append(title, meta);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-secondary';
    openBtn.textContent = 'Buka';
    openBtn.addEventListener('click', () => {
      closeAuthModal();
      const found = state.allBooks.find((b) => b.id === bm.bookId) || bm.bookSnapshot;
      if (found) {
        reader.openBook(found);
      } else {
        showToast('Buku tidak ditemukan dalam sesi saat ini.');
      }
    });

    li.append(info, openBtn);
    authBookmarksList.appendChild(li);
  });
}

function openAuthModal() {
  renderAuthState();
  authFeedback.classList.remove('show');
  authModal.classList.add('open');
  authNameInput.focus();
}

function closeAuthModal() {
  authModal.classList.remove('open');
}

// ============================================================================
// Inisialisasi Event Listeners
// ============================================================================
function initEvents() {
  mobileMenuBtn.addEventListener('click', () => {
    const open = mobileDrawer.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', String(open));
  });

  mobileDrawer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    });
  });

  heroSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearchChange(heroSearchInput.value, true);
    document.getElementById('koleksi').scrollIntoView({ behavior: 'smooth' });
  });

  heroSearchInput.addEventListener('input', (e) => {
    handleSearchChange(e.target.value, false);
  });

  filterSearchInput.addEventListener('input', (e) => {
    handleSearchChange(e.target.value, false);
  });

  suggestionLinks.forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.quickQuery || '';
      handleSearchChange(q, true);
      document.getElementById('koleksi').scrollIntoView({ behavior: 'smooth' });
    });
  });

  categoryCards.forEach((card) => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category || 'Semua';
      state.category = state.category === cat ? 'Semua' : cat;
      filterCategorySelect.value = state.category;
      syncCategoryHighlight();
      loadCatalog();
      document.getElementById('koleksi').scrollIntoView({ behavior: 'smooth' });
    });
  });

  filterCategorySelect.addEventListener('change', (e) => {
    state.category = e.target.value;
    syncCategoryHighlight();
    loadCatalog();
  });

  filterLanguageSelect.addEventListener('change', (e) => {
    state.language = e.target.value;
    loadCatalog();
  });

  filterSourceSelect.addEventListener('change', (e) => {
    state.source = e.target.value;
    loadCatalog();
  });

  filterResetBtn.addEventListener('click', resetFilters);

  loadMoreBtn.addEventListener('click', () => {
    if (state.visibleCount < state.filteredBooks.length) {
      state.visibleCount += PAGE_SIZE;
      renderBooksGrid();
    } else if (state.hasMoreRemote) {
      state.gutendexPage += 1;
      state.visibleCount += PAGE_SIZE;
      loadCatalog({ append: true });
    }
  });

  // Modal Masuk
  authOpenBtn.addEventListener('click', openAuthModal);
  authCloseBtn.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = authNameInput.value.trim();
    const email = authEmailInput.value.trim();
    if (!name || !email || !email.includes('@')) {
      authFeedback.textContent = 'Mohon isi nama pembaca dan alamat email yang valid.';
      authFeedback.className = 'form-feedback show error';
      return;
    }
    safeLocalSet(STORAGE_KEYS.user, { name, email, signedInAt: new Date().toISOString() });
    renderAuthState();
    authFeedback.textContent = `Selamat datang, ${name}. Profil pembaca tersimpan di perangkat ini.`;
    authFeedback.className = 'form-feedback show success';
    showToast(`Masuk sebagai ${name}`);
  });

  authLogoutBtn.addEventListener('click', () => {
    safeLocalRemove(STORAGE_KEYS.user);
    renderAuthState();
    authFeedback.textContent = 'Anda telah keluar dari profil pembaca.';
    authFeedback.className = 'form-feedback show success';
  });

  // Form Kontak
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = contactNameInput.value.trim();
    const email = contactEmailInput.value.trim();
    const message = contactMessageInput.value.trim();

    if (!name || !email || !email.includes('@') || message.length < 5) {
      contactFeedback.textContent = 'Mohon lengkapi nama, email valid, dan pesan minimal 5 karakter.';
      contactFeedback.className = 'form-feedback show error';
      return;
    }

    const history = safeLocalGet(STORAGE_KEYS.messages, []);
    history.push({ name, email, message, sentAt: new Date().toISOString() });
    safeLocalSet(STORAGE_KEYS.messages, history);

    contactForm.reset();
    contactFeedback.textContent = 'Terima kasih! Pesan atau usulan koleksi Anda telah kami terima.';
    contactFeedback.className = 'form-feedback show success';
    showToast('Pesan berhasil dikirim.');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal.classList.contains('open')) {
      closeAuthModal();
    }
  });
}

// ============================================================================
// Bootstrap Aplikasi
// ============================================================================
function init() {
  initTheme();
  initEvents();
  renderAuthState();
  updateStats();
  loadCatalog();
}

init();
