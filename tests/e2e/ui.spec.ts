import { test, expect, type Page } from '@playwright/test';

const snapshot = {
  sessionId: 'sess-1',
  root: 'C:/e2e-repo',
  gitDir: 'C:/e2e-repo/.git',
  commonDir: 'C:/e2e-repo/.git',
  headOid: 'abc123def456',
  branch: 'main',
  detachedHead: false,
  generation: 1,
  gitVersion: 'git version 2.52.0',
  files: [
    {
      path: 'src/app.rs',
      previousPath: null,
      status: 'M',
      tracked: true,
      existsOnDisk: true,
      editable: true,
      kind: 'file',
    },
    {
      path: 'README.md',
      previousPath: null,
      status: 'clean',
      tracked: true,
      existsOnDisk: true,
      editable: true,
      kind: 'file',
    },
  ],
};

const docs: Record<string, object> = {
  'src/app.rs': {
    documentId: 'doc-1',
    sessionId: 'sess-1',
    path: 'src/app.rs',
    requestSequence: 1,
    headOid: 'abc123def456',
    originalText: 'fn main() {}\n',
    currentText: 'fn main() { println!("hi"); }\n',
    diskVersion: { exists: true, rawBytesHash: 'aaa', byteLength: 20, modifiedTimeHint: null },
    metadata: { encoding: 'utf-8', bom: false, eol: 'lf', trailingNewline: true },
    loadState: 'ready',
    editable: true,
    reason: null,
  },
};

async function installBridge(page: Page) {
  await page.addInitScript(
    ({ snapshot, docs }) => {
      const saved: { kind: string }[] = [];
      (window as unknown as { __GDE_E2E__: unknown }).__GDE_E2E__ = {
        pickFolder: async () => snapshot.root,
        openRepository: async () => snapshot,
        readDocument: async (_sid: string, path: string, requestSequence: number) => ({
          ...(docs as Record<string, Record<string, unknown>>)[path],
          requestSequence,
        }),
        saveDocument: async () => {
          saved.push({ kind: 'saved' });
          return { kind: 'saved', diskVersion: { exists: true, rawBytesHash: 'bbb', byteLength: 21, modifiedTimeHint: null }, snapshot };
        },
        onRepoChanged: async () => () => {},
      };
    },
    { snapshot, docs },
  );
}

test.describe('Git Diff Editor UI', () => {
  test('empty state then open repository and select a changed file', async ({ page }) => {
    await installBridge(page);
    await page.goto('/');
    await expect(page.getByTestId('status')).toHaveText('저장소를 선택하세요.');
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('repo-path')).toHaveText('C:/e2e-repo');
    await expect(page.getByTestId('file-src/app.rs')).toBeVisible();
    await expect(page.getByTestId('status')).toHaveText('파일을 선택하세요.');
    await page.getByTestId('file-src/app.rs').click();
    await expect(page.getByTestId('status')).toHaveCount(0);
  });

  test('save is disabled until the repository is opened', async ({ page }) => {
    await installBridge(page);
    await page.goto('/');
    await expect(page.getByTestId('save')).toBeDisabled();
  });
});
