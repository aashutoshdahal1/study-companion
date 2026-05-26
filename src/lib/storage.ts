// Hybrid Storage - MongoDB + IndexedDB wrapper for the Study Companion app

import { hybridStorage, type StandaloneNote } from './hybrid-storage';
export type { StandaloneNote };

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocMeta {
  id: string;
  name: string;
  type: 'pdf' | 'pptx' | 'html';
  size: number;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  lastPage?: number;
}

export interface NotePayload {
  docId: string;
  html: string;
  updatedAt: number;
}

export interface FlashcardDeck {
  docId: string;
  cards: Array<{
    front: string;
    back: string;
    id: string;
  }>;
  updatedAt: number;
}

// Export the hybrid storage as the main storage interface
export const storage = {
  // Workspace management
  async listWorkspaces(): Promise<Workspace[]> {
    return hybridStorage.listWorkspaces();
  },
  
  async createWorkspace(name: string): Promise<Workspace> {
    return hybridStorage.createWorkspace(name);
  },
  
  async updateWorkspace(workspace: Workspace): Promise<void> {
    return hybridStorage.updateWorkspace(workspace);
  },
  
  async deleteWorkspace(id: string): Promise<void> {
    return hybridStorage.deleteWorkspace(id);
  },

  // Document management
  async listDocs(workspaceId?: string): Promise<DocMeta[]> {
    return hybridStorage.listDocs(workspaceId);
  },
  
  async createDoc(meta: DocMeta, blob?: Blob): Promise<void> {
    return hybridStorage.createDoc(meta, blob);
  },
  
  async updateDoc(meta: DocMeta): Promise<void> {
    return hybridStorage.updateDoc(meta);
  },
  
  async deleteDoc(id: string): Promise<void> {
    return hybridStorage.deleteDoc(id);
  },

  // Notes management
  async getNote(docId: string): Promise<NotePayload | undefined> {
    return hybridStorage.getNote(docId);
  },
  
  async saveNote(note: NotePayload): Promise<void> {
    return hybridStorage.saveNote(note);
  },

  // Blob management
  async getBlob(id: string): Promise<Blob | null> {
    return hybridStorage.getBlob(id);
  },
  
  async saveBlob(id: string, blob: Blob): Promise<void> {
    return hybridStorage.saveBlob(id, blob);
  },

  // Flashcard deck management
  async getDeck(docId: string): Promise<FlashcardDeck | undefined> {
    return hybridStorage.getDeck(docId);
  },
  
  async saveDeck(deck: FlashcardDeck): Promise<void> {
    return hybridStorage.saveDeck(deck);
  },
  
  async deleteDeck(docId: string): Promise<void> {
    return hybridStorage.deleteDeck(docId);
  },

  // Standalone notes (class notes without a PDF)
  async listStandaloneNotes(workspaceId?: string): Promise<StandaloneNote[]> {
    return hybridStorage.listStandaloneNotes(workspaceId);
  },

  async getStandaloneNote(id: string): Promise<StandaloneNote | undefined> {
    return hybridStorage.getStandaloneNote(id);
  },

  async createStandaloneNote(note: StandaloneNote): Promise<StandaloneNote> {
    return hybridStorage.createStandaloneNote(note);
  },

  async saveStandaloneNote(note: StandaloneNote): Promise<void> {
    return hybridStorage.saveStandaloneNote(note);
  },

  async saveToLocalOnly(note: StandaloneNote): Promise<void> {
    return hybridStorage.saveToLocalOnly(note);
  },

  async syncStandaloneNoteToMongo(note: StandaloneNote): Promise<void> {
    return hybridStorage.syncStandaloneNoteToMongo(note);
  },

  async deleteStandaloneNote(id: string): Promise<void> {
    return hybridStorage.deleteStandaloneNote(id);
  },

  // Sync utilities
  async backupToMongoDB(): Promise<void> {
    return hybridStorage.backupToMongoDB();
  },
  
  async restoreFromMongoDB(): Promise<void> {
    return hybridStorage.restoreFromMongoDB();
  },

  // Status methods
  isMongoOnline(): boolean {
    return hybridStorage.isMongoOnline();
  },
  
  getLastSyncTime(): number {
    return hybridStorage.getLastSyncTime();
  },
  
  getStorageStats() {
    return hybridStorage.getStorageStats();
  }
};

export default storage;
