export type AddedSpan = { line: number; startColumn: number; endColumn: number };
export type AddedHighlight = {
  lines: number[];
  spans: AddedSpan[];
};

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function lcsBacktrack(a: string[], b: string[]): { ai: number; bi: number }[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  if (n * m > 2_000_000) return greedyMatches(a, b);

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) row[j] = prev[j - 1] + 1;
      else row[j] = prev[j] >= row[j - 1] ? prev[j] : row[j - 1];
    }
  }

  const pairs: { ai: number; bi: number }[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push({ ai: i - 1, bi: j - 1 });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
    else j -= 1;
  }
  pairs.reverse();
  return pairs;
}

function greedyMatches(a: string[], b: string[]): { ai: number; bi: number }[] {
  const used = new Set<number>();
  const pairs: { ai: number; bi: number }[] = [];
  const index = new Map<string, number[]>();
  for (let i = 0; i < a.length; i++) {
    const list = index.get(a[i]);
    if (list) list.push(i);
    else index.set(a[i], [i]);
  }
  let last = -1;
  for (let j = 0; j < b.length; j++) {
    const list = index.get(b[j]);
    if (!list) continue;
    const found = list.find((i) => i > last && !used.has(i));
    if (found === undefined) continue;
    used.add(found);
    last = found;
    pairs.push({ ai: found, bi: j });
  }
  return pairs;
}

function charAddedSpans(oldLine: string, newLine: string, line: number): AddedSpan[] {
  if (oldLine === newLine) return [];
  if (newLine.length === 0) return [];
  if (oldLine.length * newLine.length > 200_000) {
    return [{ line, startColumn: 1, endColumn: newLine.length + 1 }];
  }
  const a = Array.from(oldLine);
  const b = Array.from(newLine);
  const pairs = lcsBacktrack(a, b);
  const matched = new Set(pairs.map((p) => p.bi));
  const spans: AddedSpan[] = [];
  let start = -1;
  for (let j = 0; j <= b.length; j++) {
    const added = j < b.length && !matched.has(j);
    if (added && start < 0) start = j;
    if (!added && start >= 0) {
      spans.push({ line, startColumn: start + 1, endColumn: j + 1 });
      start = -1;
    }
  }
  return spans;
}

export function addedHighlight(original: string, modified: string): AddedHighlight {
  const a = splitLines(original);
  const b = splitLines(modified);
  if (modified.length === 0) return { lines: [], spans: [] };
  if (original.length === 0) {
    return { lines: b.map((_, i) => i + 1), spans: [] };
  }

  const pairs = lcsBacktrack(a, b);
  const lines: number[] = [];
  const spans: AddedSpan[] = [];

  let ia = 0;
  let ib = 0;
  let pi = 0;
  while (ib < b.length) {
    if (pi < pairs.length && pairs[pi].bi === ib) {
      ia = pairs[pi].ai + 1;
      pi += 1;
      ib += 1;
      continue;
    }
    const nextA = pi < pairs.length ? pairs[pi].ai : a.length;
    const nextB = pi < pairs.length ? pairs[pi].bi : b.length;
    const deleted = a.slice(ia, nextA);
    const added = b.slice(ib, nextB);
    if (deleted.length === added.length && deleted.length > 0) {
      for (let k = 0; k < added.length; k++) {
        const line = ib + k + 1;
        const inline = charAddedSpans(deleted[k], added[k], line);
        if (inline.length === 0) lines.push(line);
        else spans.push(...inline);
      }
    } else {
      for (let k = 0; k < added.length; k++) lines.push(ib + k + 1);
    }
    ia = nextA;
    ib = nextB;
  }

  return { lines, spans };
}
