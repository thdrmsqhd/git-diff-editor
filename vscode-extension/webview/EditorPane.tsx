import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { Highlight } from './diff';

self.MonacoEnvironment = { getWorker: () => new editorWorker() };

export type EditorHandle = {
  revealLine(line: number): void;
  focus(): void;
};

export function EditorPane(props: {
  value: string;
  editable: boolean;
  side: 'original' | 'modified';
  highlight: Highlight;
  onChange?: (value: string) => void;
  editorRef?: React.MutableRefObject<EditorHandle | null>;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const model = useRef<monaco.editor.ITextModel | null>(null);
  const decorations = useRef<string[]>([]);
  const applying = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const m = monaco.editor.createModel(props.value, 'plaintext');
    const e = monaco.editor.create(host.current, {
      model: m,
      readOnly: !props.editable,
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: 'off',
      folding: false,
      scrollBeyondLastLine: false,
      renderWhitespace: 'none',
      fontSize: 13,
    });
    model.current = m;
    editor.current = e;
    props.editorRef && (props.editorRef.current = {
      revealLine(line) { e.revealLineInCenter(Math.max(1, Math.min(line, m.getLineCount()))); },
      focus() { e.focus(); },
    });
    const sub = m.onDidChangeContent(() => {
      if (!applying.current) props.onChange?.(m.getValue());
    });
    return () => {
      sub.dispose(); e.dispose(); m.dispose();
      if (props.editorRef) props.editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const m = model.current, e = editor.current;
    if (!m || !e) return;
    if (m.getValue() !== props.value) {
      applying.current = true;
      m.setValue(props.value);
      applying.current = false;
    }
    e.updateOptions({ readOnly: !props.editable });
    const isModified = props.side === 'modified';
    decorations.current = e.deltaDecorations(
      decorations.current,
      props.highlight.lines.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: isModified ? 'added-line' : 'deleted-line',
          marginClassName: isModified ? 'added-margin' : 'deleted-margin',
        },
      })),
    );
  }, [props.value, props.editable, props.side, props.highlight]);

  return <div className="editor-pane" ref={host} />;
}
