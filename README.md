# Git Diff Editor

Windows용 HEAD vs 작업 트리 비교·편집 도구 (Tauri).

## 개발

Rust GNU LLVM 툴체인과 llvm-mingw가 PATH에 있어야 합니다.

```
npm install
cd src-tauri && cargo test
npm test
```

앱 실행은 `npx tauri dev`이며 사용자 화면 포커스를 빼앗을 수 있어 기본 검증은 테스트로 수행합니다.

## 배포본 (Windows x64)

`release/` 폴더:

- `Git Diff Editor.exe` — 포터블. 같은 폴더의 `WebView2Loader.dll`, `libunwind.dll`과 함께 복사
- `Git Diff Editor_0.1.0_x64-setup.exe` — NSIS 설치본 (현재 사용자)
