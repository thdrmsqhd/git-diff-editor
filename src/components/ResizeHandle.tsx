import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

export function ResizeHandle(props: {
  className?: string;
  ariaLabel: string;
  ariaValueNow?: number;
  onDelta: (deltaX: number) => void;
  onKeyboardDelta: (direction: -1 | 1) => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  const pointerId = useRef<number | null>(null);
  const lastX = useRef(0);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    pointerId.current = event.pointerId;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return;
    const delta = event.clientX - lastX.current;
    if (delta !== 0) {
      lastX.current = event.clientX;
      props.onDelta(delta);
    }
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      props.onKeyboardDelta(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      props.onKeyboardDelta(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      props.onReset();
    }
  }

  return (
    <div
      className={props.className ?? 'resize-handle'}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.ariaLabel}
      aria-valuenow={props.ariaValueNow}
      tabIndex={0}
      onDoubleClick={props.onReset}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      {props.children}
      <span className="resize-grip" aria-hidden="true" />
    </div>
  );
}
