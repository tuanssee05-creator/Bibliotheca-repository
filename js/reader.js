/**
 * /js/reader.js
 * Modul Pembaca E-Book Terpadu (EPUB via epub.js, PDF via PDF.js, Internet Archive iframe,
 * serta mode teks bersih sebagai cadangan).
 */

import {
  addOrToggleBookmark,
  buildProxyUrl,
  canDownloadBook,
  getAllBookmarks,
  getBookProgress,
  saveBookProgress,
  safeLocalGet,
  safeLocalSet,
} from './core.js';

const READER_PREF_KEY = 'bs_reader_prefs_v1';

const READER_THEMES = {
  terang: { bg: '#ffffff', color: '#18181b' },
  sepia: { bg: '#f4ecd8', color: '#3b2f22' },
  gelap: { bg: '#12181b', color: '#e5ecef' },
};

export function createEbookReader({ onBookmarksChanged, onProgressChanged, showToast }) {
  const modal = document.getElementById('reader-modal');
  const closeBtn = document.getElementById('reader-close-btn');
  const errorCloseBtn = document.getElementById('reader-error-close-btn');
  const tocToggleBtn = document.getElementById('reader-toc-toggle');
  const sidebar = document.getElementById('reader-sidebar');
  const tocList = document.getElementById('reader-toc-list');
  const bookBookmarksList = document.getElementById('reader-book-bookmarks');

  const titleEl = document.getElementById('reader-book-title');
  const authorEl = document.getElementById('reader-book-author');
  const fontSlider = document.getElementById('reader-font-slider');
  const fontValueEl = document.getElementById('reader-font-value');
  const fontWrap = document.getElementById('reader-font-wrap');
  const themeBtns = Array.from(document.querySelectorAll('[data-reader-theme-btn]'));
  const bookmarkBtn = document.getElementById('reader-bookmark-btn');
  const downloadBtn = document.getElementById('reader-download-btn');

  const epubArea = document.getElementById('reader-epub-area');
  const pdfArea = document.getElementById('reader-pdf-area');
  const pdfCanvas = document.getElementById('reader-pdf-canvas');
  const textArea = document.getElementById('reader-text-area');
  const textProse = document.getElementById('reader-text-prose');
  const iframeEl = document.getElementById('reader-iframe');

  const loadingOverlay = document.getElementById('reader-loading-overlay');
  const loadingText = document.getElementById('reader-loading-text');
  const errorOverlay = document.getElementById('reader-error-overlay');
  const errorMsgEl = document.getElementById('reader-error-message');
  const retryBtn = document.getElementById('reader-retry-btn');
  const fallbackTextBtn = document.getElementById('reader-fallback-text-btn');

  const prevBtn = document.getElementById('reader-prev-btn');
  const nextBtn = document.getElementById('reader-next-btn');
  const pageStatusEl = document.getElementById('reader-page-status');
  const percentStatusEl = document.getElementById('reader-percent-status');
  const progressFillEl = document.getElementById('reader-progress-fill');
  const footerEl = document.getElementById('reader-footer');

  let currentBook = null;
  let activeMode = 'epub'; // 'epub' | 'pdf' | 'ia' | 'text'
  let epubBook = null;
  let epubRendition = null;
  let pdfDoc = null;
  let pdfPageNum = 1;
  let pdfTotalPages = 1;
  let pdfRendering = false;
  let currentCfi = '';
  let currentLocationLabel = 'Halaman 1';
  let currentPercent = 0;
  let lastFocusedEl = null;

  const savedPrefs = safeLocalGet(READER_PREF_KEY, { theme: 'terang', fontSize: 18 });
  let readerTheme = READER_THEMES[savedPrefs?.theme] ? savedPrefs.theme : 'terang';
  let fontSize = Number(savedPrefs?.fontSize) >= 14 && Number(savedPrefs?.fontSize) <= 24
    ? Number(savedPrefs.fontSize)
    : 18;

  function persistPrefs() {
    safeLocalSet(READER_PREF_KEY, { theme: readerTheme, fontSize });
  }

  function applyReaderTheme(nextTheme) {
    readerTheme = READER_THEMES[nextTheme] ? nextTheme : 'terang';
    modal.setAttribute('data-reader-theme', readerTheme);
    themeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.readerThemeBtn === readerTheme);
    });
    if (epubRendition) {
      const palette = READER_THEMES[readerTheme];
      epubRendition.themes.override('background', palette.bg);
      epubRendition.themes.override('color', palette.color);
    }
    persistPrefs();
  }

  function applyFontSize(size) {
    fontSize = Math.min(24, Math.max(14, Number(size) || 18));
    fontSlider.value = String(fontSize);
    fontValueEl.textContent = activeMode === 'pdf'
      ? `${Math.round(((fontSize - 10) / 8) * 100)}%`
      : `${fontSize}px`;

    if (epubRendition) {
      epubRendition.themes.fontSize(`${fontSize}px`);
    }
    if (activeMode === 'text') {
      textProse.style.fontSize = `${fontSize}px`;
    }
    if (activeMode === 'pdf' && pdfDoc) {
      renderPdfPage(pdfPageNum);
    }
    persistPrefs();
  }

  function resetStages() {
    epubArea.hidden = true;
    pdfArea.hidden = true;
    textArea.hidden = true;
    iframeEl.hidden = true;
    loadingOverlay.classList.remove('show');
    errorOverlay.classList.remove('show');
    fallbackTextBtn.hidden = true;
    epubArea.innerHTML = '';
    textProse.innerHTML = '';
    iframeEl.removeAttribute('src');

    if (epubRendition) {
      try {
        epubRendition.destroy();
      } catch {}
      epubRendition = null;
    }
    if (epubBook) {
      try {
        epubBook.destroy();
      } catch {}
      epubBook = null;
    }
    pdfDoc = null;
    pdfPageNum = 1;
    pdfTotalPages = 1;
    currentCfi = '';
  }

  function showLoading(message = 'Mempersiapkan buku untuk dibaca...') {
    loadingText.textContent = message;
    loadingOverlay.classList.add('show');
    errorOverlay.classList.remove('show');
  }

  function hideLoading() {
    loadingOverlay.classList.remove('show');
  }

  function showError(message, canFallbackText = false) {
    hideLoading();
    errorMsgEl.textContent = message;
    fallbackTextBtn.hidden = !canFallbackText;
    errorOverlay.classList.add('show');
  }

  function updateProgressUI(label, percent) {
    currentLocationLabel = label;
    currentPercent = Math.max(0, Math.min(100, Math.round(percent)));
    pageStatusEl.textContent = label;
    percentStatusEl.textContent = `${currentPercent}%`;
    progressFillEl.style.width = `${currentPercent}%`;
  }

  function renderBookBookmarks() {
    if (!currentBook) return;
    const all = getAllBookmarks().filter((b) => b.bookId === currentBook.id);
    bookBookmarksList.innerHTML = '';

    if (all.length === 0) {
      const li = document.createElement('li');
      li.style.fontSize = '0.82rem';
      li.style.color = 'var(--r-muted)';
      li.textContent = 'Belum ada penanda di buku ini.';
      bookBookmarksList.appendChild(li);
      return;
    }

    all.forEach((bm) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toc-btn';
      btn.textContent = bm.label || 'Penanda tersimpan';
      btn.addEventListener('click', () => {
        if (activeMode === 'epub' && epubRendition && bm.location) {
          epubRendition.display(bm.location);
        } else if (activeMode === 'pdf' && pdfDoc && bm.location) {
          const targetPage = Number(bm.location);
          if (targetPage >= 1 && targetPage <= pdfTotalPages) {
            renderPdfPage(targetPage);
          }
        } else if (activeMode === 'text' && bm.location) {
          textArea.scrollTop = Number(bm.location) || 0;
        }
        if (window.innerWidth <= 900) {
          sidebar.classList.remove('open');
          tocToggleBtn.setAttribute('aria-expanded', 'false');
        }
      });
      li.appendChild(btn);
      bookBookmarksList.appendChild(li);
    });
  }

  function renderTocItems(items) {
    tocList.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.style.fontSize = '0.82rem';
      li.style.color = 'var(--r-muted)';
      li.textContent = 'Daftar isi tidak tersedia untuk dokumen ini.';
      tocList.appendChild(li);
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toc-btn';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        item.onSelect();
        if (window.innerWidth <= 900) {
          sidebar.classList.remove('open');
          tocToggleBtn.setAttribute('aria-expanded', 'false');
        }
      });
      li.appendChild(btn);
      tocList.appendChild(li);
    });
  }

  async function fetchDocumentBuffer(url) {
    const isRemote = /^https?:\/\//i.test(url);
    if (!isRemote) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Gagal memuat berkas lokal (${res.status}).`);
      return await res.arrayBuffer();
    }

    // Coba langsung terlebih dahulu, lalu fallback otomatis lewat /api/proxy bila CORS memblokir
    try {
      const directRes = await fetch(url);
      if (directRes.ok) {
        return await directRes.arrayBuffer();
      }
    } catch {
      // Lanjut ke proxy serverless
    }

    const proxyUrl = buildProxyUrl(url);
    const proxiedRes = await fetch(proxyUrl);
    if (!proxiedRes.ok) {
      throw new Error(`Sumber eksternal tidak dapat diakses (status ${proxiedRes.status}).`);
    }
    return await proxiedRes.arrayBuffer();
  }

  async function loadEpub(book) {
    if (typeof window.ePub !== 'function') {
      throw new Error('Pustaka epub.js belum tersedia. Periksa koneksi internet Anda.');
    }

    activeMode = 'epub';
    epubArea.hidden = false;
    footerEl.hidden = false;
    fontWrap.hidden = false;
    prevBtn.disabled = false;
    nextBtn.disabled = false;

    showLoading('Mengunduh dan membuka berkas EPUB...');
    const buffer = await fetchDocumentBuffer(book.readUrl);

    epubBook = window.ePub(buffer);
    await epubBook.ready;

    epubRendition = epubBook.renderTo(epubArea, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
    });

    const palette = READER_THEMES[readerTheme];
    epubRendition.themes.default({
      body: {
        'font-family': 'Lora, Georgia, serif',
        'line-height': '1.75',
        padding: '12px 16px',
        background: palette.bg,
        color: palette.color,
      },
      'h1, h2, h3': {
        'font-family': 'Poppins, sans-serif',
      },
    });
    epubRendition.themes.fontSize(`${fontSize}px`);

    const saved = getBookProgress(book.id);
    await epubRendition.display(saved?.cfi || undefined);
    hideLoading();

    // Muat daftar isi
    const navigation = await epubBook.loaded.navigation;
    const flatToc = [];
    const walkToc = (nodes, prefix = '') => {
      (nodes || []).forEach((node) => {
        const cleanLabel = String(node.label || 'Bab').trim();
        flatToc.push({
          label: `${prefix}${cleanLabel}`,
          onSelect: () => epubRendition.display(node.href),
        });
        if (Array.isArray(node.subitems) && node.subitems.length > 0) {
          walkToc(node.subitems, `${prefix}— `);
        }
      });
    };
    walkToc(navigation?.toc || []);
    renderTocItems(flatToc);

    // Hitung lokasi untuk persentase progres secara latar belakang
    epubBook.locations.generate(1024).catch(() => {});

    epubRendition.on('relocated', (location) => {
      if (!location?.start) return;
      currentCfi = location.start.cfi || '';
      const pct = typeof location.start.percentage === 'number'
        ? Math.round(location.start.percentage * 100)
        : (epubBook.locations.total > 0
            ? Math.round(epubBook.locations.percentageFromCfi(currentCfi) * 100)
            : 0);

      const pageInfo = location.start.displayed
        ? `Halaman ${location.start.displayed.page} / ${location.start.displayed.total}`
        : 'Sedang membaca';

      updateProgressUI(pageInfo, pct);
      saveBookProgress(book.id, {
        cfi: currentCfi,
        percent: pct,
        label: pageInfo,
        judul: book.judul,
      });
      if (onProgressChanged) onProgressChanged();
    });
  }

  async function renderPdfPage(num) {
    if (!pdfDoc || pdfRendering) return;
    pdfRendering = true;
    try {
      const page = await pdfDoc.getPage(num);
      const scale = 0.8 + ((fontSize - 14) / 10) * 0.9;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      pdfCanvas.width = Math.floor(viewport.width * dpr);
      pdfCanvas.height = Math.floor(viewport.height * dpr);
      pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
      pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = pdfCanvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({ canvasContext: ctx, viewport }).promise;
      pdfPageNum = num;
      pdfArea.scrollTop = 0;

      const pct = pdfTotalPages > 0 ? Math.round((num / pdfTotalPages) * 100) : 100;
      const label = `Halaman ${num} dari ${pdfTotalPages}`;
      updateProgressUI(label, pct);
      prevBtn.disabled = num <= 1;
      nextBtn.disabled = num >= pdfTotalPages;

      if (currentBook) {
        saveBookProgress(currentBook.id, {
          page: num,
          percent: pct,
          label,
          judul: currentBook.judul,
        });
        if (onProgressChanged) onProgressChanged();
      }
    } finally {
      pdfRendering = false;
    }
  }

  async function loadPdf(book) {
    if (!window.pdfjsLib) {
      throw new Error('Pustaka PDF.js belum tersedia. Periksa koneksi internet Anda.');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

    activeMode = 'pdf';
    pdfArea.hidden = false;
    footerEl.hidden = false;
    fontWrap.hidden = false;

    showLoading('Memuat dokumen PDF...');
    const buffer = await fetchDocumentBuffer(book.readUrl);
    const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
    pdfDoc = await loadingTask.promise;
    pdfTotalPages = pdfDoc.numPages || 1;

    const saved = getBookProgress(book.id);
    const initialPage = saved?.page && saved.page >= 1 && saved.page <= pdfTotalPages ? saved.page : 1;

    // Muat daftar halaman / outline sebagai Daftar Isi
    const tocEntries = [];
    for (let i = 1; i <= pdfTotalPages; i++) {
      tocEntries.push({
        label: `Halaman ${i}`,
        onSelect: () => renderPdfPage(i),
      });
    }
    renderTocItems(tocEntries);

    await renderPdfPage(initialPage);
    hideLoading();
  }

  function loadInternetArchive(book) {
    activeMode = 'ia';
    iframeEl.hidden = false;
    footerEl.hidden = true;
    fontWrap.hidden = true;
    renderTocItems([
      {
        label: 'Pembaca Internet Archive Aktif',
        onSelect: () => {},
      },
    ]);

    showLoading('Menghubungkan ke pembaca arsip Internet Archive...');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      hideLoading();
    };

    iframeEl.onload = done;
    iframeEl.onerror = () => {
      settled = true;
      showError('Gagal memuat pratinjau dari Internet Archive. Coba muat ulang beberapa saat lagi.');
    };
    iframeEl.src = book.readUrl;
    setTimeout(done, 4500);
    saveBookProgress(book.id, {
      percent: 10,
      label: 'Dibuka di Internet Archive',
      judul: book.judul,
    });
    if (onProgressChanged) onProgressChanged();
  }

  async function loadTextFallback(book, explicitUrl) {
    const targetUrl = explicitUrl || book.fallbackTextUrl || book.readUrl;
    if (!targetUrl) {
      throw new Error('Tidak ada sumber teks cadangan untuk buku ini.');
    }

    activeMode = 'text';
    textArea.hidden = false;
    footerEl.hidden = false;
    fontWrap.hidden = false;
    prevBtn.disabled = false;
    nextBtn.disabled = false;

    showLoading('Memuat teks bacaan...');
    const res = await fetch(buildProxyUrl(targetUrl));
    if (!res.ok) {
      throw new Error(`Gagal memuat teks buku (status ${res.status}).`);
    }
    const raw = await res.text();

    // Sanitasi aman menggunakan DOMParser (tanpa script/style/atribut event)
    textProse.innerHTML = '';
    if (/<html|<body|<p>/i.test(raw)) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      const blocks = doc.body ? Array.from(doc.body.querySelectorAll('h1, h2, h3, p')) : [];
      if (blocks.length > 0) {
        blocks.slice(0, 600).forEach((node) => {
          const tag = node.tagName.toLowerCase();
          const el = document.createElement(tag);
          el.textContent = node.textContent.trim();
          if (el.textContent) textProse.appendChild(el);
        });
      } else {
        const p = document.createElement('p');
        p.textContent = doc.body?.textContent || raw;
        textProse.appendChild(p);
      }
    } else {
      raw.split(/\r?\n\s*\r?\n/).slice(0, 800).forEach((chunk) => {
        const p = document.createElement('p');
        p.textContent = chunk.trim();
        if (p.textContent) textProse.appendChild(p);
      });
    }

    textProse.style.fontSize = `${fontSize}px`;
    const saved = getBookProgress(book.id);
    if (saved?.scrollTop) {
      textArea.scrollTop = Number(saved.scrollTop) || 0;
    }

    const updateTextScrollProgress = () => {
      const maxScroll = Math.max(1, textArea.scrollHeight - textArea.clientHeight);
      const pct = Math.round((textArea.scrollTop / maxScroll) * 100);
      updateProgressUI(`Gulir ${pct}%`, pct);
      saveBookProgress(book.id, {
        scrollTop: textArea.scrollTop,
        percent: pct,
        label: `Mode Teks (${pct}%)`,
        judul: book.judul,
      });
    };

    textArea.onscroll = updateTextScrollProgress;
    updateTextScrollProgress();
    renderTocItems([{ label: 'Awal Naskah', onSelect: () => { textArea.scrollTop = 0; } }]);
    hideLoading();
  }

  async function openBook(book) {
    if (!book) return;
    lastFocusedEl = document.activeElement;
    currentBook = book;

    titleEl.textContent = book.judul;
    authorEl.textContent = `${book.penulis} · ${book.lisensi}`;

    if (canDownloadBook(book)) {
      downloadBtn.hidden = false;
      downloadBtn.href = /^https?:\/\//i.test(book.downloadUrl) && book.format !== 'ia-embed'
        ? buildProxyUrl(book.downloadUrl)
        : book.downloadUrl;
      if (book.format === 'ia-embed') {
        downloadBtn.removeAttribute('download');
        downloadBtn.target = '_blank';
        downloadBtn.rel = 'noopener noreferrer';
      } else {
        downloadBtn.setAttribute('download', '');
        downloadBtn.removeAttribute('target');
      }
    } else {
      downloadBtn.hidden = true;
      downloadBtn.removeAttribute('href');
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    applyReaderTheme(readerTheme);
    applyFontSize(fontSize);
    renderBookBookmarks();
    closeBtn.focus();

    resetStages();
    try {
      if (book.readerType === 'epub') {
        await loadEpub(book);
      } else if (book.readerType === 'pdf') {
        await loadPdf(book);
      } else if (book.readerType === 'ia') {
        loadInternetArchive(book);
      } else {
        await loadTextFallback(book);
      }
    } catch (err) {
      showError(
        err?.message || 'Terjadi kendala saat membuka buku ini.',
        Boolean(book.fallbackTextUrl)
      );
    }
  }

  function closeReader() {
    modal.classList.remove('open');
    sidebar.classList.remove('open');
    tocToggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    resetStages();
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
  }

  function goPrev() {
    if (activeMode === 'epub' && epubRendition) {
      epubRendition.prev();
    } else if (activeMode === 'pdf' && pdfDoc && pdfPageNum > 1) {
      renderPdfPage(pdfPageNum - 1);
    } else if (activeMode === 'text') {
      textArea.scrollBy({ top: -Math.round(textArea.clientHeight * 0.8), behavior: 'smooth' });
    }
  }

  function goNext() {
    if (activeMode === 'epub' && epubRendition) {
      epubRendition.next();
    } else if (activeMode === 'pdf' && pdfDoc && pdfPageNum < pdfTotalPages) {
      renderPdfPage(pdfPageNum + 1);
    } else if (activeMode === 'text') {
      textArea.scrollBy({ top: Math.round(textArea.clientHeight * 0.8), behavior: 'smooth' });
    }
  }

  // Event listeners
  closeBtn.addEventListener('click', closeReader);
  errorCloseBtn.addEventListener('click', closeReader);
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);

  tocToggleBtn.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    tocToggleBtn.setAttribute('aria-expanded', String(isOpen));
  });

  fontSlider.addEventListener('input', (e) => {
    applyFontSize(e.target.value);
  });

  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyReaderTheme(btn.dataset.readerThemeBtn);
    });
  });

  bookmarkBtn.addEventListener('click', () => {
    if (!currentBook) return;
    let location = 'start';
    if (activeMode === 'epub') location = currentCfi || 'start';
    else if (activeMode === 'pdf') location = String(pdfPageNum);
    else if (activeMode === 'text') location = String(Math.round(textArea.scrollTop));

    const result = addOrToggleBookmark({
      bookId: currentBook.id,
      judul: currentBook.judul,
      penulis: currentBook.penulis,
      sampul: currentBook.sampul,
      readerType: currentBook.readerType,
      readUrl: currentBook.readUrl,
      location,
      label: `${currentLocationLabel} (${currentPercent}%)`,
      bookSnapshot: currentBook,
    });

    renderBookBookmarks();
    if (onBookmarksChanged) onBookmarksChanged(result.list);
    if (showToast) {
      showToast(result.added ? 'Penanda halaman disimpan.' : 'Penanda halaman dihapus.');
    }
  });

  retryBtn.addEventListener('click', () => {
    if (currentBook) openBook(currentBook);
  });

  fallbackTextBtn.addEventListener('click', async () => {
    if (!currentBook) return;
    resetStages();
    try {
      await loadTextFallback(currentBook, currentBook.fallbackTextUrl);
    } catch (err) {
      showError(err?.message || 'Mode teks ringan juga gagal dimuat.');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') {
      closeReader();
    } else if (e.key === 'ArrowLeft') {
      goPrev();
    } else if (e.key === 'ArrowRight') {
      goNext();
    }
  });

  return {
    openBook,
    closeReader,
  };
}
