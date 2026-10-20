# game-project-demo-collection

아이디어가 떠오를 때마다 만드는 작은 브라우저 게임 모음입니다. 게임 하나가 폴더 하나이고, 게임마다 브랜치와 PR이 따로 있습니다.

## 작업 흐름: 게임 하나 = 브랜치 하나 = PR 하나

1. 최신 `main`에서 브랜치를 만든다.
   ```
   git switch main && git pull --ff-only
   git switch -c game/<kebab-name>
   ```
   - 새 게임: `game/<kebab-name>` (예: `game/puppet-fencing`)
   - 기존 게임 수정: 같은 이름 규칙으로 새 브랜치를 만든다. 열려 있는 PR이 있으면 그 브랜치에 이어서 커밋한다.
   - 게임이 아닌 저장소 공통 작업(이 파일, 루트 README 형식, 템플릿): `chore/<kebab-name>`
2. 그 게임 폴더(`<snake_name>/`) 안에서만 작업한다. 다른 게임 폴더는 건드리지 않는다.
3. 루트 `README.md`의 게임 목록에 한 줄을 추가하거나 고친다. 같은 PR에 넣는다.
4. 아래 **검증**을 마친 뒤 커밋하고 푸시하고 PR을 연다.
   ```
   git push -u origin game/<kebab-name>
   gh pr create --base main --fill-first   # 본문은 .github/pull_request_template.md 형식으로 채운다
   ```
5. `main`에 직접 커밋하거나 푸시하지 않는다. 머지는 사용자가 한다.

커밋, 푸시, PR 생성은 외부에 공개되는 작업입니다. 사용자가 요청했을 때만 합니다.

## 폴더 규칙

```
<snake_name>/
  index.html   # 진입점
  style.css
  game.js      # 게임 로직 (필요하면 tracker.js 같은 파일로 나눈다)
  README.md    # 한국어: 소개, 실행 방법, 조작, 규칙
```

- 순수 HTML/CSS/JS를 쓰고 빌드 단계를 두지 않는다. `index.html`을 더블클릭해서 바로 실행되어야 한다.
- `<script type="module">`은 쓰지 않는다. `file://`에서 막힌다. 일반 `<script>`와 IIFE를 쓰고, 파일 간 공유는 `window.X`로 한다. 외부 ES 모듈 라이브러리는 함수 안에서 `await import(url)`로 불러온다.
- 외부 리소스는 jsdelivr 같은 CDN에서 **정확한 버전**을 고정해서 쓴다. 웹 글꼴이 없어도 게임은 돌아가야 한다.
- 화면과 설명 문구는 한국어로 쓴다.
- 기존 게임을 그대로 따라 만들지 않는다. 장르나 메커니즘만 빌려 오고 이름, 캐릭터, 연출은 새로 만든다.

## 검증 (PR 전에 반드시)

- `node --check <파일>.js`로 모든 스크립트의 문법을 확인한다.
- 핵심 로직은 Node에서 DOM을 스텁으로 대체한 시뮬레이션으로 확인한다. 예: 득점, 판정, 라운드 전환. `requestAnimationFrame`과 입력 핸들러를 가로채서 프레임을 직접 돌린다.
- 실제 화면은 헤드리스 Chrome으로 확인한다. 실행 파일 위치는 `C:/Program Files/Google/Chrome/Application/chrome.exe`이고, 옵션은 `--headless=new --remote-debugging-port`를 쓴다. CDP로 페이지를 열고 버튼을 누르고 키를 입력한 뒤 스크린샷을 찍는다. 카메라가 필요한 게임은 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`을 붙인다.
- `file://`과 `http://localhost` 두 방식으로 모두 열리는지 확인한다.
- 테스트 스크립트와 스크린샷은 저장소에 커밋하지 않는다. 임시 폴더에 둔다.
- 확인하지 못한 것은 PR 본문에 그대로 적는다. 예: 실제 웹캠, 실제 손 조작, 모바일.

## 커밋 / PR

- 커밋 메시지: `feat(<snake_name>): 요약` 형식으로 쓴다. 고친 경우 `fix(...)`, 공통 작업은 `chore: ...`. 본문은 한국어로 쓴다.
- PR 제목: `[<게임 이름>] 요약` (예: `[마리오네트 펜싱] 손가락 인식 2인 펜싱 게임 추가`)
- PR 본문은 `.github/pull_request_template.md`를 따른다.
