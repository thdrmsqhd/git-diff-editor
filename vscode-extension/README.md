# Git Diff Editor for VS Code

standalone Git Diff Editor의 핵심 UX를 VS Code Webview Extension으로 포팅한 버전입니다.

## 핵심 UX

- 현재 VS Code workspace의 Git 저장소 자동 감지
- HEAD 원본과 Working Tree를 독립된 Monaco editor로 표시
- diff 정렬용 synthetic blank row를 삽입하지 않고 실제 줄 구조 유지
- 좌측 삭제 / 우측 추가 / 수정 문자 단위 강조
- 현재 hunk 양쪽 강조 및 실제 줄 위치 기반 연결선
- 폴더 계층 파일 트리와 접기/펼치기
- 사이드바 너비 조절
- 파일별 `-삭제/+추가` 변경량
- Reviewed 체크와 변경 파일 검토 진행률
- Breadcrumb 경로 표시
- hunk anchor 보간 기반 완화형 좌우 스크롤 동기화
- 외부 파일 변경 자동 반영
- 우측 직접 편집 후 명시적 저장

## 적용된 UX 항목

| ID | 항목 |
| --- | --- |
| UX-003 | 현재 선택된 hunk 강조 |
| UX-004 | 좌우 hunk 연결선 |
| UX-005 | 문자 단위 diff 강조 |
| UX-006 | 폴더 계층 파일 트리 |
| UX-007 | 폴더 접기/펼치기 |
| UX-008 | 사이드바 너비 리사이즈 |
| UX-010 | 파일별 +N / -N 변경량 |
| UX-011 | Reviewed 체크 상태 |
| UX-012 | 전체 변경 파일 검토 진행률 |
| UX-013 | Alt+F7/F8 이전/다음 변경 파일 |
| UX-015 | 파일 경로 Breadcrumb |
| UX-016 | hunk 기준 완화형 스크롤 싱크 |

## 단축키

- `F7`: 이전 변경 hunk
- `F8`: 다음 변경 hunk
- `Alt+F7`: 이전 변경 파일
- `Alt+F8`: 다음 변경 파일
- `Ctrl+S`: Working Tree 편집 저장
- `Scroll Sync`: 좌우 편집기 스크롤 동기화 ON/OFF (기본 ON)

## 개발

```bash
cd vscode-extension
npm install
npm run build
```

VS Code에서 이 폴더를 연 뒤 `F5`로 Extension Development Host를 실행하고,
명령 팔레트에서 `Git Diff Editor: Open Review`를 실행합니다.

## VSIX 직접 설치 패키지 만들기

```bash
cd vscode-extension
npm install
npm run package:vsix
```

생성 파일:

```text
vscode-extension/release/git-diff-editor-vscode-0.1.0.vsix
```

다른 PC:

```bash
code --install-extension git-diff-editor-vscode-0.1.0.vsix
```

또는 VS Code의 `Extensions → ... → Install from VSIX...`를 사용합니다.

## 구조

- `src/extension.ts`: extension activation / webview lifecycle
- `src/repository.ts`: Git snapshot, HEAD blob, working-tree IO, 파일별 변경량
- `src/protocol.ts`: extension ↔ webview 메시지
- `webview/App.tsx`: 리뷰 화면 및 탐색/Reviewed 상태
- `webview/diff.ts`: 줄/문자 diff와 hunk 계산
- `webview/FileTree.tsx`: 폴더 계층 탐색
- `webview/EditorPane.tsx`: Monaco 렌더링 및 hunk 위치 정보

VS Code 기본 diff editor는 사용하지 않습니다.
