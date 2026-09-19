# Git Diff Editor 구현 계획

- 버전: 1.0
- 기준: REQUIREMENTS.md v1.3
- 상태: 구현 설계안. 패키지 설치·프로덕션 코드 작성·실행 검증은 아직 하지 않음.
- 최우선 고정 정책: **외부 변경 우선, 확인창 없이 자동 새로고침. 해당 파일의 미저장 버퍼도 교체.**
- 기술 선택은 본 계획의 권장안이며 사용자 승인이나 실행 검증 결과로 표현하지 않는다.

## 1. 확정 기술 구성

- Tauri + Rust: Windows 독립 실행형, 파일 시스템·Git·파일 감시.
- React + TypeScript: 트리, 상단 바, 상태 표시, 패널 레이아웃.
- Monaco Diff Editor: 좌우 비교, 줄 정렬, 우측 편집, undo/redo, 검색, 동기 스크롤.
- Zustand: 프론트엔드 전역 상태.
- 시스템 Git CLI: Rust에서 shell 없이 인자 배열로 실행.
- Rust `notify` 계열 + 주기적 재검사: 외부 파일 변경 이벤트 수집. 이벤트만으로 데이터 진실을 판단하지 않음.
- Rust `cargo test`: Git·파일·저장·감시 도메인 테스트.
- Vitest: React/Zustand 상태와 IPC 응답 처리 테스트.
- Tauri E2E: 실제 임시 Git 저장소와 파일 I/O를 포함한 사용자 흐름 검증.
- Tauri bundler 후보: Windows portable exe 또는 폴더. 설치 프로그램은 만들지 않음.

### 선택 근거와 비용

Monaco의 diff/편집 기능을 활용하면 줄 정렬·스크롤·한글 입력·undo를 직접 구현하는 위험을 줄인다. 문법 강조가 필요 없으므로 모든 모델 언어는 plaintext로 설정한다. Tauri는 Electron보다 런타임 번들 부담을 줄일 수 있지만 Rust 파일/Git 처리와 Windows WebView2 환경 검증이 필요하다. 구체 버전과 lockfile은 S0 검증 및 호환·보안·라이선스 검토 후 확정한다.

## 2. 화면 설계

```text
┌ 저장소 선택 / 최근 저장소 ─ 경로 ─ 브랜치 ─ 저장 ┐
├ 전체 파일 트리 ┬ 원본: HEAD           ┬ 변경: 작업 파일 ┤
│ 상태/파일명    │ 줄 번호 + 원본      │ 줄 번호 + 편집  │
│               │ 읽기 전용           │ 미저장 표시     │
└───────────────┴─────────────────────┴─────────────────┘
```

- 트리/본문, 원본/변경 사이 구분선 크기 조절.
- 문법 강조·미니맵·자동 완성·자동 포맷·code lens 등 불필요한 IDE 기능 비활성화.
- 줄 정렬과 diff 색상은 활성화. 공백만 바뀐 경우도 숨기지 않는다.
- 좌측 수정 불가, 우측 수정 가능. 삭제 파일은 우측도 수정 불가.
- 좁은 창에서도 임의로 단일 인라인 diff로 전환하지 않는다.
- 모델 갱신은 직접 타이핑과 외부 재로드를 구별한다. 일반 입력마다 모델을 재생성하지 않는다.
- 외부 재로드 때는 해당 파일 undo/redo 이력을 새 기준으로 초기화하여 폐기된 버퍼가 실수로 복원되지 않도록 하는 설계안이다. 테스트로 검증한다.
- 선택 파일을 유지하고 가능한 범위에서 스크롤/커서를 유지한다. 외부 삭제/행 감소 시 유효 위치로 보정한다.

## 3. 프로세스 경계 및 모듈

```text
Renderer: 화면 + Monaco + 편집 상태
     ↕ 제한된 타입 IPC
Preload: 공개 메서드/이벤트만 연결
     ↕
Main: RepoService / FileService / WatchCoordinator / Settings
     ↕
시스템 Git / 로컬 파일 시스템
```

### 책임 분리

- RepoService: 저장소 판정, HEAD 식별, 파일 목록·변경 상태, 원본 blob 읽기.
- FileService: 바이트 읽기, 인코딩/줄바꿈 정보, 버전 비교, 저장.
- WatchCoordinator: 외부 변경 이벤트 병합, 재조회, 버전 증가, 자체 저장 식별.
- DocumentController: 파일 선택·편집·저장·재로드의 상태 전이.
- DiffEditorAdapter: Monaco 설정, 모델 교체, UI 명령 연결. Git/디스크 직접 접근 금지.
- SettingsService: 최근 저장소와 창/분할 크기. 소스 파일 내용을 설정에 저장하지 않음.

IPC는 openRepository, readDocument, saveDocument, subscribeRepoChanges 등 명시적 호출만 노출한다. 임의 Git 명령·임의 절대 경로 쓰기·raw ipcRenderer를 노출하지 않는다. Main에서 저장소 세션 ID, 경로 범위, 스키마, 메시지 크기를 검증한다.

보안: nodeIntegration=false, contextIsolation=true, sandbox 적용 가능 여부 검증, 로컬 콘텐츠만 로드, CSP, 외부 탐색/새 창 차단. Monaco worker도 로컬 번들 사용. Git 자식 프로세스는 windowsHide 적용. 앱 자체나 테스트가 사용자 마우스/포커스를 강탈하지 않도록 별도 검증 환경을 사용한다.

## 4. 데이터 모델과 갱신 규칙

- RepositorySession: sessionId, root, gitDir, commonDir, headOid, branch, repositoryGeneration.
- FileEntry: 상대 경로, 이전 경로(선택), Git 상태, 파일 유형, 편집 가능 여부.
- DiskVersion: 존재 여부, 원시 바이트 해시, 필요 시 크기/mtime. mtime만으로 동일성 판정하지 않음.
- DocumentState: documentId, headOid, originalText, baselineDiskVersion, baselineText, bufferText, bufferRevision, dirty, encoding/BOM/EOL, loadState.
- AsyncRequest: sessionId, documentId, requestSequence, repositoryGeneration. 과거 응답은 현재 UI에 적용하지 않음.

Git 변경 상태와 dirty를 별도 관리한다. dirty=false라도 HEAD와 달라 M 상태일 수 있다.

### 상태 전이

1. 파일 선택 → loading → ready 또는 unsupported/error.
2. 우측 입력 → bufferRevision 증가, dirty 계산, diff 갱신. 디스크 쓰기 없음.
3. 저장 요청 → saving → saved / refreshedExternal / error.
4. 같은 파일 외부 수정 → 자동 재읽기 → buffer 교체, baseline 갱신, dirty=false, diff 재계산.
5. 다른 파일 외부 수정 → 해당 상태/트리만 갱신. 현재 dirty 버퍼 유지.
6. 외부 삭제 → 삭제 상태, 우측 빈 화면, 저장 불가. 오래된 버퍼로 재생성 금지.
7. 사용자 파일 전환/종료 → dirty인 경우에만 기존 저장/버리기/취소. 외부 재로드에는 이 확인창을 사용하지 않음.

## 5. Git 읽기 설계

### 명령 후보 — 구현 시 실제 임시 저장소로 검증

- git --version
- git -C <root> rev-parse --show-toplevel / --absolute-git-dir / --git-common-dir
- git -C <root> rev-parse --verify HEAD
- git -C <root> symbolic-ref --quiet --short HEAD
- git -C <root> ls-tree -r -z <headOid>
- git -C <root> ls-files -z --cached --others --exclude-standard
- git -C <root> diff --no-ext-diff --no-textconv --name-status -z --find-renames <headOid> --
- git -C <root> cat-file blob <blobOid>

HEAD OID를 고정한 뒤 트리에서 blob OID를 찾아 읽는다. 파일명 자체를 revision 문법에 섞지 않는다. 변경 상태 출력은 NUL 구분으로 파싱하며 R 레코드의 이전/새 경로를 함께 처리한다. Git 경고/실패와 정상 빈 결과를 구별한다.

HEAD 파일 목록, 인덱스 파일 목록, ignore되지 않은 미추적 파일 목록의 합집합으로 트리를 만들고 실제 존재 여부를 확인한다. HEAD에는 있지만 디스크에서 사라진 파일은 유지한다. git diff만으로는 미추적 파일이 잡히지 않으므로 별도 목록이 필요하다. O-02 승인 전에는 미추적 표시 방식을 확정하지 않는다.

Git diff의 인덱스/필터/줄바꿈 처리와 원시 파일 비교의 차이에 주의한다. 예를 들어 인덱스만 다르거나 줄바꿈만 다른 fixture를 만든다. 상태 후보와 실제 좌우 데이터의 차이를 검증하고, 인덱스 상태를 곧바로 화면 상태로 사용하지 않는다. 화면에서 보이는 원본/작업 파일의 줄바꿈 차이는 별도 메타데이터로 설명하는 방안을 검토한다.

untracked 이동은 항상 R로 추론할 수 없으므로 O-03의 D+A 폴백을 계획한다. Git은 쓰기 작업을 수행하지 않는다. 외부 diff/textconv 금지, 선택적 인덱스 쓰기 억제 환경 및 타임아웃/출력 크기 제한을 적용한다.

조회 전후 HEAD가 바뀌면 결과를 폐기하고 제한적으로 재조회한다. 작업 트리 전체는 원자적 스냅샷이 아니므로 파일별 버전과 후속 이벤트로 수렴시킨다. 연속 변경 중 무한 재시도로 UI를 멈추지 않는다.

## 6. 외부 변경 우선의 구체적 구현

이 절은 확정 정책을 바꾸지 않는다. 저장 차단 확인창, 수동 새로고침, 자동 병합은 만들지 않는다.

### 감지

- 코드 파일 생성/수정/삭제, HEAD/참조/인덱스 변화 감지.
- .git을 UI에서 제외하는 것과 Git 메타데이터 감시를 분리한다.
- worktree 지원 시 gitDir와 commonDir의 실제 위치를 감시한다.
- atomic-save의 삭제→생성 및 연속 이벤트를 짧게 병합하고 안정된 바이트를 재읽는다.
- 누락 이벤트 보완을 위해 활성 문서 버전과 HEAD를 주기적으로 재검사한다. 디바운스/주기는 초기 실측으로 정한다.
- 변경 대량 발생 시 한 번의 저장소 재조회로 병합하고 최신 generation만 반영한다.

### 자체 저장 식별

시간 창 안의 이벤트를 모두 무시하지 않는다. 저장한 bytes의 해시와 실제 현재 디스크 해시가 일치할 때만 자체 저장과 동일한 상태로 간주한다. 다르면 외부 버전으로 자동 반영한다. 자체 저장 이후 사용자가 추가 타이핑한 내용은 지연된 자체 이벤트로 폐기하지 않는다.

### 저장 절차

1. 문서 revision 및 저장할 버퍼를 캡처하고 파일별 내부 작업 큐로 직렬화한다.
2. 최신 디스크 버전을 읽는다. baseline과 다르면 저장 대신 최신 내용으로 자동 재로드한다.
3. 같으면 인코딩/EOL 규칙대로 bytes를 생성하고 동일 볼륨 임시 파일에 쓴다.
4. 교체 직전 버전을 다시 확인한다. 외부 변경이 있으면 임시 파일을 제거하고 자동 재로드한다.
5. 가능한 안전한 교체 방식으로 저장하고 bytes를 재검증한다. Windows 권한/잠금/백신 영향을 실제 테스트한다.
6. 저장 중 새 입력이 생겼다면 저장한 revision만 baseline으로 갱신하고 최신 버퍼를 유지하여 dirty를 재계산한다.
7. 이후 Git 상태 조회 실패는 파일 저장 성공과 별도로 보고한다.

한계: 내부 큐와 해시 재검사만으로 외부 프로세스와의 check→replace 경합을 완전히 제거할 수 없다. 구현 단계에서 실제 동시 쓰기 테스트를 필수 게이트로 둔다. 외부 데이터 유실이 재현되면 배포를 보류하고 Windows 파일 공유/잠금 및 교체 방식을 재설계한다. 완전한 외부 변경 우선 보장을 검증 없이 주장하지 않는다.

## 7. 텍스트 저장 설계

원시 bytes → UTF-8 엄격 디코딩 → BOM/EOL/끝 개행 메타데이터 분리 → 편집 모델. 저장 시 원래 메타데이터를 적용하되 사용자가 의도적으로 추가/삭제한 끝 개행은 보존한다. 단순 편집 시 끝 개행을 자동 추가하지 않는다.

BOM이 텍스트 문자로 들어가지 않게 하고 EOL 변환을 한 계층에서만 수행한다. 혼합 EOL은 O-07 확정 전 제한 정책을 유지한다. 바이너리/실패 파일은 raw bytes를 임의로 손실 디코딩하여 저장하지 않는다. 링크/경로 탈출은 Main에서 판정하며 대상 외부 경로로 쓰지 않는다.

## 8. 예정 프로젝트 구조

```text
src/
  main/
    app.ts
    ipc/handlers.ts
    git/{runner,repository,snapshot}.ts
    files/{codec,versions,save}.ts
    watch/coordinator.ts
    settings/store.ts
  preload/index.ts
  shared/{contracts,errors}.ts
  renderer/
    App.tsx
    components/{Toolbar,FileTree,DiffPane,StatusView}.tsx
    editor/monacoAdapter.ts
    state/documentController.ts
    styles.css
tests/
  unit/
  integration/
  e2e/
  fixtures/
docs/verification/
REQUIREMENTS.md
CONTEXT.md
IMPLEMENTATION_PLAN.md
```

이 구조는 계획이며 아직 코드 파일은 생성하지 않는다. 작은 모듈로 시작하고 필요 없는 추상화나 플러그인 체계는 만들지 않는다.

## 9. 구현 단계와 통과 조건

모든 단계는 기능 하나씩 RED→GREEN→REFACTOR로 진행한다. 테스트를 전부 미리 쓰고 구현을 몰아서 하는 방식은 사용하지 않는다.

### S0. 설계 결정 및 편집 컴포넌트 검증

- O-01/02/03/04/06/07/08은 미결정으로 유지하고 해당 기능 착수 전 확정한다. O-05는 재질문하지 않는다.
- 최소 실패 테스트부터 Monaco plaintext 좌우 고정, 정렬, 우측 편집, 한글 입력, 외부 모델 교체를 확인한다.
- 로컬 worker 번들, 개발/패키지 모드 로드, Windows portable packaging을 초기에 시험한다.
- 통과: 핵심 편집 경로와 패키징 가능성이 확인됨. 실패하면 프레임워크 전체를 무작정 구현하지 않고 컴포넌트를 재검토.

### S1. 저장소 열기→파일 선택→원본/현재 내용

- 실제 임시 Git 저장소 생성, tracked/untracked/삭제/스테이징 fixture 작성.
- RepoService, 제한 IPC, 최소 트리와 DiffPane까지 수직 연결.
- 통과: AC-001~006, AC-020/021/023 중 승인 범위. HEAD/인덱스 불변 확인.

### S2. 편집→실시간 diff→명시적 저장

- Monaco adapter, dirty, undo/redo, 줄 번호/정렬/스크롤, UTF-8/EOL 처리.
- 사용자 전환/종료의 저장·버리기·취소, 실패 분기.
- 통과: AC-007~013, AC-016/018/019. 실제 저장 bytes 검증.

### S3. 외부 변경 우선 자동 재로드

- 별도 프로세스로 파일 수정/삭제/atomic replace와 외부 Git checkout/commit 수행.
- 자체 저장 구별, 오래된 응답 차단, 동일 파일 dirty 폐기와 다른 파일 dirty 유지.
- 저장 중 타이핑, 저장/외부 쓰기 경합을 결정적 동기화 지점과 실제 프로세스로 검증.
- 통과: AC-014/015/022 및 경합 테스트. 이 단계는 후속 기능이 아니라 배포 필수 조건.

### S4. UI 완성 및 범위 정책

- 최근 저장소, 리사이즈, 코드 검색, 상태/오류 UI, 미지원 파일 처리.
- 승인된 깨끗한 파일 선택 정책, 트리 정렬, 지원 범위 적용.
- 통과: AC-001/016/017/021 보완, 모든 확정 FR 추적 완료.

### S5. Windows 포터블 배포·인수 검증

- 고정 의존성 설치, 타입검사, 단위/통합/E2E, production build, portable package.
- Node 개발환경이 없는 검증 환경에서 시스템 Git만으로 실행 확인.
- 한글/공백 경로, 읽기 전용 파일, 시스템 Git 부재, 패키지 내 worker 로드 검증.
- 통과: AC-024/025 및 전체 회귀. 제한, 라이선스, 실행 안내, 테스트 결과, 패키지 체크섬 기록.

## 10. 요구사항 추적 및 검증 산출물

- FR-001/002/003/005 → S1, S4
- FR-004/006/007/009 → S0, S2, S4
- FR-008 → S3 (외부 우선 핵심)
- FR-010 → S1, S4
- NFR-001/003 → S0, S5
- NFR-002/004 → S1~S3, S5

실제 구현 후 docs/verification/에 명령, 버전, fixture, 통과/실패, GUI 증거, 성능 실측을 기록한다. 개발자가 선택한 임시 Git 저장소에서 테스트하며 사용자의 실제 프로젝트를 테스트 목적으로 수정하지 않는다. S0/S5의 GUI 검증은 별도 세션/가상 환경 등으로 사용자 입력 장치를 방해하지 않도록 한다.

## 11. 남은 결정과 제한

- REQUIREMENTS.md의 미결정 O 항목은 본 계획에서 승인된 것으로 바꾸지 않는다.
- 프레임워크/버전, watcher 간격, 파일 제한, 성능 목표, 최소 Windows 버전, 설정 저장 위치는 초기 검증 후 확정한다.
- 기간/공수는 환경 검증과 S0 결과 없이 단정하지 않는다.
- 이번 산출물은 구현 계획과 프로젝트 컨텍스트이다. 제품 코드 구현·설치·Git 초기화는 수행하지 않는다.

## 13. 그릴링 확정 결정 반영

### 13.1 런타임과 책임

- Electron 대신 Tauri를 사용한다.
- UI는 React + TypeScript + Monaco Editor로 구성한다.
- Git 실행, 파일 시스템, 파일 감시는 Rust 백엔드가 담당한다.
- diff의 시각적 계산은 Monaco가 담당하고 Rust는 Git 상태·파일 내용·버전 정보를 제공한다.
- 프론트엔드와 Rust는 타입 기반 Tauri Command/Event IPC로 통신한다.
- 전역 UI 상태는 Zustand로 관리한다.
- Rust는 디스크·Git 상태의 기준이며 React/Zustand는 화면과 편집 버퍼를 관리한다.

### 13.2 저장소·파일 정책

- 시스템 Git CLI를 사용하고 `git2`는 사용하지 않는다.
- Rust `notify` 계열 감시와 이벤트 디바운스·실제 내용 재확인을 사용한다.
- 저장은 임시 파일 작성 후 교체한다.
- UTF-8, BOM, `LF`/`CRLF`를 보존한다. 혼합 줄바꿈 파일은 읽기 전용이다.
- 미추적 파일은 `U`로 표시한다.
- Git이 이름 변경으로 판정한 경우에만 `R`, 그 외 이동은 `D`+`A`로 표시한다.
- detached HEAD와 worktree는 지원한다. bare 저장소·submodule·병합 충돌·외부 링크 대상 편집은 제한한다.
- 변경되지 않은 텍스트 파일도 우측 편집을 허용한다.
- 외부 변경은 우선하며 사용자 확인 없이 자동 새로고침한다.

### 13.3 UI·배포 정책

- 자동 줄바꿈은 끄고 가로 스크롤을 사용한다.
- 공백·탭 기호는 기본 표시하지 않으며 변경된 공백은 diff로 표시한다.
- Tauri 최소 권한만 허용하고 네트워크 권한은 사용하지 않는다.
- 최근 저장소·레이아웃 설정은 Windows 사용자 앱 데이터 폴더에 저장한다.
- Windows 포터블 실행 파일 또는 포터블 폴더로 배포한다.
- 고정 파일 크기 제한은 두지 않고 성능 위험 파일은 읽기 전용 또는 미지원으로 처리한다.

### 13.4 테스트 정책

- Rust `cargo test`, React Vitest, 실제 임시 Git 저장소 통합 테스트, Tauri E2E를 사용한다.
- 외부 변경 우선·자동 새로고침은 실제 파일 I/O와 별도 프로세스로 검증한다.

## 14. 남은 기술 결정

- Tauri·Rust·React·Monaco의 구체 버전
- 최소 Windows 및 Git 버전
- `notify` 디바운스 주기
- 최종 안전 저장 방식의 Windows 경합 검증
- 파일 크기·줄 수·응답 시간 실측 기준
- Tauri capability의 정확한 권한 목록
- 앱 데이터 저장 형식
- bare/submodule/병합 충돌의 상세 UI 문구
