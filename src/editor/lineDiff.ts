export type DiffSpan = { line: number; startColumn: number; endColumn: number };
export type DiffHighlight = {
  lines: number[];
  spans: DiffSpan[];
};
export type DiffHunk = {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  originalAnchor: number;
  modifiedAnchor: number;
};
export type TextDiff = {
  original: DiffHighlight;
  modified: DiffHighlight;
  hunks: DiffHunk[];
};

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
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

function unmatchedSpans(text: string, matched: Set<number>, line: number): DiffSpan[] {
  const chars = Array.from(text);
  const spans: DiffSpan[] = [];
  let start = -1;
  for (let i = 0; i <= chars.length; i++) {
    const changed = i < chars.length && !matched.has(i);
    if (changed && start < 0) start = i;
    if (!changed && start >= 0) {
      const before = chars.slice(0, start).join('').length;
      const changedText = chars.slice(start, i).join('').length;
      spans.push({ line, startColumn: before + 1, endColumn: before + changedText + 1 });
      start = -1;
    }
  }
  return spans;
}

function charDiffSpans(
  oldLine: string,
  newLine: string,
  oldLineNumber: number,
  newLineNumber: number,
): { original: DiffSpan[]; modified: DiffSpan[] } {
  if (oldLine === newLine) return { original: [], modified: [] };
  if (oldLine.length * newLine.length > 200_000) {
    return {
      original: oldLine.length > 0 ? [{ line: oldLineNumber, startColumn: 1, endColumn: oldLine.length + 1 }] : [],
      modified: newLine.length > 0 ? [{ line: newLineNumber, startColumn: 1, endColumn: newLine.length + 1 }] : [],
    };
  }

  const a = Array.from(oldLine);
  const b = Array.from(newLine);
  const pairs = lcsBacktrack(a, b);
  const matchedOriginal = new Set(pairs.map((p) => p.ai));
  const matchedModified = new Set(pairs.map((p) => p.bi));
  return {
    original: unmatchedSpans(oldLine, matchedOriginal, oldLineNumber),
    modified: unmatchedSpans(newLine, matchedModified, newLineNumber),
  };
}

function clampAnchor(candidate: number, lineCount: number): number {
  if (lineCount <= 0) return 1;
  return Math.max(1, Math.min(candidate, lineCount));
}

export function calculateTextDiff(original: string, modified: string): TextDiff {
  const a = splitLines(original);
  const b = splitLines(modified);
  const pairs = lcsBacktrack(a, b);
  const originalLines: number[] = [];
  const modifiedLines: number[] = [];
  const originalSpans: DiffSpan[] = [];
  const modifiedSpans: DiffSpan[] = [];
  const hunks: DiffHunk[] = [];

  let ia = 0;
  let ib = 0;
  let pi = 0;

  while (ia < a.length || ib < b.length) {
    const pair = pi < pairs.length ? pairs[pi] : null;
    if (pair && pair.ai === ia && pair.bi === ib) {
      ia += 1;
      ib += 1;
      pi += 1;
      continue;
    }

    const nextA = pair?.ai ?? a.length;
    const nextB = pair?.bi ?? b.length;
    const deleted = a.slice(ia, nextA);
    const added = b.slice(ib, nextB);

    if (deleted.length > 0 || added.length > 0) {
      hunks.push({
        originalStart: ia + 1,
        originalEnd: nextA,
        modifiedStart: ib + 1,
        modifiedEnd: nextB,
        originalAnchor: clampAnchor(ia + 1, a.length),
        modifiedAnchor: clampAnchor(ib + 1, b.length),
      });

      if (deleted.length === added.length && deleted.length > 0) {
        for (let k = 0; k < deleted.length; k++) {
          const originalLine = ia + k + 1;
          const modifiedLine = ib + k + 1;
          const spans = charDiffSpans(deleted[k], added[k], originalLine, modifiedLine);
          if (spans.original.length > 0) originalSpans.push(...spans.original);
          else originalLines.push(originalLine);
          if (spans.modified.length > 0) modifiedSpans.push(...spans.modified);
          else modifiedLines.push(modifiedLine);
        }
      } else {
        for (let k = 0; k < deleted.length; k++) originalLines.push(ia + k + 1);
        for (let k = 0; k < added.length; k++) modifiedLines.push(ib + k + 1);
      }
    }

    ia = nextA;
    ib = nextB;
  }

  return {
    original: { lines: originalLines, spans: originalSpans },
    modified: { lines: modifiedLines, spans: modifiedSpans },
    hunks,
  };
}

export function changeLines(highlight: DiffHighlight): number[] {
  const set = new Set<number>(highlight.lines);
  for (const span of highlight.spans) set.add(span.line);
  return [...set].sort((a, b) => a - b);
}

export function nextChangeLine(lines: number[], current: number, dir: 1 | -1): number | null {
  if (lines.length === 0) return null;
  if (dir === 1) {
    const found = lines.find((n) => n > current);
    return found ?? lines[0];
  }
  const previous = [...lines].reverse().find((n) => n < current);
  return previous ?? lines[lines.length - 1];
}

export function nextHunkIndex(
  hunks: DiffHunk[],
  currentLine: number,
  dir: 1 | -1,
  side: 'original' | 'modified' = 'modified',
): number | null {
  if (hunks.length === 0) return null;
  const anchor = (h: DiffHunk) => (side === 'original' ? h.originalAnchor : h.modifiedAnchor);
  if (dir === 1) {
    const index = hunks.findIndex((h) => anchor(h) > currentLine);
    return index >= 0 ? index : 0;
  }
  for (let i = hunks.length - 1; i >= 0; i--) {
    if (anchor(hunks[i]) < currentLine) return i;
  }
  return hunks.length - 1;
}
