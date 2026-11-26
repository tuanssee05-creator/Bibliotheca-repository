/**
 * Vercel Serverless Function (Node.js ESM) — /api/proxy.js
 * Proxy aman untuk mengambil e-book EPUB/PDF/teks dari domain terbuka yang diizinkan
 * guna mengatasi pembatasan CORS di browser tanpa membuka celah SSRF.
 */

const ALLOWED_ROOT_DOMAINS = [
  'gutenberg.org',
  'gutendex.com',
  'archive.org',
  'openlibrary.org',
];

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20000;
const MAX_PAYLOAD_BYTES = 35 * 1024 * 1024; // 35 MB

/**
 * Memeriksa apakah hostname adalah IP literal atau alamat lokal/privat.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().trim();
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // Blokir IPv6 literal atau bracketed host
  if (host.includes(':') || host.startsWith('[')) {
    return true;
  }

  // Blokir IPv4 literal (termasuk loopback, privat, link-local / metadata 169.254.169.254)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  return false;
}

/**
 * Memvalidasi apakah URL termasuk dalam whitelist domain legal yang diizinkan.
 * @param {string} rawUrl
 * @returns {{ valid: boolean, url?: URL, reason?: string }}
 */
export function validateTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Parameter url wajib diisi.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Format URL tidak valid.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Hanya protokol HTTP/HTTPS yang diizinkan.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Kredensial dalam URL tidak diizinkan.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHost(hostname)) {
    return { valid: false, reason: 'Host tidak diizinkan.' };
  }

  const isAllowed = ALLOWED_ROOT_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );

  if (!isAllowed) {
    return {
      valid: false,
      reason: `Domain "${hostname}" tidak termasuk daftar putih perpustakaan terbuka.`,
    };
  }

  return { valid: true, url: parsed };
}

/**
 * Melakukan fetch dengan pemeriksaan redirect manual agar setiap hop tetap berada di domain whitelist.
 * @param {URL} initialUrl
 */
async function safeFetchWithRedirects(initialUrl) {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'BibliothecaSophia/1.0 (+https://bibliotheca-sophia.vercel.app)',
          Accept: 'application/epub+zip, application/pdf, text/html, text/plain, application/json, */*',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect tanpa header Location.');
      }
      const nextRaw = new URL(location, currentUrl).toString();
      const check = validateTargetUrl(nextRaw);
      if (!check.valid || !check.url) {
        const err = new Error(check.reason || 'Tujuan redirect tidak diizinkan.');
        err.statusCode = 403;
        throw err;
      }
      currentUrl = check.url;
      continue;
    }

    return response;
  }

  const err = new Error('Terlalu banyak pengalihan (redirect).');
  err.statusCode = 502;
  throw err;
}

export default async function handler(req, res) {
  // Header CORS untuk akses dari frontend situs
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metode tidak diizinkan. Gunakan GET.' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  const validation = validateTargetUrl(rawUrl);

  if (!validation.valid || !validation.url) {
    return res.status(403).json({ error: validation.reason || 'URL ditolak.' });
  }

  try {
    const upstream = await safeFetchWithRedirects(validation.url);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Sumber eksternal merespons dengan status ${upstream.status}.`,
      });
    }

    const contentLengthHeader = upstream.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Ukuran berkas melebihi batas maksimal 35 MB.' });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Ukuran berkas melebihi batas maksimal 35 MB.' });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    const status = err?.statusCode || (err?.name === 'AbortError' ? 504 : 502);
    return res.status(status).json({
      error: err?.name === 'AbortError'
        ? 'Waktu tunggu ke server sumber habis.'
        : (err?.message || 'Gagal mengambil dokumen dari sumber eksternal.'),
    });
  }
}
