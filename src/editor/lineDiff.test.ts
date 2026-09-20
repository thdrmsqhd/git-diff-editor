import { describe, expect, it } from 'vitest';
import { calculateTextDiff, nextChangeLine, nextHunkIndex } from './lineDiff';

describe('calculateTextDiff', () => {
  it('marks every modified line when original is empty', () => {
    const diff = calculateTextDiff('', 'a\nb\n');
    expect(diff.modified.lines).toEqual([1, 2, 3]);
    expect(diff.original.lines).toEqual([]);
  });

  it('marks inserted lines only on the modified side', () => {
    const diff = calculateTextDiff('keep\n', 'keep\nnew\n');
    expect(diff.modified.lines).toEqual([2]);
    expect(diff.original.lines).toEqual([]);
  });

  it('marks deleted lines on the original side and keeps a navigable hunk', () => {
    const diff = calculateTextDiff('a\ndeleted\nb\n', 'a\nb\n');
    expect(diff.original.lines).toEqual([2]);
    expect(diff.modified.lines).toEqual([]);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].originalAnchor).toBe(2);
    expect(diff.hunks[0].modifiedAnchor).toBe(2);
  });

  it('marks changed characters on both sides of a modified line', () => {
    const diff = calculateTextDiff('fn old() {}\n', 'fn new() {}\n');
    expect(diff.original.spans.length).toBeGreaterThan(0);
    expect(diff.modified.spans.length).toBeGreaterThan(0);
    expect(diff.hunks).toHaveLength(1);
  });

  it('marks nothing when texts match', () => {
    const diff = calculateTextDiff('same\n', 'same\n');
    expect(diff.original.lines).toEqual([]);
    expect(diff.original.spans).toEqual([]);
    expect(diff.modified.lines).toEqual([]);
    expect(diff.modified.spans).toEqual([]);
    expect(diff.hunks).toEqual([]);
  });
});

describe('change navigation', () => {
  it('wraps line navigation forward and backward', () => {
    expect(nextChangeLine([2, 5, 9], 5, 1)).toBe(9);
    expect(nextChangeLine([2, 5, 9], 9, 1)).toBe(2);
    expect(nextChangeLine([2, 5, 9], 5, -1)).toBe(2);
    expect(nextChangeLine([2, 5, 9], 2, -1)).toBe(9);
  });

  it('includes a pure deletion when navigating hunks', () => {
    const diff = calculateTextDiff('a\ndeleted\nb\n', 'a\nb\n');
    expect(nextHunkIndex(diff.hunks, 1, 1)).toBe(0);
    expect(nextHunkIndex(diff.hunks, 3, -1)).toBe(0);
  });
});
