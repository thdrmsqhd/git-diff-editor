import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { addedHighlight, changeLines, nextChangeLine } from './lineDiff';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export type EditorHandle = {
  setContents: (original: string, modified: string, editable: boolean) => void;
  getModified: () => string;
  revealChange: (dir: 1 | -1) => void;
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
  let deco: string[] = [];
  let hunks: number[] = [];
  const sub = model.onDidChangeContent(() => onChange(model.getValue()));

  function paint(original: string, displayed: string) {
    const marks = addedHighlight(original, displayed);
    hunks = changeLines(marks);
    const next: monaco.editor.IModelDeltaDecoration[] = marks.lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'gde-added-line',
        marginClassName: 'gde-added-margin',
        overviewRuler: {
          color: 'rgba(24,128,56,0.8)',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    }));
    for (const span of marks.spans) {
      next.push({
        range: new monaco.Range(span.line, span.startColumn, span.line, span.endColumn),
        options: { inlineClassName: 'gde-added-text' },
      });
    }
    deco = editor.deltaDecorations(deco, next);
  }

  return {
    setContents(original, displayed, editable) {
      if (model.getValue() !== displayed) model.setValue(displayed);
      editor.updateOptions({ readOnly: !editable });
      paint(original, displayed);
    },
    getModified: () => model.getValue(),
    revealChange(dir) {
      const pos = editor.getPosition();
      const current = pos?.lineNumber ?? 0;
      const target = nextChangeLine(hunks, current, dir);
      if (target == null) return;
      editor.revealLineInCenter(target);
      editor.setPosition({ lineNumber: target, column: 1 });
      editor.focus();
    },
    dispose() {
      sub.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
