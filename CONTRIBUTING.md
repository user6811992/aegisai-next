# Contributing to AegisAI (next)

## Development Setup

```bash
git clone https://github.com/user6811992/aegisai-next.git
cd aegisai-next
npm install
npm run dev    # Vite dev server (proxies /api to :8080)
npm start      # Start the backend server
npm test       # Run tests
```

## Code Structure

- `server/` — Backend (Node.js, CommonJS)
- `src/` — Frontend (Preact + Tailwind, ESM via Vite)
- `tests/` — Test suite (node:test)
- `static/` — PWA manifest, service worker

## Guidelines

1. **One concept per module** — keep files focused
2. **Security first** — all file/process operations go through `server/core/security.js`
3. **No CDN loads** — all assets must be vendored/bundled
4. **Tests required** — new features need tests in `tests/`
5. **No breaking changes** — features are additive; don't remove existing functionality

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make changes with tests
4. Ensure `npm test` passes
5. Submit a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under the MIT License.