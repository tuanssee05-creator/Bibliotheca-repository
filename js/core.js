/**
 * /js/core.js
 * Modul logika murni Bibliotheca Sophia: penyimpanan aman, cache sessionStorage,
 * normalisasi metadata buku dari berbagai sumber legal, filter, dan progres bacaan.
 */

export const STORAGE_KEYS = {
  theme: 'bs_theme',
  progress: 'bs_reading_progress_v1',
  bookmarks: 'bs_bookmarks_v1',
  user: 'bs_reader_profile_v1',
  messages: 'bs_contact_messages_v1',
};

export const CATEGORIES = [
  { id: 'Semua', label: 'Semua' },
  { id: 'Sains', label: 'Sains' },
  { id: 'Sastra', label: 'Sastra' },
  { id: 'Teknologi', label: 'Teknologi' },
  { id: 'Sejarah', label: 'Sejarah' },
  { id: 'Pendidikan', label: 'Pendidikan' },
  { id: 'Anak', label: 'Anak' },
];

export const LANGUAGE_LABELS = {
  id: 'Indonesia',
  en: 'Inggris',
  fr: 'Prancis',
  de: 'Jerman',
  es: 'Spanyol',
  la: 'Latin',
  nl: 'Belanda',
  ind: 'Indonesia',
  eng: 'Inggris',
  fre: 'Prancis',
  ger: 'Jerman',
  spa: 'Spanyol',
};

const CATEGORY_KEYWORDS = {
  Sains: ['science', 'physics', 'biology', 'botany', 'chemistry', 'astronomy', 'nature', 'natural history', 'sains', 'matematika', 'mathematics', 'ecology'],
  Sastra: ['fiction', 'literature', 'poetry', 'novel', 'drama', 'classics', 'short stories', 'sastra', 'roman', 'adventure'],
  Teknologi: ['technology', 'engineering', 'computer', 'computing', 'telegraph', 'electricity', 'machinery', 'teknologi', 'industrial'],
  Sejarah: ['history', 'historical', 'biography', 'war', 'ancient', 'civilization', 'maritime', 'sejarah', 'voyages', 'archipelago'],
  Pendidikan: ['education', 'philosophy', 'logic', 'pedagogy', 'textbook', 'grammar', 'dictionary', 'pendidikan', 'ethics', 'psychology'],
  Anak: ['children', 'juvenile', 'fairy tales', 'fables', 'kids', 'young readers', 'anak', 'dongeng'],
};

const ALLOWED_PROXY_DOMAINS = [
  'gutenberg.org',
  'gutendex.com',
  'archive.org',
  'openlibrary.org',
];

/**
 * Membaca dari localStorage dengan aman (dibungkus try/catch).
 * @param {string} key
 * @param {*} fallback
 */
export function safeLocalGet(key, fallback = null) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Menyimpan ke localStorage dengan aman (dibungkus try/catch).
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
export function safeLocalSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Menghapus kunci dari localStorage dengan aman.
 * @param {string} key
 */
export function safeLocalRemove(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    // Abaikan error storage bila mode privat memblokir
  }
}

/**
 * Membaca cache API dari sessionStorage dengan pengecekan kedaluwarsa (TTL).
 * @param {string} cacheKey
 * @param {number} maxAgeMs
 */
export function getSessionCache(cacheKey, maxAgeMs = 15 * 60 * 1000) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > maxAgeMs) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Menyimpan cache API ke sessionStorage dengan aman.
 * @param {string} cacheKey
 * @param {*} data
 */
export function setSessionCache(cacheKey, data) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ ts: Date.now(), data })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Fungsi debounce standar untuk pencarian real-time agar hemat request API.
 * @param {Function} fn
 * @param {number} delayMs
 */
export function debounce(fn, delayMs = 350) {
  let timerId = null;
  return function debounced(...args) {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, delayMs);
  };
}

/**
 * Memetakan subjek/rak berbahasa Inggris atau Indonesia ke 6 kategori perpustakaan.
 * @param {string[]} subjects
 * @param {string} [explicitCategory]
 * @returns {string}
 */
export function inferCategory(subjects = [], explicitCategory = '') {
  if (explicitCategory && CATEGORIES.some((c) => c.id === explicitCategory && c.id !== 'Semua')) {
    return explicitCategory;
  }
  const joined = (Array.isArray(subjects) ? subjects : [subjects])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => joined.includes(kw))) {
      return category;
    }
  }
  return 'Sastra';
}

/**
 * Mengubah kode bahasa (ISO-639) ke nama bahasa Indonesia yang ramah.
 * @param {string} code
 * @returns {string}
 */
export function formatLanguageLabel(code) {
  if (!code) return 'Lainnya';
  const normalized = String(code).toLowerCase().trim();
  return LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

/**
 * Menormalkan kode bahasa ke 2 huruf standar untuk konsistensi filter.
 * @param {string} code
 * @returns {string}
 */
export function normalizeLanguageCode(code) {
  const c = String(code || 'en').toLowerCase().trim();
  if (c === 'ind') return 'id';
  if (c === 'eng') return 'en';
  if (c === 'fre') return 'fr';
  if (c === 'ger') return 'de';
  if (c === 'spa') return 'es';
  return c.slice(0, 2);
}

/**
 * Memeriksa apakah hostname berada dalam whitelist proxy server.
 * @param {string} urlString
 * @returns {boolean}
 */
export function isAllowedProxyUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_PROXY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Membangun URL melalui /api/proxy jika URL berasal dari domain eksternal whitelist.
 * @param {string} urlString
 * @returns {string}
 */
export function buildProxyUrl(urlString) {
  if (!urlString) return '';
  if (urlString.startsWith('/')) return urlString;
  if (isAllowedProxyUrl(urlString)) {
    return `/api/proxy?url=${encodeURIComponent(urlString)}`;
  }
  return urlString;
}

/**
 * Menormalkan entri buku dari /data/koleksi-lokal.json.
 * @param {object} item
 */
export function normalizeLocalBook(item) {
  const format = String(item.format || 'epub').toLowerCase();
  const langCode = normalizeLanguageCode(item.bahasa || 'id');
  return {
    id: String(item.id || `lokal-${item.judul}`),
    judul: item.judul || 'Tanpa Judul',
    penulis: item.penulis || 'Penulis Tidak Diketahui',
    kategori: inferCategory([], item.kategori),
    bahasaKode: langCode,
    bahasaLabel: formatLanguageLabel(langCode),
    sumber: 'Koleksi Lokal',
    format,
    readerType: format === 'pdf' ? 'pdf' : 'epub',
    readUrl: item.file || '',
    fallbackTextUrl: '',
    downloadUrl: item.bolehUnduh !== false ? (item.file || '') : '',
    bolehUnduh: item.bolehUnduh !== false,
    lisensi: item.lisensi || 'Koleksi Lokal Terbuka',
    sampul: item.sampul || '',
    deskripsi: item.deskripsi || 'E-book koleksi lokal yang tersedia untuk dibaca langsung.',
    tahun: item.tahun || '',
    iaIdentifier: '',
    sourceUrl: '',
  };
}

/**
 * Menormalkan entri buku dari Gutendex API (Project Gutenberg).
 * Hanya menerima buku berdomain publik.
 * @param {object} item
 */
export function normalizeGutendexBook(item) {
  const formats = item.formats || {};
  const epubUrl = formats['application/epub+zip'] || '';
  const htmlUrl = formats['text/html'] || formats['text/html; charset=utf-8'] || '';
  const textUrl =
    formats['text/plain; charset=utf-8'] ||
    formats['text/plain; charset=us-ascii'] ||
    formats['text/plain'] ||
    '';
  const coverUrl = formats['image/jpeg'] || '';

  const authors = Array.isArray(item.authors) && item.authors.length > 0
    ? item.authors.map((a) => a.name).join(', ')
    : 'Anonim / Domain Publik';

  const langCode = normalizeLanguageCode(
    Array.isArray(item.languages) && item.languages.length > 0 ? item.languages[0] : 'en'
  );

  const subjects = [...(item.subjects || []), ...(item.bookshelves || [])];
  const hasEpub = Boolean(epubUrl);
  const readUrl = epubUrl || htmlUrl || textUrl;
  const readerType = hasEpub ? 'epub' : (htmlUrl ? 'html' : 'text');

  return {
    id: `gutenberg-${item.id}`,
    judul: item.title || 'Tanpa Judul',
    penulis: authors,
    kategori: inferCategory(subjects),
    bahasaKode: langCode,
    bahasaLabel: formatLanguageLabel(langCode),
    sumber: 'Project Gutenberg',
    format: hasEpub ? 'epub' : (htmlUrl ? 'html' : 'txt'),
    readerType,
    readUrl,
    fallbackTextUrl: htmlUrl || textUrl,
    downloadUrl: epubUrl || textUrl || '',
    bolehUnduh: Boolean(item.copyright === false && (epubUrl || textUrl)),
    lisensi: 'Domain Publik (Project Gutenberg)',
    sampul: coverUrl,
    deskripsi: subjects.slice(0, 3).join(' · ') || 'Karya klasik domain publik dari arsip Project Gutenberg.',
    tahun: '',
    iaIdentifier: '',
    sourceUrl: `https://www.gutenberg.org/ebooks/${item.id}`,
  };
}

/**
 * Menormalkan entri buku dari Open Library API + Internet Archive.
 * Hanya buku open access ('public') dengan identifier Internet Archive yang dapat dibaca langsung.
 * @param {object} doc
 */
export function normalizeOpenLibraryBook(doc) {
  const iaList = Array.isArray(doc.ia) ? doc.ia : [];
  const iaId = iaList.length > 0 ? iaList[0] : '';
  const isPublic = doc.ebook_access === 'public' || Boolean(doc.public_scan_b);

  if (!iaId || !isPublic) {
    return null;
  }

  const authors = Array.isArray(doc.author_name) && doc.author_name.length > 0
    ? doc.author_name.slice(0, 2).join(', ')
    : 'Penulis Tidak Diketahui';

  const langCode = normalizeLanguageCode(
    Array.isArray(doc.language) && doc.language.length > 0 ? doc.language[0] : 'en'
  );

  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : `https://archive.org/services/img/${encodeURIComponent(iaId)}`;

  return {
    id: `openlib-${iaId}`,
    judul: doc.title || 'Tanpa Judul',
    penulis: authors,
    kategori: inferCategory(doc.subject || []),
    bahasaKode: langCode,
    bahasaLabel: formatLanguageLabel(langCode),
    sumber: 'Open Library & Internet Archive',
    format: 'ia-embed',
    readerType: 'ia',
    readUrl: `https://archive.org/embed/${encodeURIComponent(iaId)}`,
    fallbackTextUrl: '',
    downloadUrl: `https://archive.org/details/${encodeURIComponent(iaId)}`,
    bolehUnduh: Boolean(doc.public_scan_b),
    lisensi: 'Open Access / Domain Publik (Internet Archive)',
    sampul: coverUrl,
    deskripsi: Array.isArray(doc.subject) && doc.subject.length > 0
      ? doc.subject.slice(0, 3).join(' · ')
      : 'Edisi digital terbuka yang terhubung ke pembaca Internet Archive.',
    tahun: doc.first_publish_year || '',
    iaIdentifier: iaId,
    sourceUrl: `https://openlibrary.org${doc.key || ''}`,
  };
}

/**
 * Menormalkan entri langsung dari Internet Archive Advanced Search (meditype:texts & licenseurl/public).
 * @param {object} doc
 */
export function normalizeInternetArchiveBook(doc) {
  const identifier = doc.identifier;
  if (!identifier) return null;

  const rawTitle = String(doc.title || identifier).trim();
  if (/\.(pdf|djvu|txt|epub)$/i.test(rawTitle) || /^[0-9_]+$/.test(rawTitle)) {
    return null;
  }

  const creator = Array.isArray(doc.creator)
    ? doc.creator.join(', ')
    : (doc.creator || 'Arsip Terbuka');

  const langRaw = Array.isArray(doc.language) ? doc.language[0] : (doc.language || 'en');
  const langCode = normalizeLanguageCode(langRaw);
  const subjects = Array.isArray(doc.subject) ? doc.subject : (doc.subject ? [doc.subject] : []);

  return {
    id: `ia-${identifier}`,
    judul: rawTitle,
    penulis: creator,
    kategori: inferCategory(subjects),
    bahasaKode: langCode,
    bahasaLabel: formatLanguageLabel(langCode),
    sumber: 'Internet Archive',
    format: 'ia-embed',
    readerType: 'ia',
    readUrl: `https://archive.org/embed/${encodeURIComponent(identifier)}`,
    fallbackTextUrl: '',
    downloadUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    bolehUnduh: true,
    lisensi: 'Domain Publik / Lisensi Terbuka (Internet Archive)',
    sampul: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    deskripsi: doc.description
      ? String(Array.isArray(doc.description) ? doc.description[0] : doc.description).slice(0, 160)
      : 'Koleksi teks digital terbuka dari Internet Archive.',
    tahun: doc.year || '',
    iaIdentifier: identifier,
    sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
  };
}

/**
 * Menyaring daftar buku berdasarkan query, kategori, bahasa, dan sumber.
 * @param {Array} books
 * @param {object} filters
 */
export function filterBooks(books, { query = '', category = 'Semua', language = 'Semua', source = 'Semua' } = {}) {
  const q = String(query).trim().toLowerCase();

  return books.filter((book) => {
    if (category !== 'Semua' && book.kategori !== category) {
      return false;
    }
    if (language !== 'Semua' && book.bahasaKode !== language) {
      return false;
    }
    if (source !== 'Semua') {
      if (source === 'Internet Archive' && !book.sumber.includes('Internet Archive')) {
        return false;
      } else if (source === 'Open Library' && !book.sumber.includes('Open Library')) {
        return false;
      } else if (source !== 'Internet Archive' && source !== 'Open Library' && book.sumber !== source) {
        return false;
      }
    }
    if (q) {
      const hay = `${book.judul} ${book.penulis} ${book.kategori} ${book.deskripsi}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Mengecek apakah tombol unduh boleh ditampilkan/diaktifkan sesuai lisensi buku.
 * @param {object} book
 */
export function canDownloadBook(book) {
  return Boolean(book && book.bolehUnduh === true && book.downloadUrl);
}

/**
 * Mengambil seluruh progres bacaan dari localStorage.
 */
export function getAllReadingProgress() {
  const data = safeLocalGet(STORAGE_KEYS.progress, {});
  return data && typeof data === 'object' ? data : {};
}

/**
 * Mengambil progres bacaan untuk satu buku.
 * @param {string} bookId
 */
export function getBookProgress(bookId) {
  const all = getAllReadingProgress();
  return all[bookId] || null;
}

/**
 * Menyimpan progres bacaan untuk satu buku.
 * @param {string} bookId
 * @param {object} progressData
 */
export function saveBookProgress(bookId, progressData) {
  if (!bookId) return;
  const all = getAllReadingProgress();
  all[bookId] = {
    ...all[bookId],
    ...progressData,
    updatedAt: new Date().toISOString(),
  };
  safeLocalSet(STORAGE_KEYS.progress, all);
}

/**
 * Mengambil seluruh bookmark dari localStorage.
 */
export function getAllBookmarks() {
  const list = safeLocalGet(STORAGE_KEYS.bookmarks, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Menambah atau menghapus bookmark untuk sebuah buku/lokasi.
 * @param {object} entry
 */
export function addOrToggleBookmark(entry) {
  const list = getAllBookmarks();
  const idx = list.findIndex(
    (b) => b.bookId === entry.bookId && b.location === entry.location
  );
  if (idx >= 0) {
    list.splice(idx, 1);
    safeLocalSet(STORAGE_KEYS.bookmarks, list);
    return { added: false, list };
  }
  const updated = [
    {
      id: `${entry.bookId}-${Date.now()}`,
      bookId: entry.bookId,
      judul: entry.judul,
      penulis: entry.penulis,
      sampul: entry.sampul || '',
      readerType: entry.readerType,
      readUrl: entry.readUrl,
      location: entry.location,
      label: entry.label || 'Penanda Halaman',
      createdAt: new Date().toISOString(),
      bookSnapshot: entry.bookSnapshot || null,
    },
    ...list,
  ].slice(0, 50);
  safeLocalSet(STORAGE_KEYS.bookmarks, updated);
  return { added: true, list: updated };
}
