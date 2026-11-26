# Bibliotheca Sophia

**Akses ilmu kapan saja, di mana saja.**

Bibliotheca Sophia adalah website perpustakaan digital modern, minimalis, dan responsif berbahasa Indonesia. Situs ini dibangun dengan HTML, CSS, dan JavaScript murni (tanpa framework berat) dan langsung siap di-deploy ke **Vercel sebagai static site** (tanpa build step), dilengkapi fungsi serverless opsional di `/api/proxy.js` untuk membaca EPUB dari Project Gutenberg tanpa hambatan CORS.

## Fitur Utama

- **Koleksi Nyata & Legal (Tanpa API Key):**
  - **Koleksi Lokal**: File EPUB dan PDF milik sendiri di folder `/public/ebooks/` yang didaftarkan melalui `/data/koleksi-lokal.json`.
  - **Project Gutenberg (via Gutendex API)**: Pencarian, sampul, metadata, serta tautan EPUB/HTML/teks domain publik.
  - **Open Library & Internet Archive**: Metadata, sampul tambahan, dan pembaca embed resmi `https://archive.org/embed/{identifier}` untuk buku domain publik / open access.
- **Pembaca E-Book Terpadu di Dalam Situs:**
  - **EPUB**: Menggunakan `epub.js` (`0.3.93`) + `JSZip` (`3.10.1`).
  - **PDF**: Menggunakan `PDF.js` (`3.11.174`).
  - **Internet Archive**: Embed langsung di dalam modal pembaca.
  - **Kontrol Lengkap**: Daftar isi, navigasi halaman/bab (termasuk tombol panah keyboard), slider ukuran huruf, tema baca (**Terang**, **Sepia**, **Gelap**), penanda halaman (*bookmark*), dan progres bacaan tersimpan otomatis di `localStorage`.
  - **Unduhan Berbasis Lisensi**: Tombol **Unduh** hanya muncul jika lisensi buku mengizinkan.
- **Performa & Pengalaman Pengguna:**
  - Pencarian *real-time* dengan *debounce* serta filter Kategori, Bahasa, dan Sumber.
  - Cache hasil API di `sessionStorage` untuk menghemat *request*.
  - Mode Gelap (*Dark Mode*) dengan preferensi tersimpan aman di `localStorage`.

---

## Struktur Proyek

```text
/
├── api/
│   └── proxy.js              # Serverless function (Node.js ESM) untuk proxy CORS whitelist
├── css/
│   └── style.css             # Stylesheet utama dengan CSS variables (Terang & Gelap)
├── data/
│   └── koleksi-lokal.json    # Daftar buku lokal (EPUB & PDF)
├── js/
│   ├── app.js                # Logika katalog, filter, cache, pencarian, dan UI
│   ├── core.js               # Utilitas murni, normalisasi data API, & storage aman
│   └── reader.js             # Pembaca e-book (epub.js, PDF.js, Internet Archive)
├── public/
│   └── ebooks/               # Simpan file .epub dan .pdf milik Anda di sini
├── index.html                # Halaman utama perpustakaan
├── package.json              # Konfigurasi minimal proyek
├── vercel.json               # Konfigurasi static site, cleanUrls, keamanan, & cache
└── README.md                 # Panduan ini
```

---

## Cara Deploy ke Vercel

Proyek ini dirancang agar dapat langsung di-deploy sebagai static site tanpa proses *build* yang rumit, sementara `/api/proxy.js` otomatis berjalan sebagai Vercel Serverless Function.

### Opsi 1: Deploy lewat GitHub
1. Unggah (*push*) seluruh isi proyek ini ke repositori GitHub Anda.
2. Buka [vercel.com](https://vercel.com) dan masuk dengan akun GitHub Anda.
3. Klik **Add New... → Project**, lalu pilih repositori **Bibliotheca Sophia**.
4. Pada pengaturan proyek:
   - **Framework Preset**: `Other` (otomatis terdeteksi dari `vercel.json`)
   - **Build Command**: biarkan bawaan `vercel.json`
   - **Output Directory**: `.` (root)
5. Klik **Deploy**. Dalam beberapa detik situs perpustakaan Anda sudah aktif secara daring.

### Opsi 2: Deploy lewat Vercel CLI
1. Pastikan Node.js terpasang, lalu pasang Vercel CLI secara global:
   ```bash
   npm install -g vercel
   ```
2. Masuk ke akun Vercel Anda:
   ```bash
   vercel login
   ```
3. Jalankan perintah deploy dari direktori proyek:
   ```bash
   vercel --prod
   ```
4. Ikuti petunjuk di terminal. File di `/api/proxy.js` akan otomatis menjadi endpoint `/api/proxy`.

---

## Kustomisasi Mudah

### 1. Mengganti Nama & Tagline Perpustakaan
- Buka `/index.html` dan ubah teks **Bibliotheca Sophia** serta tagline **Akses ilmu kapan saja, di mana saja** pada tag `<title>`, `<meta>`, navbar `.brand-link`, bagian Hero (`#beranda`), dan `<footer>`.

### 2. Mengganti Warna Utama
- Buka `/css/style.css` dan ubah nilai variabel CSS pada blok `:root` (untuk mode terang) dan `html[data-theme='dark']` (untuk mode gelap):
  ```css
  :root {
    --accent-primary: #0f6b66;       /* Warna utama (mis. biru tua: #1e3a8a) */
    --accent-primary-hover: #0b524e; /* Warna saat hover */
    --accent-primary-soft: rgba(15, 107, 102, 0.08);
  }
  ```

### 3. Menambah E-Book Lokal Sendiri
1. Salin file `.epub` atau `.pdf` milik Anda ke dalam folder `/public/ebooks/` (misalnya `/public/ebooks/pengantar-astronomi.pdf`).
2. Jika Anda memiliki gambar sampul, letakkan di `/public/ebooks/` atau folder aset gambar Anda.
3. Daftarkan buku tersebut di `/data/koleksi-lokal.json`:
   ```json
   {
     "id": "lokal-astronomi-01",
     "judul": "Pengantar Astronomi Dasar",
     "penulis": "Nama Penulis",
     "kategori": "Sains",
     "bahasa": "id",
     "format": "pdf",
     "file": "/public/ebooks/pengantar-astronomi.pdf",
     "sampul": "",
     "tahun": 2025,
     "lisensi": "CC BY 4.0",
     "bolehUnduh": true,
     "deskripsi": "Ringkasan singkat mengenai isi buku."
   }
   ```
4. Simpan perubahan — buku baru Anda akan langsung muncul di bagian **Koleksi E-Book** dan dapat dibaca langsung di dalam situs.
