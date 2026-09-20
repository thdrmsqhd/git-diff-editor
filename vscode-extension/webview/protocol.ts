export type FileEntry = {
  path: string;
  status: string;
  previousPath?: string;
  editable: boolean;
  additions: number;
  deletions: number;
};
export type RepositorySnapshot = {
  root: string;
  branch: string | null;
  headOid: string | null;
  files: FileEntry[];
};
export type DocumentPayload = {
  path: string;
  originalText: string;
  currentText: string;
  editable: boolean;
};
export type HostToWebview =
  | { type: 'snapshot'; snapshot: RepositorySnapshot; document?: DocumentPayload }
  | { type: 'document'; document: DocumentPayload }
  | { type: 'saved'; snapshot: RepositorySnapshot; document: DocumentPayload }
  | { type: 'external-refresh'; snapshot: RepositorySnapshot; document?: DocumentPayload; discardedLocalEdit: boolean }
  | { type: 'error'; message: string };
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'select-file'; path: string }
  | { type: 'save'; path: string; text: string }
  | { type: 'refresh' };

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };
export const vscode = acquireVsCodeApi();
