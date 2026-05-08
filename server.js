import express from 'express';
import https from 'https';
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Only parse JSON for /api/* routes — the root POST proxy needs raw body
app.use('/api', express.json());

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running at http://localhost:${PORT}/`);
  console.log(`  TTS: http://localhost:${PORT}/api/voices`);
  console.log('  Press Ctrl+C to stop\n');
});
