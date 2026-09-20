import { create } from 'zustand';
import type { DocumentPayload, FileEntry, RepositorySnapshot } from '../ipc/client';

export type PendingAction = { next: 'select' | 'open-repo' | 'quit'; path?: string };

type Store = {
  session: RepositorySnapshot | null;
  files: FileEntry[];
  selectedPath: string | null;
  document: DocumentPayload | null;
  bufferText: string;
  bufferRevision: number;
  dirty: boolean;
  loadState: string;
  error: string | null;
  unsavedDialog: PendingAction | null;
  requestSequence: number;
  setSession: (session: RepositorySnapshot) => void;
  setError: (error: string | null) => void;
  setLoadState: (state: string) => void;
  setDocument: (document: DocumentPayload) => void;
  edit: (text: string) => void;
  markSaved: (document: DocumentPayload) => void;
  setSelected: (path: string | null) => void;
  setDialog: (dialog: PendingAction | null) => void;
  bumpSeq: () => number;
  applyExternal: (document: DocumentPayload) => void;
  setFiles: (files: FileEntry[]) => void;
};

export const useAppStore = create<Store>((set, get) => ({
  session: null,
  files: [],
  selectedPath: null,
  document: null,
  bufferText: '',
  bufferRevision: 0,
  dirty: false,
  loadState: 'idle',
  error: null,
  unsavedDialog: null,
  requestSequence: 0,
  setSession: (session) => set({ session, files: session.files, error: null, loadState: 'ready' }),
  setError: (error) => set({ error, loadState: error ? 'error' : get().loadState }),
  setLoadState: (loadState) => set({ loadState }),
  setDocument: (document) =>
    set({
      document,
      bufferText: document.currentText,
      bufferRevision: 0,
      dirty: false,
      selectedPath: document.path,
      loadState: document.loadState,
      error: null,
    }),
  edit: (text) => {
    const document = get().document;
    const dirty = !!document && text !== document.currentText;
    set({ bufferText: text, bufferRevision: get().bufferRevision + 1, dirty });
  },
  markSaved: (document) =>
    set({
      document,
      bufferText: document.currentText,
      dirty: false,
      bufferRevision: 0,
      error: null,
      loadState: document.loadState,
    }),
  setSelected: (selectedPath) => set({ selectedPath }),
  setDialog: (unsavedDialog) => set({ unsavedDialog }),
  bumpSeq: () => {
    const requestSequence = get().requestSequence + 1;
    set({ requestSequence });
    return requestSequence;
  },
  applyExternal: (document) =>
    set({
      document,
      bufferText: document.currentText,
      dirty: false,
      bufferRevision: get().bufferRevision + 1,
      loadState: document.loadState,
      selectedPath: document.path,
      error: null,
    }),
  setFiles: (files) => set({ files }),
}));
