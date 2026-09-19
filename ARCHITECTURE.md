# Git Diff Editor 구현 아키텍처

- 문서 버전: 1.0
- 기준 문서: `REQUIREMENTS.md` v1.3, `IMPLEMENTATION_PLAN.md` v1.0, `CONTEXT.md`
- 상태: 구현 전 아키텍처 설계안
- 대상: Windows 포터블 독립 실행형 애플리케이션

## 1. 아키텍처 목표

이 애플리케이션은 로컬 Git 저장소의 `HEAD`와 현재 작업 트리를 비교하고, 원본은 왼쪽 읽기 전용 패널에, 변경 내용은 오른쪽 편집 패널에 표시한다.

아키텍처의 최우선 불변 조건은 다음과 같다.

1. 외부 파일 변경이 우선한다.
2. 외부 변경을 감지하면 사용자 확인 없이 자동 새로고침한다.
3. 같은 파일의 미저장 편집 버퍼도 외부 내용으로 교체한다.
4. 다른 파일의 외부 변경은 현재 파일의 미저장 버퍼를 폐기하지 않는다.
5. 명시적인 저장 동작 외에는 디스크에 쓰지 않는다.
6. Git의 HEAD, 인덱스, 브랜치를 변경하지 않는다.
7. 오래된 비동기 작업 결과가 최신 화면을 덮어쓰지 않는다.

## 2. 논리적 구성

```text
┌───────────────────────────────────────────────────────────┐
│ Renderer Process                                           │
│  App Shell · Toolbar · File Tree · Status · Diff Editor    │
│  DocumentController · DiffEditorAdapter                   │
└───────────────────────────┬───────────────────────────────┘
                            │ typed, allow-listed IPC
┌───────────────────────────▼───────────────────────────────┐
│ Preload                                                     │
│  공개 API와 이벤트만 노출 · raw ipcRenderer 차단           │
└───────────────────────────┬───────────────────────────────┘
                            │ validated commands/events
┌───────────────────────────▼───────────────────────────────┐
│ Main Process                                                │
│  RepositoryService · FileService · SaveCoordinator          │
│  WatchCoordinator · SettingsService · IPC Handlers          │
└───────────────┬───────────────────────────────┬───────────┘
                │                               │
        ┌───────▼────────┐              ┌──────▼────────────┐
        │ System Git      │              │ Windows File I/O   │
        │ read-only calls │              │ read/version/write │
        └─────────────────┘              └────────────────────┘
```

## 3. 프로세스와 책임

### 3.1 Renderer

화면 렌더링과 사용자 입력만 담당한다.

- 저장소 경로·브랜치·상태 표시
- 전체 파일 트리 표시
- 좌우 diff editor 배치
- 우측 편집 입력, dirty 표시, 단축키 처리
- 로딩·변경 없음·미지원·오류 상태 표시
- Git 명령 실행이나 임의 파일 쓰기를 직접 수행하지 않음

### 3.2 Preload

Renderer와 Main 사이의 최소 권한 경계다.

- 타입이 있는 API만 `contextBridge`로 노출
- 임의 채널, 임의 명령 문자열, raw `ipcRenderer`를 노출하지 않음
- 호출 결과와 이벤트 payload의 스키마 검증

### 3.3 Main

로컬 파일과 Git에 접근하는 신뢰 영역이다.

- `RepositoryService`: 저장소 판정, HEAD·브랜치 식별, 파일 목록 및 변경 상태
- `FileService`: 원시 바이트 읽기, UTF-8/BOM/EOL 해석, 파일 버전 계산
- `SaveCoordinator`: 저장 직전 버전 확인, 안전한 쓰기, 저장 결과 검증
- `WatchCoordinator`: 외부 변경 감지, 이벤트 병합, 자동 새로고침
- `SettingsService`: 최근 저장소와 UI 설정 저장
- `IPC Handlers`: 세션·경로·payload 검증 후 서비스 호출

### 3.4 System Git

Git은 읽기 작업에만 사용한다.

- `git --version`
- 저장소 루트·git dir·common dir 조회
- HEAD와 현재 브랜치 조회
- HEAD 트리와 blob 읽기
- 변경 상태 및 파일 목록 조회

Git 명령은 shell 문자열 조합 없이 인자 배열로 실행한다. 외부 diff/textconv나 저장소 스크립트를 자동 실행하지 않는다.

## 4. 핵심 데이터 모델

```text
RepositorySession
  sessionId
  root
  gitDir
  commonDir
  headOid
  branch
  repositoryGeneration

FileEntry
  path
  previousPath?
  status: M | A | D | R | U | unsupported
  tracked
  existsOnDisk
  editable

DocumentState
  documentId
  sessionId
  path
  headOid
  originalText
  baselineText
  bufferText
  baselineDiskVersion
  bufferRevision
  dirty
  encoding
  bom
  eol
  loadState

DiskVersion
  exists
  rawBytesHash
  byteLength
  modifiedTimeHint
```

### 4.1 두 상태를 분리한다

- `Git change status`: HEAD와 디스크 파일의 차이. 예를 들어 dirty가 아니어도 `M`일 수 있다.
- `dirty`: 편집 버퍼와 마지막 읽기/저장 기준의 차이.
- 외부 자동 새로고침은 해당 DocumentState의 buffer와 baseline을 동시에 최신 디스크 내용으로 교체하고 dirty를 해제한다.

mtime은 최적화 힌트일 뿐 최종 동일성 기준이 아니다. 저장 직전에는 원시 바이트 버전을 다시 확인한다.

## 5. 주요 데이터 흐름

### 5.1 저장소 열기

```text
폴더 선택
  → Main의 경로 정규화/검증
  → Git 저장소 판정
  → HEAD·브랜치 조회
  → HEAD 트리 + 작업 트리 목록 + 변경 상태 조회
  → RepositorySession 생성
  → Renderer에 snapshot 전달
  → FileTree 렌더링
```

실패한 Git 명령이나 읽기 오류는 빈 변경 목록으로 바꾸지 않는다. 오류 상태와 재시도 가능성을 전달한다.

### 5.2 파일 선택

```text
FileTree 선택
  → sessionId/path/requestSequence 전달
  → HEAD 원본 blob 읽기
  → 현재 디스크 raw bytes 읽기
  → 텍스트/바이너리/인코딩 판정
  → DocumentState 생성
  → 좌측 원본 + 우측 작업 트리 모델 생성
```

요청이 진행 중인 동안 다른 파일이나 저장소가 선택되면 이전 응답은 requestSequence와 sessionId 검사를 통과하지 못해 폐기한다.

### 5.3 우측 편집

```text
사용자 입력
  → Monaco 우측 모델 변경
  → bufferRevision 증가
  → dirty 계산
  → HEAD 대 buffer diff 갱신
  → 디스크 쓰기 없음
```

모델을 키 입력마다 재생성하지 않는다. 직접 입력과 외부 재로드를 서로 다른 원인으로 기록해 커서·selection·undo 동작을 보호한다.

### 5.4 명시적 저장

```text
Ctrl+S/저장 버튼
  → 현재 bufferRevision 캡처
  → 최신 디스크 버전 확인
  → 외부 변경이면 외부 우선 자동 새로고침
  → 변경이 없으면 원래 encoding/EOL/BOM으로 bytes 생성
  → 동일 볼륨 임시 파일 쓰기
  → 교체 직전 버전 재확인
  → 안전한 교체 및 저장 bytes 검증
  → 저장한 revision만 baseline 갱신
  → Git 상태 재조회
```

저장 중 새로운 사용자 입력이 들어오면 저장한 revision과 최신 buffer를 구분한다. 최신 입력을 저장된 것으로 표시하지 않는다.

## 6. 외부 변경 우선 아키텍처

### 6.1 감지 대상

- 작업 트리의 생성·수정·삭제·이동 이벤트
- `.git` 내부의 HEAD·refs·index 변화
- worktree를 지원할 경우 실제 git dir/common dir

파일 감시 이벤트는 힌트다. atomic save에서 발생하는 삭제→생성 이벤트를 짧게 병합하고, 안정된 파일을 다시 읽어 실제 상태를 확인한다. 누락 이벤트를 보완하기 위해 활성 문서의 디스크 버전과 HEAD를 주기적으로 재검사한다.

### 6.2 자동 새로고침 규칙

같은 파일에 외부 변경이 발생하면 다음 순서로 처리한다.

1. 이벤트를 WatchCoordinator에 전달한다.
2. 동일 파일 이벤트를 debounce/coalesce한다.
3. 최신 raw bytes와 Git 상태를 읽는다.
4. 현재 파일의 외부 변경 여부를 내부 저장 이벤트와 구분한다.
5. 외부 내용으로 `bufferText`, `baselineText`, `baselineDiskVersion`을 교체한다.
6. dirty를 `false`로 만들고 undo/redo history를 새 기준으로 초기화한다.
7. diff, 줄 번호, 파일 상태, 오류 상태를 갱신한다.

이 과정에서 확인창이나 수동 새로고침 버튼을 사용하지 않는다. 외부 변경이 다른 파일에만 발생하면 트리와 해당 파일 상태만 갱신하고 현재 편집 버퍼는 유지한다.

### 6.3 외부 삭제

외부에서 현재 파일을 삭제하면 파일 상태를 `D`로 바꾸고 우측 패널을 편집 불가 빈 화면으로 표시한다. 이전 버퍼를 자동 저장하여 파일을 부활시키지 않는다.

### 6.4 자체 저장 식별

자체 저장 직후 발생한 watcher 이벤트를 시간만으로 무시하지 않는다. 저장한 raw bytes hash와 현재 파일 hash가 일치하는지 확인한다.

- 일치: 자체 저장으로 처리하고 현재 문서 상태를 유지
- 불일치: 외부 변경으로 처리하고 외부 우선 자동 새로고침
- 자체 저장 뒤 새 사용자 입력이 있으면 지연된 이벤트가 새 dirty 상태를 폐기하지 않도록 revision을 확인

## 7. 상태 머신

```text
NoRepository
  └─ open → LoadingRepository
                  ├─ success → RepositoryReady
                  └─ failure → RepositoryError

RepositoryReady
  ├─ select file → LoadingDocument
  ├─ external change → RefreshingExternal
  └─ close/switch → ExitGuard(if dirty)

LoadingDocument
  ├─ text success → ReadyClean
  ├─ unsupported → Unsupported
  └─ failure → DocumentError

ReadyClean
  ├─ edit → ReadyDirty
  ├─ external same-file → RefreshingExternal
  └─ save → Noop/Updated

ReadyDirty
  ├─ edit → ReadyDirty
  ├─ undo to baseline → ReadyClean
  ├─ user save → Saving
  ├─ user switch/close → ExitGuard
  └─ external same-file → RefreshingExternal

Saving
  ├─ disk unchanged → Saved
  ├─ external disk change → RefreshingExternal
  └─ write/readback failure → SaveError

RefreshingExternal
  ├─ read success → ReadyClean/Unsupported
  └─ read failure → RefreshError
```

`ExitGuard`는 사용자가 파일 전환·저장소 전환·정상 종료를 요청했을 때만 사용한다. 외부 자동 새로고침은 `ExitGuard`를 거치지 않는다.

## 8. IPC 계약 초안

```ts
type RepositoryOpenRequest = { path: string };
type RepositorySnapshot = {
  sessionId: string;
  root: string;
  branch: string | null;
  headOid: string | null;
  files: FileEntry[];
};

type DocumentReadRequest = {
  sessionId: string;
  path: string;
  requestSequence: number;
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

type RepositoryChangeEvent = {
  sessionId: string;
  generation: number;
  paths: string[];
  reason: 'external' | 'self-save' | 'git-state';
};
```

실제 타입은 구현 시 `shared/contracts`에서 정의한다. IPC가 절대 경로를 직접 받아 임의 위치에 쓰지 않도록 열린 RepositorySession의 root와 상대 경로를 조합해 Main에서 검증한다.

## 9. 보안과 운영 경계

- Renderer: `nodeIntegration=false`, `contextIsolation=true`, 가능한 경우 sandbox 사용
- Preload: allow-list API만 노출
- Main: 경로 탈출, 저장소 세션, 요청 순서, payload 크기 검증
- Git: shell=false, 인자 배열, 타임아웃, stdout/stderr 제한, Windows hidden child process
- 콘텐츠: 원격 웹 페이지를 로드하지 않고 로컬 번들만 로드
- CSP와 외부 링크/새 창 차단
- 소스 코드나 저장소 내용을 외부 서비스로 전송하지 않음
- 저장소의 Git 설정, safe.directory, index, HEAD를 자동 수정하지 않음
- 심볼릭 링크·junction·submodule은 승인된 지원 정책 전까지 제한적으로 처리

## 10. 테스트 아키텍처

### Unit

- Git NUL 출력 파싱
- 상태 병합 및 R/D+A 처리
- UTF-8/BOM/EOL round-trip
- dirty와 Git status 분리
- requestSequence/repositoryGeneration 낡은 응답 폐기
- 외부 변경 우선 상태 전이

### Integration

- 실제 임시 Git 저장소와 실제 `git` 실행
- tracked/untracked/deleted/staged/renamed fixture
- 한글·공백·특수문자 경로
- 파일 저장 후 raw bytes 검증
- HEAD/인덱스가 변경되지 않았는지 검증
- 다른 프로세스의 수정·삭제·atomic replace

### Electron E2E

- 저장소 열기부터 파일 선택·편집·저장
- 좌측 읽기 전용과 우측 편집
- Ctrl+S/Z/Y/F
- 외부 변경 자동 새로고침
- 같은 파일 dirty 폐기, 다른 파일 dirty 유지
- 창 크기 조절과 portable package 실행

외부 변경과 저장 경쟁 테스트가 실패하면 배포를 진행하지 않는다. 테스트는 사용자 실제 저장소가 아닌 임시 fixture에서 수행한다.

## 11. 단계별 구현 경계

- **S0**: Electron/Monaco 최소 proof, 보안 경계, 로컬 worker, portable build 가능성 확인
- **S1**: RepositoryService, Git snapshot, 파일 트리, 좌우 원본/작업 트리 표시
- **S2**: 우측 편집, diff 갱신, dirty, 저장, 텍스트 보존
- **S3**: WatchCoordinator, 외부 변경 우선 자동 새로고침, 자체 저장 식별, 경합 테스트
- **S4**: 최근 저장소, 오류/상태 UI, 패널 리사이즈, 코드 검색, 승인된 특수 상태
- **S5**: Windows portable 패키지, 실제 환경 검증, 수용 테스트 및 릴리스 증거

단계별 구현은 테스트 우선 RED→GREEN→REFACTOR로 진행한다. 이 문서는 구현 착수 승인이나 패키지 설치 완료 보고가 아니다.

## 12. 아키텍처 결정 기록

### ADR-001. Tauri 기반 데스크톱 셸 — 확정

- 결정: Tauri를 사용하고 Rust를 시스템 접근 백엔드로 둔다.
- 이유: Windows 포터블 배포와 최소 권한 파일/Git 처리 경계를 확보하면서 React/Monaco UI를 유지할 수 있다.
- 비용: Rust 구현과 Windows WebView2 환경 검증이 필요하다.
- 대안: Electron은 React 통합이 단순하지만 런타임 번들·메모리 부담이 더 크다. WPF는 Windows 친화적이나 편집기 통합을 별도로 검토해야 한다.
- 상태: 기술 선택 확정, 구체 버전과 S0 검증은 미결정.

### ADR-002. 외부 변경 우선

- 결정: 외부 변경을 감지하면 자동 새로고침하고 해당 파일의 미저장 버퍼를 폐기한다.
- 이유: 사용자가 명시적으로 “외부 변경이 우선이고 자동 새로고침”으로 결정했다.
- 결과: 사용자 입력 버퍼 보존보다 외부 AI 도구의 최신 파일 상태가 우선한다. 조용한 덮어쓰기 확인창과 수동 새로고침은 제공하지 않는다.

### ADR-003. Main 프로세스에 파일/Git 권한 집중

- 결정: Renderer는 파일 시스템이나 Git을 직접 호출하지 않는다.
- 이유: 임의 경로 쓰기와 shell 주입 위험을 줄이고 저장소 세션을 중앙 검증한다.
- 결과: 모든 저장과 외부 변경 처리는 IPC를 거친다.

## 13. 미결정 항목

아래는 이 문서에서 임의로 확정하지 않는다.

- 트리 정렬과 폴더 접기·펼치기 정책
- 미추적 파일 표시 정책
- 이름 변경 판정 및 D+A 표시 기준
- detached HEAD, bare, worktree, submodule, 링크 지원 범위
- 변경 없는 파일의 선택/편집 정책
- 혼합 줄바꿈 처리
- 최소 Windows/Git 버전, 파일 크기/줄 수/응답 시간 기준
- Electron/React/Monaco의 구체 버전과 라이선스 검토
- 감시 debounce/주기와 저장 교체 방식의 최종 구현

미결정 항목은 `REQUIREMENTS.md`의 O-01/02/03/04/06/07/08과 동기화한다. O-05 외부 변경 우선 정책은 확정되어 재질문하지 않는다.

## 14. 그릴링 확정 결정

- Electron 대신 Tauri를 사용한다.
- UI는 React + TypeScript + Monaco Editor로 구성한다.
- Git, 파일 시스템, 파일 감시는 Rust 백엔드가 담당한다.
- diff 계산은 Monaco가 담당하고 Rust는 Git 상태·파일 내용·버전 정보를 제공한다.
- 외부 변경 감시는 Rust `notify` 계열을 사용하며 이벤트 디바운스와 실제 내용 재확인을 적용한다.
- 프론트엔드와 Rust는 타입 기반 Tauri Command/Event IPC로 통신한다.
- 전역 UI 상태는 Zustand로 관리한다.
- 저장소·디스크 상태의 기준은 Rust이며 React/Zustand는 화면과 편집 버퍼를 관리한다.
- 저장은 임시 파일 작성 후 교체한다.
- Git은 시스템 Git CLI를 사용하고 `git2`는 사용하지 않는다.
- UTF-8, BOM, `LF`/`CRLF`를 보존하며 혼합 줄바꿈 파일은 읽기 전용이다.
- Windows 포터블 배포를 사용하고 Tauri 최소 권한 설정과 네트워크 권한 제외를 적용한다.
- 최근 저장소·레이아웃 설정은 Windows 사용자 앱 데이터 폴더에 저장한다.
- 자동 줄바꿈은 끄고 가로 스크롤을 사용한다.
- 공백·탭 기호는 기본 표시하지 않으며 변경된 공백은 diff로 표시한다.
- 미추적 파일은 `U`로 표시하고, Git이 판정한 경우에만 `R`을 사용하며 그 외 이동은 `D`+`A`로 표시한다.
- detached HEAD와 worktree는 지원한다. bare 저장소·submodule·병합 충돌·외부 링크 대상 편집은 제한한다.
- 변경되지 않은 텍스트 파일도 우측 편집을 허용한다.
- 고정 파일 크기 제한은 두지 않고 성능 위험 파일은 읽기 전용 또는 미지원으로 처리한다.

## 15. 남은 기술 결정

- Tauri·Rust·React·Monaco의 구체 버전
- 최소 Windows 및 Git 버전
- `notify` 디바운스 주기
- 최종 안전 저장 방식의 Windows 경합 검증
- 파일 크기·줄 수·응답 시간 실측 기준
- Tauri capability의 정확한 권한 목록
- 앱 데이터 저장 형식
- bare/submodule/병합 충돌의 상세 UI 문구

## 16. 참조

- 프로젝트 요구사항: `REQUIREMENTS.md`
- 구현 계획: `IMPLEMENTATION_PLAN.md`
- 프로젝트 결정/용어: `CONTEXT.md`
- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- Monaco Diff Editor API: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IDiffEditorConstructionOptions.html
- Git diff 문서: https://git-scm.com/docs/git-diff
