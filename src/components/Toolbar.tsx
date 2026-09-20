async function windowAction(fn: 'minimize' | 'toggleMaximize') {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[fn]();
  } catch {
    /* vite preview has no Tauri window */
  }
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
  return (
    <div className="toolbar" data-tauri-drag-region>
      <span className="brand">Git Diff Editor</span>
      <button
        type="button"
        className="btn"
        data-testid="open-repo"
        disabled={props.busy}
        onClick={props.onOpen}
      >
        저장소 열기
      </button>
      <span className="path" data-testid="repo-path">{props.path ?? '저장소를 선택하세요'}</span>
      {branch ? <span className="chip">{branch}</span> : null}
      {props.head ? <span className="chip">{props.head.slice(0, 8)}</span> : null}
      {props.dirty ? <span className="dirty" data-testid="dirty">미저장</span> : null}
      <button
        type="button"
        className="btn primary"
        data-testid="save"
        disabled={!props.canSave || props.busy}
        onClick={props.onSave}
      >
        {props.saving ? '저장 중…' : '저장'}
      </button>
      <div className="win-controls">
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
