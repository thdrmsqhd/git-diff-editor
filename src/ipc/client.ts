import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export type DiskVersion = {
  exists: boolean;
  rawBytesHash: string;
  byteLength: number;
  modifiedTimeHint: number | null;
};

export type TextMetadata = {
  encoding: string;
  bom: boolean;
  eol: string;
  trailingNewline: boolean;
};

export type FileEntry = {
  path: string;
  previousPath: string | null;
  status: string;
  tracked: boolean;
  existsOnDisk: boolean;
  editable: boolean;
  kind: string;
};

export type RepositorySnapshot = {
  sessionId: string;
  root: string;
  gitDir: string;
  commonDir: string;
  headOid: string | null;
  branch: string | null;
  detachedHead: boolean;
  generation: number;
  files: FileEntry[];
  gitVersion: string;
};

export type DocumentPayload = {
  documentId: string;
  sessionId: string;
  path: string;
  requestSequence: number;
  headOid: string | null;
  originalText: string;
  currentText: string;
  diskVersion: DiskVersion;
  metadata: TextMetadata | null;
  loadState: string;
  editable: boolean;
  reason: string | null;
};

export type SaveDocumentResult =
  | { kind: 'saved'; diskVersion: DiskVersion; snapshot: RepositorySnapshot }
  | { kind: 'refreshedExternal'; payload: DocumentPayload; snapshot: RepositorySnapshot };

export type RepositoryChangedPayload = {
  sessionId: string;
  generation: number;
  paths: string[];
  reason: 'external';
};

type E2eBridge = {
  pickFolder?: () => Promise<string | null>;
  openRepository?: (path: string) => Promise<RepositorySnapshot>;
  refreshRepository?: (sessionId: string) => Promise<RepositorySnapshot>;
  stopWatch?: (sessionId: string) => Promise<void>;
  readDocument?: (sessionId: string, path: string, requestSequence: number) => Promise<DocumentPayload>;
  saveDocument?: (req: unknown) => Promise<SaveDocumentResult>;
  onRepoChanged?: (cb: (payload: RepositoryChangedPayload) => void) => Promise<UnlistenFn>;
};

declare global {
  interface Window {
    __GDE_E2E__?: E2eBridge;
    __GDE_OPEN?: (path: string) => Promise<void>;
  }
}

function e2e(): E2eBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.__GDE_E2E__;
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function pickFolder(): Promise<string | null> {
  if (e2e()?.pickFolder) return e2e()!.pickFolder!();
  if (!inTauri()) return null;
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === 'string') return selected;
  return null;
}

export const api = {
  openRepository: (path: string) =>
    e2e()?.openRepository ? e2e()!.openRepository!(path) : invoke<RepositorySnapshot>('open_repository', { path }),
  refreshRepository: (sessionId: string) =>
    e2e()?.refreshRepository
      ? e2e()!.refreshRepository!(sessionId)
      : invoke<RepositorySnapshot>('refresh_repository', { sessionId }),
  stopWatch: (sessionId: string) =>
    e2e()?.stopWatch ? e2e()!.stopWatch!(sessionId) : invoke<void>('stop_watch', { sessionId }),
  listRecent: () =>
    e2e()?.openRepository
      ? Promise.resolve([])
      : invoke<{ path: string; openedAt: string }[]>('list_recent_repositories'),
  readDocument: (sessionId: string, path: string, requestSequence: number) =>
    e2e()?.readDocument
      ? e2e()!.readDocument!(sessionId, path, requestSequence)
      : invoke<DocumentPayload>('read_document', { sessionId, path, requestSequence }),
  saveDocument: (req: unknown) =>
    e2e()?.saveDocument ? e2e()!.saveDocument!(req) : invoke<SaveDocumentResult>('save_document', { req }),
};

export function onRepoChanged(
  cb: (payload: RepositoryChangedPayload) => void,
): Promise<UnlistenFn> {
  if (e2e()?.onRepoChanged) return e2e()!.onRepoChanged!(cb);
  if (!inTauri()) return Promise.resolve(() => {});
  return listen<RepositoryChangedPayload>('repository-changed', (event) => cb(event.payload));
}
