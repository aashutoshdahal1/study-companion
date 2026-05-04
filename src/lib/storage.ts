// IndexedDB-backed persistence for documents (PDF blobs) and notes.
const DB_NAME = "studysync";
const DB_VERSION = 1;

export interface DocMeta {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  lastPage: number;
}

export interface NotePayload {
  docId: string;
  html: string;
  perPage: Record<number, string>; // optional per-page notes
  updatedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "docId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const storage = {
  async listDocs(): Promise<DocMeta[]> {
    const docs = await tx<DocMeta[]>("docs", "readonly", (s) => s.getAll() as IDBRequest<DocMeta[]>);
    return docs.sort((a, b) => b.addedAt - a.addedAt);
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
  },
  async getNote(docId: string): Promise<NotePayload | undefined> {
    return tx<NotePayload | undefined>("notes", "readonly", (s) => s.get(docId) as IDBRequest<NotePayload | undefined>);
  },
  async saveNote(note: NotePayload) {
    await tx("notes", "readwrite", (s) => s.put(note));
  },
};
