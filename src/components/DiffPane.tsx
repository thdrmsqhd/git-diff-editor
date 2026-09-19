import { useEffect, useRef } from 'react';
import { createDiffEditor, type DiffHandle } from '../editor/monacoAdapter';

export function DiffPane(props: {
  original: string;
  modified: string;
  editable: boolean;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const handle = useRef<DiffHandle | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    if (!ref.current) return;
    handle.current = createDiffEditor(ref.current, (t) => onChangeRef.current(t));
    return () => handle.current?.dispose();
  }, []);

  useEffect(() => {
    handle.current?.setContents(props.original, props.modified, props.editable);
  }, [props.original, props.modified, props.editable]);

  return <div className="diff" ref={ref} />;
}
