export type Span = { line: number; startColumn: number; endColumn: number };
export type Highlight = { lines: number[]; spans: Span[] };
export type Hunk = {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  originalAnchor: number;
  modifiedAnchor: number;
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

export function calculateDiff(original: string, modified: string): TextDiff {
  const a = lines(original), b = lines(modified), pairs = lcs(a, b);
  const originalLines: number[] = [], modifiedLines: number[] = [], hunks: Hunk[] = [];
  let ia = 0, ib = 0, pi = 0;
  while (ia < a.length || ib < b.length) {
    const pair = pairs[pi];
    if (pair && pair.ai === ia && pair.bi === ib) { ia++; ib++; pi++; continue; }
    const nextA = pair?.ai ?? a.length;
    const nextB = pair?.bi ?? b.length;
    if (nextA > ia || nextB > ib) {
      for (let x = ia; x < nextA; x++) originalLines.push(x + 1);
      for (let x = ib; x < nextB; x++) modifiedLines.push(x + 1);
      hunks.push({
        originalStart: ia + 1,
        originalEnd: nextA,
        modifiedStart: ib + 1,
        modifiedEnd: nextB,
        originalAnchor: Math.max(1, Math.min(ia + 1, Math.max(1, a.length))),
        modifiedAnchor: Math.max(1, Math.min(ib + 1, Math.max(1, b.length))),
      });
    }
    ia = nextA; ib = nextB;
  }
  return {
    original: { lines: originalLines, spans: [] },
    modified: { lines: modifiedLines, spans: [] },
    hunks,
  };
}
