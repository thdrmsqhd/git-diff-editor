import { useEffect, useMemo, useState } from 'react';
import type { FileEntry } from './protocol';
import { ancestors, buildTree, directoryPaths, type TreeNode } from './fileTreeModel';

export function FileTree(props: {
  files: FileEntry[];
  selected?: string;
  reviewed: Set<string>;
  onSelect: (file: FileEntry) => void;
  onToggleReviewed: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(props.files), [props.files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!props.selected) return;
    const open = new Set(ancestors(props.selected));
    setCollapsed((previous) => {
      const next = new Set(previous);
      open.forEach((path) => next.delete(path));
      return next;
    });
  }, [props.selected]);

  function render(node: TreeNode, depth: number): React.ReactNode {
    if (node.kind === 'directory') {
      const closed = collapsed.has(node.path);
      return (
        <div key={node.path}>
          <button
            className="tree-directory"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (closed) next.delete(node.path); else next.add(node.path);
              return next;
            })}
          >
            <span className="chevron">{closed ? '›' : '⌄'}</span>
            <span className="folder-name">{node.name}</span>
            {node.changedCount > 0 && <span className="folder-count">{node.changedCount}</span>}
          </button>
          {!closed && node.children.map((child) => render(child, depth + 1))}
        </div>
      );
    }

    const file = node.file;
    const reviewed = props.reviewed.has(file.path);
    return (
      <div
        key={file.path}
        className={'tree-file ' + (props.selected === file.path ? 'selected' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={file.path}
      >
        <button
          className={'review-check ' + (reviewed ? 'reviewed' : '')}
          title={reviewed ? '검토 완료 해제' : '검토 완료'}
          onClick={(event) => { event.stopPropagation(); props.onToggleReviewed(file.path); }}
        >
          {reviewed ? '✓' : '○'}
        </button>
        <button className="tree-file-main" onClick={() => props.onSelect(file)}>
          <span className={'status s-' + file.status}>{file.status === 'clean' ? '' : file.status}</span>
          <span className="file-name">{node.name}</span>
          {file.status !== 'clean' && (
            <span className="file-stat">
              <span className="minus">-{file.deletions}</span>
              <span className="plus">+{file.additions}</span>
            </span>
          )}
        </button>
      </div>
    );
  }

  const allPaths = directoryPaths(tree);
  return (
    <div className="tree">
      <div className="tree-actions">
        <button onClick={() => setCollapsed(new Set())}>모두 펼치기</button>
        <button onClick={() => setCollapsed(new Set(allPaths))}>모두 접기</button>
      </div>
      <div className="tree-body">{tree.map((node) => render(node, 0))}</div>
    </div>
  );
}
