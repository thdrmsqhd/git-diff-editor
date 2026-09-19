import { create } from 'zustand';
import type { DocumentPayload, FileEntry, RepositorySnapshot } from '../ipc/client';

type Dialog = { next: 'select' | 'open-repo' | 'quit'; path?: string } | null;

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
  unsavedDialog: Dialog;
  requestSequence: number;
  setSession: (s: RepositorySnapshot) => void;
  setError: (e: string | null) => void;
  setLoadState: (s: string) => void;
  setDocument: (d: DocumentPayload) => void;
  edit: (text: string) => void;
  markSaved: (d: DocumentPayload) => void;
  setSelected: (p: string | null) => void;
  setDialog: (d: Dialog) => void;
  bumpSeq: () => number;
  applyExternal: (d: DocumentPayload) => void;
  setFiles: (f: FileEntry[]) => void;
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
  setSession: (s) => set({ session: s, files: s.files, error: null, loadState: 'ready' }),
  setError: (e) => set({ error: e, loadState: 'error' }),
  setLoadState: (s) => set({ loadState: s }),
  setDocument: (d) =>
    set({
      document: d,
      bufferText: d.currentText,
      bufferRevision: 0,
      dirty: false,
      selectedPath: d.path,
      loadState: d.loadState,
    }),
  edit: (text) => {
    const doc = get().document;
    const dirty = !!doc && text !== doc.currentText;
    set({ bufferText: text, bufferRevision: get().bufferRevision + 1, dirty });
  },
  markSaved: (d) => set({ document: d, bufferText: d.currentText, dirty: false, files: get().files }),
  setSelected: (p) => set({ selectedPath: p }),
  setDialog: (d) => set({ unsavedDialog: d }),
  bumpSeq: () => {
    const n = get().requestSequence + 1;
    set({ requestSequence: n });
    return n;
  },
  applyExternal: (d) =>
    set({
      document: d,
      bufferText: d.currentText,
      dirty: false,
      bufferRevision: get().bufferRevision + 1,
      loadState: d.loadState,
    }),
  setFiles: (f) => set({ files: f }),
}));
