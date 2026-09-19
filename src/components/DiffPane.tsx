import { useEffect, useRef } from 'react';
import { createSingleEditor, type EditorHandle } from '../editor/monacoAdapter';
import { useSideBySide } from '../editor/diffLayout';

export function DiffPane(props: {
  original: string;
  modified: string;
  editable: boolean;
  onChange: (text: string) => void;
}) {
  const originalRef = useRef<HTMLDivElement | null>(null);
  const modifiedRef = useRef<HTMLDivElement | null>(null);
  const originalHandle = useRef<EditorHandle | null>(null);
  const modifiedHandle = useRef<EditorHandle | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const split = useSideBySide(props.original);

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

  return (
    <div className={split ? 'diff split' : 'diff'}>
      {split ? <div className="pane original" ref={originalRef} /> : null}
      <div className="pane modified" ref={modifiedRef} />
    </div>
  );
}
