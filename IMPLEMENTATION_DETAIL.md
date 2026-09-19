# Git Diff Editor 구현 상세

- 문서 버전: 1.0
- 기준: REQUIREMENTS.md v1.3, ARCHITECTURE.md v1.0, IMPLEMENTATION_PLAN.md v1.0, FILETREE.md v1.0
- 상태: 구현 전 상세 명세. 패키지 설치·소스 작성·실행 검증은 하지 않음.
- 고정 정책: 외부 변경 우선, 확인창 없이 자동 새로고침, 같은 파일의 미저장 버퍼 교체.

이 문서는 모듈별 입력·출력·알고리즘·오류 처리·테스트 단위를 정의한다. 구체 라이브러리 버전은 S0에서 확정한다.

## 1. 구현 원칙

1. Rust가 디스크·Git 상태의 단일 기준이다.
2. React/Zustand는 화면과 편집 버퍼만 관리한다.
3. Git은 읽기 전용이다. HEAD, 인덱스, 브랜치를 변경하지 않는다.
4. 디스크 쓰기는 명시적 저장 Command만 수행한다.
5. 오래된 비동기 결과는 `sessionId + requestSequence + repositoryGeneration`으로 폐기한다.
6. 경로는 Command 문자열에 이어 붙이지 않고 인자 배열로 전달한다.
7. 네트워크 권한은 사용하지 않는다.
8. 테스트는 기능 하나당 RED→GREEN→REFACTOR로 진행한다.

## 2. IPC 계약

프론트엔드는 `@tauri-apps/api`의 invoke/listen만 사용한다. 임의 셸, 임의 경로, 임의 Git 인자를 노출하지 않는다.

### 2.1 Command

```text
open_repository(path: string)
  → RepositorySnapshot

list_recent_repositories()
  → RecentRepository[]

read_document(sessionId, path, requestSequence)
  → DocumentPayload

save_document(SaveDocumentRequest)
  → SaveDocumentResult

stop_watch(sessionId)
  → void
```

저장소가 열리면 Rust가 해당 세션의 watch를 시작한다. 별도 start_watch Command는 두지 않는다.

### 2.2 Event

```text
repository-changed
  { sessionId, generation, paths[], reason: external | self-save | git-state }

document-refreshed
  { sessionId, path, documentId, payload: DocumentPayload, reason: external }

operation-error
  { sessionId?, path?, code, message, retryable }
```

`document-refreshed`는 현재 열린 파일의 외부 변경에만 보낸다. 다른 파일은 `repository-changed`로 트리만 갱신한다.

### 2.3 주요 타입

```ts
type FileStatus = 'M' | 'A' | 'D' | 'R' | 'U' | 'clean' | 'unsupported' | 'conflict' | 'submodule' | 'symlink';

type DiskVersion = {
  exists: boolean;
  rawBytesHash: string;
  byteLength: number;
  modifiedTimeHint: number | null;
};

type TextMetadata = {
  encoding: 'utf-8';
  bom: boolean;
  eol: 'lf' | 'crlf' | 'mixed' | 'none';
  trailingNewline: boolean;
};

type FileEntry = {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  tracked: boolean;
  existsOnDisk: boolean;
  editable: boolean;
  kind: 'file' | 'dir';
};

type RepositorySnapshot = {
  sessionId: string;
  root: string;
  gitDir: string;
  commonDir: string;
  headOid: string | null;
  branch: string | null;
  detachedHead: boolean;
  generation: number;
  files: FileEntry[];
  gitVersion: string;
};

type DocumentPayload = {
  documentId: string;
  sessionId: string;
  path: string;
  requestSequence: number;
  headOid: string | null;
  originalText: string;
  currentText: string;
  diskVersion: DiskVersion;
  metadata: TextMetadata | null;
  loadState: 'ready' | 'unsupported' | 'deleted' | 'error';
  editable: boolean;
  reason: string | null;
};

type SaveDocumentRequest = {
  sessionId: string;
  path: string;
  documentId: string;
  bufferRevision: number;
  text: string;
  expectedDiskVersion: DiskVersion;
  metadata: TextMetadata;
};

type SaveDocumentResult =
  | { kind: 'saved'; diskVersion: DiskVersion; snapshot: RepositorySnapshot }
  | { kind: 'refreshed-external'; payload: DocumentPayload; snapshot: RepositorySnapshot }
  | { kind: 'error'; code: string; message: string };
```

경로 검증: Command의 `path`는 저장소 root 기준 상대 경로만 받는다. Rust가 `root`와 결합한 뒤 canonicalize하고, 결과가 root 밖이면 거부한다. 심볼릭 링크·junction이 root 밖을 가리키면 읽기·쓰기를 거부한다.

## 3. Git 실행기 `git/runner.rs`

### 3.1 실행 규칙

- 실행 파일: `git` PATH 조회. 없으면 `GIT_NOT_FOUND`.
- `Command::new("git").args([...]).current_dir(root)` 또는 `-C root`.
- `shell: false`.
- Windows에서 콘솔 창이 뜨지 않게 CREATE_NO_WINDOW 적용.
- 환경: `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`.
- 외부 helper 억제: `--no-ext-diff`, `--no-textconv`.
- 타임아웃과 stdout/stderr 크기 상한은 S0 실측 후 설정. 초과 시 `GIT_TIMEOUT` / `GIT_OUTPUT_TOO_LARGE`.
- 종료 코드 0이 아니면 stderr를 사용자 메시지로 변환. 빈 stdout을 성공으로 오인하지 않음.

### 3.2 저장소 열기 순서

1. `git --version`
2. `git -C <path> rev-parse --show-toplevel`
3. `git -C <root> rev-parse --absolute-git-dir`
4. `git -C <root> rev-parse --git-common-dir`
5. `git -C <root> rev-parse --is-bare-repository`
6. `git -C <root> rev-parse --verify HEAD`
7. `git -C <root> symbolic-ref --quiet --short HEAD`

판정:

- bare이면 열지 않고 `BARE_REPOSITORY` 안내.
- HEAD가 없으면 `NO_HEAD` 안내 후 비교 제한.
- symbolic-ref 실패이고 HEAD OID가 있으면 detached HEAD. 브랜치 자리에 짧은 OID 표시.
- worktree는 git-dir가 파일이거나 common-dir가 다른 경우로 처리하고 지원한다.

### 3.3 스냅샷 명령

HEAD OID를 먼저 고정한다.

```text
git -C <root> ls-tree -r -z --full-tree <headOid>
git -C <root> ls-files -z --cached --others --exclude-standard
git -C <root> diff --no-ext-diff --no-textconv --name-status -z --find-renames <headOid> --
```

원본 읽기:

```text
git -C <root> ls-tree -z --full-tree <headOid> -- <path>
git -C <root> cat-file blob <blobOid>
```

파일명을 `HEAD:path` 형태로 넣지 않는다. blob OID를 조회한 뒤 `cat-file blob`만 사용한다.

### 3.4 NUL 파싱

- `ls-tree -z`: `mode SP type SP oid TAB path NUL`
- `ls-files -z`: `path NUL`
- `diff --name-status -z`:
  - `M|A|D|U|T NUL path NUL`
  - `Rxxx NUL oldPath NUL newPath NUL`
  - `Cxxx`는 복사로 보고 `A`와 기존 파일 유지. 임의 연결하지 않음.

실패/경고와 빈 결과를 구분한다. Git이 rename을 주지 않으면 `D`+`A`로 남긴다.

### 3.5 파일 상태 병합

집합:

- `headPaths` = ls-tree 경로
- `indexPaths` = ls-files --cached
- `untrackedPaths` = ls-files --others --exclude-standard
- `diffRecords` = name-status

표시 대상 = `headPaths ∪ indexPaths ∪ untrackedPaths ∪ deletedFromDiff`

규칙:

| 조건 | status | editable |
|---|---|---|
| diff M, 텍스트 | M | true |
| diff A 또는 untracked 텍스트 | A 또는 U | true |
| untracked | U | 텍스트면 true |
| diff D 또는 HEAD에만 존재하고 디스크 없음 | D | false |
| diff R | R, previousPath 설정 | 텍스트면 true |
| 디스크와 HEAD 내용이 같고 untracked 아님 | clean | 텍스트면 true |
| 바이너리/혼합 EOL/미지원 인코딩 | unsupported | false |
| submodule | submodule | false |
| 외부 링크 | symlink | false |
| 병합 충돌(U) | conflict | false |

ignore된 미추적은 목록에 없다. 추적 파일은 ignore 패턴과 관계없이 표시한다. `.git` 내부는 트리에 넣지 않는다.

인덱스만 다르고 디스크 bytes가 HEAD와 같으면 화면 status는 `clean`이다. 스테이징 전용 표시는 하지 않는다.

## 4. 파일 트리 UI `FileTree.tsx`

### 4.1 트리 구성

1. `files[]`를 `/` 기준 경로 조각으로 분할한다.
2. 중간 디렉터리 노드를 만든다.
3. 각 디렉터리에서 자식 정렬:
   - 변경 자손을 가진 디렉터리 우선
   - 변경 파일 우선 (`M A D R U conflict unsupported`)
   - 그다음 디렉터리, 그다음 파일
   - 같은 그룹은 이름 로케일 비교
4. 접기 상태는 경로 집합으로 유지한다. 새로고침 때 가능한 한 유지한다.

표시:

- 상태 문자 + 색상/아이콘
- R은 `old → new` 보조 표시
- 현재 선택 경로는 상태 색과 별도 강조

클릭한 파일만 `read_document`를 호출한다. 디렉터리 클릭은 접기/펼치기만 한다.

## 5. 텍스트 코덱 `files/codec.rs`

### 5.1 판정 순서

1. 빈 파일: encoding utf-8, bom false, eol none, trailingNewline false, editable true.
2. NUL 바이트가 있으면 binary → unsupported.
3. UTF-8 BOM(`EF BB BF`) 여부 기록 후 본문 디코딩.
4. UTF-8 엄격 디코딩 실패 → unsupported. 손실 디코딩 금지.
5. `\r\n`만 있으면 crlf, `\n`만 있으면 lf, 둘 다 있으면 mixed.
6. mixed는 읽기 전용. 원문을 표시할 수는 있으나 저장 Command를 받지 않는다.
7. 마지막 바이트가 `\n`이면 trailingNewline true.

편집 모델에는 `\n`만 남긴다. `\r`을 텍스트 문자로 넣지 않는다.

### 5.2 저장 인코딩

입력: 편집 텍스트(`\n` 구분) + 원본 TextMetadata.

1. mixed면 저장 거부.
2. 사용자가 마지막 개행을 지웠으면 trailingNewline false를 유지한다. 자동 추가하지 않는다.
3. eol이 crlf면 `\n` → `\r\n`.
4. bom이면 앞에 UTF-8 BOM을 붙인다.
5. 그 바이트를 저장한다.

왕복 테스트: UTF-8 한글, BOM 유무, LF, CRLF, 끝 개행 유무. 의도한 편집 외 바이트가 바뀌면 실패다.

## 6. 문서 읽기 `read_document`

1. session 검증.
2. 상대 경로 정규화 및 root 내부 확인.
3. 링크가 외부를 가리키면 unsupported.
4. HEAD에 경로 또는 previousPath가 있으면 blob 읽기. 없으면 originalText="".
5. 디스크가 있으면 raw bytes 읽기. 없으면 currentText="", loadState=deleted, editable=false.
6. 코덱 판정.
7. DocumentPayload 반환.

추가 파일: 좌측 빈 화면, 우측 디스크 내용.  
삭제 파일: 좌측 HEAD, 우측 빈 화면, 편집 불가.  
clean 파일: 좌우 동일 텍스트, 우측 편집 가능.

프론트는 `requestSequence`가 최신이 아니면 payload를 버린다.

## 7. 저장 `files/save.rs`

파일별 작업 큐로 직렬화한다. 같은 경로의 저장/재로드가 겹치지 않게 한다.

```text
1. session/path/documentId 검증
2. 현재 디스크 DiskVersion 계산
3. expectedDiskVersion과 다르면 저장하지 않고 최신 내용으로 refreshed-external
4. 메타데이터로 bytes 생성
5. 동일 디렉터리에 `.gde-tmp-<random>` 임시 파일 생성
6. 임시 파일 쓰기 + flush
7. 교체 직전 DiskVersion 재확인
   다르면 임시 파일 삭제, refreshed-external
8. 원자적 교체 시도 (Windows: replace/move 방식은 S0에서 검증)
9. 저장 후 raw bytes hash가 기대한 값인지 확인
10. 자체 저장 해시 기록 (path, hash, bufferRevision)
11. Git 스냅샷 재조회
    실패해도 kind=saved 유지, Git 오류는 별도 operation-error
```

프론트 처리:

- `saved`: 해당 bufferRevision만 baseline으로 갱신. 더 높은 revision이 있으면 dirty 유지.
- `refreshed-external`: 버퍼를 payload.currentText로 교체, dirty=false, undo 초기화.
- `error`: 버퍼 유지, 전환/종료 진행 금지.

삭제 상태 문서는 저장하지 않는다. 오래된 버퍼로 파일을 되살리지 않는다.

## 8. 감시 `watch/coordinator.rs`

### 8.1 감시 대상

- `<root>` 작업 트리. `.git` 객체 대량은 디바운스로 흡수.
- `gitDir`의 HEAD, refs, index.
- worktree면 `commonDir`의 refs도 감시.

### 8.2 처리

1. notify 이벤트 수신.
2. 경로별 50~200ms 디바운스. 값은 S0에서 조정.
3. 대량 변경이면 경로 나열 대신 전체 스냅샷 1회.
4. 안정된 뒤 실제 bytes/Git 재조회.
5. 자체 저장 해시와 같으면 reason=self-save. 프론트는 dirty를 건드리지 않음.
6. 다르면 reason=external.
7. 현재 열린 파일이면 document-refreshed, 아니면 repository-changed.
8. HEAD/index 변화는 git-state로 스냅샷 갱신. 내용이 바뀐 열린 파일은 외부 우선 적용.

주기적 재검사: 활성 문서의 hash와 HEAD OID를 수 초 간격으로 확인. 누락된 notify를 보완한다.

자체 저장 직후 새 입력이 있으면 프론트의 bufferRevision이 저장 revision보다 크다. self-save 이벤트는 그 버퍼를 덮지 않는다.

## 9. Zustand `appStore.ts`

```ts
{
  session: RepositorySnapshot | null;
  recent: RecentRepository[];
  selectedPath: string | null;
  document: DocumentPayload | null;
  bufferText: string;
  bufferRevision: number;
  dirty: boolean;
  loadState: 'idle' | 'loading-repo' | 'loading-doc' | 'ready' | 'error';
  error: { code: string; message: string } | null;
  unsavedDialog: null | { next: 'select' | 'open-repo' | 'quit'; path?: string };
  split: { sidebar: number; editor: number };
  requestSequence: number;
}
```

`dirty = bufferText !== document.currentText`가 아니다. baseline은 마지막 읽기/저장 텍스트다. 외부 새로고침 후 baseline과 buffer가 모두 새 텍스트가 되면 dirty=false.

documentController 동작:

- selectFile: dirty면 unsavedDialog, 아니면 requestSequence++ 후 read_document
- edit: bufferRevision++, dirty 재계산. 디스크 쓰기 없음
- save: save_document
- discard: buffer를 baseline으로 되돌림
- cancel dialog: 선택 유지
- onDocumentRefreshed: 같은 path면 버퍼 교체, dirty=false, monaco history reset
- onRepositoryChanged: 트리만 갱신. selectedPath가 이벤트 paths에 없으면 버퍼 유지

## 10. Monaco `monacoAdapter.ts`

설정:

- language: plaintext
- originalEditable: false
- modifiedEditable: payload.editable
- renderSideBySide: true (좁은 창에서도 inline 전환 없음)
- wordWrap: off
- minimap: { enabled: false }
- folding: false
- lineNumbers: on
- renderWhitespace: selection 또는 none. 변경 공백은 diff 색으로만 표시
- unicodeHighlight, suggest, hover, links, formatOnType, formatOnPaste: off
- automaticLayout: true
- ignoreTrimWhitespace: false

동작:

- 일반 입력: modified 모델 setValue 없이 에디터 자체 편집. onDidChangeModelContent에서 buffer 동기화.
- 외부 재로드: setModel 또는 setValue로 양쪽 교체. undo/redo 스택 초기화.
- 삭제/unsupported: modified 편집 비활성, 빈 모델 또는 StatusView.
- Ctrl+S는 Monaco 기본 저장이 아니라 앱 save 명령에 연결.
- Ctrl+F는 활성 패널 문자열 검색. 치환/정규식 UI는 제공하지 않음.
- 한글 조합 중 setValue를 호출하지 않음.

좌측 붙여넣기는 originalEditable=false로 차단한다.

## 11. 화면 상태

| 조건 | 본문 |
|---|---|
| 저장소 없음 | 폴더 선택 안내 |
| 저장소 로딩 | 로딩 |
| Git 오류 | 원인 + 재선택 |
| 파일 미선택 + 변경 없음 | “변경사항이 없습니다” |
| 파일 미선택 + 변경 있음 | 파일 선택 안내, 트리는 하이라이트 |
| 문서 로딩 | 로딩. 이전 문서를 성공으로 보여주지 않음 |
| ready | 좌우 diff |
| unsupported | 사유. 편집 없음 |
| deleted | 좌측 원본, 우측 빈 화면 |
| error | 원인 + 재시도 |

저장 버튼: dirty이고 editable일 때만 활성.

브랜치 표시: 이름 또는 `detached <shortOid>`. HEAD 짧은 OID는 툴바에 함께 표시한다.

## 12. 오류 코드

| code | 사용자 메시지 방향 |
|---|---|
| GIT_NOT_FOUND | Git을 설치한 뒤 다시 실행 |
| NOT_A_REPOSITORY | Git 저장소를 선택 |
| BARE_REPOSITORY | 작업 트리가 없는 저장소는 열 수 없음 |
| NO_HEAD | 커밋이 없어 비교할 수 없음 |
| GIT_FAILED | Git 명령 실패. stderr 요약 |
| PATH_ESCAPE | 저장소 밖 경로는 열 수 없음 |
| SYMLINK_EXTERNAL | 외부 링크는 읽기·쓰기 차단 |
| UNSUPPORTED_ENCODING | 인코딩을 해석할 수 없음 |
| BINARY_FILE | 바이너리는 미리보기 불가 |
| MIXED_EOL | 혼합 줄바꿈은 읽기 전용 |
| SAVE_FAILED | 권한·잠금 확인. 버퍼 유지 |
| REFRESH_FAILED | 외부 변경을 읽지 못함. 오래된 내용 자동 저장 없음 |
| FILE_LOCKED | 파일이 잠겨 저장할 수 없음 |

앱을 종료하지 않는다. 다른 저장소/파일 선택은 유지한다.

## 13. 설정 `settings/store.rs`

위치: Windows 사용자 앱 데이터 폴더 아래 `git-diff-editor/settings.json`.

```json
{
  "recent": [{ "path": "", "openedAt": "" }],
  "split": { "sidebar": 0.24, "editor": 0.5 },
  "window": { "width": 1280, "height": 800 }
}
```

소스 파일 내용을 저장하지 않는다. 최근 경로는 존재 여부를 열 때 확인하고, 없으면 목록에서 안내 후 제거 또는 비활성 표시.

## 14. Tauri 권한 초안

허용:

- 폴더 선택 대화상자
- 열린 저장소 root 내부 읽기/쓰기
- git 실행 파일 실행
- 앱 데이터 설정 파일 읽기/쓰기
- 저장소와 gitDir 파일 감시

거부:

- 네트워크
- 임의 경로 쓰기
- 임의 프로세스 실행
- Git 쓰기 명령

구체 capability JSON은 S0에서 Tauri 버전에 맞게 작성한다.

## 15. 단계별 구현 단위

### S0

1. Tauri+Vite+React 최소 창
2. Monaco side-by-side plaintext, 가로 스크롤, 우측 편집, 한글 입력
3. 로컬 worker 로드
4. 포터블 빌드 가능성
5. WebView2 존재 확인 안내

실패 시 전체 기능을 쌓지 않고 편집 컴포넌트를 재검토한다.

### S1

1. git runner 테스트
2. 저장소 판정
3. snapshot 병합
4. open_repository
5. FileTree
6. read_document → DiffPane

통과: AC-001~006, AC-020, AC-021, AC-023 중 지원 범위.

### S2

1. codec round-trip
2. dirty/revision
3. save 큐와 교체 저장
4. unsaved dialog
5. 단축키

통과: AC-007~013, AC-016, AC-018, AC-019.

### S3

1. notify debounce
2. self-save hash
3. document-refreshed
4. 다른 파일 변경 시 dirty 유지
5. 저장 중 외부 쓰기 경합

통과: AC-014, AC-015, AC-022. 이 단계 실패 시 배포하지 않는다.

### S4

1. 최근 저장소
2. 리사이즈 저장
3. 상태/오류 UI
4. Ctrl+F
5. unsupported/conflict/submodule/symlink 안내

통과: AC-017 및 확정 FR 추적.

### S5

1. 포터블 패키지
2. Git 없는 환경 안내
3. 한글/공백 경로
4. 읽기 전용 파일
5. 검증 기록

## 16. 테스트 매핑

| 테스트 | 위치 | 실제 I/O |
|---|---|---|
| NUL 파싱, R/D+A 병합 | cargo test git | fixture bytes |
| UTF-8/BOM/EOL | cargo test codec | 임시 파일 |
| 경로 탈출, 외부 링크 | cargo test files | 임시 디렉터리 |
| 저장 교체, 외부 변경 시 저장 취소 | cargo test save | 임시 파일 |
| 상태 전이, stale response | Vitest documentController | mock IPC |
| 트리 정렬 | Vitest FileTree | 없음 |
| 저장소 fixture 시나리오 | integration | 실제 git |
| 외부 프로세스 수정/삭제 | integration/e2e | 실제 파일 |
| 열기-선택-편집-저장 | e2e | 임시 git |
| 포터블 실행 | S5 수동/e2e | 패키지 |

테스트는 사용자 실제 저장소를 수정하지 않는다. GUI 자동화는 사용자 마우스/포커스를 빼앗지 않는 별도 세션에서 한다.

## 17. 구현하지 않는 것

- 문법 강조, 자동 포맷, 미니맵, 접기
- 파일명 검색, 상태 필터
- Git add/commit/checkout/branch
- 자동 저장, 자동 병합
- 좌측 편집
- 혼합 EOL 정규화 저장
- 외부 링크 따라가 쓰기
- macOS/Linux, 설치 프로그램
- 소스 코드 외부 전송

## 18. 남은 구현 결정

- Tauri/Rust/React/Monaco 버전
- notify 디바운스 ms, 재검사 주기
- Windows 파일 교체 API
- stdout 상한, Git 타임아웃
- 성능 위험 파일의 읽기 전용 임계값 실측
- settings.json vs sqlite
- conflict/submodule 문구 최종안

이 항목은 제품 요구를 바꾸지 않으며 S0/S3 검증 후 채운다.
