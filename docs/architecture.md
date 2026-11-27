# Architecture

| Boundary | Implementation |
| --- | --- |
| Browser shell and navigation | [React entry point](../src/main.tsx), [app composition](../src/App.tsx), [URL and legacy hash parsing](../src/navigation.ts), [page metadata](../src/pageMetadata.mts), [preferences and locales](../src/preferences.ts) |
| Browser and Node data exchange | [Vite proxy](../vite.config.mts), [directory provider](../src/ServerDirectoryProvider.tsx), [public WebSocket messages](../src/liveUpdates.mts), [Node route dispatch](../server/index.mts) |
| Node and WebCraft | [Instance config parser](../server/instances.mts), [server directory](../server/serverDirectory.mts), [live update subscriptions](../server/liveUpdates.mts), [player/progress feeds](players.md) |
| Published data | [Import entry point](../scripts/import-items.mjs), [catalog serving](../server/itemCatalog.mts), [recipe uses](../server/itemRecipeUses.mts), [Ponder storage](../server/ponderStorage.mts) |
| Access and identity | [Clerk account endpoint](../server/accounts.mts), [local equipment allowlist](../server/localEquipment.mts), [sign-in and linking](account-sign-in.md) |
| Offline and render failures | [Vite fallback build](../scripts/offline-page.mts), [service worker](../offline/service-worker.js), [shared fallback React page](../offline/FallbackPage.tsx) |

In production Caddy serves the built site and proxies its public routes to the Node API on loopback. Vite provides equivalent API access for local development. Keep browser requests on the Capycraft origin, keep browser and Node releases aligned for shared message formats, and check both the Vite routes and [Caddy routes](deployment.md#caddy-routes) when changing a public entry point. Keep legacy paths and archive formats working where the current contract supports them.

The Node API reads private WebCraft feeds and publishes only the intended fields. It stores player history, cached server data, and account links in SQLite. Keep WebCraft secrets and UUIDs server-side, preserve stable instance aliases and production state across releases, and apply the domain constraints in the [account](account-sign-in.md), [local equipment](local-equipment.md), and [catalog storage](catalog-publishing.md#catalog-and-sensitive-data-storage) guides. Public catalog content can be published independently of the frontend build.

The source owns route definitions, message fields, defaults, and size limits. Read the relevant implementation and tests for exact contracts.
