// DeepAI Proxy Server
// Run: node deepai-server.js
// Requires: npm install express node-fetch

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8789;

// CORS — allow all browser requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Ping endpoint for status checking
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve the chat HTML (optional)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'deepai-chat.html')));

// Proxy POST to DeepAI
app.post('/api', express.urlencoded({ extended: true, limit: '10mb' }), async (req, res) => {
  try {
    const params = new URLSearchParams(req.body).toString();

    const upstream = await fetch('https://api.deepai.org/hacking_is_a_serious_crime', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://deepai.org',
        'Referer': 'https://deepai.org/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: params,
    });

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain');

    // Stream response back
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ DeepAI Proxy running → http://localhost:${PORT}`);
  console.log(`  Open http://localhost:${PORT}/ in your browser`);
  console.log('  Press Ctrl+C to stop');
});
