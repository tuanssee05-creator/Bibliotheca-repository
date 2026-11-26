import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProxyUrl,
  canDownloadBook,
  filterBooks,
  formatLanguageLabel,
  inferCategory,
  isAllowedProxyUrl,
  normalizeGutendexBook,
  normalizeLocalBook,
  normalizeOpenLibraryBook,
} from '../js/core.js';

test('inferCategory maps English and Indonesian subjects accurately', () => {
  assert.equal(inferCategory(['Botany', 'Natural History']), 'Sains');
  assert.equal(inferCategory(['Children\'s fairy tales']), 'Anak');
  assert.equal(inferCategory(['World History', 'Voyages']), 'Sejarah');
  assert.equal(inferCategory([], 'Teknologi'), 'Teknologi');
});

test('normalizeGutendexBook extracts EPUB and respects copyright flag for downloads', () => {
  const normalized = normalizeGutendexBook({
    id: 1342,
    title: 'Pride and Prejudice',
    copyright: false,
    authors: [{ name: 'Austen, Jane' }],
    languages: ['en'],
    subjects: ['Fiction', 'Courtship'],
    formats: {
      'application/epub+zip': 'https://www.gutenberg.org/ebooks/1342.epub3.images',
      'image/jpeg': 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    },
  });

  assert.equal(normalized.id, 'gutenberg-1342');
  assert.equal(normalized.readerType, 'epub');
  assert.equal(normalized.bahasaLabel, 'Inggris');
  assert.equal(canDownloadBook(normalized), true);
});

test('normalizeOpenLibraryBook skips non-public books and creates Internet Archive embed for public scans', () => {
  const restricted = normalizeOpenLibraryBook({
    key: '/works/OL1W',
    title: 'Restricted Book',
    ebook_access: 'borrowable',
    ia: ['restricted123'],
    public_scan_b: false,
  });
  assert.equal(restricted, null);

  const openBook = normalizeOpenLibraryBook({
    key: '/works/OL2W',
    title: 'Origin of Species',
    author_name: ['Charles Darwin'],
    ebook_access: 'public',
    public_scan_b: true,
    ia: ['originofspecies00darw'],
    language: ['eng'],
    subject: ['Science', 'Biology'],
  });
  assert.ok(openBook);
  assert.equal(openBook.readerType, 'ia');
  assert.equal(openBook.readUrl, 'https://archive.org/embed/originofspecies00darw');
  assert.equal(openBook.kategori, 'Sains');
});

test('filterBooks filters by query, category, language, and source', () => {
  const books = [
    normalizeLocalBook({
      id: '1',
      judul: 'Filosofi Alam',
      penulis: 'Ratna',
      kategori: 'Sains',
      bahasa: 'id',
      format: 'epub',
      file: '/public/ebooks/filosofi.epub',
    }),
    normalizeGutendexBook({
      id: 84,
      title: 'Frankenstein',
      copyright: false,
      authors: [{ name: 'Mary Shelley' }],
      languages: ['en'],
      subjects: ['Gothic Fiction'],
      formats: { 'application/epub+zip': 'https://www.gutenberg.org/ebooks/84.epub' },
    }),
  ];

  assert.equal(filterBooks(books, { category: 'Sains' }).length, 1);
  assert.equal(filterBooks(books, { language: 'en' }).length, 1);
  assert.equal(filterBooks(books, { source: 'Koleksi Lokal' }).length, 1);
  assert.equal(filterBooks(books, { query: 'shelley' }).length, 1);
});

test('proxy URL helpers allow whitelisted domains and reject arbitrary hosts', () => {
  assert.equal(isAllowedProxyUrl('https://www.gutenberg.org/ebooks/11.epub'), true);
  assert.equal(isAllowedProxyUrl('https://archive.org/download/test/test.pdf'), true);
  assert.equal(isAllowedProxyUrl('https://evil.example.com/file.epub'), false);
  assert.equal(
    buildProxyUrl('https://www.gutenberg.org/ebooks/11.epub'),
    '/api/proxy?url=https%3A%2F%2Fwww.gutenberg.org%2Febooks%2F11.epub'
  );
  assert.equal(buildProxyUrl('/public/ebooks/local.epub'), '/public/ebooks/local.epub');
  assert.equal(formatLanguageLabel('id'), 'Indonesia');
});
