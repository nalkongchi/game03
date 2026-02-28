# 마법사 수련생 아카데미 리팩터링본

## 파일 구성
- `index.html`: 화면 구조
- `style.css`: 스타일
- `data.js`: 게임 데이터/상수
- `game.js`: 게임 로직

## 반영한 개선점
1. 저장 데이터 로드 시 손상 데이터 방어(`try/catch`)
2. 사용자 이름 렌더링 시 `innerHTML` 대신 안전한 DOM 생성
3. 인라인 `onclick` 제거, `data-action` + 이벤트 위임으로 통일
4. 모달 접근성 보강(Esc 닫기, 포커스 트랩, role/aria)
5. 상/하단 고정 UI 높이를 JS로 계산해 패딩 자동 반영
6. BGM 자동재생/중복 재생 시도 로직 단순화
7. 단일 HTML → 분리 파일 구조로 정리
8. `renderAll()` / `setTab()` 중복 저장 제거
