# Development and verification

## Local development

Use Node.js 20.19 or later in the 20.x line, or Node.js 22.12 or later, with npm 10 or later for the Vite client and Storybook. Use Node.js 22.18 or later for the API and Node-based tests and import tools that use SQLite. Production uses Node.js 24.15 or later in the 24 LTS line, which also avoids the experimental SQLite warning. Run commands from the project root.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The browser updates as files change. Use `Ctrl+C` to stop the dev server. Start the API separately with `npm run start:api` when the task calls for server data. Keep private overrides in the ignored `.env.local` and see the [example environment](../.env.example). Vite proxies data requests to the Node API. For the built site, use `npm run build` and `npm run preview` at `http://127.0.0.1:4173/` with the API already running.

## Verification

Apply the startup and desktop/mobile rules in [AGENTS.md](../AGENTS.md). Choose checks based on the files and behavior changed.

| Scope | Entry point |
| --- | --- |
| TypeScript and Storybook types | `npm run typecheck` |
| Targeted API or data behavior | `node --test tests/<name>.test.mts` for the relevant [test file](../tests/) |
| ATM10 browser behavior and standalone Ponder renderer | [Ponder browser regression tests](ponder.md#browser-regression-tests-for-atm10) |
| Build or static fallback output | `npm run build`, writing to `dist/` |
| Documentation | `node scripts/check-docs.mjs` and `git diff --check` |

Some API tests use loopback fixtures. Check their setup when startup permission matters. The Playwright config connects to the URL supplied by `CAPYCRAFT_E2E_URL` or the default dev address and does not start the site.

## Storybook

After installing dependencies, use `npm run storybook` at `http://127.0.0.1:6006/` or `npm.cmd run storybook -- --port 6007` if the default port is in use. Use **Language** in the preview toolbar. Its preference is separate from the site. Use **Reload story** to replay the animated winter scene. Scene and layout stories cover animated and static variants, information panels, server cards, and the empty and example server directories. Example addresses use the reserved `.example` domain. Sign-in can be left unconfigured.

`npm run build-storybook` writes `storybook-static/`. The [Storybook config](../.storybook/main.ts) controls story discovery and watch exclusions. Vite converts winter artwork to WebP for the site and Storybook and caches it under `node_modules/.cache/capycraft-scene/`. The originals stay in [assets](../assets/).

## Documentation

Start with the relevant guide in [README.md](../README.md). Link to code or config for details that change with implementation, and update the existing guide when the behavior changes. Treat plans as plans and flag conflicts with approved requirements before changing either the requirement or the implementation. Keep durable decisions with the affected guide. Archive superseded setup and non-reproducible evidence under [history](history/README.md) when Git history alone would make it hard to find.

Keep logs, captures, and reproducible reports under ignored `.local-artifacts/`. Record the result and any meaningful caveats in the task's completion summary. Run the docs check from the project root. It checks the relative inline Markdown links and heading fragments used in this repository. Review external links and protocol or setup claims against their authoritative source when changing them.
