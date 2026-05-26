// Hybrid Storage Service - Local IndexedDB + MongoDB Backup

interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface DocMeta {
  id: string;
  name: string;
  type: 'pdf' | 'pptx' | 'html';
  size: number;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  lastPage?: number;
}

interface NotePayload {
  docId: string;
  html: string;
  updatedAt: number;
}

interface FlashcardDeck {
  docId: string;
  cards: Array<{
    front: string;
    back: string;
    id: string;
  }>;
  updatedAt: number;
}

export interface StandaloneNote {
  id: string;
  title: string;
  subject: string;
  html: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
}

class HybridStorage {
  private mongoApiUrl: string;
  private isOnline: boolean = false;
  private syncInProgress: boolean = false;
  private lastSyncTime: number = 0;
  private dbPromise: Promise<IDBDatabase> | null = null;
  
  constructor() {
    // Use browser-compatible way to get environment variables
    this.mongoApiUrl = this.getEnvVar('VITE_REACT_APP_MONGO_API_URL') || 'http://localhost:3001/api';
    this.checkOnlineStatus();
    setInterval(() => this.checkOnlineStatus(), 30000); // Check every 30 seconds
  }
  
  private getEnvVar(name: string): string | undefined {
    const viteName = `VITE_${name}`;
    const env = (import.meta as any).env;
    if (env) {
      return env[viteName] || env[name];
    }
    if (typeof window !== 'undefined' && (window as any).__ENV__) {
      return (window as any).__ENV__[name];
    }
    return undefined;
  }

  private async checkOnlineStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${this.mongoApiUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      const wasOnline = this.isOnline;
      this.isOnline = response.ok;
      
      // Log status changes
      if (wasOnline !== this.isOnline) {
        console.log(`MongoDB connection status changed: ${wasOnline} -> ${this.isOnline}`);
      }
      
      return this.isOnline;
    } catch (error) {
      console.warn('MongoDB health check failed:', error);
      this.isOnline = false;
      return false;
    }
  }

  // Local IndexedDB operations (existing functionality)
  private async open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('StudyCompanionDB', 7);
      
      request.onupgradeneeded = () => {
        const db = request.result;
        
        // Create stores if they don't exist
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('docs')) {
          db.createObjectStore('docs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'docId' });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('flashcards')) {
          db.createObjectStore('flashcards', { keyPath: 'docId' });
        }
        if (!db.objectStoreNames.contains('standaloneNotes')) {
          db.createObjectStore('standaloneNotes', { keyPath: 'id' });
        }
      };
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });
    return this.dbPromise;
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(store)) {
        console.warn(`[IDB] store "${store}" not found in DB — upgrade may not have run`);
        resolve((Array.isArray([] as unknown as T) ? [] : undefined) as T);
        return;
      }

      const t = db.transaction(store, mode);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(new Error(`Transaction aborted on store "${store}"`));

      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  // MongoDB operations with fallback to local
  private async mongoRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.isOnline) {
      throw new Error('MongoDB is not available');
    }
    
    try {
      const response = await fetch(`${this.mongoApiUrl}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      
      if (!response.ok) {
        throw new Error(`MongoDB request failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      this.isOnline = false;
      throw error;
    }
  }

  // Auto-sync to MongoDB (debounced)
  private async syncToMongoDB(data: any, type: 'workspace' | 'document' | 'note'): Promise<void> {
    if (!this.isOnline || this.syncInProgress) return;
    
    this.syncInProgress = true;
    try {
      switch (type) {
        case 'workspace':
          await this.mongoRequest('/workspaces', {
            method: 'POST',
            body: JSON.stringify(data)
          });
          break;
        case 'document':
          await this.mongoRequest('/documents', {
            method: 'POST',
            body: JSON.stringify(data)
          });
          break;
        case 'note':
          await this.mongoRequest('/notes', {
            method: 'POST',
            body: JSON.stringify(data)
          });
          break;
      }
      this.lastSyncTime = Date.now();
    } catch (error) {
      console.warn('Failed to sync to MongoDB:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  // Workspace management
  async listWorkspaces(): Promise<Workspace[]> {
    try {
      // Try MongoDB first
      if (this.isOnline) {
        const mongoWorkspaces = await this.mongoRequest<Workspace[]>('/workspaces');
        // Update local cache
        await this.updateLocalCache('workspaces', mongoWorkspaces);
        return mongoWorkspaces;
      }
    } catch (error) {
      console.warn('MongoDB unavailable, using local storage');
    }
    
    // Fallback to local
    return this.tx<Workspace[]>('workspaces', 'readonly', (s) => s.getAll() as IDBRequest<Workspace[]>);
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save locally first
    await this.tx('workspaces', 'readwrite', (s) => s.add(workspace));
    
    // Sync to MongoDB
    this.syncToMongoDB(workspace, 'workspace').catch(console.warn);
    
    return workspace;
  }

  async updateWorkspace(workspace: Workspace): Promise<void> {
    workspace.updatedAt = Date.now();
    
    // Update locally
    await this.tx('workspaces', 'readwrite', (s) => s.put(workspace));
    
    // Sync to MongoDB
    this.syncToMongoDB(workspace, 'workspace').catch(console.warn);
  }

  async deleteWorkspace(id: string): Promise<void> {
    // Delete locally
    await this.tx('workspaces', 'readwrite', (s) => s.delete(id));
    
    // Delete from MongoDB
    if (this.isOnline) {
      try {
        await this.mongoRequest(`/workspaces/${id}`, { method: 'DELETE' });
      } catch (error) {
        console.warn('Failed to delete workspace from MongoDB:', error);
      }
    }
  }

  // Document management
  async listDocs(workspaceId?: string): Promise<DocMeta[]> {
    try {
      // Try MongoDB first
      if (this.isOnline) {
        const url = workspaceId ? `/documents?workspaceId=${workspaceId}` : '/documents';
        const mongoDocs = await this.mongoRequest<DocMeta[]>(url);
        // Update local cache
        await this.updateLocalCache('docs', mongoDocs);
        return mongoDocs;
      }
    } catch (error) {
      console.warn('MongoDB unavailable, using local storage');
    }
    
    // Fallback to local
    const allDocs = await this.tx<DocMeta[]>('docs', 'readonly', (s) => s.getAll() as IDBRequest<DocMeta[]>);
    return workspaceId ? allDocs.filter(doc => doc.workspaceId === workspaceId) : allDocs;
  }

  async createDoc(meta: DocMeta, blob?: Blob): Promise<void> {
    // Save locally
    await this.tx('docs', 'readwrite', (s) => s.add(meta));
    if (blob) {
      await this.saveBlob(meta.id, blob);
    }
    
    // Sync to MongoDB
    this.syncToMongoDB(meta, 'document').catch(console.warn);
    if (blob) {
      this.syncBlobToMongo(meta.id, blob).catch(console.warn);
    }
  }

  async updateDoc(meta: DocMeta): Promise<void> {
    meta.updatedAt = Date.now();
    
    // Update locally
    await this.tx('docs', 'readwrite', (s) => s.put(meta));
    
    // Sync to MongoDB
    this.syncToMongoDB(meta, 'document').catch(console.warn);
  }

  async deleteDoc(id: string): Promise<void> {
    // Delete locally
    await this.tx('docs', 'readwrite', (s) => s.delete(id));
    await this.tx('notes', 'readwrite', (s) => s.delete(id));
    await this.tx('blobs', 'readwrite', (s) => s.delete(id));
    await this.tx('flashcards', 'readwrite', (s) => s.delete(id));
    
    // Delete from MongoDB
    if (this.isOnline) {
      try {
        await Promise.all([
          this.mongoRequest(`/documents/${id}`, { method: 'DELETE' }),
          this.mongoRequest(`/notes/${id}`, { method: 'DELETE' }),
          this.mongoRequest(`/blobs/${id}`, { method: 'DELETE' }),
          this.mongoRequest(`/flashcards/${id}`, { method: 'DELETE' })
        ]);
      } catch (error) {
        console.warn('Failed to delete document from MongoDB:', error);
      }
    }
  }

  // Notes management
  async getNote(docId: string): Promise<NotePayload | undefined> {
    // Always try MongoDB first if online
    try {
      const response = await fetch(`${this.mongoApiUrl}/notes/${docId}`);
      if (response.ok) {
        const mongoNote = await response.json() as NotePayload;
        if (mongoNote && mongoNote.docId) {
          // Update local cache with MongoDB data
          await this.tx('notes', 'readwrite', (s) => s.put(mongoNote));
          console.log('Retrieved note from MongoDB:', docId);
          return mongoNote;
        }
      }
    } catch (error) {
      console.warn('MongoDB note retrieval failed, using local:', error);
      this.isOnline = false;
    }

    // Fallback to local storage
    const local = await this.tx<NotePayload | undefined>('notes', 'readonly', (s) => s.get(docId) as IDBRequest<NotePayload | undefined>);
    if (local) {
      console.log('Retrieved note from local storage:', docId);
      // Try to sync local note to MongoDB if we're back online
      if (this.isOnline) {
        this.syncToMongoDB(local, 'note').catch(() => {});
      }
    }
    return local;
  }

  async saveNote(note: NotePayload): Promise<void> {
    note.updatedAt = Date.now();
    
    // Save locally
    await this.tx('notes', 'readwrite', (s) => s.put(note));
    
    // Sync to MongoDB
    this.syncToMongoDB(note, 'note').catch(console.warn);
  }

  // Blob management
  async getBlob(id: string): Promise<Blob | null> {
    if (this.isOnline) {
      try {
        const response = await fetch(`${this.mongoApiUrl}/blobs/${id}`);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          return new Blob([buffer], { type: contentType });
        }
        // 404 — not in MongoDB yet, fall through to local then back-fill
      } catch {
        this.isOnline = false;
      }
    }

    const result = await this.tx<any>('blobs', 'readonly', (s) => s.get(id));
    if (!result) return null;

    const blob = new Blob([result.data], { type: result.contentType || 'application/octet-stream' });
    if (this.isOnline) {
      this.syncBlobToMongo(id, blob).catch(() => {});
    }
    return blob;
  }

  async saveBlob(id: string, blob: Blob): Promise<void> {
    // Save locally
    const buffer = await blob.arrayBuffer();
    const blobData = { id, data: buffer, contentType: blob.type };
    await this.tx('blobs', 'readwrite', (s) => s.put(blobData));
    
    // Sync to MongoDB
    this.syncBlobToMongo(id, blob).catch(console.warn);
  }

  private async syncBlobToMongo(id: string, blob: Blob): Promise<void> {
    if (!this.isOnline) return;
    
    try {
      const base64Data = await blob.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      });
      
      await this.mongoRequest('/blobs', {
        method: 'POST',
        body: JSON.stringify({
          id,
          data: base64Data,
          contentType: blob.type
        })
      });
    } catch (error) {
      console.warn('Failed to sync blob to MongoDB:', error);
    }
  }

  // Flashcard management
  async getDeck(docId: string): Promise<FlashcardDeck | undefined> {
    if (this.isOnline) {
      try {
        const response = await fetch(`${this.mongoApiUrl}/flashcards/${docId}`);
        if (response.ok) {
          const deck = await response.json() as FlashcardDeck;
          if (deck && deck.docId) {
            await this.tx('flashcards', 'readwrite', (s) => s.put(deck));
            return deck;
          }
        }
      } catch {
        // fall through to local
      }
    }
    return this.tx<FlashcardDeck | undefined>('flashcards', 'readonly', (s) => s.get(docId) as IDBRequest<FlashcardDeck | undefined>);
  }

  async saveDeck(deck: FlashcardDeck): Promise<void> {
    deck.updatedAt = Date.now();
    await this.tx('flashcards', 'readwrite', (s) => s.put(deck));
    if (this.isOnline) {
      this.mongoRequest('/flashcards', {
        method: 'POST',
        body: JSON.stringify(deck),
      }).catch(console.warn);
    }
  }

  async deleteDeck(docId: string): Promise<void> {
    await this.tx('flashcards', 'readwrite', (s) => s.delete(docId));
    if (this.isOnline) {
      this.mongoRequest(`/flashcards/${docId}`, { method: 'DELETE' }).catch(console.warn);
    }
  }

  // Sync utilities
  private async updateLocalCache(store: string, data: any[]): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      const storeObj = transaction.objectStore(store);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error(`updateLocalCache aborted on store "${store}"`));
      storeObj.clear();
      for (const item of data) {
        storeObj.put(item);
      }
    });
  }

  async backupToMongoDB(): Promise<void> {
    if (!this.isOnline) {
      throw new Error('MongoDB is not available');
    }
    
    try {
      const [workspaces, documents, notes] = await Promise.all([
        this.listWorkspaces(),
        this.listDocs(),
        this.getAllNotes()
      ]);
      
      await this.mongoRequest('/sync/backup', {
        method: 'POST',
        body: JSON.stringify({ workspaces, documents, notes })
      });
      
      this.lastSyncTime = Date.now();
    } catch (error) {
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  async restoreFromMongoDB(): Promise<void> {
    if (!this.isOnline) {
      throw new Error('MongoDB is not available');
    }
    
    try {
      const data = await this.mongoRequest<{
        workspaces: Workspace[];
        documents: DocMeta[];
        notes: NotePayload[];
      }>('/sync/restore');
      
      // Update local cache with restored data
      await Promise.all([
        this.updateLocalCache('workspaces', data.workspaces),
        this.updateLocalCache('docs', data.documents),
        this.updateLocalCache('notes', data.notes)
      ]);
      
      this.lastSyncTime = Date.now();
    } catch (error) {
      throw new Error(`Restore failed: ${error.message}`);
    }
  }

  private async getAllNotes(): Promise<NotePayload[]> {
    return this.tx<NotePayload[]>('notes', 'readonly', (s) => s.getAll() as IDBRequest<NotePayload[]>);
  }

  // Standalone notes (no PDF/doc attached)
  async listStandaloneNotes(workspaceId?: string): Promise<StandaloneNote[]> {
    // Try MongoDB first — returns metadata only (no html) to keep payload small
    if (this.isOnline) {
      try {
        const mongoNotes = await this.mongoRequest<StandaloneNote[]>('/standalone-notes');
        return workspaceId ? mongoNotes.filter((n) => n.workspaceId === workspaceId) : mongoNotes;
      } catch {
        // fall through to local
      }
    }
    const all = await this.tx<StandaloneNote[]>('standaloneNotes', 'readonly', (s) => s.getAll() as IDBRequest<StandaloneNote[]>);
    return workspaceId ? all.filter((n) => n.workspaceId === workspaceId) : all;
  }

  async getStandaloneNote(id: string): Promise<StandaloneNote | undefined> {
    // Read local first — IndexedDB is source of truth for content
    const local = await this.tx<StandaloneNote | undefined>('standaloneNotes', 'readonly', (s) => s.get(id) as IDBRequest<StandaloneNote | undefined>);

    if (this.isOnline) {
      try {
        const remote = await this.mongoRequest<StandaloneNote>(`/standalone-notes/${id}`);
        if (remote && remote.id) {
          // Local has html and is newer (or equal) → trust local, push to MongoDB
          if (local?.html && local.updatedAt >= remote.updatedAt) {
            this.mongoRequest('/standalone-notes', { method: 'POST', body: JSON.stringify(local) }).catch(console.warn);
            return local;
          }
          // Remote is newer and has html → use remote, cache locally
          if (remote.html) {
            await this.tx('standaloneNotes', 'readwrite', (s) => s.put(remote));
            return remote;
          }
          // Remote has no html but local does → push local to MongoDB
          if (local?.html) {
            this.mongoRequest('/standalone-notes', { method: 'POST', body: JSON.stringify(local) }).catch(console.warn);
            return local;
          }
          // Neither has html (new/empty note) — cache remote metadata locally so it opens
          await this.tx('standaloneNotes', 'readwrite', (s) => s.put(remote));
          return remote;
        }
      } catch {
        // fall through to local
      }
    }

    return local;
  }

  async createStandaloneNote(note: StandaloneNote): Promise<StandaloneNote> {
    await this.tx('standaloneNotes', 'readwrite', (s) => s.add(note));
    // Sync to MongoDB
    if (this.isOnline) {
      this.mongoRequest('/standalone-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      }).catch(console.warn);
    }
    return note;
  }

  async saveStandaloneNote(note: StandaloneNote): Promise<void> {
    note.updatedAt = Date.now();
    await this.tx('standaloneNotes', 'readwrite', (s) => s.put(note));
    if (this.isOnline) {
      this.mongoRequest('/standalone-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      }).catch(console.warn);
    }
  }

  // Write only to IndexedDB — fast, synchronous source of truth
  async saveToLocalOnly(note: StandaloneNote): Promise<void> {
    await this.tx('standaloneNotes', 'readwrite', (s) => s.put(note));
  }

  // Push a note to MongoDB (called separately after local save)
  async syncStandaloneNoteToMongo(note: StandaloneNote): Promise<void> {
    if (!this.isOnline) return;
    await this.mongoRequest('/standalone-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    });
  }

  async deleteStandaloneNote(id: string): Promise<void> {
    await this.tx('standaloneNotes', 'readwrite', (s) => s.delete(id));
    if (this.isOnline) {
      this.mongoRequest(`/standalone-notes/${id}`, { method: 'DELETE' }).catch(console.warn);
    }
  }

  // Status methods
  isMongoOnline(): boolean {
    return this.isOnline;
  }

  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  getStorageStats(): Promise<{
    local: { workspaces: number; documents: number; notes: number };
    mongo: { online: boolean; lastSync: number };
  }> {
    return Promise.all([
      this.tx('workspaces', 'readonly', s => s.count()),
      this.tx('docs', 'readonly', s => s.count()),
      this.tx('notes', 'readonly', s => s.count())
    ]).then(([workspaces, documents, notes]) => ({
      local: { workspaces, documents, notes },
      mongo: { online: this.isOnline, lastSync: this.lastSyncTime }
    }));
  }
}

export const hybridStorage = new HybridStorage();
export default hybridStorage;
