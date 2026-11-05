# 따붕 공용 저장소

GitHub Pages 정적 사이트에서 공용 붕어를 저장·조회·삭제할 수 있도록 Cloudflare Worker와 D1을 연결합니다.

- Worker: `https://ttabung-fish-api.mina1379.workers.dev`
- D1: `ttabung-public-fish` (APAC)
- 브라우저 API 주소는 `index.html`의 `ttabung-api` 메타 태그에 설정되어 있습니다.
- 관리자 비밀번호는 Worker secret으로 설정되어 있으며 소스 파일에는 포함하지 않습니다.

## 배포 갱신

`cloudflare` 폴더에서 `npx wrangler@latest deploy`를 실행합니다. 데이터베이스 구조를 바꿀 때는 `npx wrangler@latest d1 migrations apply ttabung-public-fish --remote`를 먼저 실행합니다. GitHub Pages는 저장소의 기존 배포 절차로 `index.html`을 갱신합니다.

로컬 개발용 `cloudflare/.dev.vars`는 `.gitignore`에 제외되어 있습니다. 운영 비밀번호 변경은 `npx wrangler@latest secret put ADMIN_PASSWORD`로 새 secret을 설정합니다.

Worker는 GitHub Pages 도메인에서 오는 브라우저 요청만 허용합니다. 저장은 IP별 시간당 8건, 관리자 삭제 검증은 IP별 10분당 5회로 제한합니다.
