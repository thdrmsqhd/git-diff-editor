import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export type DiffHandle = {
  editor: monaco.editor.IStandaloneDiffEditor;
  setContents: (original: string, modified: string, editable: boolean) => void;
  getModified: () => string;
  dispose: () => void;
};

export function createDiffEditor(el: HTMLElement, onChange: (text: string) => void): DiffHandle {
  const original = monaco.editor.createModel('', 'plaintext');
  const modified = monaco.editor.createModel('', 'plaintext');
  const editor = monaco.editor.createDiffEditor(el, {
    automaticLayout: true,
    renderSideBySide: true,
    wordWrap: 'off',
    minimap: { enabled: false },
    folding: false,
    originalEditable: false,
    ignoreTrimWhitespace: false,
    renderWhitespace: 'none',
    fontSize: 13,
    theme: 'vs',
  });
  editor.setModel({ original, modified });
  const sub = modified.onDidChangeContent(() => onChange(modified.getValue()));
  return {
    editor,
    setContents(orig, mod, editable) {
      original.setValue(orig);
      modified.setValue(mod);
      editor.getModifiedEditor().updateOptions({ readOnly: !editable });
    },
    getModified: () => modified.getValue(),
    dispose() {
      sub.dispose();
      editor.dispose();
      original.dispose();
      modified.dispose();
    },
  };
}
