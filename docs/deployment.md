# Deploy Capycraft Web

Capycraft Web can be released independently of WebCraft. Keep the production [instance definitions and feed settings](webcraft-instances.md). Keep `onlinePlayersTransport` unset for instances awaiting a compatible feed. Published catalogs and recorded player history continue to work in that configuration.

1. **Prepare the release.** Fetch the Capycraft Web repository and check out the release commit in a staging directory. Run `npm ci` and `npm run build` there to produce the matching `dist/`. Use Node.js 24.15 or later in the Node.js 24 LTS line and npm 10 or later. Check the Node binary used by the service as well as the interactive shell. If production enables sign-in, set its production `VITE_CLERK_PUBLISHABLE_KEY` before building. See [Account sign-in](account-sign-in.md#deploy-and-verify).
2. **Preserve production state.** Keep a rollback copy of the previous application release and Caddy configuration. Preserve the Node service definition, its environment or `.env.local`, `data/instances/`, `data/item-imports/`, the player SQLite database, and existing catalog directories and revision databases. Include any locations overridden through the service environment. A legacy catalog may be under `public/item-catalog/` or `dist/item-catalog/`. Keep it at the path currently read by the API. For SQLite backups, use a SQLite-aware backup or stop the service before taking a filesystem copy. Keep private files outside Caddy's static root.
3. **Prepare Caddy.** Compare the site's active routes with [Caddy routes](#caddy-routes). If the routes or static root need changes, merge them into the existing site block and validate the updated configuration with `caddy validate --config /path/to/Caddyfile --adapter caddyfile` before activating it.
4. **Activate and restart.** Use the existing service manager to stop the Capycraft Node service, activate the prepared release using the site's existing deployment mechanism, and start the service again. For an in-place deployment, copy the tracked application files and the staged `dist/` into the existing app directory while retaining the production state from step 2. For a release-directory deployment, keep production data and environment paths reachable from the new working directory. In the activated app directory, install runtime dependencies with `npm ci --omit=dev` using the release's lockfile before starting Node. The service runs `npm run start:api` from the app root and listens on `127.0.0.1:8787`. Caddy's static root and Node's `dist/index.html` must point to the same release. Reload Caddy if its configuration changed. Preserve the incoming public host for the player route so the Node equipment handler can enforce its loopback-only boundary. A published catalog can be reused immediately. The first fluid-uses request may take longer while it builds the index. Reimport only when publishing new catalog data.

## Caddy routes

Merge these handlers into the existing site block and set its `root` to the absolute path to the release's `dist/`. Retain the site's existing TLS setup and static file handler. Merge equivalent matchers to avoid duplicate routes. Place the site handlers before any unconditional catch-all in a `route` block. Caddy's `reverse_proxy` handles the WebSocket upgrade on `/api/live`.

```caddyfile
@capycraftApi path /api/account /api/servers /api/players /api/achievements /api/quests /api/ponder /api/item-search /api/item-recipe-uses /api/live /item-catalog/*
handle @capycraftApi {
  reverse_proxy 127.0.0.1:8787
}

@capycraftItemPages path_regexp capycraftItemPages ^/(server/[a-z0-9-]+/items/.+|sitemap(-items-.+)?\.xml|robots\.txt)$
handle @capycraftItemPages {
  reverse_proxy 127.0.0.1:8787
}

@capycraftPages path_regexp capycraftPages ^/((server/[a-z0-9-]+(/(items|players|achievements|quests))?|players|404)/?)?$
handle @capycraftPages {
  reverse_proxy 127.0.0.1:8787
}
```

The example uses standard Caddy. If production uses the [optional recipe cache](catalog-publishing.md#optional-shared-recipe-cache), keep that route and remove `/api/item-recipe-uses` from `@capycraftApi`. Check for `http.handlers.cache` in `caddy list-modules` before enabling the cache route.

## Verify after restart

1. Check the Node service status and startup logs. On the host, run `curl -fsS http://127.0.0.1:8787/api/servers` and confirm it returns JSON. Repeat against `/api/servers` on the public HTTPS origin and confirm the expected configured instances are present. Check the Home page for server status or last-known information as appropriate for each instance.
2. Open DevTools and reload Home. In the Network panel, confirm `/api/live` upgrades with HTTP `101` and receives a `servers` message. Open Items for a published catalog and confirm the same socket receives a `catalog` message. Verify the Home page and Items at desktop and narrow mobile widths.
3. Search for an item, open its recipe, reload its direct URL, and confirm the same recipe opens. Check that the direct response contains `og:title` and that `/sitemap.xml` returns XML. Open recipe uses and verify the catalog publication time. Check that the response has `X-Catalog-Published-At`. When the optional shared cache is enabled, repeat the same recipe-uses GET and check for a `Cache-Status` hit, `s-maxage=1800`, and the same publication timestamp.
4. For each exposed Players tab, reload its direct URL and verify that the history view loads for an instance awaiting the WebCraft update. For such an instance, `GET /api/players?server=<alias>&online=1` returns `{"status":"disabled"}`. If account sign-in is configured, check its sign-in flow on the public origin.
5. If a check fails, compare the loopback API response with the public response to distinguish a Node startup problem from a proxy or static root problem. If the release cannot pass the checks, restore the previous application release and Caddy configuration, start the previous Node service, and repeat the Home, catalog, and API checks. Keep production data in place during application rollback.
