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
      path: 'docs/README.md',
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
  'docs/README.md': {
    documentId: 'doc-2',
    sessionId: 'sess-1',
    path: 'docs/README.md',
    requestSequence: 1,
    headOid: 'abc123def456',
    originalText: '# Readme\n',
    currentText: '# Readme\n',
    diskVersion: { exists: true, rawBytesHash: 'ccc', byteLength: 9, modifiedTimeHint: null },
    metadata: { encoding: 'utf-8', bom: false, eol: 'lf', trailingNewline: true },
    loadState: 'ready',
    editable: true,
    reason: null,
  },
};

type BridgeOptions = { failFirstOpen?: boolean; openDelayMs?: number };
type BridgeInit = { snapshot: typeof snapshot; docs: typeof docs; options: BridgeOptions };

async function installBridge(
  page: Page,
  options: BridgeOptions = {},
) {
  await page.addInitScript(
    ({ snapshot, docs, options }: BridgeInit) => {
      let openAttempts = 0;
      (window as unknown as { __GDE_E2E__: unknown }).__GDE_E2E__ = {
        pickFolder: async () => snapshot.root,
        openRepository: async () => {
          openAttempts += 1;
          if (options.openDelayMs) {
            await new Promise((resolve) => window.setTimeout(resolve, options.openDelayMs));
          }
          if (options.failFirstOpen && openAttempts === 1) {
            throw { message: '테스트 저장소 열기 실패' };
          }
          return snapshot;
        },
        refreshRepository: async () => snapshot,
        stopWatch: async () => undefined,
        readDocument: async (_sid: string, path: string, requestSequence: number) => ({
          ...(docs as Record<string, Record<string, unknown>>)[path],
          requestSequence,
        }),
        saveDocument: async () => ({
          kind: 'saved',
          diskVersion: { exists: true, rawBytesHash: 'bbb', byteLength: 21, modifiedTimeHint: null },
          snapshot,
        }),
        onRepoChanged: async () => () => {},
      };
    },
    { snapshot, docs, options },
  );
}

test.describe('Git Diff Editor UI', () => {
  test('opens the changed file, builds a folder tree, and shows hunk summary', async ({ page }: { page: Page }) => {
    await installBridge(page);
    await page.goto('/');
    await expect(page.getByTestId('status')).toHaveText('저장소를 선택하세요.');
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('repo-path')).toHaveText('C:/e2e-repo');
    await expect(page.getByTestId('directory-src')).toBeVisible();
    await expect(page.getByTestId('file-src/app.rs')).toBeVisible();
    await expect(page.getByTestId('directory-docs')).toBeVisible();
    await expect(page.getByTestId('file-docs/README.md')).toBeHidden();
    await page.getByTestId('directory-docs').click();
    await expect(page.getByTestId('file-docs/README.md')).toBeVisible();
    await expect(page.getByTestId('diff-summary')).toContainText('변경 1/1');
    await expect(page.getByTestId('diff-summary-total')).toContainText('-1 / +1');
    await expect(page.getByRole('separator')).toHaveCount(2);
  });

  test('shows repository loading progress', async ({ page }: { page: Page }) => {
    await installBridge(page, { openDelayMs: 250 });
    await page.goto('/');
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('status')).toHaveText('저장소를 여는 중입니다.');
    await expect(page.getByTestId('repo-path')).toHaveText('C:/e2e-repo');
  });

  test('retries a failed repository open', async ({ page }: { page: Page }) => {
    await installBridge(page, { failFirstOpen: true });
    await page.goto('/');
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('status')).toHaveText('테스트 저장소 열기 실패');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByTestId('repo-path')).toHaveText('C:/e2e-repo');
    await expect(page.getByTestId('file-src/app.rs')).toBeVisible();
  });

  test('save is disabled until the repository is opened', async ({ page }: { page: Page }) => {
    await installBridge(page);
    await page.goto('/');
    await expect(page.getByTestId('save')).toBeDisabled();
  });
});
