# Git Diff Editor

Windows용 HEAD vs 작업 트리 비교·편집 도구 (Tauri).

## 개발

```
npm install
cd src-tauri && cargo test
npm test
```

앱 실행은 `npx tauri dev`입니다.

## 배포본 (Windows x64)

GitHub Releases에서 다음 파일을 제공합니다.

- `Git.Diff.Editor_<version>_x64-setup.exe` — NSIS 설치본
- `GitDiffEditor-<version>-windows-x64-portable.zip` — 포터블 실행본

## 자동 릴리즈

`master` 브랜치에 push되면 GitHub Actions가 자동으로:

1. 프런트엔드/Rust 테스트
2. Windows x64 빌드
3. 설치형 EXE와 portable ZIP 생성
4. GitHub Release 생성

을 수행합니다.

소스 기준 버전은 `0.2.0`이며, 기존 Release가 이 버전 이상이면 이후 master push마다 patch 버전을 자동 증가시킵니다.
예: `v0.2.0 → v0.2.1 → v0.2.2`.
