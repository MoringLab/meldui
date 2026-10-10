# Engine

React 웹, React Native·Expo, Flutter에서 같은 A2UI 메시지를 표시하는 생성형 UI SDK입니다. 두 디자인 킷을 바꿔도 입력 상태가 유지되며, 계산·탭·입력 상호작용은 모델 호출 없이 실행됩니다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm schemas
# 서버 환경변수에 OMNIROUTE_API_KEY 설정
pnpm dev
```

웹: http://127.0.0.1:5173. 모델 없이 30개 리플레이 예제를 실행할 수 있습니다. 실시간 생성은 로컬 OmniRoute를 사용하는 서버(8787)에 연결합니다. 게이트웨이 키는 앱에 포함하지 않습니다.

Android 앱은 `adb reverse tcp:8787 tcp:8787` 후 실행하세요. Flutter 앱은 `apps/flutter`에서 `flutter run`, Expo 앱은 `apps/expo-lab`에서 `pnpm android`로 실행합니다.

A2UI v0.9.1의 제한된 호환 프로파일과 자체 카탈로그를 사용합니다. 표준 A2UI 기본 카탈로그 전체를 지원한다고 주장하지 않습니다. 사용자 입력과 충돌하는 모델 업데이트는 적용하지 않고 진단을 남깁니다.

구체적인 API와 확장법은 [영문 README](README.md), 진행 상태와 검증 범위는 [STATUS](docs/STATUS.md)를 확인하세요. 공개 패키지명은 아직 확정되지 않았으며, 샌드박스와 데스크톱은 후속 범위입니다.

[Android 실제 입력·킷 전환 영상](docs/media/android-demo.mp4)과 [검증 보고서](docs/verification/REPORT.md)를 확인하세요. 현재는 private 프리뷰입니다. 네이티브 p95와 모델 첫 생성 성공률은 출시 목표에 아직 미달하며, iOS 검증과 공개 소유권 확정도 남아 있습니다.
