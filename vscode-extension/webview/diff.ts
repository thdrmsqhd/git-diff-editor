export type Span = { line: number; startColumn: number; endColumn: number };
export type Highlight = { lines: number[]; spans: Span[] };
export type Hunk = {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  originalAnchor: number;
  modifiedAnchor: number;
  additions: number;
  deletions: number;
};
export type TextDiff = { original: Highlight; modified: Highlight; hunks: Hunk[] };

function lines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

function lcs(a: string[], b: string[]): { ai: number; bi: number }[] {
  if (a.length * b.length > 2_000_000) return greedy(a, b);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: { ai: number; bi: number }[] = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out.push({ ai: --i, bi: --j }); }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return out.reverse();
}

function greedy(a: string[], b: string[]): { ai: number; bi: number }[] {
  const index = new Map<string, number[]>();
  a.forEach((value, i) => index.set(value, [...(index.get(value) ?? []), i]));
  const out: { ai: number; bi: number }[] = [];
  let last = -1;
  b.forEach((value, bi) => {
    const ai = (index.get(value) ?? []).find((n) => n > last);
    if (ai !== undefined) { out.push({ ai, bi }); last = ai; }
  });
  return out;
}

function charSpans(oldLine: string, newLine: string, oldLineNumber: number, newLineNumber: number): { original: Span[]; modified: Span[] } {
  const a = Array.from(oldLine);
  const b = Array.from(newLine);
  const pairs = lcs(a, b);
  const matchedA = new Set(pairs.map((p) => p.ai));
  const matchedB = new Set(pairs.map((p) => p.bi));
  const collect = (chars: string[], matched: Set<number>, line: number): Span[] => {
    const spans: Span[] = [];
    let start = -1;
    for (let i = 0; i <= chars.length; i++) {
      const changed = i < chars.length && !matched.has(i);
      if (changed && start < 0) start = i;
      if (!changed && start >= 0) {
        spans.push({ line, startColumn: start + 1, endColumn: i + 1 });
        start = -1;
      }
    }
    return spans;
  };
  return {
    original: collect(a, matchedA, oldLineNumber),
    modified: collect(b, matchedB, newLineNumber),
  };
}

export function calculateDiff(original: string, modified: string): TextDiff {
  const a = lines(original), b = lines(modified), pairs = lcs(a, b);
  const originalLines: number[] = [], modifiedLines: number[] = [];
  const originalSpans: Span[] = [], modifiedSpans: Span[] = [];
  const hunks: Hunk[] = [];
  let ia = 0, ib = 0, pi = 0;

  while (ia < a.length || ib < b.length) {
    const pair = pairs[pi];
    if (pair && pair.ai === ia && pair.bi === ib) { ia++; ib++; pi++; continue; }
    const nextA = pair?.ai ?? a.length;
    const nextB = pair?.bi ?? b.length;
    const deleted = a.slice(ia, nextA);
    const added = b.slice(ib, nextB);

    if (deleted.length || added.length) {
      hunks.push({
        originalStart: ia + 1,
        originalEnd: nextA,
        modifiedStart: ib + 1,
        modifiedEnd: nextB,
        originalAnchor: Math.max(1, Math.min(ia + 1, Math.max(1, a.length))),
        modifiedAnchor: Math.max(1, Math.min(ib + 1, Math.max(1, b.length))),
        additions: added.length,
        deletions: deleted.length,
      });

      if (deleted.length === added.length && deleted.length > 0) {
        for (let k = 0; k < deleted.length; k++) {
          const spans = charSpans(deleted[k], added[k], ia + k + 1, ib + k + 1);
          if (spans.original.length) originalSpans.push(...spans.original); else originalLines.push(ia + k + 1);
          if (spans.modified.length) modifiedSpans.push(...spans.modified); else modifiedLines.push(ib + k + 1);
        }
      } else {
        for (let x = ia; x < nextA; x++) originalLines.push(x + 1);
        for (let x = ib; x < nextB; x++) modifiedLines.push(x + 1);
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
