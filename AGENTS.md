# Capycraft Web repository guidance

- Use the current chat unless asked to open another. Write repository content in English and translations in their target language.
- Before editing, check the branch with `git status --short --branch` and inspect the affected diff. Preserve others' work. Before committing, stage only task files explicitly, run `git diff --check`, and review the staged diff. Report checks and limitations.
- Find the relevant guide or skill in [README.md](README.md). Search headings and symbols, read targeted sections, and reuse current findings. Keep output and polling concise. Reuse automation and delegate only when it saves work.
- Start architecture and dependency questions and complex caller tracing with [Graphify](docs/graphify.md). Use the narrowest scope, refresh stale graphs, and confirm in source. Use source directly for small changes or if Graphify is unavailable.
- Preserve the [same-origin API and private WebCraft boundary](docs/architecture.md). Keep tokens, internal feeds, and private databases out of bundles and public roots.
- Start or restart apps, servers, services, or background processes only on explicit request in this task. Use running services for relevant desktop and narrow mobile checks. When unavailable, run applicable standalone checks and report the gap.
- For images, record source and purpose and check paths, transparency, and crops. For docs, check links and implementation, label plans, and update the authoritative guide. Keep temporary reports in `.local-artifacts/` and consult [history](docs/history/README.md) for earlier designs.
- Preserve approved model and reasoning settings unless the user authorizes a change.
