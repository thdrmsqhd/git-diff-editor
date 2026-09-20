export function StatusView(props: { text: string; hint?: string }) {
  return (
    <div className="status">
      <div className="status-title" data-testid="status">
        {props.text}
      </div>
      {props.hint ? <div className="status-hint">{props.hint}</div> : null}
    </div>
  );
}
