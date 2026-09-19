import { describe, expect, it } from 'vitest';
import { sortFiles } from './FileTree';
import type { FileEntry } from '../ipc/client';

function f(path: string, status: string): FileEntry {
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

describe('sortFiles', () => {
  it('keeps directory grouping and prefers changed files', () => {
    const out = sortFiles([f('src/z.ts', 'clean'), f('src/a.ts', 'M'), f('lib/b.ts', 'clean')]);
    expect(out.map((x) => x.path)).toEqual(['lib/b.ts', 'src/a.ts', 'src/z.ts']);
  });
});
