import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentPayload, FileEntry, HostToWebview, RepositorySnapshot } from './protocol';
import { vscode } from './protocol';
import { calculateDiff } from './diff';
import { EditorPane, type EditorHandle } from './EditorPane';

function leaf(path: string): string {
  return path.split('/').pop() ?? path;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>();
  const [document, setDocument] = useState<DocumentPayload>();
  const [buffer, setBuffer] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [activeHunk, setActiveHunk] = useState(0);
  const left = useRef<EditorHandle | null>(null);
  const right = useRef<EditorHandle | null>(null);

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
        setDocument(message.document);
        setBuffer(message.document.currentText);
        setDirty(false);
        setActiveHunk(0);
      }
      if (message.type === 'external-refresh') {
        setNotice(message.discardedLocalEdit && dirty
          ? '외부 변경을 반영하여 미저장 편집을 폐기했습니다.'
          : '외부 변경을 반영했습니다.');
      } else if (message.type === 'saved') {
        setNotice('저장했습니다.');
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [dirty]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const diff = useMemo(
    () => calculateDiff(document?.originalText ?? '', buffer),
    [document?.originalText, buffer],
  );

  function select(file: FileEntry) {
    if (dirty && !confirm('저장하지 않은 편집을 버리고 다른 파일로 이동할까요?')) return;
    vscode.postMessage({ type: 'select-file', path: file.path });
  }

  function save() {
    if (!document || !document.editable || !dirty) return;
    vscode.postMessage({ type: 'save', path: document.path, text: buffer });
  }

  function navigate(delta: number) {
    if (diff.hunks.length === 0) return;
    const next = (activeHunk + delta + diff.hunks.length) % diff.hunks.length;
    setActiveHunk(next);
    left.current?.revealLine(diff.hunks[next].originalAnchor);
    right.current?.revealLine(diff.hunks[next].modifiedAnchor);
    right.current?.focus();
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); save();
      } else if (event.key === 'F7') {
        event.preventDefault(); navigate(-1);
      } else if (event.key === 'F8') {
        event.preventDefault(); navigate(1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const changed = snapshot?.files.filter((file) => file.status !== 'clean') ?? [];
  const clean = snapshot?.files.filter((file) => file.status === 'clean') ?? [];
  const fileRow = (file: FileEntry) => (
    <button
      key={file.path}
      className={'file-row ' + (document?.path === file.path ? 'selected' : '')}
      onClick={() => select(file)}
      title={file.path}
    >
      <span className={'status s-' + file.status}>{file.status === 'clean' ? '' : file.status}</span>
      <span className="file-name">{leaf(file.path)}</span>
      <span className="file-path">{file.path}</span>
    </button>
  );

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Git Diff Editor</strong>
        <span className="repo">{snapshot?.root ?? 'workspace 확인 중...'}</span>
        {snapshot?.branch && <span className="chip">{snapshot.branch}</span>}
        {snapshot?.headOid && <span className="chip">{snapshot.headOid.slice(0, 8)}</span>}
        {dirty && <span className="dirty">미저장</span>}
        <button onClick={() => vscode.postMessage({ type: 'refresh' })}>새로고침</button>
        <button className="primary" disabled={!dirty || !document?.editable} onClick={save}>저장</button>
      </header>

      <div className="body">
        <aside>
          <div className="section-title">변경 {changed.length}</div>
          {changed.map(fileRow)}
          <div className="section-title">기타 {clean.length}</div>
          {clean.map(fileRow)}
        </aside>

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
                <span>{document.path}</span>
                <span className="summary">
                  변경 {diff.hunks.length ? activeHunk + 1 : 0}/{diff.hunks.length}
                  {' · '}- {diff.original.lines.length} / + {diff.modified.lines.length}
                </span>
                <button onClick={() => navigate(-1)}>이전</button>
                <button onClick={() => navigate(1)}>다음</button>
              </div>
              <div className="split">
                <section>
                  <div className="pane-title">HEAD</div>
                  <EditorPane
                    value={document.originalText}
                    editable={false}
                    side="original"
                    highlight={diff.original}
                    editorRef={left}
                  />
                </section>
                <section>
                  <div className="pane-title">Working Tree</div>
                  <EditorPane
                    value={buffer}
                    editable={document.editable}
                    side="modified"
                    highlight={diff.modified}
                    editorRef={right}
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
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
