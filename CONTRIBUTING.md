# Contributing

Thanks for helping! Issues and pull requests are welcome in English or Japanese.
日本語での Issue / Pull Request も歓迎します。

## Getting started

```bash
npm ci
python3 -m venv .venv && .venv/bin/pip install -r server/requirements-dev.txt
ROOM_SETUP_MOCK_ENGINE=1 npm run api   # terminal 1: gateway with the no-GPU mock engine
npm run dev                            # terminal 2
```

Read [docs/development.md](docs/development.md) for the code layout and conventions.

## Before opening a pull request

```bash
npm test             # unit tests
npm run test:api     # gateway tests
npm run test:ui      # headless browser smoke test (with the two servers above running)
npm run build
```

- Add both Japanese and English text for any new UI string.
- Keep saved projects working: don't rename texture preset ids or project fields; bump `VERSION` in `src/project/format.js` and keep reading older files if the format must change.
- If you touch an engine module, say which GPU, driver and upstream commit you tested with.

## Please don't commit

- `.env`, logs, or anything from `generated/`
- Photos of real homes or people, or models generated from them
- Model weights or upstream engine source code
- Machine-specific paths, user names or other personal details

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
