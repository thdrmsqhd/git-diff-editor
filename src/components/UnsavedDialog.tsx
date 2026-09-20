export function UnsavedDialog(props: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="status" data-testid="unsaved-dialog">
      <p>저장하지 않은 변경이 있습니다.</p>
      <button type="button" className="btn primary" data-testid="unsaved-save" onClick={props.onSave}>
        저장
      </button>
      <button type="button" className="btn" data-testid="unsaved-discard" onClick={props.onDiscard}>
        버리기
      </button>
      <button type="button" className="btn" data-testid="unsaved-cancel" onClick={props.onCancel}>
        취소
      </button>
    </div>
  );
}
