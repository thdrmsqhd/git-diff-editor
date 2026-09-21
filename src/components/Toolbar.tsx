async function windowAction(fn: 'minimize' | 'toggleMaximize' | 'startDragging') {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[fn]();
  } catch {
    /* vite preview has no Tauri window */
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('button, input, textarea, select, a, [role="button"], [data-no-drag]'),
  );
}

export function Toolbar(props: {
  path?: string;
  branch?: string | null;
  detached?: boolean;
  head?: string | null;
  dirty: boolean;
  canSave: boolean;
  busy?: boolean;
  saving?: boolean;
  onOpen: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const branch = props.detached
    ? 'detached ' + (props.head?.slice(0, 8) ?? '')
    : props.branch ?? '';

  function startWindowDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    void windowAction('startDragging');
  }

  function toggleWindowMaximize(event: React.MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return;
    void windowAction('toggleMaximize');
  }

  return (
    <div
      className="toolbar"
      data-tauri-drag-region
      onPointerDown={startWindowDrag}
      onDoubleClick={toggleWindowMaximize}
    >
      <span className="brand" data-tauri-drag-region>Git Diff Editor</span>
      <button
        type="button"
        className="btn"
        data-testid="open-repo"
        data-no-drag
        disabled={props.busy}
        onClick={props.onOpen}
      >
        저장소 열기
      </button>
      <span className="path" data-testid="repo-path" data-tauri-drag-region>
        {props.path ?? '저장소를 선택하세요'}
      </span>
      {branch ? <span className="chip" data-tauri-drag-region>{branch}</span> : null}
      {props.head ? <span className="chip" data-tauri-drag-region>{props.head.slice(0, 8)}</span> : null}
      {props.dirty ? <span className="dirty" data-testid="dirty" data-tauri-drag-region>미저장</span> : null}
      <button
        type="button"
        className="btn primary"
        data-testid="save"
        data-no-drag
        disabled={!props.canSave || props.busy}
        onClick={props.onSave}
      >
        {props.saving ? '저장 중…' : '저장'}
      </button>
      <div className="win-controls" data-no-drag>
        <button type="button" className="win-btn" aria-label="최소화" onClick={() => void windowAction('minimize')}>
          ─
        </button>
        <button type="button" className="win-btn" aria-label="최대화" onClick={() => void windowAction('toggleMaximize')}>
          □
        </button>
        <button type="button" className="win-btn close" aria-label="닫기" onClick={props.onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
