import { describe, expect, it } from 'vitest';
import { useSideBySide } from './diffLayout';

describe('useSideBySide', () => {
  it('hides the empty original pane so hatch does not consume layout', () => {
    expect(useSideBySide('')).toBe(false);
  });

  it('keeps side-by-side when HEAD original exists', () => {
    expect(useSideBySide('fn main() {}\n')).toBe(true);
  });
});
