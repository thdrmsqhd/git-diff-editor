import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { DiffHighlight } from './lineDiff';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export type DiffSide = 'original' | 'modified';
export type HunkRange = { start: number; end: number; anchor: number };
export type ViewportRange = { top: number; bottom: number; visible: boolean };

export type EditorHandle = {
  setContents: (
    displayed: string,
    editable: boolean,
    highlight: DiffHighlight,
    side: DiffSide,
    activeHunk?: HunkRange | null,
  ) => void;
  getModified: () => string;
  getCurrentLine: () => number;
  getViewportHeight: () => number;
  getViewportRange: (range: HunkRange) => ViewportRange;
  hasTextFocus: () => boolean;
  revealRange: (range: HunkRange, focus?: boolean) => void;
  onViewportChange: (callback: () => void) => () => void;
  dispose: () => void;
};

function safeLine(model: monaco.editor.ITextModel, line: number): number {
  return Math.max(1, Math.min(line, model.getLineCount()));
}

export function createSingleEditor(el: HTMLElement, onChange: (text: string) => void): EditorHandle {
  const model = monaco.editor.createModel('', 'plaintext');
  const editor = monaco.editor.create(el, {
    model,
    automaticLayout: true,
    wordWrap: 'off',
    minimap: { enabled: false },
    folding: false,
    fontSize: 13,
    theme: 'vs',
    renderWhitespace: 'none',
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
  });
  let decorations: string[] = [];
  let applyingContents = false;
  const sub = model.onDidChangeContent(() => {
    if (!applyingContents) onChange(model.getValue());
  });

  function paint(
    highlight: DiffHighlight,
    side: DiffSide,
    activeHunk?: HunkRange | null,
  ) {
    const added = side === 'modified';
    const lineClass = added ? 'gde-added-line' : 'gde-deleted-line';
    const marginClass = added ? 'gde-added-margin' : 'gde-deleted-margin';
    const textClass = added ? 'gde-added-text' : 'gde-deleted-text';
    const rulerColor = added ? 'rgba(24,128,56,0.8)' : 'rgba(207,34,46,0.8)';
    const next: monaco.editor.IModelDeltaDecoration[] = highlight.lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: lineClass,
        marginClassName: marginClass,
        overviewRuler: {
          color: rulerColor,
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    }));
    for (const span of highlight.spans) {
      next.push({
        range: new monaco.Range(span.line, span.startColumn, span.line, span.endColumn),
        options: { inlineClassName: textClass },
      });
    }

    if (activeHunk) {
      if (activeHunk.start <= activeHunk.end) {
        const start = safeLine(model, activeHunk.start);
        const end = safeLine(model, activeHunk.end);
        next.push({
          range: new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
          options: {
            isWholeLine: true,
            className: 'gde-active-hunk-line',
            marginClassName: 'gde-active-hunk-margin',
          },
        });
      } else {
        const anchor = safeLine(model, activeHunk.anchor);
        next.push({
          range: new monaco.Range(anchor, 1, anchor, 1),
          options: {
            isWholeLine: true,
            className: 'gde-active-hunk-anchor',
            marginClassName: 'gde-active-hunk-margin',
          },
        });
      }
    }

    decorations = editor.deltaDecorations(decorations, next);
  }

  return {
    setContents(displayed, editable, highlight, side, activeHunk) {
      if (model.getValue() !== displayed) {
        applyingContents = true;
        try {
          model.setValue(displayed);
        } finally {
          applyingContents = false;
        }
      }
      editor.updateOptions({ readOnly: !editable });
      paint(highlight, side, activeHunk);
    },
    getModified: () => model.getValue(),
    getCurrentLine: () => editor.getPosition()?.lineNumber ?? 1,
    getViewportHeight: () => editor.getLayoutInfo().height,
    getViewportRange(range) {
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
      const viewportHeight = editor.getLayoutInfo().height;
      const scrollTop = editor.getScrollTop();
      if (range.start <= range.end) {
        const start = safeLine(model, range.start);
        const end = safeLine(model, range.end);
        const top = editor.getTopForLineNumber(start) - scrollTop;
        const bottom = editor.getTopForLineNumber(end) - scrollTop + lineHeight;
        return { top, bottom, visible: bottom >= 0 && top <= viewportHeight };
      }
      const anchor = safeLine(model, range.anchor);
      const center = editor.getTopForLineNumber(anchor) - scrollTop + lineHeight / 2;
      return {
        top: center - 2,
        bottom: center + 2,
        visible: center >= -lineHeight && center <= viewportHeight + lineHeight,
      };
    },
    hasTextFocus: () => editor.hasTextFocus(),
    revealRange(range, focus = false) {
      const anchor = safeLine(model, range.anchor);
      if (range.start <= range.end) {
        const start = safeLine(model, range.start);
        const end = safeLine(model, range.end);
        editor.revealRangeInCenter(
          new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
          monaco.editor.ScrollType.Smooth,
        );
      } else {
        editor.revealLineInCenter(anchor, monaco.editor.ScrollType.Smooth);
      }
      editor.setPosition({ lineNumber: anchor, column: 1 });
      if (focus) editor.focus();
    },
    onViewportChange(callback) {
      const scroll = editor.onDidScrollChange(callback);
      const layout = editor.onDidLayoutChange(callback);
      return () => {
        scroll.dispose();
        layout.dispose();
      };
    },
    dispose() {
      sub.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
