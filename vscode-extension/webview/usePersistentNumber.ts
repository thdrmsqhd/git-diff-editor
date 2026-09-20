import { useEffect, useState } from 'react';

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function usePersistentNumber(key: string, initial: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) ? clamp(stored, min, max) : initial;
  });
  useEffect(() => { localStorage.setItem(key, String(value)); }, [key, value]);
  return [value, (next: number | ((previous: number) => number)) => {
    setValue((previous) => clamp(typeof next === 'function' ? next(previous) : next, min, max));
  }] as const;
}
