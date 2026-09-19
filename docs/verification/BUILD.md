# 구현 검증 기록

- 일시: 로컬 빌드
- GUI 앱은 사용자 포커스를 빼앗지 않기 위해 실행하지 않음

## 통과

- `cargo test --lib`: 7 passed
  - UTF-8/BOM/CRLF 왕복
  - 혼합 줄바꿈 읽기 전용
  - 바이너리 NUL 판정
  - rename NUL 파싱
  - 실제 git 저장소에서 수정 파일 status=M
  - 저장 시 CRLF 보존
- `npx vitest run`: FileTree 정렬 1 passed
- `npx tsc --noEmit`: 통과
- `vite build`: `dist/` 생성
- `cargo build --bin git-diff-editor`: debug exe 생성
  - `src-tauri/target/x86_64-pc-windows-gnullvm/debug/git-diff-editor.exe`

## E2E

- `cargo test --test e2e_git`: 4 passed
  - 저장소 열기, 수정 파일 읽기, 저장, 외부 변경 시 오래된 버퍼 저장 거부
  - 삭제 `D` / 미추적 `U`
  - 경로 탈출 거부
  - 혼합 줄바꿈 저장 거부
- `npx playwright test`: 2 passed (headless Chromium, Vite preview)
  - 빈 화면 → 저장소 열기 → 변경 파일 선택
  - 저장 버튼 비활성

Playwright는 화면 포커스를 빼앗지 않도록 headless로 실행함. Tauri 네이티브 창 E2E는 실행하지 않음.

- Windows GNU LLVM(`gnullvm`)에서 `cdylib`는 심볼 수 제한으로 링크 실패. bin/rlib로 빌드.
- `npx tauri dev` / GUI 실행은 하지 않음.
- 포터블 NSIS 패키지는 만들지 않음 (아이콘·WebView2·설치 UI).
- 파일 감시 스레드는 코드에 있으나 `open_repository`에 아직 연결하지 않음.
- 사이드바는 디렉터리 노드 없이 경로 목록 + 변경 우선 정렬.

## 실행에 필요한 PATH

- llvm-mingw: `%LOCALAPPDATA%/git-diff-editor-tools/llvm-mingw-20260616-ucrt-x86_64/bin`
- rustup: puccinialin cache cargo/bin
