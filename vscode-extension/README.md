# Git Diff Editor for VS Code

현재 저장소의 standalone Git Diff Editor를 VS Code Extension으로 포팅한 브랜치입니다.

## 핵심 UX

- 현재 VS Code workspace의 Git 저장소를 자동 감지
- HEAD 원본과 Working Tree를 좌우에 독립된 Monaco editor로 표시
- diff 정렬용 synthetic blank row를 삽입하지 않음
- 좌측 삭제/수정, 우측 추가/수정 강조
- 변경 파일 탐색, F7/F8 hunk 이동
- 우측 직접 편집 후 명시적 저장
- 외부 파일 변경 자동 반영

## 개발

```bash
cd vscode-extension
npm install
npm run build
```

VS Code에서 이 폴더를 연 뒤 Extension Development Host로 실행하고
명령 팔레트에서 `Git Diff Editor: Open Review`를 실행합니다.

## 구조

- `src/extension.ts`: extension activation / webview lifecycle
- `src/repository.ts`: Git snapshot, HEAD blob, working-tree IO
- `src/protocol.ts`: extension ↔ webview 메시지 타입
- `webview/`: React + Monaco 기반 review UI

VS Code 기본 diff editor는 사용하지 않습니다.
