import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { DiffHighlight } from './lineDiff';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export type DiffSide = 'original' | 'modified';

export type EditorHandle = {
  setContents: (displayed: string, editable: boolean, highlight: DiffHighlight, side: DiffSide) => void;
  getModified: () => string;
  getCurrentLine: () => number;
  hasTextFocus: () => boolean;
  revealLine: (line: number, focus?: boolean) => void;
  dispose: () => void;
};

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

  function paint(highlight: DiffHighlight, side: DiffSide) {
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
    decorations = editor.deltaDecorations(decorations, next);
  }

  return {
    setContents(displayed, editable, highlight, side) {
      if (model.getValue() !== displayed) {
        applyingContents = true;
        try {
          model.setValue(displayed);
        } finally {
          applyingContents = false;
        }
      }
      editor.updateOptions({ readOnly: !editable });
      paint(highlight, side);
    },
    getModified: () => model.getValue(),
    getCurrentLine: () => editor.getPosition()?.lineNumber ?? 1,
    hasTextFocus: () => editor.hasTextFocus(),
    revealLine(line, focus = false) {
      const safeLine = Math.max(1, Math.min(line, model.getLineCount()));
      editor.revealLineInCenter(safeLine);
      editor.setPosition({ lineNumber: safeLine, column: 1 });
      if (focus) editor.focus();
    },
    dispose() {
      sub.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
