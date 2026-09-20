import { describe, expect, it } from 'vitest';
import { calculateTextDiff, formatHunkSummary, nextChangeLine, nextHunkIndex } from './lineDiff';

describe('calculateTextDiff', () => {
  it('marks every modified line when original is empty', () => {
    const diff = calculateTextDiff('', 'a\nb\n');
    expect(diff.modified.lines).toEqual([1, 2, 3]);
    expect(diff.original.lines).toEqual([]);
    expect(diff.summary).toEqual({ deletedCount: 0, addedCount: 3 });
  });

  it('marks inserted lines only on the modified side', () => {
    const diff = calculateTextDiff('keep\n', 'keep\nnew\n');
    expect(diff.modified.lines).toEqual([2]);
    expect(diff.original.lines).toEqual([]);
    expect(diff.hunks[0].addedCount).toBe(1);
  });

  it('marks deleted lines on the original side and keeps a navigable hunk', () => {
    const diff = calculateTextDiff('a\ndeleted\nb\n', 'a\nb\n');
    expect(diff.original.lines).toEqual([2]);
    expect(diff.modified.lines).toEqual([]);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].originalAnchor).toBe(2);
    expect(diff.hunks[0].modifiedAnchor).toBe(2);
    expect(formatHunkSummary(diff.hunks[0])).toBe('-1 / +0');
  });

  it('marks changed characters on both sides of a modified line', () => {
    const diff = calculateTextDiff('fn old() {}\n', 'fn new() {}\n');
    expect(diff.original.spans.length).toBeGreaterThan(0);
    expect(diff.modified.spans.length).toBeGreaterThan(0);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.summary).toEqual({ deletedCount: 1, addedCount: 1 });
  });

  it('summarizes multiple independent hunks', () => {
    const diff = calculateTextDiff('a\nremove\nb\nc\n', 'a\nb\ninsert\nc\n');
    expect(diff.hunks).toHaveLength(2);
    expect(diff.summary).toEqual({ deletedCount: 1, addedCount: 1 });
  });

  it('marks nothing when texts match', () => {
    const diff = calculateTextDiff('same\n', 'same\n');
    expect(diff.original.lines).toEqual([]);
    expect(diff.original.spans).toEqual([]);
    expect(diff.modified.lines).toEqual([]);
    expect(diff.modified.spans).toEqual([]);
    expect(diff.hunks).toEqual([]);
    expect(diff.summary).toEqual({ deletedCount: 0, addedCount: 0 });
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
