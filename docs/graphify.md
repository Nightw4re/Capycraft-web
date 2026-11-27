# Graphify

Use Graphify for architecture, dependency, and caller tracing. For a localized change, inspect the relevant files and tests directly.

| Scope | Use |
| --- | --- |
| `capycraft-web` | Browser-to-API work, cross-boundary paths, Vite and Storybook configuration |
| `web` | React client and stories in `src/` |
| `api` | Node API and WebCraft integration in `server/` |
| `offline` | Fallback page and service worker in `offline/` |
| `tooling` | Import, build, and maintenance scripts in `scripts/` |

Run commands from the project root. Use `npm` outside Windows.

```powershell
npm.cmd run graphify -- list
npm.cmd run graphify -- explain api instances.mts
npm.cmd run graphify -- query web "server picker"
npm.cmd run graphify -- refresh api
```

Try `explain` for a known symbol and `path <scope> "<from>" "<to>"` for a specific relationship. Use the full node ID if a name is ambiguous. Inspect the relevant results and confirm them in source. Keep generated graph JSON, HTML, and reports out of routine context.

Refresh a graph when it is missing, invalid, or its indexed sources or exclusions changed. After a pull or branch switch, refresh affected scopes if their inputs changed. `refresh` without a scope updates `capycraft-web`. Reserve `refresh all` for changes that affect every scope or initial setup that needs all five. Documentation edits alone do not change code extraction.

The first refresh needs Node.js, npm, and uv. It provisions Python 3.13 and the pinned Graphify package if they are absent. Extraction is local, code-only, and uses no API key. Queries use cached tooling offline. If the package is missing from that cache, refresh once where provisioning is available or inspect source directly. To refresh with a populated cache in a disconnected environment, set `UV_OFFLINE=true` for the command environment.

Graphs and reports live under ignored `.local-artifacts/graphify/<scope>/graphify-out/`. The shared cache and installed tooling live under the same `graphify/` parent. Refresh in place and reuse those artifacts. [Exclusions](../.graphifyignore) keep private data, dependencies, lockfiles, artwork, build outputs, and generated catalogs out of the graphs.
