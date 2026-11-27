# WebCraft instances

## Instance configuration

The Node API creates `data/instances/` on startup. Create a directory for each instance inside it and add a `server.json`. By default, its directory name serves as the alias. Set `alias` in `server.json` to use a stable alias with a different directory name. Use lowercase letters, digits, and hyphens in the alias. Keep it stable when the server moves so bookmarks, stored information, and imported catalogs continue using the same identifier. For example, `data/instances/Universum Server/server.json` can contain the following for a WebCraft listener on the same machine.

```json
{
  "alias": "universum",
  "webcraftUrl": "http://127.0.0.1:8765",
  "tokenEnv": "WEBCRAFT_UNIVERSUM_TOKEN"
}
```

`webcraftUrl` is the HTTP or HTTPS origin that Capycraft contacts. Set the public server name, Minecraft join address, and fields such as the server icon in WebCraft's **Server information** configuration. Enable WebCraft's HTTP listener and the server information and status feeds. The example reads public information and internal status. Set `infoExposure` or `statusExposure` to `public` or `internal` to match the WebCraft settings. Without `tokenEnv`, both feeds default to public. For an internal feed, set the named environment variable in the Node service or `.env.local` to the same machine token WebCraft uses. Keep the instance directory and tokens outside the public web root. On one machine, the WebCraft listener can bind to the loopback address.

The optional `tabs` array controls the configured sections. It defaults to `items` and `players` in that order. Achievements and Quests use the player profile and require the matching instance settings. Ponder opens from published items. See [the instance parser](../server/instances.mts) for accepted keys and legacy values. When there are no instance definitions, the default `universum` entry keeps the existing local catalog and player routes available. Set `CAPYCRAFT_INSTANCE_DIR` to use another private directory. The Node API reads instance definitions at startup.

Set `"directoryTransport": "websocket"` in an instance's `server.json` to subscribe to its WebCraft information and status feeds. Both feeds must allow WebSocket access. In WebCraft, use `BOTH` or `WEBSOCKET` as the effective transport for each feed. The Node API uses the configured exposure for each subscription, sends the machine token only to the internal WebCraft endpoint, and resubscribes for fresh snapshots after disconnects. The default `"http"` checks both feeds on startup and about once a minute. This setting applies to the server directory. Player history still uses its own HTTP requests.

## Server directory

The overview shows configured instances by alias while waiting for their first WebCraft response. An instance becomes selectable after its first usable server information response. A published Items catalog or a configured live Players, Achievements, or Quests tab also makes the instance selectable while its information feed is unavailable. See [catalog publishing](catalog-publishing.md#live-publication) for import status.

Capycraft keeps the last successful server information and time of contact in the SQLite database used for player history. During a later outage the card shows the cached name, icon, join address, player limit, accumulated time online, and world playtime when available. The Players statistic shows the current count while online and the last known count during an outage when available. The status tooltip includes the last known connection time during the outage.

The card shows the server message under its name and a colored status dot with a label on hover, focus, or tap. When WebCraft reports the instance ready, the card displays the available player count and limit, accumulated time online and world playtime as inline statistics that wrap on narrow screens. The card and header picker show the server icon when WebCraft supplies one. Capycraft requests `iconFormat=webp` when reading `server-info` and accepts a PNG or WebP base64 data URL in `serverIcon`, up to 96,000 characters. The card enables copying when an address is available. Click the card title to select that instance in the header. Home shows a compact, scrollable list of online names, Minecraft avatars, and connection indicators inside the selected server card when the instance has a Players tab, or inside the first card with a Players tab when no server is selected. The list uses two columns when space permits. Click a name to open that player's details in Players.

## Directory transport to the browser

The browser requests an initial public directory from `GET /api/servers` and opens `/api/live` on the same Capycraft origin. Vite proxies both paths locally. Use the [Caddy routes](deployment.md#caddy-routes) in production.

Total time online uses WebCraft's `totalUptimeSeconds` to show accumulated time across sessions. It excludes downtime and displays the last reported total during an outage. Feeds that only provide session uptime show it under Uptime while the instance is ready. Uptime uses hours and minutes below one day and days and hours from one day onward. World playtime uses WebCraft's `worldGameTimeTicks` with `publishWorldAge` enabled. The card displays completed tenths of a Minecraft day at 24,000 ticks per game day and retains the last reported value during an outage. Feeds without the tick counter omit the card's world playtime statistic.

The server card also displays one-minute TPS, mean MSPT, and p95 MSPT when Spark measurements are available in WebCraft's server information feed. Enable `publishSparkMetrics` in the Minecraft instance's `webcraft-server-info.toml`. Capycraft displays the measurements only while the instance is ready and the information feed is available.

Each socket gets a fresh directory snapshot when it subscribes. The browser applies subsequent patches to that snapshot and reconnects if a patch is invalid. The [directory update contract](../src/directoryUpdates.mts) and [server patch producer](../server/directoryUpdates.mts) define the frames and comparison rules. Display-equivalent uptime and world playtime changes and a healthy server's last-contact timestamp alone do not trigger a frame. The HTTP directory includes exact values.

Deploy the frontend and Node API from the same revision for this protocol. Node requests delta subscriptions upstream only when the WebCraft upgrade advertises `X-WebCraft-Subscription-Updates: delta`. It continues accepting full snapshots and updates from older WebCraft versions.

## First deployment without Minecraft instances

Home shows the Discord invite, Capybara facts, and the player dashboard preview even without the Node API. With an empty server directory, the Server overview panel stays visible and reports that no servers are configured. The header shows the server picker when at least one instance can be selected. The API also lists the legacy default server on installations that already have its catalog or player feed.
