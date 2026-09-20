import type { FileEntry } from './protocol';

export type TreeFile = { kind: 'file'; name: string; path: string; file: FileEntry; changedCount: number };
export type TreeDirectory = { kind: 'directory'; name: string; path: string; children: TreeNode[]; changedCount: number };
export type TreeNode = TreeFile | TreeDirectory;

type MutableDir = { name: string; path: string; dirs: Map<string, MutableDir>; files: FileEntry[] };

function isChanged(file: FileEntry) { return file.status !== 'clean'; }

function rank(node: TreeNode): number {
  if (node.kind === 'directory' && node.changedCount > 0) return 0;
  if (node.kind === 'file' && node.changedCount > 0) return 1;
  if (node.kind === 'directory') return 2;
  return 3;
}

function finalize(dir: MutableDir): TreeDirectory {
  const dirs = [...dir.dirs.values()].map(finalize);
  const files: TreeFile[] = dir.files.map((file) => ({
    kind: 'file',
    name: file.path.split('/').pop() ?? file.path,
    path: file.path,
    file,
    changedCount: isChanged(file) ? 1 : 0,
  }));
  const children = [...dirs, ...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return {
    kind: 'directory',
    name: dir.name,
    path: dir.path,
    children,
    changedCount: children.reduce((sum, child) => sum + child.changedCount, 0),
  };
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: MutableDir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const childPath = current.path ? `${current.path}/${name}` : name;
      let child = current.dirs.get(name);
      if (!child) {
        child = { name, path: childPath, dirs: new Map(), files: [] };
        current.dirs.set(name, child);
      }
      current = child;
    }
    current.files.push(file);
  }
  return finalize(root).children;
}

export function directoryPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const visit = (node: TreeNode) => {
    if (node.kind === 'directory') {
      out.push(node.path);
      node.children.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return out;
}

export function ancestors(filePath: string): string[] {
  const parts = filePath.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
