// IndexedDB-backed persistence for documents (PDF blobs), notes, and flashcard decks.
const DB_NAME = "studysync";
const DB_VERSION = 4;

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocMeta {
  id: string;
  name: string;
  size: number;
  type: 'pdf' | 'pptx' | 'html';
  workspaceId: string;
  addedAt: number;
  lastPage: number;
}

export interface NotePayload {
  docId: string;
  html: string;
  perPage: Record<number, string>; // optional per-page notes
  updatedAt: number;
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface FlashcardDeck {
  docId: string;
  cards: Flashcard[];
  updatedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const upgradeEvent = event as IDBVersionChangeEvent;
      const db = req.result;
      const oldVersion = upgradeEvent.oldVersion;
      
      console.log(`Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
      console.log("Available stores before upgrade:", Array.from(db.objectStoreNames));
      
      // Force recreation for any version less than 3
      if (oldVersion < 3) {
        console.log(`Creating/migrating to version ${DB_VERSION} database`);

        // Delete all existing stores to force clean recreation
        const existingStores = Array.from(db.objectStoreNames);
        console.log("Deleting existing stores:", existingStores);

        existingStores.forEach(storeName => {
          if (db.objectStoreNames.contains(storeName)) {
            db.deleteObjectStore(storeName);
          }
        });

        // Create all stores with new schema
        db.createObjectStore("workspaces", { keyPath: "id" });
        db.createObjectStore("docs", { keyPath: "id" });
        db.createObjectStore("blobs");
        db.createObjectStore("notes", { keyPath: "docId" });
        db.createObjectStore("flashcards", { keyPath: "docId" });

        console.log("Stores created:", Array.from(db.objectStoreNames));
      }

      // Add flashcards store for users upgrading from v3
      if (oldVersion === 3 && !db.objectStoreNames.contains("flashcards")) {
        db.createObjectStore("flashcards", { keyPath: "docId" });
      }

      console.log("Database upgrade complete");
    };
    req.onsuccess = () => {
      console.log("Database opened successfully");
      const db = req.result;
      console.log("Available stores:", Array.from(db.objectStoreNames));
      console.log("Database version:", db.version);
      resolve(db);
    };
    req.onerror = () => {
      console.error("Database error:", req.error);
      reject(req.error);
    };
    req.onblocked = () => {
      console.warn("Database operation blocked");
    };
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        // Verify the store exists before creating transaction
        if (!db.objectStoreNames.contains(store)) {
          console.error(`Store "${store}" not found. Available stores:`, Array.from(db.objectStoreNames));
          reject(new Error(`Store "${store}" not found in database`));
          return;
        }
        
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const storage = {
  // Workspace management
  async listWorkspaces(): Promise<Workspace[]> {
    const workspaces = await tx<Workspace[]>("workspaces", "readonly", (s) => s.getAll() as IDBRequest<Workspace[]>);
    return workspaces.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async createWorkspace(name: string): Promise<Workspace> {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await tx("workspaces", "readwrite", (s) => s.put(workspace));
    return workspace;
  },
  async updateWorkspace(workspace: Workspace) {
    workspace.updatedAt = Date.now();
    await tx("workspaces", "readwrite", (s) => s.put(workspace));
  },
  async deleteWorkspace(id: string) {
    // Delete workspace and all its documents
    const docs = await this.listDocsByWorkspace(id);
    await Promise.all(docs.map(doc => this.deleteDoc(doc.id)));
    await tx("workspaces", "readwrite", (s) => s.delete(id));
  },
  
  // Document management
  async listDocs(): Promise<DocMeta[]> {
    const docs = await tx<DocMeta[]>("docs", "readonly", (s) => s.getAll() as IDBRequest<DocMeta[]>);
    return docs.sort((a, b) => b.addedAt - a.addedAt);
  },
  async listDocsByWorkspace(workspaceId: string): Promise<DocMeta[]> {
    const docs = await this.listDocs();
    return docs.filter(doc => doc.workspaceId === workspaceId);
  },
  async addDoc(meta: DocMeta, blob: Blob) {
    await tx("docs", "readwrite", (s) => s.put(meta));
    await tx("blobs", "readwrite", (s) => s.put(blob, meta.id));
  },
  async getBlob(id: string): Promise<Blob | undefined> {
    return tx<Blob | undefined>("blobs", "readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>);
  },
  async updateDoc(meta: DocMeta) {
    await tx("docs", "readwrite", (s) => s.put(meta));
  },
  async deleteDoc(id: string) {
    await tx("docs", "readwrite", (s) => s.delete(id));
    await tx("blobs", "readwrite", (s) => s.delete(id));
    await tx("notes", "readwrite", (s) => s.delete(id));
    await tx("flashcards", "readwrite", (s) => s.delete(id));
  },

  // Notes management
  async getNote(docId: string): Promise<NotePayload | undefined> {
    return tx<NotePayload | undefined>("notes", "readonly", (s) => s.get(docId) as IDBRequest<NotePayload | undefined>);
  },
  async saveNote(note: NotePayload) {
    await tx("notes", "readwrite", (s) => s.put(note));
  },

  // Flashcard deck management
  async getDeck(docId: string): Promise<FlashcardDeck | undefined> {
    return tx<FlashcardDeck | undefined>("flashcards", "readonly", (s) => s.get(docId) as IDBRequest<FlashcardDeck | undefined>);
  },
  async saveDeck(deck: FlashcardDeck) {
    await tx("flashcards", "readwrite", (s) => s.put(deck));
  },
  async deleteDeck(docId: string) {
    await tx("flashcards", "readwrite", (s) => s.delete(docId));
  },
};
