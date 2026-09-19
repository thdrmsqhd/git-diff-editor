export function StatusView(props: { text: string }) {
  return <div className="status" data-testid="status">{props.text}</div>;
}
