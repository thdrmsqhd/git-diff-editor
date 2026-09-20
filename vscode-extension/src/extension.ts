import * as vscode from 'vscode';
import type { HostToWebview, RepositorySnapshot, WebviewToHost } from './protocol';
import { detectRepository, readDocument, saveDocument, snapshotRepository } from './repository';

let currentPanel: vscode.WebviewPanel | undefined;

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

function htmlFor(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'webview.css'));
  const token = nonce();
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${token}' ${webview.cspSource}; worker-src blob:; font-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Git Diff Editor</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${token}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

async function chooseWorkspace(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage('Git Diff Editor: 열린 workspace가 없습니다.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: '검토할 Git workspace를 선택하세요.' },
  );
  return picked?.folder;
}

class ReviewSession implements vscode.Disposable {
  private root = '';
  private snapshot: RepositorySnapshot | undefined;
  private selectedPath: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private suppressExternalUntil = 0;
  private disposed = false;

  constructor(private readonly panel: vscode.WebviewPanel) {}

  async start(): Promise<void> {
    const folder = await chooseWorkspace();
    if (!folder) return;
    this.root = await detectRepository(folder);
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.root), '**/*'),
    );
    const changed = () => this.queueExternalRefresh();
    this.watcher.onDidChange(changed);
    this.watcher.onDidCreate(changed);
    this.watcher.onDidDelete(changed);
    await this.refresh(false);
  }

  private post(message: HostToWebview): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private async refresh(external: boolean): Promise<void> {
    try {
      const snapshot = await snapshotRepository(this.root);
      this.snapshot = snapshot;
      let selected = this.selectedPath
        ? snapshot.files.find((file) => file.path === this.selectedPath)
        : undefined;
      if (!selected) selected = snapshot.files.find((file) => file.status !== 'clean') ?? snapshot.files[0];

      if (selected) {
        this.selectedPath = selected.path;
        const document = await readDocument(this.root, selected);
        this.post(external
          ? { type: 'external-refresh', snapshot, document, discardedLocalEdit: false }
          : { type: 'snapshot', snapshot, document });
      } else {
        this.selectedPath = undefined;
        this.post(external
          ? { type: 'external-refresh', snapshot, discardedLocalEdit: false }
          : { type: 'snapshot', snapshot });
      }
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private queueExternalRefresh(): void {
    if (Date.now() < this.suppressExternalUntil) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(true), 180);
  }

  async onMessage(message: WebviewToHost): Promise<void> {
    if (!this.snapshot && message.type !== 'ready') return;
    try {
      if (message.type === 'ready') {
        if (this.root) await this.refresh(false);
      } else if (message.type === 'refresh') {
        await this.refresh(false);
      } else if (message.type === 'select-file') {
        const file = this.snapshot?.files.find((entry) => entry.path === message.path);
        if (!file) return;
        this.selectedPath = file.path;
        this.post({ type: 'document', document: await readDocument(this.root, file) });
      } else if (message.type === 'save') {
        this.suppressExternalUntil = Date.now() + 900;
        await saveDocument(this.root, message.path, message.text);
        const snapshot = await snapshotRepository(this.root);
        this.snapshot = snapshot;
        const file = snapshot.files.find((entry) => entry.path === message.path);
        if (file) {
          this.post({ type: 'saved', snapshot, document: await readDocument(this.root, file) });
        }
      }
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.watcher?.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitDiffEditor.openReview', async () => {
      if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Active);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'gitDiffEditor.review',
        'Git Diff Editor',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
        },
      );
      currentPanel = panel;
      panel.webview.html = htmlFor(panel.webview, context.extensionUri);

      const session = new ReviewSession(panel);
      context.subscriptions.push(session);
      panel.webview.onDidReceiveMessage((message: WebviewToHost) => void session.onMessage(message));
      panel.onDidDispose(() => {
        session.dispose();
        currentPanel = undefined;
      });

      await session.start();
    }),
  );
}

export function deactivate(): void {}
