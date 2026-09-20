import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export function ResizeHandle(props: {
  ariaLabel: string;
  value: number;
  onDelta: (delta: number) => void;
  onReset: () => void;
}) {
  const pointer = useRef<number | null>(null);
  const lastX = useRef(0);

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    pointer.current = event.pointerId;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current !== event.pointerId) return;
    const delta = event.clientX - lastX.current;
    lastX.current = event.clientX;
    if (delta) props.onDelta(delta);
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); props.onDelta(-16); }
    if (event.key === 'ArrowRight') { event.preventDefault(); props.onDelta(16); }
    if (event.key === 'Home') { event.preventDefault(); props.onReset(); }
  }
  return <div
    className="resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label={props.ariaLabel}
    aria-valuenow={Math.round(props.value)}
    tabIndex={0}
    onDoubleClick={props.onReset}
    onKeyDown={key}
    onPointerDown={down}
    onPointerMove={move}
    onPointerUp={finish}
    onPointerCancel={finish}
  />;
}
