export function Toolbar(props: {
  path?: string;
  branch?: string | null;
  detached?: boolean;
  head?: string | null;
  dirty: boolean;
  canSave: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const branch = props.detached
    ? 'detached ' + (props.head?.slice(0, 8) ?? '')
    : props.branch ?? '';
  return (
    <div className="toolbar">
      <button type="button" data-testid="open-repo" onClick={props.onOpen}>
        저장소 열기
      </button>
      <span className="path" data-testid="repo-path">{props.path ?? '저장소를 선택하세요'}</span>
      <span>{branch}</span>
      {props.head ? <span>{props.head.slice(0, 8)}</span> : null}
      {props.dirty ? <span className="dirty" data-testid="dirty">미저장</span> : null}
      <button type="button" data-testid="save" disabled={!props.canSave} onClick={props.onSave}>
        저장
      </button>
    </div>
  );
}
