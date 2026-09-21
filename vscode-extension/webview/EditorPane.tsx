import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { Highlight, Hunk } from './diff';

self.MonacoEnvironment = { getWorker: () => new editorWorker() };

export type EditorHandle = {
  revealLine(line: number): void;
  focus(): void;
  screenY(line: number): number;
  lineTop(line: number): number;
  getScrollTop(): number;
  setScrollTop(value: number): void;
  getViewportHeight(): number;
};

export function EditorPane(props: {
  value: string;
  editable: boolean;
  side: 'original' | 'modified';
  highlight: Highlight;
  activeHunk?: Hunk;
  onChange?: (value: string) => void;
  onViewportChange?: () => void;
  onScroll?: (scrollTop: number) => void;
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
    if (props.editorRef) {
      props.editorRef.current = {
        revealLine(line) { e.revealLineInCenter(Math.max(1, Math.min(line, m.getLineCount()))); },
        focus() { e.focus(); },
        screenY(line) {
          const safe = Math.max(1, Math.min(line, m.getLineCount()));
          return e.getTopForLineNumber(safe) - e.getScrollTop() + e.getOption(monaco.editor.EditorOption.lineHeight) / 2;
        },
        lineTop(line) {
          const safe = Math.max(1, Math.min(line, m.getLineCount()));
          return e.getTopForLineNumber(safe) + e.getOption(monaco.editor.EditorOption.lineHeight) / 2;
        },
        getScrollTop() { return e.getScrollTop(); },
        setScrollTop(value) { e.setScrollTop(Math.max(0, value), monaco.editor.ScrollType.Immediate); },
        getViewportHeight() { return e.getLayoutInfo().height; },
      };
    }
    const contentSub = m.onDidChangeContent(() => {
      if (!applying.current) props.onChange?.(m.getValue());
    });
    const scrollSub = e.onDidScrollChange((event) => {
      props.onViewportChange?.();
      if (event.scrollTopChanged) props.onScroll?.(event.scrollTop);
    });
    const layoutSub = e.onDidLayoutChange(() => props.onViewportChange?.());
    return () => {
      contentSub.dispose();
      scrollSub.dispose();
      layoutSub.dispose();
      e.dispose();
      m.dispose();
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
    const next: monaco.editor.IModelDeltaDecoration[] = [
      ...props.highlight.lines.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: isModified ? 'added-line' : 'deleted-line',
          marginClassName: isModified ? 'added-margin' : 'deleted-margin',
        },
      })),
      ...props.highlight.spans.map((span) => ({
        range: new monaco.Range(span.line, span.startColumn, span.line, span.endColumn),
        options: { inlineClassName: isModified ? 'added-text' : 'deleted-text' },
      })),
    ];

    if (props.activeHunk) {
      const start = props.side === 'original' ? props.activeHunk.originalStart : props.activeHunk.modifiedStart;
      const end = props.side === 'original' ? props.activeHunk.originalEnd : props.activeHunk.modifiedEnd;
      if (end >= start && start > 0) {
        next.push({
          range: new monaco.Range(start, 1, Math.max(start, end), 1),
          options: { isWholeLine: true, className: 'active-hunk-line' },
        });
      }
    }

    decorations.current = e.deltaDecorations(decorations.current, next);
    props.onViewportChange?.();
  }, [props.value, props.editable, props.side, props.highlight, props.activeHunk]);

  return <div className="editor-pane" ref={host} />;
}
