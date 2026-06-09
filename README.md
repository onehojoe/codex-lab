# Automation Lab

Public site: https://onehojoe.github.io/codex-lab/

Direct lab: https://onehojoe.github.io/codex-lab/labs/realtime-geometry-pathfinding/

Automation Lab is a static publishing hub for runnable automation experiments, visual previews, and analysis reports.

## Current Contents

- `labs/realtime-geometry-pathfinding/`: canvas-based pathfinding automation experiment
- `reports/vibe-coding-video-analysis/`: video analysis report
- `blog/blogger-link-snippet.html`: Blogger-ready link block with image preview

## Local Preview

```powershell
python -m http.server 8788 --bind 127.0.0.1
```

Open `http://127.0.0.1:8788/`.

## Deployment

This folder is ready for GitHub Pages or Cloudflare Pages as a static site.

For Cloudflare Pages:

1. Push this folder to GitHub.
2. In Cloudflare, create a Pages project from the GitHub repository.
3. Leave the build command empty.
4. Use `/` or the project root as the output directory.
5. Connect the final public URL from Blogger posts or menus.

Wrangler direct deploy is also possible after Cloudflare login:

```powershell
npx wrangler pages deploy . --project-name codex-lab
```
