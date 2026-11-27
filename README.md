# Capycraft Web

Capycraft Web is the public site for the Capycraft Minecraft community. It shows server status, Minecraft item catalogs and recipes, and player profiles and progress. Home includes a dashboard preview and a server leaderboard. React and Vite power the browser UI. A Node.js API connects to WebCraft and serves published data.

## Local development

The [development guide](docs/development.md#local-development) covers Node.js, setup, and verification. The [architecture map](docs/architecture.md) points to shared routes and data boundaries.

## Find the relevant guide

| Task | Guide |
| --- | --- |
| Trace architecture, callers, or dependencies | [Graphify](docs/graphify.md) |
| Change navigation, set up UI previews, or update artwork | [Site UI and artwork](docs/site-ui.md) · [Storybook](docs/development.md#storybook) |
| Configure a WebCraft server or its directory feed | [WebCraft instances](docs/webcraft-instances.md) |
| Work on players, history, achievements, quests, or equipment | [Players and progress](docs/players.md) · [Local equipment](docs/local-equipment.md) |
| Update sign-in or link Minecraft accounts | [Clerk and Minecraft linking](docs/account-sign-in.md) |
| Change catalog browsing, sharing, or recipe UI | [Items and recipes](docs/items.md) |
| Import catalogs, migrate storage, or index recipe uses | [Catalog publishing](docs/catalog-publishing.md) |
| Import or verify captured scenes and guides | [Ponder scenes](docs/ponder.md) |
| Prepare a release, configure Caddy, or roll back | [Deployment](docs/deployment.md) |
| Update project documentation | [Documentation maintenance](docs/development.md#documentation) |

The `capycraft-catalog` repository skill routes archive import, recipe-index, and Ponder work. See [AGENTS.md](AGENTS.md) for repository rules. Earlier implementations and measured import baselines are in [project history](docs/history/README.md).
