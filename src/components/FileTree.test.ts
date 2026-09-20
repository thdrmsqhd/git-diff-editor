import { describe, expect, it } from 'vitest';
import { fileName, sortFiles } from './FileTree';
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
    expect(out.map((x) => x.path)).toEqual(['src/a.ts', 'lib/b.ts', 'src/z.ts']);
  });
});

describe('fileName', () => {
  it('shows the leaf name', () => {
    expect(fileName('src/app.rs')).toBe('app.rs');
    expect(fileName('README.md')).toBe('README.md');
  });
});
