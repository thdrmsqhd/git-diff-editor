import { useEffect, useMemo, useRef } from 'react';
import { createSingleEditor, type EditorHandle } from '../editor/monacoAdapter';
import { useSideBySide } from '../editor/diffLayout';
import { calculateTextDiff, nextHunkIndex } from '../editor/lineDiff';

export function DiffPane(props: {
  original: string;
  modified: string;
  editable: boolean;
  headShort?: string;
  dirty?: boolean;
  onChange: (text: string) => void;
}) {
  const originalRef = useRef<HTMLDivElement | null>(null);
  const modifiedRef = useRef<HTMLDivElement | null>(null);
  const originalHandle = useRef<EditorHandle | null>(null);
  const modifiedHandle = useRef<EditorHandle | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const split = useSideBySide(props.original);
  const head = props.headShort ? 'HEAD ' + props.headShort : 'HEAD';
  const diff = useMemo(
    () => calculateTextDiff(props.original, props.modified),
    [props.original, props.modified],
  );
  const diffRef = useRef(diff);
  diffRef.current = diff;

  useEffect(() => {
    if (!modifiedRef.current) return;
    modifiedHandle.current = createSingleEditor(modifiedRef.current, (text) => onChangeRef.current(text));
    return () => {
      modifiedHandle.current?.dispose();
      modifiedHandle.current = null;
    };
  }, []);

  useEffect(() => {
    if (!split) {
      originalHandle.current?.dispose();
      originalHandle.current = null;
      return;
    }
    if (!originalRef.current) return;
    originalHandle.current = createSingleEditor(originalRef.current, () => undefined);
    return () => {
      originalHandle.current?.dispose();
      originalHandle.current = null;
    };
  }, [split]);

  useEffect(() => {
    originalHandle.current?.setContents(props.original, false, diff.original, 'original');
    modifiedHandle.current?.setContents(props.modified, props.editable, diff.modified, 'modified');
  }, [props.original, props.modified, props.editable, split, diff]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F7' && event.key !== 'F8') return;
      event.preventDefault();
      const direction = event.key === 'F8' ? 1 : -1;
      const side = originalHandle.current?.hasTextFocus() ? 'original' : 'modified';
      const active = side === 'original' ? originalHandle.current : modifiedHandle.current;
      const currentLine = active?.getCurrentLine() ?? 1;
      const index = nextHunkIndex(diffRef.current.hunks, currentLine, direction, side);
      if (index == null) return;
      const hunk = diffRef.current.hunks[index];
      originalHandle.current?.revealLine(hunk.originalAnchor, side === 'original');
      modifiedHandle.current?.revealLine(hunk.modifiedAnchor, side === 'modified');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={split ? 'diff split' : 'diff'}>
      {split ? (
        <div className="pane original">
          <div className="pane-head">{head}</div>
          <div className="pane-body" ref={originalRef} />
        </div>
      ) : null}
      <div className="pane modified">
        <div className="pane-head">
          작업 트리
          {props.dirty ? <span className="pane-dirty">미저장</span> : null}
          <span className="pane-hint">F7/F8 변경 이동</span>
        </div>
        <div className="pane-body" ref={modifiedRef} />
      </div>
    </div>
  );
}
