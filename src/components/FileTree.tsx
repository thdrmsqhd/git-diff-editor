import type { FileEntry } from '../ipc/client';

function statusRank(s: string): number {
  return ['M', 'A', 'U', 'D', 'R', 'conflict', 'unsupported'].includes(s) ? 0 : 1;
}

export function sortFiles(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    const da = a.path.split('/').slice(0, -1).join('/');
    const db = b.path.split('/').slice(0, -1).join('/');
    if (da !== db) return da.localeCompare(db);
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
}

export function FileTree(props: {
  files: FileEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const files = sortFiles(props.files);
  return (
    <div className="sidebar">
      {files.map((f) => (
        <div
          key={f.path}
          className={'tree-item' + (props.selected === f.path ? ' selected' : '')}
          data-testid={'file-' + f.path}
          onClick={() => props.onSelect(f.path)}
        >
          <span className={'st ' + f.status}>{f.status === 'clean' ? '' : f.status}</span>
          <span title={f.previousPath ? f.previousPath + ' → ' + f.path : f.path}>{f.path}</span>
        </div>
      ))}
    </div>
  );
}
