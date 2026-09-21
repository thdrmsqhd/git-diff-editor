import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '../ipc/client';
import {
  ancestorDirectoryPaths,
  buildFileTree,
  collectDefaultCollapsedPaths,
  collectDirectoryPaths,
  type FileTreeNode,
} from './fileTreeModel';

function statusLabel(status: string): string {
  if (status === 'clean') return '';
  if (status === 'conflict') return '!';
  if (status === 'unsupported') return '?';
  return status;
}

function statusTitle(status: string): string {
  switch (status) {
    case 'M': return '수정됨';
    case 'A': return '추가됨';
    case 'U': return '추적되지 않음';
    case 'D': return '삭제됨';
    case 'R': return '이름 변경';
    case 'conflict': return '충돌';
    case 'unsupported': return '미지원';
    default: return '';
  }
}

function TreeRows(props: {
  nodes: FileTreeNode[];
  depth: number;
  collapsed: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {props.nodes.map((node) => {
        if (node.kind === 'directory') {
          const isCollapsed = props.collapsed.has(node.path);
          return (
            <div key={'directory-' + node.path} className="tree-group">
              <button
                type="button"
                className={'tree-item tree-directory' + (node.changedCount > 0 ? ' changed' : '')}
                style={{ paddingLeft: 10 + props.depth * 16 }}
                aria-expanded={!isCollapsed}
                data-testid={'directory-' + node.path}
                title={node.path}
                onClick={() => props.onToggle(node.path)}
              >
                <span className="tree-caret" aria-hidden="true">{isCollapsed ? '›' : '⌄'}</span>
                <span className="tree-folder-icon" aria-hidden="true" />
                <span className="tree-name tree-directory-name">{node.name}</span>
                {node.changedCount > 0 ? (
                  <span className="tree-change-count" title={`변경 파일 ${node.changedCount}개`}>
                    {node.changedCount}
                  </span>
                ) : null}
              </button>
              {!isCollapsed ? (
                <div className="tree-children">
                  <TreeRows
                    nodes={node.children}
                    depth={props.depth + 1}
                    collapsed={props.collapsed}
                    selected={props.selected}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                  />
                </div>
              ) : null}
            </div>
          );
        }

        const file = node.file;
        const clean = file.status === 'clean';
        return (
          <button
            type="button"
            key={node.path}
            className={
              'tree-item tree-file' +
              (clean ? ' clean' : ' changed') +
              (props.selected === node.path ? ' selected' : '')
            }
            style={{ paddingLeft: 10 + props.depth * 16 }}
            data-testid={'file-' + node.path}
            title={file.previousPath ? file.previousPath + ' → ' + node.path : node.path}
            onClick={() => props.onSelect(node.path)}
          >
            <span className="tree-caret spacer" aria-hidden="true" />
            <span className="tree-file-icon" aria-hidden="true" />
            <span className="tree-name">{node.name}</span>
            {!clean ? (
              <span
                className={'tree-status ' + file.status}
                title={statusTitle(file.status)}
                aria-label={statusTitle(file.status)}
              >
                {statusLabel(file.status)}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

export function FileTree(props: {
  repositoryKey: string;
  files: FileEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(props.files), [props.files]);
  const allDirectories = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const defaultCollapsed = useMemo(() => collectDefaultCollapsedPaths(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed));
  const previousRepository = useRef(props.repositoryKey);
  const changedCount = props.files.filter((file) => file.status !== 'clean').length;

  useEffect(() => {
    if (previousRepository.current !== props.repositoryKey) {
      previousRepository.current = props.repositoryKey;
      setCollapsed(new Set(defaultCollapsed));
      return;
    }
    const available = new Set(allDirectories);
    setCollapsed((previous) => new Set([...previous].filter((path) => available.has(path))));
  }, [allDirectories, defaultCollapsed, props.repositoryKey]);

  useEffect(() => {
    if (!props.selected) return;
    const ancestors = new Set(ancestorDirectoryPaths(props.selected));
    setCollapsed((previous) => {
      const next = new Set([...previous].filter((path) => !ancestors.has(path)));
      return next.size === previous.size ? previous : next;
    });
  }, [props.selected]);

  function toggle(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="sidebar">
      <div className="side-head">
        <div className="side-title-group">
          <span className="side-title">FILES</span>
          {changedCount > 0 ? <span className="side-count">{changedCount}</span> : null}
        </div>
        <span className="side-actions">
          <button
            type="button"
            className="side-action icon-only"
            title="모든 폴더 접기"
            aria-label="모든 폴더 접기"
            onClick={() => setCollapsed(new Set(allDirectories))}
          >
            −
          </button>
          <button
            type="button"
            className="side-action icon-only"
            title="모든 폴더 펼치기"
            aria-label="모든 폴더 펼치기"
            onClick={() => setCollapsed(new Set())}
          >
            +
          </button>
        </span>
      </div>
      <div className="side-body" role="tree" aria-label="저장소 파일">
        <TreeRows
          nodes={tree}
          depth={0}
          collapsed={collapsed}
          selected={props.selected}
          onToggle={toggle}
          onSelect={props.onSelect}
        />
      </div>
    </div>
  );
}
