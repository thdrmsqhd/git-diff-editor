import { useEffect } from 'react';
import { api, onRepoChanged, pickFolder } from './ipc/client';
import { useAppStore } from './state/appStore';
import { Toolbar } from './components/Toolbar';
import { FileTree } from './components/FileTree';
import { DiffPane } from './components/DiffPane';
import { StatusView } from './components/StatusView';
import { UnsavedDialog } from './components/UnsavedDialog';

export default function App() {
  const store = useAppStore();

  useEffect(() => {
    const un = onRepoChanged(async () => {
      const session = useAppStore.getState().session;
      if (!session) return;
      try {
        const snap = await api.openRepository(session.root);
        useAppStore.getState().setSession(snap);
        const sel = useAppStore.getState().selectedPath;
        if (sel) {
          const seq = useAppStore.getState().bumpSeq();
          const doc = await api.readDocument(snap.sessionId, sel, seq);
          if (doc.requestSequence === seq || true) {
            useAppStore.getState().applyExternal(doc);
          }
        }
      } catch {
        /* keep current buffer on refresh failure of other files */
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    window.__GDE_OPEN = (path: string) => openRepo(path);
    return () => {
      delete window.__GDE_OPEN;
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function openRepo(path?: string) {
    const p = path ?? (await pickFolder());
    if (!p) return;
    store.setLoadState('loading-repo');
    try {
      const snap = await api.openRepository(p);
      store.setSession(snap);
      store.setDocument({
        documentId: '',
        sessionId: snap.sessionId,
        path: '',
        requestSequence: 0,
        headOid: snap.headOid,
        originalText: '',
        currentText: '',
        diskVersion: { exists: false, rawBytesHash: '', byteLength: 0, modifiedTimeHint: null },
        metadata: null,
        loadState: 'ready',
        editable: false,
        reason: null,
      });
    } catch (e) {
      store.setError(String((e as { message?: string }).message ?? e));
    }
  }

  async function selectFile(path: string) {
    if (store.dirty) {
      store.setDialog({ next: 'select', path });
      return;
    }
    await loadFile(path);
  }

  async function loadFile(path: string) {
    const session = store.session;
    if (!session) return;
    store.setLoadState('loading-doc');
    const seq = store.bumpSeq();
    try {
      const doc = await api.readDocument(session.sessionId, path, seq);
      store.setDocument(doc);
    } catch (e) {
      store.setError(String((e as { message?: string }).message ?? e));
    }
  }

  async function save() {
    const { session, document, bufferText, dirty } = useAppStore.getState();
    if (!session || !document || !dirty || !document.editable || !document.metadata) return;
    try {
      const result = (await api.saveDocument({
        sessionId: session.sessionId,
        path: document.path,
        documentId: document.documentId,
        bufferRevision: useAppStore.getState().bufferRevision,
        text: bufferText,
        expectedDiskVersion: document.diskVersion,
        metadata: document.metadata,
      })) as { kind: string; payload?: typeof document; snapshot?: { files: typeof store.files } };
      if (result.kind === 'refreshedExternal' && result.payload) {
        store.applyExternal(result.payload);
      } else {
        const seq = store.bumpSeq();
        const doc = await api.readDocument(session.sessionId, document.path, seq);
        store.setDocument(doc);
      }
    } catch (e) {
      store.setError(String((e as { message?: string }).message ?? e));
    }
  }

  const changed = store.files.some((f) => f.status !== 'clean');
  let body;
  if (store.unsavedDialog) {
    body = (
      <UnsavedDialog
        onSave={async () => {
          await save();
          store.setDialog(null);
          if (store.unsavedDialog?.path) await loadFile(store.unsavedDialog.path);
        }}
        onDiscard={() => {
          const next = store.unsavedDialog;
          store.setDialog(null);
          if (next?.path) void loadFile(next.path);
        }}
        onCancel={() => store.setDialog(null)}
      />
    );
  } else if (store.error) {
    body = <StatusView text={store.error} />;
  } else if (!store.session) {
    body = <StatusView text="저장소를 선택하세요." />;
  } else if (!store.selectedPath) {
    body = <StatusView text={changed ? '파일을 선택하세요.' : '변경사항이 없습니다'} />;
  } else if (store.document && store.document.loadState === 'unsupported') {
    body = <StatusView text={store.document.reason ?? '미리보기를 지원하지 않습니다.'} />;
  } else if (store.document) {
    body = (
      <DiffPane
        original={store.document.originalText}
        modified={store.dirty ? store.bufferText : store.document.currentText}
        editable={store.document.editable}
        onChange={(t) => store.edit(t)}
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
        onOpen={() => void openRepo()}
        onSave={() => void save()}
      />
      <div className="body">
        <FileTree files={store.files} selected={store.selectedPath} onSelect={(p) => void selectFile(p)} />
        <div className="resizer" />
        <div className="main">{body}</div>
      </div>
    </div>
  );
}
