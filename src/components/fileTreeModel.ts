import type { FileEntry } from '../ipc/client';

export type FileTreeFile = {
  kind: 'file';
  name: string;
  path: string;
  file: FileEntry;
  changedCount: number;
  totalCount: number;
};

export type FileTreeDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  children: FileTreeNode[];
  changedCount: number;
  totalCount: number;
};

export type FileTreeNode = FileTreeFile | FileTreeDirectory;

type MutableDirectory = {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: FileEntry[];
};

function normalized(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isChanged(file: FileEntry): boolean {
  return file.status !== 'clean';
}

function nodeRank(node: FileTreeNode): number {
  if (node.changedCount > 0 && node.kind === 'directory') return 0;
  if (node.changedCount > 0) return 1;
  if (node.kind === 'directory') return 2;
  return 3;
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.sort((a, b) => {
    const rank = nodeRank(a) - nodeRank(b);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function finalizeDirectory(directory: MutableDirectory): FileTreeDirectory {
  const directoryChildren = [...directory.directories.values()].map(finalizeDirectory);
  const fileChildren: FileTreeFile[] = directory.files.map((file) => {
    const path = normalized(file.path);
    const parts = path.split('/');
    return {
      kind: 'file',
      name: parts[parts.length - 1] || path,
      path,
      file,
      changedCount: isChanged(file) ? 1 : 0,
      totalCount: 1,
    };
  });
  const children = sortNodes([...directoryChildren, ...fileChildren]);
  return {
    kind: 'directory',
    name: directory.name,
    path: directory.path,
    children,
    changedCount: children.reduce((sum, child) => sum + child.changedCount, 0),
    totalCount: children.reduce((sum, child) => sum + child.totalCount, 0),
  };
}

export function buildFileTree(files: FileEntry[]): FileTreeNode[] {
  const root: MutableDirectory = {
    name: '',
    path: '',
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const path = normalized(file.path);
    if (!path) continue;
    const parts = path.split('/');
    let current = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index];
      const childPath = current.path ? `${current.path}/${name}` : name;
      let child = current.directories.get(name);
      if (!child) {
        child = { name, path: childPath, directories: new Map(), files: [] };
        current.directories.set(name, child);
      }
      current = child;
    }
    current.files.push({ ...file, path });
  }

  const rootNode = finalizeDirectory(root);
  return rootNode.children;
}

export function collectDirectoryPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  const visit = (node: FileTreeNode) => {
    if (node.kind !== 'directory') return;
    paths.push(node.path);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

export function collectDefaultCollapsedPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  const visit = (node: FileTreeNode) => {
    if (node.kind !== 'directory') return;
    if (node.changedCount === 0) {
      paths.push(node.path);
      return;
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

export function ancestorDirectoryPaths(filePath: string): string[] {
  const parts = normalized(filePath).split('/');
  const paths: string[] = [];
  for (let index = 1; index < parts.length; index++) {
    paths.push(parts.slice(0, index).join('/'));
  }
  return paths;
}
