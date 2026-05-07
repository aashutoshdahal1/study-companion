import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8788;
const htmlPath = path.join(__dirname, 'index.html');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function setCors(res, contentType = 'text/plain') {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader('Content-Type', contentType);
}

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.sendStatus(200);
  }
  next();
});

app.get('/ping', (req, res) => {
  setCors(res, 'application/json');
  res.status(200).send('{"status":"ok"}');
});

app.get('/', (req, res) => {
  res.sendFile(htmlPath);
});

app.get('/index.html', (req, res) => {
  res.sendFile(htmlPath);
});

app.get("/health", (req, res) => {
  setCors(res, 'application/json');
  res.status(200).send('{"status":"healthy"}');
}); 
app.post('/', express.raw({ type: 'application/json', limit: '10mb' }), async (req, res) => {
  const token = req.get('X-Token') || '';
  const cookie = req.get('X-Cookie') || '';
  const query = req.url.includes('?') ? req.url.split('?', 2)[1] : '';
  const target = query
    ? `https://chat.z.ai/api/v2/chat/completions?${query}` 
    : 'https://chat.z.ai/api/v2/chat/completions';

  console.log(`  → Target: ${target.slice(0, 100)}`);
  console.log(`  → Token: ${token.slice(0, 30)}...`);
  console.log(`  → Body size: ${req.body ? req.body.length : 0} bytes`);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: 'https://chat.z.ai',
        Referer: 'https://chat.z.ai/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-fe-version': 'prod-fe-1.1.21',
        'x-region': 'overseas',
        Cookie: cookie,
      },
      body: req.body,
    });

    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text();
      console.log(`  → HTTP Error ${upstream.status}: ${errorText.slice(0, 200)}`);
      setCors(res, 'application/json');
      return res.status(upstream.status).send(JSON.stringify({
        error: `HTTP ${upstream.status}`,
        detail: errorText,
      }));
    }

    console.log(`  → Response status: ${upstream.status}`);
    setCors(res, 'text/event-stream; charset=utf-8');
    res.status(200);
    res.flushHeaders();

    const reader = upstream.body.getReader();
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.length;
        res.write(Buffer.from(value));
      }
    }

    res.end();
    console.log(`  → Streamed ${total} bytes total`);
  } catch (error) {
    console.log(`  → Exception: ${error.message}`);
    setCors(res, 'application/json');
    res.status(502).send(JSON.stringify({ error: error.message }));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Proxy running at http://localhost:${PORT}/`);
  console.log(`  Open http://localhost:${PORT}/ in your browser`);
  console.log('  Press Ctrl+C to stop\n');
});
