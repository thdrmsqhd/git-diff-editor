import { useCallback, useEffect, useState, type SetStateAction } from 'react';

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function usePersistentNumber(
  key: string,
  initialValue: number,
  min: number,
  max: number,
): [number, (next: SetStateAction<number>) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(key));
      return Number.isFinite(stored) ? clampNumber(stored, min, max) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      /* localStorage may be unavailable in restricted previews */
    }
  }, [key, value]);

  const update = useCallback(
    (next: SetStateAction<number>) => {
      setValue((previous) => {
        const candidate = typeof next === 'function' ? next(previous) : next;
        return clampNumber(candidate, min, max);
      });
    },
    [max, min],
  );

  return [value, update];
}
