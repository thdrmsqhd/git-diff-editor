import { useEffect, useRef, useState } from 'react';
import {
  api,
  onRepoChanged,
  pickFolder,
  type DiskVersion,
  type DocumentPayload,
  type SaveDocumentResult,
} from './ipc/client';
import { useAppStore, type PendingAction } from './state/appStore';
import { Toolbar } from './components/Toolbar';
import { FileTree } from './components/FileTree';
import { DiffPane } from './components/DiffPane';
import { StatusView } from './components/StatusView';
import { UnsavedDialog } from './components/UnsavedDialog';

type SaveOutcome = 'saved' | 'refreshed-external' | 'failed' | 'noop';

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function sameDiskVersion(a: DiskVersion, b: DiskVersion): boolean {
  return a.exists === b.exists && a.rawBytesHash === b.rawBytesHash && a.byteLength === b.byteLength;
}

function emptyDocument(sessionId: string, headOid: string | null): DocumentPayload {
  return {
    documentId: '',
    sessionId,
    path: '',
    requestSequence: 0,
    headOid,
    originalText: '',
    currentText: '',
    diskVersion: { exists: false, rawBytesHash: '', byteLength: 0, modifiedTimeHint: null },
    metadata: null,
    loadState: 'ready',
    editable: false,
    reason: null,
  };
}

export default function App() {
  const store = useAppStore();
  const [notice, setNotice] = useState<string | null>(null);
  const allowCloseRef = useRef(false);
  const ignoreWatchUntilRef = useRef(0);
  const openTokenRef = useRef(0);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let running = false;
    let queued = false;
    let queuedSessionId: string | null = null;

    async function refreshOnce(sessionId: string) {
      if (Date.now() < ignoreWatchUntilRef.current) return;
      const before = useAppStore.getState();
      if (before.session?.sessionId !== sessionId) return;
      const previousDocument = before.document;
      const previousSelectedPath = before.selectedPath;

      try {
        const snapshot = await api.refreshRepository(sessionId);
        const active = useAppStore.getState();
        if (active.session?.sessionId !== sessionId) return;
        active.setSession(snapshot);

        if (active.selectedPath !== previousSelectedPath) {
          setNotice('외부 저장소 변경을 반영했습니다.');
          return;
        }
        const selectedPath = previousSelectedPath;
        if (!selectedPath) {
          setNotice('외부 저장소 변경을 반영했습니다.');
          return;
        }

        const sequence = active.bumpSeq();
        const document = await api.readDocument(sessionId, selectedPath, sequence);
        const latest = useAppStore.getState();
        if (
          latest.session?.sessionId !== sessionId ||
          latest.selectedPath !== selectedPath ||
          latest.requestSequence !== sequence ||
          document.requestSequence !== sequence
        ) {
          return;
        }

        const selectedFileChanged =
          !previousDocument ||
          previousDocument.path !== selectedPath ||
          previousDocument.headOid !== document.headOid ||
          !sameDiskVersion(previousDocument.diskVersion, document.diskVersion);

        if (selectedFileChanged) {
          const discarded = latest.dirty;
          latest.applyExternal(document);
          latest.setDialog(null);
          setNotice(
            discarded
              ? '외부 변경을 반영하여 현재 파일의 미저장 편집을 폐기했습니다.'
              : '현재 파일의 외부 변경을 반영했습니다.',
          );
        } else {
          setNotice('외부 저장소 변경을 반영했습니다.');
        }
      } catch (error) {
        setNotice('외부 변경을 다시 읽지 못했습니다: ' + messageOf(error));
      }
    }

    async function enqueueRefresh(sessionId: string) {
      if (running) {
        queued = true;
        queuedSessionId = sessionId;
        return;
      }
      running = true;
      try {
        let currentSessionId: string | null = sessionId;
        do {
          queued = false;
          queuedSessionId = null;
          if (currentSessionId) await refreshOnce(currentSessionId);
          currentSessionId = queuedSessionId;
        } while (queued && !disposed);
      } finally {
        running = false;
      }
    }

    void onRepoChanged((payload) => {
      const sessionId = useAppStore.getState().session?.sessionId;
      if (!sessionId || payload.sessionId !== sessionId) return;
      void enqueueRefresh(sessionId);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const fn = await getCurrentWindow().onCloseRequested((event) => {
          if (allowCloseRef.current) return;
          const state = useAppStore.getState();
          if (state.dirty) {
            event.preventDefault();
            state.setDialog({ next: 'quit' });
          }
        });
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    window.__GDE_OPEN = async (path: string) => {
      await requestAction({ next: 'open-repo', path });
    };
    return () => {
      delete window.__GDE_OPEN;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function openRepo(path?: string) {
    const selectedPath = path ?? (await pickFolder());
    if (!selectedPath) return;
    const token = ++openTokenRef.current;
    const previousSessionId = useAppStore.getState().session?.sessionId;
    const state = useAppStore.getState();
    state.setError(null);
    state.setLoadState('loading-repo');

    try {
      const snapshot = await api.openRepository(selectedPath);
      if (token !== openTokenRef.current) {
        await api.stopWatch(snapshot.sessionId).catch(() => undefined);
        return;
      }

      state.setSession(snapshot);
      state.setSelected(null);
      if (previousSessionId && previousSessionId !== snapshot.sessionId) {
        await api.stopWatch(previousSessionId).catch(() => undefined);
      }

      const first = snapshot.files.find((file) => file.status !== 'clean');
      if (!first) {
        state.setDocument(emptyDocument(snapshot.sessionId, snapshot.headOid));
        return;
      }

      state.setSelected(first.path);
      const sequence = state.bumpSeq();
      const document = await api.readDocument(snapshot.sessionId, first.path, sequence);
      const latest = useAppStore.getState();
      if (
        latest.session?.sessionId === snapshot.sessionId &&
        latest.requestSequence === sequence &&
        document.requestSequence === sequence
      ) {
        latest.setDocument(document);
      }
    } catch (error) {
      if (token === openTokenRef.current) state.setError(messageOf(error));
    }
  }

  async function loadFile(path: string) {
    const state = useAppStore.getState();
    const session = state.session;
    if (!session) return;
    state.setError(null);
    state.setSelected(path);
    state.setLoadState('loading-doc');
    const sequence = state.bumpSeq();
    try {
      const document = await api.readDocument(session.sessionId, path, sequence);
      const latest = useAppStore.getState();
      if (
        latest.session?.sessionId === session.sessionId &&
        latest.requestSequence === sequence &&
        document.requestSequence === sequence
      ) {
        latest.setDocument(document);
      }
    } catch (error) {
      const latest = useAppStore.getState();
      if (latest.session?.sessionId === session.sessionId && latest.requestSequence === sequence) {
        latest.setError(messageOf(error));
      }
    }
  }

  async function save(): Promise<SaveOutcome> {
    const state = useAppStore.getState();
    const { session, document, bufferText, dirty } = state;
    if (!dirty) return 'noop';
    if (!session || !document || !document.editable || !document.metadata) {
      state.setError('현재 파일은 저장할 수 없습니다.');
      return 'failed';
    }

    try {
      const result: SaveDocumentResult = await api.saveDocument({
        sessionId: session.sessionId,
        path: document.path,
        documentId: document.documentId,
        bufferRevision: state.bufferRevision,
        text: bufferText,
        expectedDiskVersion: document.diskVersion,
        metadata: document.metadata,
      });

      if (result.kind === 'refreshedExternal') {
        state.setSession(result.snapshot);
        state.applyExternal(result.payload);
        state.setDialog(null);
        setNotice('저장 직전 외부 변경을 감지하여 최신 파일로 다시 불러왔습니다.');
        return 'refreshed-external';
      }

      ignoreWatchUntilRef.current = Date.now() + 750;
      state.setSession(result.snapshot);
      state.markSaved({
        ...document,
        currentText: bufferText,
        diskVersion: result.diskVersion,
        requestSequence: state.requestSequence,
      });
      return 'saved';
    } catch (error) {
      state.setError(messageOf(error));
      return 'failed';
    }
  }

  async function closeWindow() {
    const sessionId = useAppStore.getState().session?.sessionId;
    if (sessionId) await api.stopWatch(sessionId).catch(() => undefined);
    try {
      allowCloseRef.current = true;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      allowCloseRef.current = false;
    }
  }

  async function executeAction(action: PendingAction) {
    if (action.next === 'select' && action.path) await loadFile(action.path);
    else if (action.next === 'open-repo') await openRepo(action.path);
    else if (action.next === 'quit') await closeWindow();
  }

  async function requestAction(action: PendingAction) {
    const state = useAppStore.getState();
    if (action.next === 'select' && action.path === state.selectedPath) return;
    if (state.dirty) {
      state.setDialog(action);
      return;
    }
    await executeAction(action);
  }

  async function saveAndContinue() {
    const state = useAppStore.getState();
    const pending = state.unsavedDialog;
    if (!pending) return;
    const outcome = await save();
    state.setDialog(null);
    if (outcome === 'saved') await executeAction(pending);
  }

  async function discardAndContinue() {
    const state = useAppStore.getState();
    const pending = state.unsavedDialog;
    if (!pending) return;
    state.setDialog(null);
    await executeAction(pending);
  }

  const changed = store.files.some((file) => file.status !== 'clean');
  let body;
  if (store.unsavedDialog) {
    body = (
      <UnsavedDialog
        onSave={() => void saveAndContinue()}
        onDiscard={() => void discardAndContinue()}
        onCancel={() => useAppStore.getState().setDialog(null)}
      />
    );
  } else if (store.error) {
    body = <StatusView text={store.error} />;
  } else if (!store.session) {
    body = <StatusView text="저장소를 선택하세요." hint="위쪽 저장소 열기로 폴더를 고르세요." />;
  } else if (!store.selectedPath) {
    body = (
      <StatusView
        text={changed ? '파일을 선택하세요.' : '변경사항이 없습니다'}
        hint={changed ? '왼쪽 변경 목록에서 파일을 고르세요.' : undefined}
      />
    );
  } else if (store.document && store.document.loadState === 'unsupported') {
    body = <StatusView text={store.document.reason ?? '미리보기를 지원하지 않습니다.'} />;
  } else if (store.document) {
    body = (
      <DiffPane
        original={store.document.originalText}
        modified={store.dirty ? store.bufferText : store.document.currentText}
        editable={store.document.editable}
        onChange={(text) => store.edit(text)}
        headShort={store.session?.headOid?.slice(0, 8)}
        dirty={store.dirty}
      />
    );
  }

  return (
    <div className="app">
      <Toolbar
        path={store.session?.root}
        branch={store.session?.branch}
        detached={store.session?.detachedHead}
        head={store.session?.headOid}
        dirty={store.dirty}
        canSave={store.dirty && !!store.document?.editable}
        onOpen={() => void requestAction({ next: 'open-repo' })}
        onSave={() => void save()}
        onClose={() => void requestAction({ next: 'quit' })}
      />
      <div className={store.session ? 'body has-sidebar' : 'body'}>
        {store.session ? (
          <>
            <FileTree
              files={store.files}
              selected={store.selectedPath}
              onSelect={(path) => void requestAction({ next: 'select', path })}
            />
            <div className="resizer" />
          </>
        ) : null}
        <div className="main">{body}</div>
      </div>
      {notice ? <div className="notice" role="status">{notice}</div> : null}
    </div>
  );
}
