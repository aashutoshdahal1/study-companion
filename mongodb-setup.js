import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { config } from 'dotenv';

config();

const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = 3001;

const MONGODB_URI = process.env.MONGODB_URI || process.env.VITE_MONGODB_URI || 'mongodb://localhost:27017/study-companion';
const DEFAULT_FRONTEND_URLS = 'http://localhost:8081,http://127.0.0.1:8081,http://localhost:8080,http://localhost:8082,http://localhost:8083';
const FRONTEND_URLS = (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URLS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions = {
  origin: FRONTEND_URLS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};
const client = new MongoClient(MONGODB_URI, {
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  retryWrites: true,
  w: 'majority'
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

const strip = ({ _id, ...rest }) => rest;

const upload = multer({ dest: 'uploads/' });

let workspaces;
let documents;
let notes;
let blobs;
let standaloneNotes;
let flashcards;

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db();

    workspaces = db.collection('workspaces');
    documents = db.collection('documents');
    notes = db.collection('notes');
    blobs = db.collection('blobs');
    standaloneNotes = db.collection('standaloneNotes');
    flashcards = db.collection('flashcards');

    await workspaces.createIndex({ id: 1 }, { unique: true });
    await documents.createIndex({ id: 1 }, { unique: true });
    await notes.createIndex({ docId: 1 }, { unique: true });
    await blobs.createIndex({ id: 1 }, { unique: true });
    await standaloneNotes.createIndex({ id: 1 }, { unique: true });
    await flashcards.createIndex({ docId: 1 }, { unique: true });

    console.log('MongoDB collections and indexes created');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}

app.get('/api/workspaces', async (req, res) => {
  try {
    const result = await workspaces.find({}).sort({ updatedAt: -1 }).toArray();
    res.json(result.map(strip));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workspaces', async (req, res) => {
  try {
    const workspace = strip(req.body);
    await workspaces.replaceOne({ id: workspace.id }, workspace, { upsert: true });
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    await workspaces.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const filter = workspaceId ? { workspaceId } : {};
    const result = await documents.find(filter).sort({ updatedAt: -1 }).toArray();
    res.json(result.map(strip));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const document = strip(req.body);
    await documents.replaceOne({ id: document.id }, document, { upsert: true });
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await documents.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notes/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const result = await notes.findOne({ docId });
    res.json(result ? strip(result) : null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const note = strip(req.body);
    await notes.replaceOne({ docId: note.docId }, note, { upsert: true });
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/notes/:docId', async (req, res) => {
  try {
    await notes.deleteOne({ docId: req.params.docId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await blobs.findOne({ id });
    if (result && result.data) {
      const buffer = Buffer.from(result.data, 'base64');
      res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
      res.send(buffer);
    } else {
      res.status(404).json({ error: 'Blob not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/blobs', upload.single('file'), async (req, res) => {
  try {
    const { id, contentType } = req.body;
    const filePath = req.file ? req.file.path : null;

    let data;
    if (filePath && existsSync(filePath)) {
      data = readFileSync(filePath).toString('base64');
      unlinkSync(filePath);
    } else if (req.body.data) {
      data = req.body.data;
    }

    const blob = { id, contentType, data };
    await blobs.replaceOne({ id }, blob, { upsert: true });
    res.json({ id, contentType });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/blobs/:id', async (req, res) => {
  try {
    await blobs.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync/backup', async (req, res) => {
  try {
    const { workspaces: localWorkspaces, documents: localDocuments, notes: localNotes } = req.body;

    if (localWorkspaces?.length) await workspaces.insertMany(localWorkspaces, { ordered: false });
    if (localDocuments?.length) await documents.insertMany(localDocuments, { ordered: false });
    if (localNotes?.length) await notes.insertMany(localNotes, { ordered: false });

    res.json({ success: true, message: 'Data backed up to MongoDB' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync/restore', async (req, res) => {
  try {
    const [workspacesData, documentsData, notesData] = await Promise.all([
      workspaces.find({}).toArray(),
      documents.find({}).toArray(),
      notes.find({}).toArray()
    ]);
    res.json({ workspaces: workspacesData, documents: documentsData, notes: notesData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Standalone Notes ─────────────────────────────────────────────────────────
app.get('/api/standalone-notes', async (req, res) => {
  try {
    const all = await standaloneNotes.find({}, { projection: { _id: 0, html: 0 } }).toArray();
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/standalone-notes/:id', async (req, res) => {
  try {
    const note = await standaloneNotes.findOne({ id: req.params.id });
    if (!note) return res.status(404).json({ error: 'Not found' });
    res.json(strip(note));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/standalone-notes', async (req, res) => {
  try {
    const note = req.body;
    await standaloneNotes.replaceOne({ id: note.id }, note, { upsert: true });
    res.json(strip(note));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/standalone-notes/:id', async (req, res) => {
  try {
    await standaloneNotes.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Flashcard Decks ───────────────────────────────────────────────────────────
app.get('/api/flashcards/:docId', async (req, res) => {
  try {
    const result = await flashcards.findOne({ docId: req.params.docId });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(strip(result));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/flashcards', async (req, res) => {
  try {
    const deck = strip(req.body);
    await flashcards.replaceOne({ docId: deck.docId }, deck, { upsert: true });
    res.json(deck);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/flashcards/:docId', async (req, res) => {
  try {
    await flashcards.deleteOne({ docId: req.params.docId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'MongoDB API is running', timestamp: new Date().toISOString() });
});

connectToMongoDB().then(() => {
  app.listen(PORT, () => {
    console.log(`MongoDB API server running on port ${PORT}`);
    console.log(`Allowed frontend origins: ${FRONTEND_URLS.join(', ')}`);
  });
}).catch(console.error);
