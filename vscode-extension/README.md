# Git Diff Editor for VS Code

현재 저장소의 standalone Git Diff Editor를 VS Code Extension으로 포팅한 버전입니다.

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

VS Code에서 이 폴더를 연 뒤 `F5`로 Extension Development Host를 실행하고,
명령 팔레트에서 `Git Diff Editor: Open Review`를 실행합니다.

## VSIX 직접 설치 패키지 만들기

Marketplace에 올리지 않고 다른 PC에 직접 설치하려면:

```bash
cd vscode-extension
npm install
npm run package:vsix
```

생성 파일:

```text
vscode-extension/release/git-diff-editor-vscode-0.1.0.vsix
```

다른 PC에서 설치하는 방법:

### VS Code 화면에서

```text
Extensions
→ 우측 상단 ...
→ Install from VSIX...
→ git-diff-editor-vscode-0.1.0.vsix 선택
```

### 명령어로

```bash
code --install-extension git-diff-editor-vscode-0.1.0.vsix
```

설치 후 VS Code를 열고 명령 팔레트에서:

```text
Git Diff Editor: Open Review
```

를 실행합니다.

## 구조

- `src/extension.ts`: extension activation / webview lifecycle
- `src/repository.ts`: Git snapshot, HEAD blob, working-tree IO
- `src/protocol.ts`: extension ↔ webview 메시지 타입
- `webview/`: React + Monaco 기반 review UI

VS Code 기본 diff editor는 사용하지 않습니다.
