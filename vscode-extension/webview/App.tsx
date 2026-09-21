import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentPayload, FileEntry, HostToWebview, RepositorySnapshot } from './protocol';
import { vscode } from './protocol';
import { calculateDiff } from './diff';
import { EditorPane, type EditorHandle } from './EditorPane';
import { FileTree } from './FileTree';
import { ResizeHandle } from './ResizeHandle';
import { usePersistentNumber } from './usePersistentNumber';

type Connector = { index: number; leftY: number; rightY: number };

function breadcrumb(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export default function App() {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>();
  const [document, setDocument] = useState<DocumentPayload>();
  const [buffer, setBuffer] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [activeHunk, setActiveHunk] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [pendingFile, setPendingFile] = useState<FileEntry>();
  const [scrollSync, setScrollSync] = useState(() => localStorage.getItem('gde.vscode.scrollSync') !== 'off');
  const [sidebarWidth, setSidebarWidth] = usePersistentNumber('gde.vscode.sidebarWidth', 300, 190, 620);
  const dirtyRef = useRef(false);
  const left = useRef<EditorHandle | null>(null);
  const right = useRef<EditorHandle | null>(null);
  const connectorBody = useRef<HTMLDivElement | null>(null);
  const programmaticScrollSide = useRef<'original' | 'modified' | null>(null);

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { localStorage.setItem('gde.vscode.scrollSync', scrollSync ? 'on' : 'off'); }, [scrollSync]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (message.type === 'error') {
        setError(message.message);
        return;
      }
      setError(undefined);
      if ('snapshot' in message) setSnapshot(message.snapshot);
      if ('document' in message && message.document) {
        const discarded = message.type === 'external-refresh' && dirtyRef.current;
        setDocument(message.document);
        setBuffer(message.document.currentText);
        setDirty(false);
        setActiveHunk(0);
        if (message.type === 'external-refresh') {
          setReviewed((previous) => {
            const next = new Set(previous);
            next.delete(message.document!.path);
            return next;
          });
          setNotice(discarded
            ? '외부 변경을 반영하여 미저장 편집을 폐기했습니다.'
            : '외부 변경을 반영했습니다.');
        } else if (message.type === 'saved') {
          setNotice('저장했습니다.');
        }
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!snapshot?.root) return;
    try {
      const raw = localStorage.getItem('gde.reviewed:' + snapshot.root);
      setReviewed(new Set(raw ? JSON.parse(raw) as string[] : []));
    } catch {
      setReviewed(new Set());
    }
  }, [snapshot?.root]);

  useEffect(() => {
    if (!snapshot?.root) return;
    localStorage.setItem('gde.reviewed:' + snapshot.root, JSON.stringify([...reviewed]));
  }, [reviewed, snapshot?.root]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const diff = useMemo(
    () => calculateDiff(document?.originalText ?? '', buffer),
    [document?.originalText, buffer],
  );
  const currentHunk = diff.hunks[activeHunk];

  useEffect(() => {
    if (diff.hunks.length === 0) {
      if (activeHunk !== 0) setActiveHunk(0);
    } else if (activeHunk >= diff.hunks.length) {
      setActiveHunk(diff.hunks.length - 1);
    }
  }, [activeHunk, diff.hunks.length]);

  const refreshConnectors = useCallback(() => {
    const leftEditor = left.current;
    const rightEditor = right.current;
    if (!leftEditor || !rightEditor) return;
    setConnectors(diff.hunks.map((hunk, index) => ({
      index,
      leftY: leftEditor.screenY(hunk.originalAnchor),
      rightY: rightEditor.screenY(hunk.modifiedAnchor),
    })));
  }, [diff.hunks]);

  useEffect(() => {
    const frame = requestAnimationFrame(refreshConnectors);
    return () => cancelAnimationFrame(frame);
  }, [refreshConnectors, sidebarWidth]);

  const changedFiles = useMemo(
    () => snapshot?.files.filter((file) => file.status !== 'clean') ?? [],
    [snapshot?.files],
  );
  const reviewedChanged = changedFiles.filter((file) => reviewed.has(file.path)).length;

  function syncScrollFrom(sourceSide: 'original' | 'modified') {
    if (!scrollSync || diff.hunks.length === 0) return;
    if (programmaticScrollSide.current === sourceSide) {
      programmaticScrollSide.current = null;
      return;
    }

    const source = sourceSide === 'original' ? left.current : right.current;
    const target = sourceSide === 'original' ? right.current : left.current;
    if (!source || !target) return;

    const sourceCenter = source.getScrollTop() + source.getViewportHeight() / 2;
    const anchors = diff.hunks.map((hunk) => ({
      source: source.lineTop(sourceSide === 'original' ? hunk.originalAnchor : hunk.modifiedAnchor),
      target: target.lineTop(sourceSide === 'original' ? hunk.modifiedAnchor : hunk.originalAnchor),
    }));

    let targetCenter: number;
    if (anchors.length === 1 || sourceCenter <= anchors[0].source) {
      targetCenter = anchors[0].target + (sourceCenter - anchors[0].source);
    } else if (sourceCenter >= anchors[anchors.length - 1].source) {
      const last = anchors[anchors.length - 1];
      targetCenter = last.target + (sourceCenter - last.source);
    } else {
      let index = 0;
      while (index + 1 < anchors.length && anchors[index + 1].source < sourceCenter) index++;
      const a = anchors[index];
      const b = anchors[index + 1];
      const span = Math.max(1, b.source - a.source);
      const ratio = Math.max(0, Math.min(1, (sourceCenter - a.source) / span));
      targetCenter = a.target + (b.target - a.target) * ratio;
    }

    const targetTop = targetCenter - target.getViewportHeight() / 2;
    const targetSide = sourceSide === 'original' ? 'modified' : 'original';
    programmaticScrollSide.current = targetSide;
    target.setScrollTop(targetTop);
    requestAnimationFrame(() => {
      if (programmaticScrollSide.current === targetSide) programmaticScrollSide.current = null;
      refreshConnectors();
    });
  }

  function openFile(file: FileEntry) {
    vscode.postMessage({ type: 'select-file', path: file.path });
  }

  function discardLocalEdits() {
    if (!document) return;
    setBuffer(document.currentText);
    setDirty(false);
    setActiveHunk(0);
    dirtyRef.current = false;
    requestAnimationFrame(refreshConnectors);
  }

  function select(file: FileEntry) {
    if (document?.path === file.path) return;
    if (dirty) {
      setPendingFile(file);
      return;
    }
    openFile(file);
  }

  function discardAndMove() {
    const target = pendingFile;
    if (!target) return;
    discardLocalEdits();
    setPendingFile(undefined);
    openFile(target);
  }

  function save() {
    if (!document || !document.editable || !dirty) return;
    vscode.postMessage({ type: 'save', path: document.path, text: buffer });
  }

  function activateHunk(index: number, focus = true) {
    if (!diff.hunks.length) return;
    const next = (index + diff.hunks.length) % diff.hunks.length;
    setActiveHunk(next);
    const hunk = diff.hunks[next];
    left.current?.revealLine(hunk.originalAnchor);
    right.current?.revealLine(hunk.modifiedAnchor);
    if (focus) right.current?.focus();
    requestAnimationFrame(refreshConnectors);
  }

  function navigateHunk(delta: number) {
    activateHunk(activeHunk + delta);
  }

  function navigateFile(delta: number) {
    if (!document || !changedFiles.length) return;
    const current = changedFiles.findIndex((file) => file.path === document.path);
    const base = current >= 0 ? current : 0;
    const next = (base + delta + changedFiles.length) % changedFiles.length;
    select(changedFiles[next]);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      } else if (event.altKey && event.key === 'F7') {
        event.preventDefault();
        navigateFile(-1);
      } else if (event.altKey && event.key === 'F8') {
        event.preventDefault();
        navigateFile(1);
      } else if (event.key === 'F7') {
        event.preventDefault();
        navigateHunk(-1);
      } else if (event.key === 'F8') {
        event.preventDefault();
        navigateHunk(1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function toggleReviewed(path: string) {
    setReviewed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  const crumbs = breadcrumb(document?.path ?? '');

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Git Diff Editor</strong>
        <span className="repo">{snapshot?.root ?? 'workspace 확인 중...'}</span>
        {snapshot?.branch && <span className="chip">{snapshot.branch}</span>}
        {snapshot?.headOid && <span className="chip">{snapshot.headOid.slice(0, 8)}</span>}
        {changedFiles.length > 0 && (
          <span className="review-progress" title="변경 파일 검토 진행률">
            검토 {reviewedChanged}/{changedFiles.length}
          </span>
        )}
        {dirty && <span className="dirty">미저장</span>}
        <button onClick={() => vscode.postMessage({ type: 'refresh' })}>새로고침</button>
        <button disabled={!dirty} onClick={discardLocalEdits}>변경 취소</button>
        <button className="primary" disabled={!dirty || !document?.editable} onClick={save}>저장</button>
      </header>

      <div className="body">
        <aside style={{ width: sidebarWidth }}>
          <FileTree
            files={snapshot?.files ?? []}
            selected={document?.path}
            reviewed={reviewed}
            onSelect={select}
            onToggleReviewed={toggleReviewed}
          />
        </aside>
        <ResizeHandle
          ariaLabel="파일 트리 너비 조절"
          value={sidebarWidth}
          onDelta={(delta) => setSidebarWidth((width) => width + delta)}
          onReset={() => setSidebarWidth(300)}
        />

        <main>
          {error ? (
            <div className="center error">
              <strong>오류</strong><div>{error}</div>
              <button onClick={() => vscode.postMessage({ type: 'refresh' })}>다시 시도</button>
            </div>
          ) : !document ? (
            <div className="center">파일을 선택하세요.</div>
          ) : (
            <>
              <div className="diff-toolbar">
                <nav className="breadcrumb" aria-label="파일 경로">
                  {crumbs.map((part, index) => (
                    <span key={index}>
                      {index > 0 && <span className="crumb-sep">›</span>}
                      <span className={index === crumbs.length - 1 ? 'crumb-current' : ''}>{part}</span>
                    </span>
                  ))}
                </nav>
                <button
                  className={'sync-toggle ' + (scrollSync ? 'active' : '')}
                  onClick={() => setScrollSync((value) => !value)}
                  title="좌우 hunk 기준 완화형 스크롤 동기화"
                  aria-pressed={scrollSync}
                >
                  Scroll Sync {scrollSync ? 'ON' : 'OFF'}
                </button>
                <span className="summary">
                  변경 {diff.hunks.length ? activeHunk + 1 : 0}/{diff.hunks.length}
                  {currentHunk && <> · <span className="minus">-{currentHunk.deletions}</span> <span className="plus">+{currentHunk.additions}</span></>}
                </span>
                <button onClick={() => navigateHunk(-1)} title="F7">이전</button>
                <button onClick={() => navigateHunk(1)} title="F8">다음</button>
              </div>

              <div className="compare-grid">
                <section className="compare-pane">
                  <div className="pane-title">HEAD</div>
                  <EditorPane
                    value={document.originalText}
                    editable={false}
                    side="original"
                    highlight={diff.original}
                    activeHunk={currentHunk}
                    editorRef={left}
                    onViewportChange={refreshConnectors}
                    onScroll={() => syncScrollFrom('original')}
                  />
                </section>

                <div className="connector-column">
                  <div className="connector-head">↔</div>
                  <div className="connector-body" ref={connectorBody}>
                    <svg className="connector-svg" aria-label="변경 묶음 연결">
                      {connectors.map((connector) => {
                        const active = connector.index === activeHunk;
                        const y1 = connector.leftY;
                        const y2 = connector.rightY;
                        return (
                          <g
                            key={connector.index}
                            className={active ? 'connector active' : 'connector'}
                            onClick={() => activateHunk(connector.index)}
                          >
                            <line x1="1" y1={y1} x2="39" y2={y2} />
                            <circle cx="4" cy={y1} r={active ? 3 : 2} />
                            <circle cx="36" cy={y2} r={active ? 3 : 2} />
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                <section className="compare-pane">
                  <div className="pane-title">Working Tree</div>
                  <EditorPane
                    value={buffer}
                    editable={document.editable}
                    side="modified"
                    highlight={diff.modified}
                    activeHunk={currentHunk}
                    editorRef={right}
                    onViewportChange={refreshConnectors}
                    onScroll={() => syncScrollFrom('modified')}
                    onChange={(value) => {
                      setBuffer(value);
                      setDirty(value !== document.currentText);
                    }}
                  />
                </section>
              </div>
            </>
          )}
        </main>
      </div>
      <div className="shortcut-hint">F7/F8 변경 이동 · Alt+F7/F8 변경 파일 이동</div>
      {pendingFile && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingFile(undefined)}>
          <div className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title" onMouseDown={(event) => event.stopPropagation()}>
            <strong id="discard-title">저장하지 않은 변경 사항</strong>
            <div className="discard-message">
              현재 편집을 버리고 <b>{pendingFile.path}</b> 파일로 이동하시겠습니까?
            </div>
            <div className="discard-actions">
              <button onClick={() => setPendingFile(undefined)}>취소</button>
              <button className="danger" onClick={discardAndMove}>변경 버리고 이동</button>
            </div>
          </div>
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
