import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import proxyHandler from './api/proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Mount serverless proxy handler identical to Vercel /api/proxy
app.all('/api/proxy', (req, res) => proxyHandler(req, res));

// Serve static files from root with proper MIME types for EPUB/PDF
app.use(
  express.static(__dirname, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.epub')) {
        res.setHeader('Content-Type', 'application/epub+zip');
      } else if (filePath.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
      }
    },
  })
);

// Clean URL fallback to index.html for unknown non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bibliotheca Sophia running at http://localhost:${PORT}`);
});
