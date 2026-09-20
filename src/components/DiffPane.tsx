import { useEffect, useRef } from 'react';
import { createSingleEditor, type EditorHandle } from '../editor/monacoAdapter';
import { useSideBySide } from '../editor/diffLayout';

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

  useEffect(() => {
    if (!modifiedRef.current) return;
    modifiedHandle.current = createSingleEditor(modifiedRef.current, (t) => onChangeRef.current(t));
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
    originalHandle.current?.setContents(props.original, props.original, false);
    modifiedHandle.current?.setContents(props.original, props.modified, props.editable);
  }, [props.original, props.modified, props.editable, split]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7' && e.key !== 'F8') return;
      e.preventDefault();
      modifiedHandle.current?.revealChange(e.key === 'F8' ? 1 : -1);
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
          <span className="pane-hint">F8 다음 변경</span>
        </div>
        <div className="pane-body" ref={modifiedRef} />
      </div>
    </div>
  );
}
