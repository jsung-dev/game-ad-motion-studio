# 게임 광고 영상 스튜디오 MVP

기존 MP4에 배경 없는 텍스트·PNG 그래픽과 프레임 기반 모션을 직접 합성해 선택한 화면 비율의 MP4로 출력하는 MVP입니다. 메인 화면은 `/`, 영상 API는 `/api/video-ad/*`에서 제공합니다.

## 실행 환경

- Node.js 20 이상 (개발·검증 환경: Node.js 24.20.0)
- pnpm (개발·검증 환경: pnpm 12.0.0)
- Windows, macOS 또는 Linux의 로컬 파일 시스템
- Chromium을 실행할 수 있는 환경. Remotion renderer가 첫 렌더에서 호환 브라우저를 준비할 수 있습니다.
- 시스템 FFmpeg 설치는 필수가 아닙니다. `ffmpeg-static`과 `ffprobe-static`을 프로젝트 의존성으로 사용합니다.

주요 버전은 `remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler` 모두 `4.0.523`으로 통일했습니다. UI와 서버는 Next.js 15 + TypeScript입니다.

## 설치와 실행

```bash
pnpm install
```

터미널 1에서 웹 서버를 실행합니다.

```bash
pnpm dev
```

터미널 2에서 렌더 워커를 실행합니다.

```bash
pnpm worker
```

브라우저에서 <http://localhost:3000>을 엽니다. 기존 북마크를 위한 <http://localhost:3000/video-ad> 경로도 유지됩니다. 워커는 작업을 한 번에 하나씩 처리합니다. 대기 작업 하나만 처리하고 종료하려면 `pnpm worker:once`를 사용할 수 있습니다.

## 로컬 다중 컷 조립 테스트

<http://localhost:3000/cut-editor-test>에서는 기존 영상 스튜디오와 별개로 여러 로컬 MP4를 순서대로 조립해 볼 수 있습니다.

- 여러 MP4 컷 추가, 순서 변경, 삭제
- 컷별 새 MP4 교체(향후 개별 재생성 결과 교체 흐름)
- 전체 재생 시간 기준 연속 재생과 탐색
- 컷별 투명 PNG 추가, 드래그 이동, 비율 유지 크기 조절
- 컷 내부 시작·종료 시간과 `none`, `pop`, `slideUp` 모션
- `clips[]`, `overlays[]` 기반 상태 관리

이 화면의 MP4와 PNG는 `URL.createObjectURL`로 브라우저 메모리에서만 사용합니다. 서버와 Supabase Storage에는 전송하지 않으며, 교체·삭제·화면 종료 시 Object URL을 해제합니다. 새로고침하면 작업 내용도 초기화됩니다. 최종 MP4 출력은 이 테스트 화면의 범위에 포함되지 않습니다.

프로덕션 모드의 로컬 실행은 다음과 같습니다.

```bash
pnpm build
pnpm start
pnpm worker
```

웹 서버가 3000번이 아닌 다른 주소에서 실행된다면 서버와 워커에 같은 값을 지정합니다.

```bash
VIDEO_AD_RENDER_ORIGIN=http://127.0.0.1:4000 pnpm dev
VIDEO_AD_RENDER_ORIGIN=http://127.0.0.1:4000 pnpm worker
```

PowerShell에서는 `$env:VIDEO_AD_RENDER_ORIGIN="http://127.0.0.1:4000"`으로 먼저 지정합니다.

Vercel 배포에서는 함수의 4.5MB 요청 제한을 피하도록 브라우저가 비공개 Supabase Storage에 직접 업로드합니다. 다음 환경 변수가 필요합니다.

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
NEXT_PUBLIC_VIDEO_STORAGE_MODE=supabase
```

`SUPABASE_SECRET_KEY`는 서버 전용이며 `NEXT_PUBLIC_` 접두사를 붙이면 안 됩니다. 현재 연결된 Supabase 무료 프로젝트의 객체 한도에 맞춰 웹 배포 업로드는 최대 50MB이고, 로컬 업로드는 기존대로 최대 100MB입니다.

배포된 업로드 경로만 실제 점검하려면 위 환경 변수를 셸에 설정한 뒤 다음처럼 실행합니다. 테스트 MP4와 Storage 객체는 점검 직후 자동 삭제됩니다.

```bash
VIDEO_AD_CLOUD_TEST_ORIGIN=https://game-ad-motion-studio.vercel.app pnpm test:cloud-upload
```

## 사용 방법

1. MP4를 선택하거나 드롭합니다. 서버의 ffprobe가 실제 MP4 여부, 업로드 크기 제한, 30초 제한을 확인합니다.
2. 직접 문구를 추가하거나 `PNG 글자 추가`로 투명 PNG 카피를 업로드합니다. PNG 카피는 시간, 모션, 크기, 가로·세로 위치와 그림자를 편집할 수 있습니다.
3. Remotion Player에서 재생·일시정지·탐색하며 결과를 확인합니다.
4. `1:1`, `21:9`, `16:9`, `4:3`, `3:4`, `9:16` 중 영상 비율을 선택합니다.
5. 원본 영상을 `화면 꽉 채우기` 또는 `영상 전체 보기` 방식으로 맞춥니다.
6. `최종 영상 만들기`를 누르고 워커가 완료하면 MP4를 다운로드합니다.

렌더 요청 시 문구와 출력 설정의 복사본이 작업 폴더에 저장되므로 렌더 도중 편집한 값은 이미 시작한 결과에 섞이지 않습니다. 마지막 작업 ID는 브라우저 localStorage에 남아 새로고침 후에도 상태를 다시 조회합니다. 죽은 워커의 PID가 확인되면 오래된 `rendering` 작업은 실패로 전환되어 재시도할 수 있습니다.

## 출력 규격

- 비율별 해상도: 1:1 720×720, 21:9 1260×540, 16:9 1280×720, 4:3 960×720, 3:4 720×960, 9:16 720×1280
- 30fps, MP4/H.264, yuv420p
- 오디오 입력: AAC로 유지
- 무음 입력: 오디오 트랙 없이 정상 출력
- 길이: `round(원본 초 × 30)` 프레임. AAC 패딩은 마지막에 무손실 트림합니다.
- 텍스트와 투명 PNG 카피는 영상 위에 직접 합성하며, 미리보기와 최종 출력 모두 [`remotion/AdComposition.tsx`](remotion/AdComposition.tsx)를 사용합니다.
- PNG 카피는 최대 10MB, 가로·세로 4096px까지 지원하며 실제 PNG 시그니처와 IHDR 크기를 검사합니다.
- Noto Sans KR 900 로컬 서브셋을 미리보기와 렌더러가 함께 사용합니다. 라이선스 전문은 [`licenses/NotoSansKR-OFL.txt`](licenses/NotoSansKR-OFL.txt)에 있습니다.

## 테스트

먼저 프로덕션 빌드를 만든 뒤 E2E 테스트를 실행합니다. 3100번 포트가 비어 있어야 합니다.

```bash
pnpm build
pnpm test:video-ad
```

테스트는 3초 가로 영상 두 개(오디오 포함/무음)를 FFmpeg로 생성하고 아래 흐름을 실제 수행합니다.

- 업로드 API와 ffprobe 메타데이터 확인
- 팝업, 슬라이드 업, 페이드 및 한글 줄바꿈 문구 렌더
- PNG 카피 업로드, 알파 채널, 위치·크기·팝업 모션 및 실제 출력 픽셀 차이 확인
- 작업 생성·상태 조회·다운로드 API 확인
- 화면 꽉 채우기 9:16 + 오디오, 영상 전체 보기 16:9 + 무음 출력
- 720×1280 및 1280×720, 30fps, H.264, yuv420p, AAC, 90프레임 및 재생 가능 여부 확인
- 등장·유지·퇴장 프레임과 contain 배치 프레임 추출

결과는 `test-artifacts/video-ad/report.json`, 출력 MP4 두 개, 추출 PNG에 남습니다. 2026-09-14 로컬 검증에서 두 출력 모두 90프레임으로 디코딩되었고 오디오 결과의 컨테이너 길이는 AAC 패딩을 포함해 3.008초(한 프레임 이내), 무음 결과는 3.000초였습니다.

## 파일 저장과 정리

```text
data/video-ad/uploads/<asset-id>/input.mp4
data/video-ad/uploads/<asset-id>/asset.json
data/video-ad/graphics/<graphic-id>/input.png
data/video-ad/graphics/<graphic-id>/graphic.json
data/video-ad/jobs/<job-id>/job.json
data/video-ad/jobs/<job-id>/output.mp4
```

사용자 파일명은 메타데이터 표시용으로만 보관하고 서버 경로에는 사용하지 않습니다. 영상·PNG 업로드, 작업, 출력, 테스트 산출물은 Git에서 제외됩니다. 완료 파일은 자동 삭제하지 않습니다.

7일보다 오래된 완료·실패 작업과 업로드 폴더를 정리하려면 다음 명령을 사용합니다. 대기·렌더링 중인 작업은 삭제하지 않습니다.

```bash
pnpm cleanup:video-ad -- --days=7
```

## 현재 제한

- 로컬 렌더링은 단일 사용자·단일 워커 테스트용입니다. 로그인과 결제는 없습니다.
- Vercel에서는 영상·PNG 입력을 Supabase Storage에 보관하고 미리보기까지 지원합니다. 클라우드 최종 렌더링은 Remotion Lambda 연결 전이므로 아직 로컬 워커를 사용해야 합니다.
- 웹 배포 영상 업로드 한도는 현재 Supabase 프로젝트 제한에 맞춘 50MB이며, 로컬은 100MB입니다.
- 웹 서버와 렌더 워커를 함께 실행해야 합니다. 워커가 꺼져 있으면 작업은 `대기` 상태로 유지됩니다.
- 텍스트 넘침 안내는 안전 영역 기준 추정치이며 최종 판단은 같은 composition을 사용하는 미리보기에서 확인합니다.
