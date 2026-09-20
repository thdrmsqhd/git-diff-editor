export type StatusAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
};

export function StatusView(props: {
  text: string;
  hint?: string;
  busy?: boolean;
  primaryAction?: StatusAction;
  secondaryAction?: StatusAction;
}) {
  return (
    <div className="status" aria-busy={props.busy || undefined}>
      {props.busy ? <span className="spinner" aria-hidden="true" /> : null}
      <div className="status-title" data-testid="status">
        {props.text}
      </div>
      {props.hint ? <div className="status-hint">{props.hint}</div> : null}
      {props.primaryAction || props.secondaryAction ? (
        <div className="status-actions">
          {props.primaryAction ? (
            <button
              type="button"
              className={'btn' + (props.primaryAction.primary !== false ? ' primary' : '')}
              onClick={props.primaryAction.onClick}
            >
              {props.primaryAction.label}
            </button>
          ) : null}
          {props.secondaryAction ? (
            <button
              type="button"
              className={'btn' + (props.secondaryAction.primary ? ' primary' : '')}
              onClick={props.secondaryAction.onClick}
            >
              {props.secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
