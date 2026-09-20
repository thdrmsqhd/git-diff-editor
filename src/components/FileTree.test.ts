import { describe, expect, it } from 'vitest';
import {
  ancestorDirectoryPaths,
  buildFileTree,
  collectDefaultCollapsedPaths,
  type FileTreeDirectory,
} from './fileTreeModel';
import type { FileEntry } from '../ipc/client';

function file(path: string, status: string): FileEntry {
  return {
    path,
    previousPath: null,
    status,
    tracked: true,
    existsOnDisk: true,
    editable: true,
    kind: 'file',
  };
}

describe('buildFileTree', () => {
  it('builds hierarchy and prioritizes changed branches', () => {
    const tree = buildFileTree([
      file('docs/readme.md', 'clean'),
      file('src/feature/a.ts', 'M'),
      file('src/z.ts', 'clean'),
      file('lib/b.ts', 'clean'),
    ]);
    expect(tree.map((node) => node.path)).toEqual(['src', 'docs', 'lib']);
    const src = tree[0] as FileTreeDirectory;
    expect(src.changedCount).toBe(1);
    expect(src.children[0].path).toBe('src/feature');
  });

  it('collapses clean directory branches by default', () => {
    const tree = buildFileTree([file('src/a.ts', 'M'), file('docs/readme.md', 'clean')]);
    expect(collectDefaultCollapsedPaths(tree)).toContain('docs');
    expect(collectDefaultCollapsedPaths(tree)).not.toContain('src');
  });
});

describe('ancestorDirectoryPaths', () => {
  it('returns every directory needed to reveal a selected file', () => {
    expect(ancestorDirectoryPaths('src/features/a.ts')).toEqual(['src', 'src/features']);
  });
});
