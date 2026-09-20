import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { DocumentPayload, FileEntry, RepositorySnapshot } from './protocol';

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  });
  return result.stdout;
}

async function gitBuffer(root: string, args: string[]): Promise<Buffer> {
  const result = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'buffer',
  }) as unknown as { stdout: Buffer };
  return result.stdout;
}

function splitNul(text: string): string[] {
  return text.split('\0').filter(Boolean);
}

function parseNameStatus(raw: string): Map<string, { status: string; previousPath?: string }> {
  const parts = raw.split('\0');
  const out = new Map<string, { status: string; previousPath?: string }>();
  let i = 0;
  while (i < parts.length) {
    const statusRaw = parts[i++];
    if (!statusRaw) break;
    if (statusRaw.startsWith('R')) {
      const oldPath = parts[i++] ?? '';
      const newPath = parts[i++] ?? '';
      if (newPath) out.set(newPath, { status: 'R', previousPath: oldPath });
    } else {
      const filePath = parts[i++] ?? '';
      if (filePath) out.set(filePath, { status: statusRaw[0] ?? 'M' });
    }
  }
  return out;
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const out = new Map<string, { additions: number; deletions: number }>();
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const [addedRaw, deletedRaw, filePath] = record.split('\t');
    if (!filePath) continue;
    const additions = Number.parseInt(addedRaw, 10);
    const deletions = Number.parseInt(deletedRaw, 10);
    out.set(filePath, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return out;
}

function countTextLines(bytes: Uint8Array): number {
  if (bytes.byteLength === 0) return 0;
  const text = Buffer.from(bytes).toString('utf8');
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

export async function detectRepository(folder: vscode.WorkspaceFolder): Promise<string> {
  const stdout = await git(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
  return stdout.trim();
}

export async function snapshotRepository(root: string): Promise<RepositorySnapshot> {
  const [branchRaw, headRaw, listedRaw, diffRaw, numstatRaw] = await Promise.all([
    git(root, ['branch', '--show-current']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', 'HEAD', '--']),
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', 'HEAD', '--']),
  ]);

  const statuses = parseNameStatus(diffRaw);
  const numstat = parseNumstat(numstatRaw);
  const files: FileEntry[] = splitNul(listedRaw).map((filePath) => {
    const hit = statuses.get(filePath);
    const stat = numstat.get(filePath);
    return {
      path: filePath,
      status: hit?.status ?? (statuses.has(filePath) ? 'M' : 'clean'),
      previousPath: hit?.previousPath,
      editable: true,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    };
  });

  for (const [filePath, hit] of statuses) {
    if (!files.some((file) => file.path === filePath)) {
      const stat = numstat.get(filePath);
      files.push({
        path: filePath,
        status: hit.status,
        previousPath: hit.previousPath,
        editable: hit.status !== 'D',
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      });
    }
  }

  const tracked = new Set(splitNul(await git(root, ['ls-files', '-z', '--cached'])));
  await Promise.all(files.map(async (file) => {
    if (!tracked.has(file.path) && file.status === 'clean') {
      file.status = 'U';
      try {
        file.additions = countTextLines(await vscode.workspace.fs.readFile(resolveInside(root, file.path)));
      } catch {
        file.additions = 0;
      }
    }
  }));

  files.sort((a, b) => {
    const ac = a.status === 'clean' ? 1 : 0;
    const bc = b.status === 'clean' ? 1 : 0;
    return ac - bc || a.path.localeCompare(b.path);
  });

  return {
    root,
    branch: branchRaw.trim() || null,
    headOid: headRaw.trim() || null,
    files,
  };
}

function resolveInside(root: string, rel: string): vscode.Uri {
  const resolved = path.resolve(root, rel);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('저장소 밖 경로는 열 수 없습니다.');
  }
  return vscode.Uri.file(resolved);
}

export async function readDocument(root: string, file: FileEntry): Promise<DocumentPayload> {
  let originalText = '';
  if (file.status !== 'U' && file.status !== 'A') {
    const sourcePath = file.previousPath ?? file.path;
    try {
      const bytes = await gitBuffer(root, ['show', `HEAD:${sourcePath}`]);
      originalText = bytes.toString('utf8');
    } catch {
      originalText = '';
    }
  }

  let currentText = '';
  if (file.status !== 'D') {
    const uri = resolveInside(root, file.path);
    try {
      currentText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      currentText = '';
    }
  }

  return {
    path: file.path,
    originalText,
    currentText,
    editable: file.editable && file.status !== 'D',
  };
}

export async function saveDocument(root: string, filePath: string, text: string): Promise<void> {
  const uri = resolveInside(root, filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}
