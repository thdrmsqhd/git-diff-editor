import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSingleEditor,
  type EditorHandle,
  type HunkRange,
  type ViewportRange,
} from '../editor/monacoAdapter';
import { useSideBySide } from '../editor/diffLayout';
import {
  calculateTextDiff,
  formatHunkSummary,
  nextHunkIndex,
  type DiffHunk,
} from '../editor/lineDiff';
import { ResizeHandle } from './ResizeHandle';
import { clampNumber, usePersistentNumber } from './usePersistentNumber';

const DIVIDER_WIDTH = 16;

function rangeFor(hunk: DiffHunk, side: 'original' | 'modified'): HunkRange {
  if (side === 'original') {
    return { start: hunk.originalStart, end: hunk.originalEnd, anchor: hunk.originalAnchor };
  }
  return { start: hunk.modifiedStart, end: hunk.modifiedEnd, anchor: hunk.modifiedAnchor };
}

function connectorPath(
  original: ViewportRange,
  modified: ViewportRange,
  width: number,
  height: number,
): string {
  const clip = (value: number) => clampNumber(value, 0, height);
  const leftTop = clip(original.top);
  const leftBottom = Math.max(leftTop + 2, clip(original.bottom));
  const rightTop = clip(modified.top);
  const rightBottom = Math.max(rightTop + 2, clip(modified.bottom));
  const oneThird = width / 3;
  const twoThirds = (width * 2) / 3;
  return [
    `M 0 ${leftTop}`,
    `C ${oneThird} ${leftTop}, ${twoThirds} ${rightTop}, ${width} ${rightTop}`,
    `L ${width} ${rightBottom}`,
    `C ${twoThirds} ${rightBottom}, ${oneThird} ${leftBottom}, 0 ${leftBottom}`,
    'Z',
  ].join(' ');
}

export function DiffPane(props: {
  original: string;
  modified: string;
  editable: boolean;
  headShort?: string;
  dirty?: boolean;
  onChange: (text: string) => void;
}) {
  const diffContainerRef = useRef<HTMLDivElement | null>(null);
  const originalRef = useRef<HTMLDivElement | null>(null);
  const modifiedRef = useRef<HTMLDivElement | null>(null);
  const originalHandle = useRef<EditorHandle | null>(null);
  const modifiedHandle = useRef<EditorHandle | null>(null);
  const onChangeRef = useRef(props.onChange);
  const [activeHunkIndex, setActiveHunkIndex] = useState<number | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [splitPercent, setSplitPercent] = usePersistentNumber('gde.diffSplitPercent', 50, 20, 80);
  onChangeRef.current = props.onChange;
  const split = useSideBySide(props.original);
  const head = props.headShort ? 'HEAD ' + props.headShort : 'HEAD';
  const diff = useMemo(
    () => calculateTextDiff(props.original, props.modified),
    [props.original, props.modified],
  );
  const diffRef = useRef(diff);
  diffRef.current = diff;
  const activeHunk = activeHunkIndex == null ? null : diff.hunks[activeHunkIndex] ?? null;
  const bumpViewport = useCallback(() => setViewportVersion((version) => version + 1), []);

  useEffect(() => {
    setActiveHunkIndex((current) => {
      if (diff.hunks.length === 0) return null;
      if (current == null) return 0;
      return Math.min(current, diff.hunks.length - 1);
    });
  }, [diff.hunks.length]);

  useEffect(() => {
    if (!modifiedRef.current) return;
    const handle = createSingleEditor(modifiedRef.current, (text) => onChangeRef.current(text));
    modifiedHandle.current = handle;
    const unsubscribe = handle.onViewportChange(bumpViewport);
    window.requestAnimationFrame(bumpViewport);
    return () => {
      unsubscribe();
      handle.dispose();
      modifiedHandle.current = null;
    };
  }, [bumpViewport]);

  useEffect(() => {
    if (!split) {
      originalHandle.current?.dispose();
      originalHandle.current = null;
      return;
    }
    if (!originalRef.current) return;
    const handle = createSingleEditor(originalRef.current, () => undefined);
    originalHandle.current = handle;
    const unsubscribe = handle.onViewportChange(bumpViewport);
    window.requestAnimationFrame(bumpViewport);
    return () => {
      unsubscribe();
      handle.dispose();
      originalHandle.current = null;
    };
  }, [bumpViewport, split]);

  useEffect(() => {
    originalHandle.current?.setContents(
      props.original,
      false,
      diff.original,
      'original',
      activeHunk ? rangeFor(activeHunk, 'original') : null,
    );
    modifiedHandle.current?.setContents(
      props.modified,
      props.editable,
      diff.modified,
      'modified',
      activeHunk ? rangeFor(activeHunk, 'modified') : null,
    );
    window.requestAnimationFrame(bumpViewport);
  }, [activeHunk, bumpViewport, diff, props.editable, props.modified, props.original, split]);

  function revealHunk(index: number, focusSide?: 'original' | 'modified') {
    const hunk = diffRef.current.hunks[index];
    if (!hunk) return;
    setActiveHunkIndex(index);
    originalHandle.current?.revealRange(rangeFor(hunk, 'original'), focusSide === 'original');
    modifiedHandle.current?.revealRange(rangeFor(hunk, 'modified'), focusSide === 'modified');
    window.requestAnimationFrame(bumpViewport);
  }

  function moveFromCursor(direction: 1 | -1) {
    const side = originalHandle.current?.hasTextFocus() ? 'original' : 'modified';
    const active = side === 'original' ? originalHandle.current : modifiedHandle.current;
    const currentLine = active?.getCurrentLine() ?? 1;
    const index = nextHunkIndex(diffRef.current.hunks, currentLine, direction, side);
    if (index != null) revealHunk(index, side);
  }

  function moveFromSelection(direction: 1 | -1) {
    const hunks = diffRef.current.hunks;
    if (hunks.length === 0) return;
    const current = activeHunkIndex ?? (direction === 1 ? -1 : 0);
    const index = (current + direction + hunks.length) % hunks.length;
    revealHunk(index);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F7' && event.key !== 'F8') return;
      event.preventDefault();
      moveFromCursor(event.key === 'F8' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const connectors = useMemo(() => {
    const originalEditor = originalHandle.current;
    const modifiedEditor = modifiedHandle.current;
    if (!split || !originalEditor || !modifiedEditor) return [];
    const height = Math.min(originalEditor.getViewportHeight(), modifiedEditor.getViewportHeight());
    return diff.hunks.flatMap((hunk, index) => {
      const originalRange = originalEditor.getViewportRange(rangeFor(hunk, 'original'));
      const modifiedRange = modifiedEditor.getViewportRange(rangeFor(hunk, 'modified'));
      if (!originalRange.visible && !modifiedRange.visible) return [];
      return [{
        index,
        active: index === activeHunkIndex,
        path: connectorPath(originalRange, modifiedRange, DIVIDER_WIDTH, height),
        height,
      }];
    });
  }, [activeHunkIndex, diff.hunks, split, viewportVersion]);

  const connectorHeight = connectors[0]?.height ?? modifiedHandle.current?.getViewportHeight() ?? 0;
  const currentSummary = activeHunk
    ? `변경 ${Number(activeHunkIndex) + 1}/${diff.hunks.length} · ${formatHunkSummary(activeHunk)}`
    : diff.hunks.length > 0
      ? `변경 ${diff.hunks.length}개`
      : '변경 없음';

  return (
    <div className="diff-shell">
      <div className="diff-summary" aria-live="polite">
        <span className="diff-summary-main" data-testid="diff-summary">{currentSummary}</span>
        <span className="diff-summary-total" data-testid="diff-summary-total">
          전체 <span className="summary-deleted">-{diff.summary.deletedCount}</span>
          {' / '}
          <span className="summary-added">+{diff.summary.addedCount}</span>
        </span>
        <span className="diff-nav">
          <button
            type="button"
            className="diff-nav-btn"
            disabled={diff.hunks.length === 0}
            aria-label="이전 변경"
            title="이전 변경 (F7)"
            onClick={() => moveFromSelection(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="diff-nav-btn"
            disabled={diff.hunks.length === 0}
            aria-label="다음 변경"
            title="다음 변경 (F8)"
            onClick={() => moveFromSelection(1)}
          >
            ↓
          </button>
          <span className="pane-hint">F7/F8</span>
        </span>
      </div>
      <div
        className={split ? 'diff split' : 'diff'}
        ref={diffContainerRef}
        style={split ? { gridTemplateColumns: `${splitPercent}fr ${DIVIDER_WIDTH}px ${100 - splitPercent}fr` } : undefined}
      >
        {split ? (
          <div className="pane original">
            <div className="pane-head">{head}</div>
            <div className="pane-body" ref={originalRef} />
          </div>
        ) : null}
        {split ? (
          <ResizeHandle
            className="pane-resizer"
            ariaLabel="원본과 작업 트리 패널 너비 조절"
            ariaValueNow={Math.round(splitPercent)}
            onDelta={(delta) => {
              const width = Math.max(1, (diffContainerRef.current?.clientWidth ?? 1) - DIVIDER_WIDTH);
              setSplitPercent((value) => value + (delta / width) * 100);
            }}
            onKeyboardDelta={(direction) => setSplitPercent((value) => value + direction * 2)}
            onReset={() => setSplitPercent(50)}
          >
            {connectorHeight > 0 ? (
              <svg
                className="hunk-connectors"
                width={DIVIDER_WIDTH}
                height={connectorHeight}
                viewBox={`0 0 ${DIVIDER_WIDTH} ${connectorHeight}`}
                aria-hidden="true"
              >
                {connectors.map((connector) => (
                  <path
                    key={connector.index}
                    className={'hunk-connector' + (connector.active ? ' active' : '')}
                    d={connector.path}
                  />
                ))}
              </svg>
            ) : null}
          </ResizeHandle>
        ) : null}
        <div className="pane modified">
          <div className="pane-head">
            작업 트리
            {props.dirty ? <span className="pane-dirty">미저장</span> : null}
          </div>
          <div className="pane-body" ref={modifiedRef} />
        </div>
      </div>
    </div>
  );
}
