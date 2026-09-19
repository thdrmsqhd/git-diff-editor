# Git Diff Editor 파일 트리

- 문서 버전: 1.0
- 기준: `ARCHITECTURE.md` v1.0, `IMPLEMENTATION_PLAN.md` v1.0, `CONTEXT.md`
- 상태: 구현 전 예정 구조. 아래 소스 파일은 아직 생성하지 않음.
- 현재 실제 파일: 프로젝트 문서 6개

## 1. 현재 저장소

```text
git-diff-editor/
├── ARCHITECTURE.md
├── CONTEXT.md
├── FILETREE.md
├── IMPLEMENTATION_DETAIL.md
├── IMPLEMENTATION_PLAN.md
└── REQUIREMENTS.md
```

## 2. 예정 소스 구조

```text
git-diff-editor/
├── ARCHITECTURE.md
├── CONTEXT.md
├── FILETREE.md
├── IMPLEMENTATION_PLAN.md
├── REQUIREMENTS.md
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles.css
│   ├── components/
│   │   ├── Toolbar.tsx
│   │   ├── FileTree.tsx
│   │   ├── DiffPane.tsx
│   │   ├── StatusView.tsx
│   │   └── UnsavedDialog.tsx
│   ├── editor/
│   │   └── monacoAdapter.ts
│   ├── state/
│   │   ├── appStore.ts
│   │   └── documentController.ts
│   └── ipc/
│       └── client.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands.rs
│       ├── events.rs
│       ├── contracts.rs
│       ├── errors.rs
│       ├── git/
│       │   ├── mod.rs
│       │   ├── runner.rs
│       │   ├── repository.rs
│       │   └── snapshot.rs
│       ├── files/
│       │   ├── mod.rs
│       │   ├── codec.rs
│       │   ├── versions.rs
│       │   └── save.rs
│       ├── watch/
│       │   ├── mod.rs
│       │   └── coordinator.rs
│       └── settings/
│           ├── mod.rs
│           └── store.rs
├── tests/
│   ├── rust/                 # cargo test 보조 fixture/설명
│   ├── unit/                 # Vitest
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
└── docs/
    └── verification/
```

이 트리는 구현 착수 시 생성할 예정 구조다. 불필요한 플러그인 체계나 Electron preload 계층은 포함하지 않는다.

## 3. 모듈과 파일 매핑

### 프론트엔드 — React / TypeScript

- `src/main.tsx`: 앱 진입점
- `src/App.tsx`: 레이아웃, 패널 분할, 상태 연결
- `src/components/Toolbar.tsx`: 저장소 선택, 경로, 브랜치, 저장 버튼
- `src/components/FileTree.tsx`: 전체 파일 트리, 변경 상태, 폴더 접기, 폴더 내 변경 우선 정렬
- `src/components/DiffPane.tsx`: 좌우 원본/변경 패널 컨테이너
- `src/components/StatusView.tsx`: 변경 없음, 로딩, 미지원, 오류
- `src/components/UnsavedDialog.tsx`: 사용자 전환/종료 시 저장·버리기·취소
- `src/editor/monacoAdapter.ts`: Monaco Diff Editor 설정, plaintext, 가로 스크롤, 우측 편집
- `src/state/appStore.ts`: Zustand 저장소. 세션, 트리, 선택 파일, dirty, 오류
- `src/state/documentController.ts`: 파일 선택·편집·저장·외부 재로드 상태 전이
- `src/ipc/client.ts`: Tauri Command 호출과 Event 구독

### 백엔드 — Rust / Tauri

- `src-tauri/src/commands.rs`: 저장소 열기, 문서 읽기, 저장 Command
- `src-tauri/src/events.rs`: 외부 변경, Git 상태, 오류 Event
- `src-tauri/src/contracts.rs`: IPC payload 타입
- `src-tauri/src/git/runner.rs`: 시스템 Git CLI 실행. shell 없음, 인자 배열
- `src-tauri/src/git/repository.rs`: 저장소 판정, HEAD, 브랜치, worktree
- `src-tauri/src/git/snapshot.rs`: 파일 목록과 변경 상태 스냅샷
- `src-tauri/src/files/codec.rs`: UTF-8, BOM, EOL
- `src-tauri/src/files/versions.rs`: 디스크 버전 해시
- `src-tauri/src/files/save.rs`: 임시 파일 작성 후 교체 저장
- `src-tauri/src/watch/coordinator.rs`: `notify` 감시, 디바운스, 자체 저장 식별
- `src-tauri/src/settings/store.rs`: 최근 저장소와 레이아웃. Windows 앱 데이터 폴더

### 테스트

- `src-tauri` 내부 `#[cfg(test)]` 및 `cargo test`
- `tests/unit`: React/Zustand
- `tests/integration`: 실제 임시 Git 저장소
- `tests/e2e`: Tauri 앱 사용자 흐름
- `tests/fixtures`: tracked/untracked/deleted/renamed/한글 경로 fixture
- `docs/verification`: 실행 결과와 패키지 검증 기록

## 4. 제외하는 경로

다음 구조는 사용하지 않는다.

- Electron `src/main`, `src/preload`
- Node.js sidecar
- `git2` 전용 Git 라이브러리 모듈
- 네트워크 권한 또는 원격 API 모듈
- 파일명 검색·상태 필터 UI 모듈
- Git 스테이징·커밋·브랜치 전환 모듈

## 5. 생성 시점

- S0: `package.json`, `src-tauri`, 최소 `App.tsx`/`DiffPane`, 빌드 설정
- S1: `git/`, `FileTree.tsx`, snapshot Command
- S2: `files/save.rs`, `monacoAdapter.ts`, dirty/저장 UI
- S3: `watch/coordinator.rs`, 외부 변경 Event
- S4: `settings/store.rs`, 오류/상태 UI, 리사이즈
- S5: 포터블 패키지 설정과 `docs/verification`
