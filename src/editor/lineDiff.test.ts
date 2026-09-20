import { describe, expect, it } from 'vitest';
import { addedHighlight, nextChangeLine } from './lineDiff';

describe('addedHighlight', () => {
  it('marks every line when original is empty', () => {
    const h = addedHighlight('', 'a\nb\n');
    expect(h.lines).toEqual([1, 2, 3]);
    expect(h.spans).toEqual([]);
  });

  it('marks inserted lines only', () => {
    const h = addedHighlight('keep\n', 'keep\nnew\n');
    expect(h.lines).toEqual([2]);
  });

  it('marks added characters inside a changed line', () => {
    const h = addedHighlight('fn main() {}\n', 'fn main() { println!(); }\n');
    expect(h.lines).toEqual([]);
    expect(h.spans.length).toBeGreaterThan(0);
    expect(h.spans[0].line).toBe(1);
  });

  it('marks nothing when texts match', () => {
    const h = addedHighlight('same\n', 'same\n');
    expect(h.lines).toEqual([]);
    expect(h.spans).toEqual([]);
  });
});

describe('nextChangeLine', () => {
  it('wraps forward and backward', () => {
    expect(nextChangeLine([2, 5, 9], 5, 1)).toBe(9);
    expect(nextChangeLine([2, 5, 9], 9, 1)).toBe(2);
    expect(nextChangeLine([2, 5, 9], 5, -1)).toBe(2);
    expect(nextChangeLine([2, 5, 9], 2, -1)).toBe(9);
  });
});
