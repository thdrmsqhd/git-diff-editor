import type { FileEntry } from '../ipc/client';

function statusRank(s: string): number {
  return ['M', 'A', 'U', 'D', 'R', 'conflict', 'unsupported'].includes(s) ? 0 : 1;
}

export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function fileDir(path: string): string {
  const parts = path.split('/');
  if (parts.length < 2) return '';
  return parts.slice(0, -1).join('/');
}

export function sortFiles(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    const da = fileDir(a.path);
    const db = fileDir(b.path);
    if (da !== db) return da.localeCompare(db);
    return a.path.localeCompare(b.path);
  });
}

function Row(props: {
  file: FileEntry;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const f = props.file;
  return (
    <div
      className={'tree-item' + (props.selected ? ' selected' : '')}
      data-testid={'file-' + f.path}
      title={f.previousPath ? f.previousPath + ' → ' + f.path : f.path}
      onClick={() => props.onSelect(f.path)}
    >
      <span className={'st ' + f.status}>{f.status === 'clean' ? '' : f.status}</span>
      <span className="tree-name">{fileName(f.path)}</span>
      <span className="tree-dir">{fileDir(f.path)}</span>
    </div>
  );
}

export function FileTree(props: {
  files: FileEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const files = sortFiles(props.files);
  const changed = files.filter((f) => f.status !== 'clean');
  const rest = files.filter((f) => f.status === 'clean');
  return (
    <div className="sidebar">
      <div className="side-head">
        파일
        {changed.length > 0 ? <span className="side-count">{changed.length}</span> : null}
      </div>
      <div className="side-body">
        {changed.length > 0 ? <div className="side-label changed">변경</div> : null}
        {changed.map((f) => (
          <Row key={f.path} file={f} selected={props.selected === f.path} onSelect={props.onSelect} />
        ))}
        {rest.length > 0 ? <div className="side-label">기타</div> : null}
        {rest.map((f) => (
          <Row key={f.path} file={f} selected={props.selected === f.path} onSelect={props.onSelect} />
        ))}
      </div>
    </div>
  );
}
