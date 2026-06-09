# Codex Lab

로컬 Codex 실험을 GitHub와 Cloudflare Pages로 배포하기 위한 정적 테스트 허브입니다.

## 포함된 첫 산출물

- `labs/realtime-geometry-pathfinding/`: 브라우저에서 직접 실행되는 캔버스 경로찾기 실험
- `reports/vibe-coding-video-analysis/`: 바이브 코딩 수익화 영상 분석 리포트
- `blog/blogger-link-snippet.html`: Blogger 글이나 메뉴에 붙일 링크 섹션 예시

## 로컬 실행

```powershell
python -m http.server 8788 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:8788/`를 엽니다.

## GitHub + Cloudflare Pages 배포

1. 이 폴더를 GitHub 저장소로 push합니다.
2. Cloudflare Dashboard에서 `Workers & Pages` -> `Create application` -> `Pages`를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. Build command는 비워둡니다.
5. Build output directory는 `/` 또는 프로젝트 루트로 둡니다.
6. 배포 후 생성된 `https://...pages.dev/` 주소를 Blogger 글이나 메뉴에 연결합니다.

Wrangler 로그인이 되어 있으면 직접 업로드도 가능합니다.

```powershell
npx wrangler pages deploy . --project-name codex-lab
```

현재 환경에서는 `wrangler whoami` 결과 Cloudflare 로그인이 되어 있지 않았습니다.
