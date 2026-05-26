import express from 'express';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8788;
const htmlPath = path.join(__dirname, 'index.html');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

function setCors(res, contentType = 'text/plain') {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader('Content-Type', contentType);
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Only parse JSON for /api/* routes — the root POST proxy needs raw body.
// Exclude /api/audioconvert/* so express.raw() on that route gets the body first.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/audioconvert')) return next();
  express.json()(req, res, next);
});

// ── TTS voices ───────────────────────────────────────────────────────────────
const VOICES = [
  { id: 'voice-1',  name: 'Adam',      gender: 'male',    accent: 'American' },
  { id: 'voice-2',  name: 'Alice',     gender: 'female',  accent: 'British' },
  { id: 'voice-3',  name: 'Brian',     gender: 'male',    accent: 'British' },
  { id: 'voice-4',  name: 'Carla',     gender: 'female',  accent: 'Italian' },
  { id: 'voice-5',  name: 'Charlie',   gender: 'male',    accent: 'Australian' },
  { id: 'voice-6',  name: 'Charlotte', gender: 'female',  accent: 'Swedish' },
  { id: 'voice-7',  name: 'Chris',     gender: 'male',    accent: 'American' },
  { id: 'voice-8',  name: 'Daniel',    gender: 'male',    accent: 'British' },
  { id: 'voice-9',  name: 'Eric',      gender: 'male',    accent: 'American' },
  { id: 'voice-10', name: 'George',    gender: 'male',    accent: 'British' },
  { id: 'voice-11', name: 'Jessica',   gender: 'female',  accent: 'American' },
  { id: 'voice-12', name: 'Laura',     gender: 'female',  accent: 'American' },
  { id: 'voice-13', name: 'Liam',      gender: 'male',    accent: 'American' },
  { id: 'voice-14', name: 'Lily',      gender: 'female',  accent: 'British' },
  { id: 'voice-15', name: 'Matilda',   gender: 'female',  accent: 'Australian' },
  { id: 'voice-16', name: 'Nicole',    gender: 'female',  accent: 'American' },
  { id: 'voice-17', name: 'River',     gender: 'neutral', accent: 'American' },
  { id: 'voice-18', name: 'Roger',     gender: 'male',    accent: 'American' },
  { id: 'voice-19', name: 'Sarah',     gender: 'female',  accent: 'American' },
  { id: 'voice-20', name: 'Will',      gender: 'male',    accent: 'American' },
  { id: 'voice-79', name: 'Nova',      gender: 'female',  accent: 'American' },
];

app.get('/api/voices', (req, res) => {
  setCors(res, 'application/json');
  res.json({ voices: VOICES });
});

app.post('/api/tts', (req, res) => {
  const { text, voice = 'voice-79', pitch = 0, rate = 0 } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 chars)' });
  }

  const payload = JSON.stringify({ text, voice, pitch, rate });

  const options = {
    hostname: 'speechma.com',
    path: '/com.api/tts-api.php',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Accept: '*/*',
      Origin: 'https://speechma.com',
      Referer: 'https://speechma.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';

    if (proxyRes.statusCode !== 200 || !contentType.includes('audio')) {
      let body = '';
      proxyRes.on('data', (c) => (body += c));
      proxyRes.on('end', () => {
        res.status(502).json({ error: 'Upstream TTS service error', detail: body.slice(0, 200) });
      });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${voice}.mp3"`);
    if (proxyRes.headers['content-length']) {
      res.setHeader('Content-Length', proxyRes.headers['content-length']);
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('TTS proxy error:', err);
    res.status(500).json({ error: 'Failed to reach TTS service' });
  });

  proxyReq.write(payload);
  proxyReq.end();
});

// ── Utility routes ───────────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
  setCors(res, 'application/json');
  res.status(200).send('{"status":"ok"}');
});

app.get('/health', (req, res) => {
  setCors(res, 'application/json');
  res.status(200).send('{"status":"healthy"}');
});

app.get('/deepai-ping', async (req, res) => {
  setCors(res, 'application/json');
  try {
    const r = await fetch('http://localhost:8789/ping', { signal: AbortSignal.timeout(1000) });
    res.status(r.ok ? 200 : 502).send(r.ok ? '{"status":"ok"}' : '{"status":"offline"}');
  } catch {
    res.status(502).send('{"status":"offline"}');
  }
});

app.post('/deepai-api', express.urlencoded({ extended: true, limit: '10mb' }), async (req, res) => {
  setCors(res, 'text/plain');
  try {
    const upstream = await fetch('http://localhost:8789/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(req.body).toString(),
    });
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain');
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.sendFile(htmlPath));
app.get('/index.html', (req, res) => res.sendFile(htmlPath));

// ── Chat AI proxy ────────────────────────────────────────────────────────────
app.post('/', express.raw({ type: 'application/json', limit: '10mb' }), async (req, res) => {
  const token = req.get('X-Token') || '';
  const cookie = req.get('X-Cookie') || '';
  const query = req.url.includes('?') ? req.url.split('?', 2)[1] : '';
  const target = query
    ? `https://chat.z.ai/api/v2/chat/completions?${query}`
    : 'https://chat.z.ai/api/v2/chat/completions';

  // Forward any x-* headers the client sent (x-signature, x-fe-version, etc.)
  const extraHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith('x-') && k !== 'x-token' && k !== 'x-cookie') {
      extraHeaders[k] = v;
    }
  }
  const userAgent = req.get('X-UA') || 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: 'https://chat.z.ai',
        Referer: 'https://chat.z.ai/',
        'User-Agent': userAgent,
        Accept: '*/*',
        'Accept-Language': 'en-US',
        'x-fe-version': 'prod-fe-1.1.34',
        'x-region': 'overseas',
        Cookie: cookie,
        ...extraHeaders,
      },
      body: req.body,
    });

    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text();
      setCors(res, 'application/json');
      return res.status(upstream.status).send(JSON.stringify({ error: `HTTP ${upstream.status}`, detail: errorText }));
    }

    setCors(res, 'text/event-stream; charset=utf-8');
    res.status(200);
    res.flushHeaders();

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    setCors(res, 'application/json');
    res.status(502).send(JSON.stringify({ error: error.message }));
  }
});

// ── Aliyun OSS upload proxy ──────────────────────────────────────────────────
app.put('/api/oss-upload', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  setCors(res, 'application/json');
  const ossUrl = req.get('X-OSS-URL');
  if (!ossUrl) return res.status(400).json({ error: 'Missing X-OSS-URL header' });
  try {
    const upstream = await fetch(ossUrl, { method: 'PUT', body: req.body });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `OSS ${upstream.status}`, detail: text.slice(0, 500) });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── audioconvert.ai API proxy ─────────────────────────────────────────────────
// All audioconvert.ai calls are blocked by CORS when made from localhost.
// This proxy forwards them from Node (no browser CORS restrictions).
app.all('/api/audioconvert/*', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  setCors(res, 'application/json');
  const acPath = req.path.replace('/api/audioconvert', '');
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = `https://audioconvert.ai/api${acPath}${query}`;
  const token = req.get('X-AC-Token') || '';

  const headers = {
    'authorization': `Bearer ${token}`,
    'accept': req.get('accept') || '*/*',
    'origin': 'https://audioconvert.ai',
    'referer': 'https://audioconvert.ai/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  };
  if (req.get('content-type')) headers['content-type'] = req.get('content-type');

  console.log(`[audioconvert proxy] ${req.method} ${target} body-len=${req.body?.length ?? 0}`);
  try {
    // Use redirect:'manual' to detect redirects and reissue with body preserved.
    let upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual',
    });
    // Follow redirects manually so POST body is not dropped
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      console.log(`[audioconvert proxy] redirect ${upstream.status} → ${location}`);
      if (location) {
        upstream = await fetch(location, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        });
      }
    }

    // For SSE streaming responses, pipe directly
    const ct = upstream.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      setCors(res, 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.status(upstream.status);
      res.flushHeaders();
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    // Regular JSON response
    const body = await upstream.text();
    setCors(res, ct || 'application/json');
    res.status(upstream.status).send(body);
  } catch (err) {
    console.error('[audioconvert proxy] error:', err.message, '| target:', target);
    res.status(502).json({ error: err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running at http://localhost:${PORT}/`);
  console.log(`  TTS: http://localhost:${PORT}/api/voices`);
  console.log('  Press Ctrl+C to stop\n');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill the existing process first:\n  kill $(lsof -t -i:${PORT})`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

// Start MongoDB API server as a child process
const mongo = spawn('node', ['mongodb-setup.js'], { stdio: 'inherit' });
mongo.on('error', (err) => console.error('Failed to start MongoDB server:', err));
mongo.on('exit', (code) => { if (code !== 0) console.error(`MongoDB server exited with code ${code}`); });

// Start DeepAI proxy server as a child process
const deepai = spawn('node', ['deepai-server.js'], { stdio: 'inherit' });
deepai.on('error', (err) => console.error('Failed to start DeepAI server:', err));
deepai.on('exit', (code) => { if (code !== 0) console.error(`DeepAI server exited with code ${code}`); });
