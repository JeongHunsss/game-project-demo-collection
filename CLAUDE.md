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
  README.md    # 필수. 아래 '게임 README 규칙'을 따른다
```

- 순수 HTML/CSS/JS를 쓰고 빌드 단계를 두지 않는다. `index.html`을 더블클릭해서 바로 실행되어야 한다.
- `<script type="module">`은 쓰지 않는다. `file://`에서 막힌다. 일반 `<script>`와 IIFE를 쓰고, 파일 간 공유는 `window.X`로 한다. 외부 ES 모듈 라이브러리는 함수 안에서 `await import(url)`로 불러온다.
- 외부 리소스는 jsdelivr 같은 CDN에서 **정확한 버전**을 고정해서 쓴다. 웹 글꼴이 없어도 게임은 돌아가야 한다.
- 화면과 설명 문구는 한국어로 쓴다.
- 기존 게임을 그대로 따라 만들지 않는다. 장르나 메커니즘만 빌려 오고 이름, 캐릭터, 연출은 새로 만든다.

## 게임 README 규칙

게임 폴더마다 `README.md`를 둔다. 처음 보는 사람이 이 파일만 읽고도 게임을 실행하고 플레이할 수 있어야 한다. 한국어로 쓰고, 아래 순서를 지킨다. 게임 동작이 바뀌면 같은 PR에서 README도 고친다.

````markdown
# <게임 이름> · <영문 이름>

<장르> · <인원(1인/2인…)> · <입력 장치(키보드/마우스/웹캠…)>

<게임 소개 2~3문장: 무엇을 하는 게임인지, 어떤 점이 재미 포인트인지>

## 실행

`index.html`을 Chrome/Edge에서 연다. (카메라 권한, 인터넷 필요 여부 같은 준비 사항이 있으면 함께 적는다)

## 조작

| 입력 | 동작 |
| --- | --- |
| ... | ... |

(입력 방식이 여러 개면 `### 키보드`, `### 손` 처럼 하위 제목으로 나눈다)

## 규칙

목표, 득점과 판정, 승리 조건, 라운드 진행 방식.

## 팁            ← 선택

## 사용한 기술    ← 선택: 외부 라이브러리와 버전, 특이한 구현
````

- 필수 섹션은 제목, 메타 줄, 소개, `## 실행`, `## 조작`, `## 규칙`이다.
- 조작은 표로 쓴다. 키 이름은 실제 키보드 표기(`A`, `Space`, `←`)를 쓴다.
- 수치(점수, 시간, 쿨다운)는 코드와 같은 값을 적는다.

## 검증 (PR 전에 반드시)

- `node --check <파일>.js`로 모든 스크립트의 문법을 확인한다.
- 핵심 로직은 Node에서 DOM을 스텁으로 대체한 시뮬레이션으로 확인한다. 예: 득점, 판정, 라운드 전환. `requestAnimationFrame`과 입력 핸들러를 가로채서 프레임을 직접 돌린다.
- 실제 화면은 헤드리스 Chrome으로 확인한다. 실행 파일 위치는 `C:/Program Files/Google/Chrome/Application/chrome.exe`이고, 옵션은 `--headless=new --remote-debugging-port`를 쓴다. CDP로 페이지를 열고 버튼을 누르고 키를 입력한 뒤 스크린샷을 찍는다. 카메라가 필요한 게임은 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`을 붙인다.
- `file://`과 `http://localhost` 두 방식으로 모두 열리는지 확인한다.
- 테스트 스크립트와 스크린샷은 저장소에 커밋하지 않는다. 임시 폴더에 둔다.
- 확인하지 못한 것은 PR 본문에 그대로 적는다. 예: 실제 웹캠, 실제 손 조작, 모바일.

## 커밋: Conventional Commits

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/ko/v1.0.0/)을 따른다.

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**

  | type | 언제 |
  | --- | --- |
  | `feat` | 새 게임, 새 기능이나 메커니즘 |
  | `fix` | 버그 수정 |
  | `docs` | README 같은 문서만 바뀜 |
  | `style` | 동작에 영향이 없는 코드 포맷 |
  | `refactor` | 동작은 같고 구조만 바뀜 |
  | `perf` | 성능 개선 |
  | `test` | 테스트 추가나 수정 |
  | `build` / `ci` | 빌드, 배포, CI 설정 |
  | `chore` | 그 밖의 저장소 관리(규칙 문서, 템플릿 등) |
- **scope**: 게임 폴더 이름(`puppet_fencing`). 저장소 공통 작업은 scope를 생략하거나 `repo`를 쓴다.
- **subject**: 한국어로 쓰고 50자 안쪽, 마침표 없이 무엇을 했는지 쓴다. 예: `feat(puppet_fencing): 엄지 패리 추가`
- **body**(선택): 한 줄을 띄우고 무엇을 왜 바꿨는지 쓴다. 목록(`-`)을 써도 된다.
- **footer**(선택): 호환이 깨지는 변경은 type 뒤에 `!`를 붙이거나 `BREAKING CHANGE: ...`를 쓴다. 이슈 연결은 `Closes #3`.
- 커밋 하나에는 논리적 변경 하나만 담는다. 게임 추가와 다른 게임 수정을 한 커밋에 섞지 않는다.

## PR

- PR 제목: `[<게임 이름>] 요약` (예: `[마리오네트 펜싱] 손가락 인식 2인 펜싱 게임 추가`)
- PR 본문은 `.github/pull_request_template.md`를 따른다.
