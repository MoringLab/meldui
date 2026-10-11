# MeldUI · 멜드유아이

React 웹, React Native·Expo, Flutter용 생성형 답변 SDK입니다. Markdown·인터랙티브 화면·호스트 미디어를 섞고, 세 디자인 Kit를 바꿔도 입력값을 유지합니다. 공통 카탈로그는 50개 컴포넌트입니다.

프로젝트 이름은 MeldUI입니다. 기존 `@engine/*` 패키지명, `engine_flutter`, 앱 ID와 프로토콜·카탈로그 ID는 호환성을 위해 유지합니다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm schemas
# .env.example을 참고해 서버에만 OMNIROUTE_API_KEY 설정
pnpm dev
# 별도 터미널: 예약 서비스
pnpm --filter @engine/reservations start
```

[인터페이스 랩](http://127.0.0.1:5173) · [30개 Showcase](http://127.0.0.1:5173/showcase.html) · [SQLite 예약 앱](http://127.0.0.1:5173/reservation.html). 리플레이에는 모델이 필요 없습니다. 실제 생성은 로컬 OmniRoute를 거치며, 키는 앱에 포함하지 않습니다.

AI는 등록된 이미지 ID를 골라 스와이프 갤러리/비교/그리드를 만들고, Markdown의 왼쪽·오른쪽·위·아래에 미디어를 배치할 수 있습니다. 좁은 화면에서는 세로로 접힙니다. 이전·다음 버튼, 페이지 표시, 이미지 확대, 호스트 영상 자막·챕터도 지원합니다. 업로드·저장·서명 URL·다운로드 인증은 호스트가 담당합니다. [미디어 작성 계약](docs/hybrid/MEDIA-LAYOUT.md).

계산·슬라이더·탭·퀴즈·게임·이미지 넘기기는 모델 호출 없이 동작합니다. SVG 장면, 함수/분포 Plot, 개략 RouteMap과 11개 작성 패턴을 추가했습니다. 웹은 신뢰된 nBody/cellular/agents 시뮬레이션을 제공합니다. 모바일의 연속 재생·장면 직접 드래그·고급 Chart·시뮬레이션은 지원 범위와 대체 경로를 선언합니다. [시각화 계약](docs/VISUALS.md).

웹 샌드박스는 별도 Docker/Chromium 프로세스와 검증된 입력 브리지로 실행하는 실험 기능이며 기본 비활성화입니다. HTML 모드는 스크립트를 금지합니다. 실제 예약 저장은 모델이 만든 확인 화면이 아니라 호스트 인증·CSRF·서버 nonce·idempotency·audit로 검증합니다.

Android 두 앱은 서로 다른 앱 ID로 설치합니다. `adb reverse tcp:8787 tcp:8787` 후 사용하세요. 일반 실기기 검증과 CI는 성능 벤치마크를 실행하지 않습니다. 모델 평가에는 `--live`가 필요하고, 평가 결과는 구조·행동·수치·라우팅·학습·인프라를 구분합니다.

[현재 상태](docs/STATUS.md) · [영문 API 안내](README.md) · [Kit 커스텀](docs/KITS.md) · [배포 준비](docs/RELEASING.md). 현재는 private 프리뷰입니다. 모델의 UI 선택/의미 품질, RN p95, 인간 평가 보정, iOS, 일부 의존성 경고는 출시 게이트로 남습니다. 실제 공개 배포나 패키지 등록은 하지 않았습니다.

See [custom components, SVG compilation and code artifacts](docs/PHASE3.md) and [Phase 3 verification](docs/verification/2026-10-11-phase3/REPORT.md).
