# Capycraft Web

Capycraft Web is the public site for the Capycraft Minecraft server and will also provide an information dashboard for players.

## Current state

The home page (`/`) shows a full-screen winter scene, an illustrated highlight, and square-cornered information panels. The server overview shows a card for each server in the header picker. It displays the information and status reported by WebCraft and keeps the last known server information during outages. The two corner illustrations sit above the scrolling content, and the native scrollbar stays visible beside them. The landscape and header stay in place while the information panels scroll. Below 550 px, the corner illustrations take up a larger share of the width until they reach a limit that leaves a gap between them. The player dashboard is planned.

A pixelated square fills as the browser decodes the landscape, island, and logo images. Once the images are ready, the large logo drops into the center over the blurred landscape. The dark header slides in, and the logo shrinks and moves to its left edge. After the logo settles, the navigation entries appear one at a time from left to right. The header controls slide in from right to left as the landscape comes into focus. Page content slides in and fades into view when the intro ends, or as soon as the images are ready with the intro turned off. With reduced motion enabled, the finished scene appears as soon as the images are ready. The loading screen offers a retry if an image fails to load.

[index.html](index.html) loads [src/main.tsx](src/main.tsx), which renders the home page, the Items catalog, and the Players list in the shared [WinterScene](src/scene/WinterScene.tsx). The logo in [SceneHeader](src/scene/SceneHeader.tsx) links home. Old links to the information page also open the home page. [SceneBackground and SceneIslands](src/scene/SceneBackground.tsx) render the landscape and the two island cutouts. [SceneEntrance](src/scene/SceneEntrance.tsx) waits for the images and runs the entrance animation.

The site uses paths such as `/server/universum`, `/server/universum/items`, and `/server/universum/players`. Links from earlier versions, including the `#/items` and `#/players` shortcuts, open the corresponding path and retain their catalog and recipe settings. The `/404` route shows an illustrated [404 page](src/layout/PageError.tsx). The page offers a link home. The Players view uses the same layout to show sign-in and permission messages if its API responds with 401 or 403.

[PageLayout](src/layout/PageLayout.tsx) provides a single column or a responsive grid for content such as [InfoPanel](src/layout/InfoPanel.tsx).

The [home highlight](src/layout/HomeHighlight.tsx) spans the width of the panel grid and rotates through seven Czech or English facts every 20 seconds. The text and artwork slide horizontally when the active fact changes. Original inline vector icons mark the previous and next buttons on the left and the play or pause button on the right. All three buttons keep the same size while rotation is toggled. With reduced motion enabled, rotation starts paused and manual changes are immediate. Each [fact](src/layout/homeHighlightFacts.ts) includes its own artwork setting. All seven currently use the winter capybara crop. The wildlife facts draw on [research on capybara digestion](https://link.springer.com/article/10.1007/BF00264639), [observations of cecotrophy](https://www.sciencedirect.com/science/article/abs/pii/S0168159199000805), [research on wombat droppings](https://doi.org/10.1039/D0SM01230K), and the [San Diego Zoo’s capybara profile](https://animals.sandiegozoo.org/animals/capybara).

The outline inside the play or pause button fills as the current fact's 20-second interval elapses. Pause holds the current progress until playback resumes. Selecting another fact manually resets the outline and pauses playback.

The header places the server picker after Home. Selecting a server reveals its tabs one at a time, or immediately with reduced motion. The browser tab remembers the selected server when you return to Home. Choose **Select server** in the picker to clear the selection and hide the server tabs. Shared server links use the server alias in the URL to set the selection. When you switch servers from a section the new server omits, the picker opens the new server's home page. The header shows the current language as a flag. The language menu lists English first, followed by Czech. English is the default for new visitors. A swatch grid offers all 16 Minecraft dye colors and defaults to green. The selected color accents the highlight, controls, and panel borders, with a subtler tint on panel backgrounds and text. The Intro switch controls whether the entrance plays on the next load. The browser remembers these preferences. Microsoft sign-in is optional and awaits an app registration.

## Local development

Use Node.js 20.19 or later in the 20.x series, or Node.js 22.12 or later, and npm 10 or later. Run these commands from the project root.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The browser updates automatically when you save changes. Press `Ctrl+C` to stop the server.

Run `npm run start:api` in a second terminal for the server directory, player list, and item catalog. Vite forwards these requests to the same Node API used behind Caddy, including item search and recipe uses. Use Node.js 24.15 or later in the Node.js 24 LTS line to run the API without the experimental SQLite warning.

To check the built site locally, run `npm run build` followed by `npm run preview` and open `http://127.0.0.1:4173/`. Keep the Node API running. The preview serves `dist/` and forwards the same API requests as the development server.

### Offline page

After a successful visit over HTTPS or on loopback, the service worker saves an English offline page in the browser. It embeds the existing [dragon battle backdrop](assets/dragon-battle-background.png), the [supplied electric capybara illustration](assets/capycraft-capybara-electric-transparent.webp) beside the message, and the site's [tab icon](public/favicon.png). If a page navigation fails to connect or returns HTTP 502, 503, or 504, it shows **Server offline**. **Try again** reloads the same address.

To verify it, open the site and wait for the service worker to activate in the browser's developer tools. Take the site offline and reload normally. Check the offline panel at desktop and narrow mobile widths, then restore the connection and select **Try again**.

## WebCraft instances

The Node API creates `data/instances/` on startup. Create a directory for each instance inside it and add a `server.json`. By default, its directory name serves as the alias. Set `alias` in `server.json` to use a stable alias with a different directory name. Use lowercase letters, digits, and hyphens in the alias. Keep it stable when the server moves so bookmarks, stored information, and imported catalogs continue using the same identifier. For example, `data/instances/Universum Server/server.json` can contain the following for a WebCraft listener on the same machine.

```json
{
  "alias": "universum",
  "webcraftUrl": "http://127.0.0.1:8765",
  "tokenEnv": "WEBCRAFT_UNIVERSUM_TOKEN"
}
```

`webcraftUrl` is the HTTP or HTTPS origin that Capycraft contacts. Set the public server name, Minecraft join address, and fields such as the server icon in WebCraft's **Server information** configuration. Enable WebCraft's HTTP listener and the server information and status feeds. The example reads public information and internal status. Set `infoExposure` or `statusExposure` to `public` or `internal` to match the WebCraft settings. Without `tokenEnv`, both feeds default to public. For an internal feed, set the named environment variable in the Node service or `.env.local` to the same machine token WebCraft uses. Keep the instance directory and tokens outside the public web root. On one machine, the WebCraft listener can bind to the loopback address.

The optional `tabs` array controls the order and visibility of `items` and `players`. Omitting it shows both in that order. When there are no instance definitions, the default `universum` entry keeps the existing local catalog and player routes available. Set `CAPYCRAFT_INSTANCE_DIR` to use another private directory. Restart the Node API after editing instance definitions.

Set `"directoryTransport": "websocket"` in an instance's `server.json` to subscribe to its WebCraft information and status feeds. Both feeds must allow WebSocket access. In WebCraft, use `BOTH` or `WEBSOCKET` as the effective transport for each feed. The Node API uses the configured exposure for each subscription, sends the machine token only to the internal WebCraft endpoint, and resubscribes for fresh snapshots after disconnects. The default `"http"` checks both feeds on startup and about once a minute. This setting applies to the server directory. Player history still uses its own HTTP requests.

Run `npm run start:api` to populate the overview and selector. The overview shows configured instances by alias while waiting for their first WebCraft response. An instance appears in the selector after its first server information response or when part of its Items catalog is available. An instance still waiting for WebCraft offers only Items if its configuration enables that tab. Items shows import progress and lets visitors browse items already published. Capycraft keeps the last successful server information and time of contact in the SQLite database used for player history. During a later outage the card shows the cached name, icon, join address, player limit, accumulated time online, and world age when available. The current player count shows a dash. The status tooltip includes the last known connection time during the outage. The card shows the server message under its name and a colored status dot with a label on hover, focus, or tap. When WebCraft reports the instance ready, the card displays the available player count and limit, accumulated time online and world age as inline statistics that wrap on narrow screens. The card and header picker show the server icon when WebCraft supplies one. Capycraft requests `iconFormat=webp` when reading `server-info` and accepts a PNG or WebP base64 data URL in `serverIcon`, up to 96,000 characters. The card enables copying when an address is available. Open Items from the header after selecting an instance. The browser requests an initial public directory from `GET /api/servers` and opens `/api/live` on the same Capycraft origin. The WebSocket sends the current directory on connection and sends updates as the directory changes. The browser reconnects automatically after a disconnect. Vite proxies both paths locally. In production, reverse proxy both paths to the Node service through Caddy.

Total time online uses WebCraft's `totalUptimeSeconds` to show accumulated time across sessions. It excludes downtime and displays the last reported total during an outage. Feeds that only provide session uptime show it under Uptime while the instance is ready. Total time online, session uptime, and world age use hours and minutes below one day and days and hours from one day onward when the feed provides minute-level precision. Older feeds that publish only `worldAgeDays` still show whole days.

### First deployment without Minecraft instances

Home shows the Discord invite, Capybara facts, and the player dashboard preview even without the Node API. With an empty server directory, the Server overview panel stays visible and reports that no servers are configured. The header shows the server picker when at least one instance can be selected. The API also lists the legacy default server on installations that already have its catalog or player feed.

## Players

Select a server and open **Players**. An instance with a live roster shows the players that WebCraft lists online with their Minecraft heads and round-trip latency. The connection indicator shows good at up to 75 ms, fair at up to 150 ms, and high latency above 150 ms. A player without a loadable Java skin gets a name-based icon.

To publish the live roster for an instance, include `players` in its `tabs` and set `"onlinePlayersTransport": "websocket"` or `"onlinePlayersTransport": "http"` in its private `server.json`. Enable `onlinePlayersEnabled` in WebCraft and allow the matching transport for that feed. Set `tokenEnv` to a Node environment variable holding the same machine token as WebCraft's `WEBCRAFT_FEED_TOKEN`. If you add `tokenEnv` to an instance that uses a public status feed, set `"statusExposure": "public"` explicitly. Restart the Node API after changing its configuration.

WebCraft applies Minecraft's online listing settings. Capycraft publishes only the names and latency that feed returns, and serves head textures only for currently listed names. The browser requests `GET /api/players?server=<alias>&online=1` and subscribes on the same-origin `/api/live` socket. In WebSocket mode, Node subscribes to WebCraft and resubscribes after disconnects. In HTTP mode, Node reads WebCraft on demand and refreshes about every five seconds while a browser subscribes. Route both `/api/players` and `/api/live` to the Node API in Caddy. Keep WebCraft's internal endpoints and token on the private side of the proxy.

Run `node --test tests/onlinePlayers.test.mts` to exercise both transports, browser subscriptions, and directory recovery with loopback fixtures.

Instances without a live roster keep the alphabetical list of previously recorded usernames. The [Node.js API](server/index.mts) fetches WebCraft player histories on startup and about once a minute. It keeps one entry per Minecraft UUID and uses the name from the latest known login on that server. The SQLite list retains previously collected names during outages.

Use Node.js 24.15 or later in the Node.js 24 LTS line in production. Node.js 22.18 or later also runs the API for local development, where the built-in SQLite module may emit an experimental-feature warning. Run the API from the project root in a separate terminal alongside `npm run dev`.

```sh
npm run start:api
```

The API listens on loopback port 8787, and Vite proxies `GET /api/players` to it. The production web server should route that exact path on the same HTTPS origin to the same loopback address. The response contains only a `players` array of names, for example `{"players":["ExamplePlayer"]}`.

On each Minecraft instance, install a WebCraft Core version with the player history feed. Enable `listenerEnabled` and `playerHistoryEnabled` in `webcraft-server.toml` and set `WEBCRAFT_FEED_TOKEN` in the mod's process environment. Set `"playerHistory": true` and reference the token with `tokenEnv` in the Capycraft instance definition. Existing installations can keep using `WEBCRAFT_PLAYER_FEEDS` in the ignored `.env.local`. Each entry supplies `server`, `url`, and `token` and takes priority for that instance. An entry with no alias uses the default server.

```dotenv
WEBCRAFT_PLAYER_FEEDS='[{"server":"universum","url":"http://127.0.0.1:8765/api/v1/internal/players","token":"REPLACE_WITH_THE_INSTANCE_FEED_TOKEN"}]'
```

The API stores data at `data/players.sqlite` by default. Set `CAPYCRAFT_PLAYER_DATABASE` to use a different path. WebCraft records logins after the feature is enabled. Earlier logins would need a separate import from existing records.

## Items catalog

### Share an item

Open an item and copy the address from the browser. For example, `/server/universum/items/minecraft%3Adiamond` opens the diamond's recipe panel. The link can also carry the selected recipe view, station, page, and ingredient group. Existing links such as `#/server/universum/items?item=minecraft%3Adiamond` still open the same item, including legacy links that open over Players or server Home.

The Node service uses the published catalog to send the item name, a description, and Open Graph metadata in the initial HTML. Browsers with JavaScript show the scene loader until the app opens the item. With JavaScript disabled, the page shows a basic item summary and a link to the catalog. The service makes a square PNG preview from the imported item icon, preserving transparency and using nearest-neighbor scaling. Items without an imported icon use the Capycraft favicon. The public item URL stays the same across imports.

`/sitemap.xml` lists the sitemap files for published catalogs. Each file includes up to 25,000 canonical item URLs, and `/robots.txt` points crawlers to the index. The sitemap uses the current catalog manifests, so publishing an update refreshes the listed items independently of the site build.

See [Caddy routes](#caddy-routes) for the production handlers. Caddy's forwarded scheme and the request host determine the absolute URLs in item metadata and sitemaps.

### Publish a catalog update

1. In the Minecraft client with the Universium WebCraft exporter, run `/webcraft export` and choose **Export item catalog and inventory**. Use a full item catalog export for production. Each import replaces the selected instance's catalog. A test export or a filtered export will publish only the entries it contains.
2. Copy the archive into the instance's `imports/` directory on the host running the Capycraft Node API. The default ATM10 path is `data/instances/atm10/imports/`, relative to the project root. Use a temporary name such as `previews.zip.part` during the transfer. When the copy finishes and the inbox has no pending `previews.zip`, rename the temporary file to `previews.zip`.
3. Leave the Node API running. It picks up the archive automatically. Open the instance's **Items** page to follow progress and check the new catalog after publication.

The instance's `imports/` directory sits next to its `server.json`. If `CAPYCRAFT_INSTANCE_DIR` points elsewhere, use that instance directory on the API host. The shared `data/item-imports/` inbox still works for the default server or the server selected with `CAPYCRAFT_ITEM_SERVER`.

For each preview key, the importer prefers an animated WebP or APNG from `animations/` and otherwise uses the WebP or PNG in `previews/`. Animated icons are served as individual images. Fluid icons come from the texture references in WebCraft machine recipes. The importer preserves animated WebP and APNG textures in the catalog and machine slots. Tooltip, stack, and recipe documents can come from standalone JSON files or the shared bundles in newer WebCraft exports. The importer resolves compact crafting ingredient tags from the exported tag documents. Resubmitting an older archive can rebuild its catalog after importer changes.

Run `npm run start:api` alongside `npm run dev` locally and as the Node service in production. The Node API creates the inbox and checks for `previews.zip` at startup and every 30 seconds. It takes the ZIP into processing and skips checks while an import is running. A new ZIP can wait in the inbox for the next check. After publishing a catalog or finding that the archive matches the active catalog, the importer removes the submitted copy. A failed archive is kept as `.failed.zip` until the next failure replaces it or the next success removes it. To use another inbox location, set `CAPYCRAFT_ITEM_IMPORT_DIR` in `.env.local` or the service environment. Keep the inbox outside `public/`, `dist/`, and the live catalog directory.

Restart the Node API after upgrading from a version without SQLite catalog support. The running API chooses the inbox worker mode at startup and will otherwise continue requesting file-backed imports with atlases. To import a ZIP explicitly, run the following from the project root.

```sh
npm run import:items -- /path/to/previews.zip
```

The [import script](scripts/import-items.mjs) leaves an explicitly supplied archive in place. Set `CAPYCRAFT_ITEM_SERVER` to choose the configured instance for an explicit import. New catalogs are prepared in `catalog/` alongside that instance's `server.json` and `imports/`. Existing catalogs in the shared catalog directory keep their location. To move a file-backed catalog into its instance directory, stop the API and any running imports, move the entire catalog into `catalog/`, and restart the API and local Vite server. For a SQLite-backed catalog in the static directory, re-import the WebCraft ZIP with the new location configured. The default instance without a `server.json` uses the shared directory, `public/item-catalog/` by default. Set `CAPYCRAFT_ITEM_CATALOG_DIR` to point to an existing shared directory in a different location. The importer copies WebP and PNG previews from the archive without re-encoding them. If an archive contains both formats for a preview key, the importer uses the WebP file. New revisions store the original preview bytes, item data, and indexes in one SQLite database. The importer runs at reduced process priority when supported and checks host CPU usage between batches of items. The revision's `import-metrics.json` records counts and sizes for ZIP reads and SQLite writes.

The ingredient options dialog can show icons for items outside the imported catalog when the WebCraft ZIP includes `catalog-data/recipe-item-previews.json`. These icons are stored with the revision and used in the dialog. Catalog browsing, search and item links still use the regular item list. Older archives can omit this index.

The Items view subscribes to the selected server through the same `/api/live` WebSocket. The API watches the catalog directory and sends import status and catalog changes, including imports started from the command line. The view shows percentages during the first import and subsequent updates. First imports publish completed items in batches. During updates, visitors can keep using the existing catalog. The notice also identifies the preparation and publication stages. The importer stages the replacement in a separate directory and switches `catalog.json` in one filesystem operation after all files are ready. The notice clears and open Items views load the new revision. The previous complete revision remains available as the only backup. Its own `catalog.json` is stored inside its revision directory. A failed update leaves the current catalog available.

Use a full WebCraft export containing machine recipes to publish them with the replacement catalog. The importer reads both recipes stored directly in result files and recipes referenced through shared groups. Production recipes captured from JEI or EMI appear under the machines that run them. The cards use the exported slot positions and show item counts and fluid amounts. **Ingredients and results** appears when the diagram leaves out exported alternatives or slots without positions. A complete machine recipe replaces the result-only entry with the same recipe ID in **Other**.

Fluids with exported production recipes appear as searchable catalog entries alongside items such as filled buckets. The importer reads their recipe files from `catalog-data/machine-recipes/fluids/`. A fluid recipe file can supply a display `name` and a `previewKey` pointing to a PNG or WebP in the archive's `previews/` folder. When those fields are absent, the catalog derives the name from the fluid ID and uses a generic drop icon.

Select a server and open **Items** (for example `/server/universum/items`). The [catalog](src/items/ItemCatalog.tsx) loads a small manifest and a JSON response for each page of up to 100 items. Search uses exported names and registry IDs. Use `@mod` for a mod namespace, `#tag` for an exported recipe tag, or `$text` for text in the default tooltip. Combine terms with spaces and put phrases in quotes. The mod filter lists all namespaces and narrows the list as you type. Selecting a mod adds its namespace to the search field. Choosing **All mods** removes all mod terms and keeps the rest of the search. The search service returns one page of matching items. Names use the Minecraft client's language at export time. The catalog shows a language notice on the first visit after each page load. Select the checkbox to hide it on future visits in that browser. The grid requests previews for visible slots concurrently and requests more as they scroll into view. The page arrows and mouse wheel at a scroll boundary keep the current grid visible while the target page and its previews load. The next grid appears all at once, including on narrow screens. A loading indicator floats over the grid during longer waits. The field between the arrows shows the selected page beside the total. Enter a page number and press Enter to jump to it. The URL query records the search text and page number so reloading restores the same search results. Repeated navigation uses the latest chosen page, including while previews are loading. After a short pause in navigation input, the catalog requests the latest target and cancels superseded requests. Import progress floats below the header. When a revision finishes publishing, the open catalog loads it while keeping the search and page. New revisions serve individual previews for the grid and dialogs. The unfiltered grid can still use atlases from earlier revisions. Older catalog formats still work. On short screens, slots shrink to fit where space allows. When the grid still needs to scroll, it scrolls independently of the filters and pagination. Hover over a slot or focus it with the keyboard to see its [in-game tooltip](src/items/ItemTooltip.tsx) with exported text styles. The catalog reuses one tooltip panel as you move between slots. On narrow screens, tooltip controls float on the right just below the header. Up to four controls are visible at once. A bottom fade marks additional controls that you can scroll to. The item name appears immediately, with a loading indicator if the exported text is slow to arrive.

The floating tooltip controls sit above the Items catalog and the recipe dialog. The controls sit at the right edge on wide screens. On narrow screens, the catalog controls float above the page buttons and the dialog controls sit at the bottom edge. **F3 + H** adds the item ID and available durability to the tooltip and reveals **NBT and components** in the dialog when stack data is available. The importer collects tooltip shortcuts from all items and stack variants in each catalog. The Items panel and recipe dialog offer that full list, even when the current view contains no items that use a shortcut. Both show up to four controls at once. Scroll to reach the remaining shortcuts. Only one tooltip shortcut can be active at a time. Each exported shortcut has its own border color. The Items grid uses that color to outline the items whose default tooltip supports the selected shortcut. The **F3 + H** button uses the site theme. Until a catalog is reimported, the Items panel reads shortcuts from the current results page and the recipe dialog reads them from the selected item or stack variant. The browser remembers the selected tooltip mode while browsing the catalog and after a page reload. When WebCraft exports an inventory bar, the catalog draws its track and colored fill on the item preview, including a visible empty track for a bar with zero fill.

Click an item to open its production recipes. With touch input, tap an item once to show its tooltip and tap the same slot again to open its recipes. The same two taps work for item links and ingredient groups within recipes. Tap a different slot to see its tooltip, or tap outside to dismiss it. Right-click, press **Shift + F10** on a focused item, or touch and hold to open recipes that list it as an ingredient. A progress indicator appears while holding. The importer indexes concrete ingredient IDs for the uses view. The API can build the index on the first request for an existing catalog revision. Results can be partial when the exporter supplies only examples or a recipe result. Recipes open beside the catalog on screens at least 68 rem wide. On narrower screens and when opening a recipe from another page, they open in a dialog. The recipes scroll beneath the heading and close button. They are grouped into tabs by station, with result-only entries in **Other**. Station tabs show a catalog preview where available and a name otherwise. The station tabs stay in a single row. When the row overflows, the arrows scroll by one tab at a time. Crafting table recipes show all nine slots for patterns that fit the 3 × 3 grid. Shaped inputs keep their row and column positions, and shapeless inputs fill the grid in export order. Machine recipes trim the unused space around their exported slots and scale item icons to the crafting grid size where the available width allows. Each station shows up to three recipes per page, with arrows when more recipes are available. Recipe cards fit their contents, and the dialog retains its size across tabs and pages. Select the station icon to see how to craft that station. Hover or focus an ingredient or result for its tooltip. Ingredient groups rotate available previews every two seconds. Rotation pauses while the pointer is over any recipe slot, including empty slots, or while an ingredient group is focused or its tooltip is open. Reduced motion keeps the preview still. An ingredient with one known complete match uses that item's tooltip and links straight to it. Tagged ingredient groups show a **#** marker. Open an ingredient group to see its exported tag names and a paginated grid of ingredient variants. Hover or focus a slot for its name and details. Right-click a displayed ingredient or press **Shift + F10** on its focused slot to see recipes that use that item. The importer combines all members of tags included in the archive with explicitly listed ingredients. If the export supplies only a capped set of examples, the dialog marks the list as incomplete. To restore tag members omitted by an older import, reimport an archive that contains the full tag lists. Following a recipe link replaces the displayed item. Closing the recipe dialog returns to the underlying page. Turn on **F3 + H** to select a stack variant and expand its NBT and components when available. Recipe links belong to a server instance and can open over its Items page, Players page, or server home. For example, `/server/atm10/items/minecraft%3Achest?from=players` opens the chest recipe over Players. The named `view=uses` and `ingredient` options can appear in any order. Opening a group adds its recipe ID and input slot to the URL so the link restores both dialogs. Closing that group returns to the recipe. Earlier item detail links still work, and links without a server alias open the default server. Keep the original ZIP private and only import exports whose item information is intended for public display.

For a Caddy deployment, serve the built site from `dist/`. Reverse proxy `/item-catalog/*`, `/api/item-search`, `/api/item-recipe-uses`, and `/api/live` to the same Node service as the player and server directory APIs. Caddy’s `reverse_proxy` handles the WebSocket upgrade on `/api/live`. The catalog route serves manifests, import status, pages, previews, atlases, item details, and payloads. Manifests and import status use `Cache-Control: no-cache` and support revalidation. Revision assets, including tooltip and recipe payloads, are immutable and can be served from the browser cache for a year. Keep instance directories outside the static web root so configuration, ZIPs, and search indexes stay private. A revision in a private catalog directory keeps its database alongside its manifest. When the shared catalog is under `public/` or `dist/`, its revision databases are stored under `data/item-catalog-databases/`. Include that directory when backing up a shared static catalog. Catalog data can be updated independently of the site build.

For shared caching of recipe-use queries, build Caddy with [cache-handler](https://github.com/caddyserver/cache-handler) and add `cache` to its global options. In the site block, import [the recipe cache route](deploy/recipe-cache.caddy) before any catch-all handler. Pass the Node API address and remove `/api/item-recipe-uses` from the general proxy matcher.

```caddyfile
import deploy/recipe-cache.caddy 127.0.0.1:8787
```

The route caches successful recipe-use responses for 30 minutes. The cache key includes the query parameters for catalog server, revision, ingredient ID, and ingredient kind. Recipe details display the catalog publication time from `X-Catalog-Published-At`. The timestamp belongs to the revision and remains the same when a cache serves it. Older revisions use their own manifest file's modification time.

### Recipe uses index

SQLite imports prepare a gzip recipe-uses response for each ingredient. Ingredients with the same ordered recipe list share a response. The Node API serves those bytes directly to gzip-capable clients and decompresses them for clients requesting identity encoding. For an older published catalog with a legacy recipe-uses index, prepare these responses without reimporting the ZIP. Pass the directory that contains `catalog.json`.

```sh
node scripts/index-recipe-uses.mts data/instances/atm10/catalog
```

Keep the generated `*.recipe-uses.sqlite` alongside the revision assets when backing up an upgraded catalog. For shared catalogs in the static directory, the index is placed under `data/item-catalog-databases/` with the other revision databases.

On the local ATM10 catalog, the gzip response for iron ingot uses was 56,446 bytes, down from 1,367,709 bytes of JSON. In 48 first requests with empty handler caches and an established local HTTP connection, the handler took at most 7.1 ms. Forty-seven complete responses arrived in under 20 ms. The first HTTP request in a fresh process took 29 ms, including 5.6 ms in the handler. These timings exclude browser decompression and JSON parsing.

### ATM10 import baseline

On November 20, 2026, the local Windows import worker started at 12:28:35 CET and published the replacement catalog at 13:12:42 CET, about 44 minutes later. The submitted archive was about 202 MiB and contained 303,181 ZIP entries, 63,217 catalog items, and 1,972 variants. The previous catalog remained available while the replacement was prepared. The inbox upload was consumed after the successful import.

The new revision contained 61,064 WebP icons, 63,217 item detail files, 125,862 payload files, and 633 atlases. The running worker still used the earlier status format, so this run provides a wall-clock baseline without timings for individual stages. The measurements do not establish how much time went to ZIP reads, file writes, atlas generation, or CPU pacing.

### ATM10 sample benchmark

An isolated sample from the original archive contained 100 items from 42 mods, with 34 variants and 569 ZIP entries. Each configuration ran eight times in rotating order. The [benchmark script](scripts/benchmark-item-import.mjs) uses the same importer for each run and verifies matching item data and matching catalog manifests for the two storage backends within each preview mode.

| Configuration | Total | Atlas creation | ZIP reading | Storage writes and commit |
| --- | ---: | ---: | ---: | ---: |
| Files with atlases | 1,439 ms | 348 ms | 296 ms | 608 ms |
| Files with direct icons | 1,044 ms | 0 ms | 293 ms | 613 ms |
| SQLite with atlases | 581 ms | 311 ms | 155 ms | 23 ms |
| SQLite with direct icons | 288 ms | 0 ms | 174 ms | 27 ms |

Values are medians. Atlas creation includes its storage write, and the ZIP measurement includes reading the directory and inflating individual entries. The benchmark disables CPU pacing and skips live publication and backup rotation. The sample measures import work. Direct previews change the number of image requests, so browser load time is a separate measurement.

To repeat the benchmark with a WebCraft catalog archive, run the following from the project root. The optional final argument sets the number of runs per configuration.

```sh
node scripts/benchmark-item-import.mjs /path/to/previews.zip 8
```

The full ATM10 archive was also imported into an isolated update using SQLite and direct previews. It published 63,217 items and 61,064 unique previews in 3 minutes 12 seconds. The importer read 235,464 non-image ZIP entries (about 663 MiB) and 64,318 preview entries (about 45 MiB). It performed 251,526 SQLite asset writes. These are application-level reads and writes. ZIP reading, including directory scanning and decompression, took about 98 seconds.

Reimporting the same archive through the running ATM10 inbox with SQLite and fluid recipes enabled prepared 63,632 catalog entries in 3 minutes 39 seconds. The import metrics exclude the inbox polling delay and backup cleanup. The published catalog returned Argon and Liquefied Source with their production recipes through the site API.

### Catalog and sensitive data storage

Keep the public item catalog unencrypted at rest, including its SQLite databases. If a future feature stores sensitive data, use a separate encrypted database with its own key and restricted server-side access. Keep the key separate from the database file and keep sensitive records out of the public catalog.

## Deploy an update to an existing server

The Capycraft Web release can go out independently of WebCraft. For a Web-only update, keep the production instance definitions and the current WebCraft HTTP feed settings. `directoryTransport` defaults to `http`. Keep `onlinePlayersTransport` unset for instances awaiting a compatible feed. If the Players tab is available, it uses recorded player history in that configuration. A server still awaiting its first usable information response can offer its published Items catalog. The browser's `/api/live` WebSocket works with either upstream directory transport.

1. **Prepare the release.** Fetch the Capycraft Web repository and check out the release commit in a staging directory. Run `npm ci` and `npm run build` there to produce the matching `dist/`. Use Node.js 24.15 or later in the Node.js 24 LTS line and npm 10 or later. Check the Node binary used by the service as well as the interactive shell. If production uses Microsoft sign-in, set its production `VITE_MICROSOFT_CLIENT_ID` before building. See [Microsoft sign-in](#microsoft-sign-in).
2. **Preserve production state.** Keep a rollback copy of the previous application release and Caddy configuration. Preserve the Node service definition, its environment or `.env.local`, `data/instances/`, `data/item-imports/`, the player SQLite database, and existing catalog directories and revision databases. Include any locations overridden through the service environment. A legacy catalog may be under `public/item-catalog/` or `dist/item-catalog/`. Keep it at the path currently read by the API. For SQLite backups, use a SQLite-aware backup or stop the service before taking a filesystem copy. Keep private files outside Caddy's static root.
3. **Prepare Caddy.** Compare the site's active routes with [Caddy routes](#caddy-routes). If the routes or static root need changes, merge them into the existing site block and validate the updated configuration with `caddy validate --config /path/to/Caddyfile --adapter caddyfile` before activating it.
4. **Activate and restart.** Use the existing service manager to stop the Capycraft Node service, activate the prepared release using the site's existing deployment mechanism, and start the service again. For an in-place deployment, copy the tracked application files and the staged `dist/` into the existing app directory while retaining the production state from step 2. For a release-directory deployment, keep production data and environment paths reachable from the new working directory. In the activated app directory, install runtime dependencies with `npm ci --omit=dev` using the release's lockfile before starting Node. The service runs `npm run start:api` from the app root and listens on `127.0.0.1:8787`. Caddy's static root and Node's `dist/index.html` must point to the same release. Reload Caddy if its configuration changed. A published catalog can be reused immediately. The first fluid-uses request may take longer while it builds the index. Reimport only when publishing new catalog data.

### Caddy routes

Merge these handlers into the existing site block and set its `root` to the absolute path to the release's `dist/`. Retain the site's existing TLS setup and static file handler. Merge equivalent matchers to avoid duplicate routes. Place the site handlers before any unconditional catch-all in a `route` block. Caddy's `reverse_proxy` handles the WebSocket upgrade on `/api/live`.

```caddyfile
@capycraftApi path /api/servers /api/players /api/item-search /api/item-recipe-uses /api/live /item-catalog/*
handle @capycraftApi {
  reverse_proxy 127.0.0.1:8787
}

@capycraftItemPages path_regexp capycraftItemPages ^/(server/[a-z0-9-]+/items/.+|sitemap(-items-.+)?\.xml|robots\.txt)$
handle @capycraftItemPages {
  reverse_proxy 127.0.0.1:8787
}

@capycraftPages path_regexp capycraftPages ^/(server/[a-z0-9-]+(/(items|players))?|404)/?$
handle @capycraftPages {
  rewrite * /index.html
  file_server
}
```

The example uses standard Caddy. If production already uses the optional shared recipe cache, retain the [recipe cache route](deploy/recipe-cache.caddy) and remove `/api/item-recipe-uses` from `@capycraftApi`. Check for `http.handlers.cache` in `caddy list-modules` before enabling that import.

### Verify after restart

1. Check the Node service status and startup logs. On the host, run `curl -fsS http://127.0.0.1:8787/api/servers` and confirm it returns JSON. Repeat against `/api/servers` on the public HTTPS origin and confirm the expected configured instances are present. Check the Home page for server status or last-known information as appropriate for each instance.
2. Open DevTools and reload Home. In the Network panel, confirm `/api/live` upgrades with HTTP `101` and receives a `servers` message. Open Items for a published catalog and confirm the same socket receives a `catalog` message. Verify the Home page and Items at desktop and narrow mobile widths.
3. Search for an item, open its recipe, reload its direct URL, and confirm the same recipe opens. Check that the direct response contains `og:title` and that `/sitemap.xml` returns XML. Open recipe uses and verify the catalog publication time. Check that the response has `X-Catalog-Published-At`. When the optional shared cache is enabled, repeat the same recipe-uses GET and check for a `Cache-Status` hit, `s-maxage=1800`, and the same publication timestamp.
4. For each exposed Players tab, reload its direct URL and verify that the history view loads for an instance awaiting the WebCraft update. For such an instance, `GET /api/players?server=<alias>&online=1` returns `{"status":"disabled"}`. If Microsoft sign-in is configured, check its sign-in flow on the public origin.
5. If a check fails, compare the loopback API response with the public response to distinguish a Node startup problem from a proxy or static root problem. If the release cannot pass the checks, restore the previous application release and Caddy configuration, start the previous Node service, and repeat the Home, catalog, and API checks. Keep production data in place during application rollback.

## Microsoft sign-in

The site and Storybook work with sign-in left unconfigured. When ready, use the [Microsoft SSO setup guide](docs/microsoft-sso.md) to configure a local development registration, a shared HTTPS preview, or the production site.

## Storybook

After `npm ci`, run `npm run storybook` and open `http://127.0.0.1:6006/`. On Windows, run `npm.cmd run storybook -- --port 6007` if the default port is in use. Storybook excludes generated catalog and build directories from file watching.

Use **Language** in the preview toolbar to switch between English and Czech. The choice applies to Storybook previews and uses settings separate from the Capycraft site.

The scene stories cover the background, header, entrance animation, and the full scene in animated and static variants. Use **Reload story** in the preview toolbar to replay the animation.

The layout stories show the information panel, both page layouts, a single Minecraft server card, and the server overview in its empty state and with two example servers. Example addresses use the reserved `.example` domain and can be copied from the icon inside the address field or the server logo. A notification in the lower right reports the result.

- `npm run typecheck` checks TypeScript for the site and Storybook.
- `npm run build` builds the site into `dist/`.
- `npm run build-storybook` builds Storybook into `storybook-static/`.

Vite converts the winter scene artwork to WebP for the development site, production builds, and Storybook. The site preloads the same WebP files it displays. Generated files are cached under `node_modules/.cache/capycraft-scene/` and the original artwork stays in `assets/`.

## Artwork

- The [dragon battle](assets/dragon-battle-background.png) comes from `Válka draků nad korálovým golemem.png` and serves as the opaque full-screen background.
- The [snow islands](assets/capybara-snow-islands.png) come from `Sněhové ostrovy s kapybarou a magickou zahradou.png`. The scene displays the transparent PNG twice with different CSS crops, placing the garden behind the capybara. CSS draws the capybara's eyelid to match the position and colors of the original artwork. The capybara blinks at irregular intervals and keeps its eye open when reduced motion is enabled. The home highlight and 404 page crop the same artwork to show the capybara and lantern.
- The [winter logo](assets/capycraft-winter-logo.png) comes from `Zimní logo CAPYCRAFT s kapybarou (1).png`. It starts large in the center of the scene and finishes at the left of the header.

The repository preserves all three supplied images in their original form. The Discord invite uses a [white Discord symbol](assets/discord-symbol-white.svg) based on the [official vector](https://discord.com/branding). Its outline uses rounded curves at the corners and is displayed at 36 × 27 CSS pixels.

The [browser tab favicon](public/favicon.png) is the supplied transparent pixel-art capybara.

The [paper copy icon](assets/pixel-copy-papers.png) and [example server keep](assets/example-server-keep.webp) are original pixel art for the server cards. Both use a transparent background.

The dashboard preview uses [Nugwa's local 64 × 64 classic Java skin](assets/nugwa-a7cd3a2452c6.png), obtained from the [Minecraft texture service](https://textures.minecraft.net/texture/a7cd3a2452c60522337b72e157429e2ff6ec4a90287a8d685a4bf5aada0177a5) through the [Nugwa profile](https://sessionserver.mojang.com/session/minecraft/profile/a0ea91265d8e40218f45c610125e2f75). In the [solo scene](src/portrait/nugwaAnimation.ts), Nugwa looks both ways, stands, and turns to wave before leaving on the left. He peeks in from the right and returns to the [seated pose](src/portrait/nugwaPose.ts).

In the [grass block scene](src/portrait/blockScene.ts), the block rolls to the left after bumping the seated player. The other player claims the seat while the first investigates, then the first carries the block away. This scene requires two distinct usernames. [The loop](src/portrait/portraitAnimation.ts) can also pair the departure and arrival clips with different players. It follows the cast order and wraps back to the first player. The bundled cast includes [nightware6's local 64 × 64 classic Java skin](assets/nightware6-56ec53e9f367.png) from the [Minecraft texture service](https://textures.minecraft.net/texture/56ec53e9f3674c0f7aa8e99d2233002529968a1aa1428dafab94f399e0fa1463). The grass block uses an [original pixel texture](src/portrait/grassBlock.ts).

The [renderer](src/portrait/renderPortrait.ts) adapts WebCraft Armor Preview's expanded outer skin, depth testing, nearest-neighbor texture sampling, and two-light shading. It supersamples the outlines to smooth the edges in motion.

[NugwaPortrait](src/portrait/NugwaPortrait.tsx) uses up to ten distinct recent visitors to the selected server, or across all servers when no server is selected. It accepts an explicit `players` list in playback order. Set `arrival` to `same` to open with the same player returning, or `next` to alternate the departure-and-arrival scene with the grass block scene. A cast of one always plays the departure and return. The API looks up recorded usernames through Minecraft's profile and texture services. Players without a loadable custom skin are skipped. If no visitor skins load, the canvas uses the bundled cast.

The canvas plays while the card and browser window are active. Playback resumes from the same point after switching windows or scrolling away. If the canvas fails, the card loads the transparent [animated PNG](assets/nugwa-animated.png). The transparent [seated PNG](assets/nugwa-seated.png) is shown while the canvas loads and whenever reduced motion is enabled. Both exported images use the bundled cast and the same renderer and motion as the canvas. They are served as static assets and can be hosted independently.

Edit [portrait-players.json](portrait-players.json) to add or reorder distinct Minecraft Java usernames with public custom skins. A list with one name plays only the solo scene. Run `npm run export:nugwa` after editing the cast, poses, scenes, or renderer. It downloads skins for new names from Minecraft's profile and texture services, reuses saved skins for existing names, and regenerates the cast and both PNGs. Run `npm run export:nugwa -- --refresh-skins` to fetch updated skins for names already in the cast. The site reads the generated assets locally.

## Fonts

Headings and recipe quantities use [Chakra Petch](https://github.com/google/fonts/tree/main/ofl/chakrapetch). Body text uses [Barlow](https://github.com/google/fonts/tree/main/ofl/barlow), and server statistics use [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed). The build serves Latin and Latin Extended WOFF2 files locally, with system fonts available as fallbacks for other scripts. See the licenses for [Chakra Petch](public/licenses/chakra-petch-ofl.txt) and [Barlow](public/licenses/barlow-ofl.txt).

## History and contribution guidance

The earlier winter scene with a day cycle, layer controls, and technical notes is in commit `d7567392f459a06d22b68db41c1603c8372496bd`. The [winter reference](references/winter-scene.png) and [depth map](references/depth-map.png) are available in the repository.

See [AGENTS.md](AGENTS.md) for the repository language, workflow, and verification guidance.
