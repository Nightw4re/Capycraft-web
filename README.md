# Capycraft Web

Capycraft Web is the public site for the Capycraft Minecraft server and will also provide an information dashboard for players.

## Current state

The home page (`#/`) shows a full-screen winter scene, an illustrated highlight, and square-cornered information panels. The server overview shows a card for each server in the header picker. It displays the information and status reported by WebCraft and keeps the last known server information during outages. The two corner illustrations sit above the scrolling content, and the native scrollbar stays visible beside them. The landscape and header stay in place while the information panels scroll. Below 550 px, the corner illustrations take up a larger share of the width until they reach a limit that leaves a gap between them. The player dashboard is planned.

A pixelated square fills as the browser decodes the landscape, island, and logo images. Once the images are ready, the large logo drops into the center over the blurred landscape. The dark header slides in, and the logo shrinks and moves to its left edge. After the logo settles, the navigation entries appear one at a time from left to right. The header controls slide in from right to left as the landscape comes into focus. Page content slides in and fades into view when the intro ends, or as soon as the images are ready with the intro turned off. With reduced motion enabled, the finished scene appears as soon as the images are ready. The loading screen offers a retry if an image fails to load.

[index.html](index.html) loads [src/main.tsx](src/main.tsx), which renders the home page, the Items catalog, and the Players list in the shared [WinterScene](src/scene/WinterScene.tsx). The logo in [SceneHeader](src/scene/SceneHeader.tsx) links home. Old links to the information page also open the home page. [SceneBackground and SceneIslands](src/scene/SceneBackground.tsx) render the landscape and the two island cutouts. [SceneEntrance](src/scene/SceneEntrance.tsx) waits for the images and runs the entrance animation.

Unknown hash routes, including `#/404`, show an illustrated [404 page](src/layout/PageError.tsx) and keep the original URL. The page offers a link home. The Players view uses the same layout to show sign-in and permission messages if its API responds with 401 or 403.

[PageLayout](src/layout/PageLayout.tsx) provides a single column or a responsive grid for content such as [InfoPanel](src/layout/InfoPanel.tsx).

The [home highlight](src/layout/HomeHighlight.tsx) spans the width of the panel grid and rotates through seven Czech or English facts every 20 seconds. The text and artwork slide horizontally when the active fact changes. Original inline vector icons mark the previous and next buttons on the left and the play or pause button on the right. All three buttons keep the same size while rotation is toggled. With reduced motion enabled, rotation starts paused and manual changes are immediate. Each [fact](src/layout/homeHighlightFacts.ts) includes its own artwork setting. All seven currently use the winter capybara crop. The wildlife facts draw on [research on capybara digestion](https://link.springer.com/article/10.1007/BF00264639), [observations of cecotrophy](https://www.sciencedirect.com/science/article/abs/pii/S0168159199000805), [research on wombat droppings](https://doi.org/10.1039/D0SM01230K), and the [San Diego Zoo’s capybara profile](https://animals.sandiegozoo.org/animals/capybara).

The header places the server picker after Home. Selecting a server reveals its tabs one at a time, or immediately with reduced motion. The browser tab remembers the selected server when you return to Home. Choose **Select server** in the picker to clear the selection and hide the server tabs. Shared server links use the server alias in the URL to set the selection. When you switch servers from a section the new server omits, the picker opens the new server's home page. The header shows the current language as a flag. The language menu lists English first, followed by Czech. English is the default for new visitors. A swatch grid offers all 16 Minecraft dye colors and defaults to green. The selected color accents the highlight, controls, and panel borders, with a subtler tint on panel backgrounds and text. The Intro switch controls whether the entrance plays on the next load. The browser remembers these preferences. Microsoft sign-in is optional and awaits an app registration.

## Local development

Use Node.js 20.19 or later in the 20.x series, or Node.js 22.12 or later, and npm 10 or later. Run these commands from the project root.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The browser updates automatically when you save changes. Press `Ctrl+C` to stop the server.

Use Node.js 22.18 or later to run `npm run start:api` in a second terminal for the server directory, player list, and item catalog. Vite forwards these requests to the same Node API used behind Caddy, including item search and recipe uses.

To check the built site locally, run `npm run build` followed by `npm run preview` and open `http://127.0.0.1:4173/`. Keep the Node API running. The preview serves `dist/` and forwards the same API requests as the development server.

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

Run `npm run start:api` to populate the overview and selector. The Node API checks configured WebCraft instances on startup and about once a minute. The overview shows configured instances by alias while waiting for their first WebCraft response. An instance appears in the selector after its first server information response or when part of its Items catalog is available. An instance still waiting for WebCraft offers only Items if its configuration enables that tab. Items shows import progress and lets visitors browse items already published. Capycraft keeps the last successful server information and time of contact in the SQLite database used for player history. During a later outage the card shows the cached name, icon, join address, player limit, total world runtime, and world age when available. The current player count and session uptime show a dash. The status tooltip includes the last known connection time during the outage. The card shows the server message under its name and a colored status dot with a label on hover, focus, or tap. When WebCraft reports the instance ready, the card displays the available player count and limit, current session uptime, total uptime, and world age as inline statistics that wrap on narrow screens. The card and header picker show the server icon when WebCraft supplies one. Capycraft requests `iconFormat=webp` when polling `server-info` and accepts a PNG or WebP base64 data URL in `serverIcon`, up to 96,000 characters. The card enables copying when an address is available. Open Items from the header after selecting an instance. The browser receives the public server directory through a WebSocket at `/api/live` on the Capycraft origin. The API sends a snapshot on connection and sends updates as the directory changes. The browser reconnects automatically after a disconnect. `GET /api/servers` also serves the public directory over HTTP. Vite proxies both paths locally. In production, reverse proxy both paths to the Node service through Caddy.

### First deployment without Minecraft instances

Home shows the Discord invite, Capybara facts, and the player dashboard preview even without the Node API. With an empty server directory, the Server overview panel stays visible and reports that no servers are configured. The header shows the server picker when at least one instance can be selected. The API also lists the legacy default server on installations that already have its catalog or player feed.

## Players

Select a server and open **Players** (for example `#/server/universum/players`) to see an alphabetical list of usernames recorded on that server. The [Node.js API](server/index.mts) fetches the WebCraft player histories on startup and about once a minute. It keeps one entry per Minecraft UUID and uses the name from the latest known login on that server. The SQLite list retains previously collected names during outages.

Use Node.js 24 in production. Node.js 22.18 or later also runs the API for local development. Run the API from the project root in a separate terminal alongside `npm run dev`.

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

### Publish a catalog update

1. In the Minecraft client with the Universium WebCraft exporter, run `/webcraft export` and choose **Export item catalog and inventory**. Use a full item catalog export for production. Each import replaces the selected instance's catalog. A test export or a filtered export will publish only the entries it contains.
2. Copy the archive into the instance's `imports/` directory on the host running the Capycraft Node API. The default ATM10 path is `data/instances/atm10/imports/`, relative to the project root. Use a temporary name such as `previews.zip.part` during the transfer. When the copy finishes and the inbox has no pending `previews.zip`, rename the temporary file to `previews.zip`.
3. Leave the Node API running. It picks up the archive automatically. Open the instance's **Items** page to follow progress and check the new catalog after publication.

The instance's `imports/` directory sits next to its `server.json`. If `CAPYCRAFT_INSTANCE_DIR` points elsewhere, use that instance directory on the API host. The shared `data/item-imports/` inbox still works for the default server or the server selected with `CAPYCRAFT_ITEM_SERVER`.

Run `npm run start:api` alongside `npm run dev` locally and as the Node service in production. The Node API creates the inbox and checks for `previews.zip` at startup and every 30 seconds. It takes the ZIP into processing and skips checks while an import is running. A new ZIP can wait in the inbox for the next check. After publishing a catalog or finding that the archive matches the active catalog, the importer removes the submitted copy. A failed archive is kept as `.failed.zip` until the next failure replaces it or the next success removes it. To use another inbox location, set `CAPYCRAFT_ITEM_IMPORT_DIR` in `.env.local` or the service environment. Keep the inbox outside `public/`, `dist/`, and the live catalog directory.

Restart the Node API after upgrading from a version without SQLite catalog support. The running API chooses the inbox worker mode at startup and will otherwise continue requesting file-backed imports with atlases. To import a ZIP explicitly, run the following from the project root.

```sh
npm run import:items -- /path/to/previews.zip
```

The [import script](scripts/import-items.mjs) leaves an explicitly supplied archive in place. Set `CAPYCRAFT_ITEM_SERVER` to choose the configured instance for an explicit import. New catalogs are prepared in `catalog/` alongside that instance's `server.json` and `imports/`. Existing catalogs in the shared catalog directory keep their location. To move a file-backed catalog into its instance directory, stop the API and any running imports, move the entire catalog into `catalog/`, and restart the API and local Vite server. For a SQLite-backed catalog in the static directory, re-import the WebCraft ZIP with the new location configured. The default instance without a `server.json` uses the shared directory, `public/item-catalog/` by default. Set `CAPYCRAFT_ITEM_CATALOG_DIR` to point to an existing shared directory in a different location. The importer copies WebP and PNG previews from the archive without re-encoding them. If an archive contains both formats for a preview key, the importer uses the WebP file. New revisions store the original preview bytes, item data, and indexes in one SQLite database. The importer runs at reduced process priority when supported and checks host CPU usage between batches of items. The revision's `import-metrics.json` records counts and sizes for ZIP reads and SQLite writes.

The Items view subscribes to the selected server through the same `/api/live` WebSocket. The API watches the catalog directory and sends import status and catalog changes, including imports started from the command line. The view shows percentages during the first import and subsequent updates. First imports publish completed items in batches. During updates, visitors can keep using the existing catalog. The notice also identifies the preparation and publication stages. The importer stages the replacement in a separate directory and switches `catalog.json` in one filesystem operation after all files are ready. The notice clears and open Items views load the new revision. The previous complete revision remains available as the only backup. Its own `catalog.json` is stored inside its revision directory. A failed update leaves the current catalog available.

Use a full WebCraft export containing machine recipes to publish them with the replacement catalog. The importer reads both recipes stored directly in result files and recipes referenced through shared groups. Production recipes captured from JEI or EMI appear under the machines that run them. The cards use the exported slot positions and show item counts and fluid amounts. **Ingredients and results** appears when the diagram leaves out exported alternatives or slots without positions. A complete machine recipe replaces the result-only entry with the same recipe ID in **Other**.

Fluids with exported production recipes appear as searchable catalog entries alongside items such as filled buckets. The importer reads their recipe files from `catalog-data/machine-recipes/fluids/`. A fluid recipe file can supply a display `name` and a `previewKey` pointing to a PNG or WebP in the archive's `previews/` folder. When those fields are absent, the catalog derives the name from the fluid ID and uses a generic drop icon.

Select a server and open **Items** (for example `#/server/universum/items`). The [catalog](src/items/ItemCatalog.tsx) loads a small manifest and a JSON response for each page of up to 100 items. Search uses exported names and registry IDs. The mod filter lists all namespaces and narrows the list as you type. Select a mod to apply the filter, or choose **All mods** to clear it. The search service returns one page of matching items. Names use the Minecraft client's language at export time. The grid requests previews for visible slots concurrently and requests more as they scroll into view. When you use the page buttons, the current grid stays visible while the next results and previews load. The catalog shows the current page and total pages. At a scroll boundary, the mouse wheel updates the page number immediately and shows empty slots while the target page loads. After a short pause in wheel input, the catalog requests the latest target and cancels superseded requests. A loading indicator appears beside the page number during longer waits when using the page buttons. New revisions serve individual previews for the grid and dialogs. The unfiltered grid can still use atlases from earlier revisions. Older catalog formats still work. On narrow or short screens, the grid scrolls independently of the filters and pagination. Hover over a slot or focus it with the keyboard to see its [in-game tooltip](src/items/ItemTooltip.tsx) with exported text styles. The catalog reuses one tooltip panel as you move between slots. The item name appears immediately, with a loading indicator if the exported text is slow to arrive.

The floating tooltip controls sit above the Items catalog and the recipe dialog. The controls sit at the right edge on wide screens. On narrow screens, the catalog controls float above the page buttons and the dialog controls sit at the bottom edge. **F3 + H** adds the item ID and available durability to the tooltip and reveals **NBT and components** in the dialog when stack data is available. The Items panel combines exported shortcuts from all items on the current results page, including slots below the fold. Only one tooltip shortcut can be active at a time. Each exported shortcut has its own border color. The Items grid uses that color to outline the items affected by the selected exported shortcut. The **F3 + H** button uses the site theme. The recipe dialog uses the shortcuts for the selected item or its selected stack variant. The selected modes persist while browsing the catalog. When WebCraft exports an inventory bar, the catalog draws its track and colored fill on the item preview, including a visible empty track for a bar with zero fill.

Click an item to open its production recipes. With touch input, tap an item once to show its tooltip and tap the same slot again to open its recipes. The same two taps work for item links and ingredient groups within recipes. Tap a different slot to see its tooltip, or tap outside to dismiss it. Right-click, press **Shift + F10** on a focused item, or touch and hold to open recipes that list it as an ingredient. A progress indicator appears while holding. The importer indexes concrete ingredient IDs for the uses view. The API can build the index on the first request for an existing catalog revision. Results can be partial when the exporter supplies only examples or a recipe result. Recipes open immediately and scroll beneath the dialog heading and close button. They are grouped into tabs by station, with result-only entries in **Other**. Station tabs show a catalog preview where available and a name otherwise. The station tabs stay in a single row. When the row overflows, the arrows scroll by one tab at a time. Crafting table recipes show all nine slots for patterns that fit the 3 × 3 grid. Shaped inputs keep their row and column positions, and shapeless inputs fill the grid in export order. Each station shows up to three recipes per page, with arrows when more recipes are available. Recipe cards fit their contents, and the dialog retains its size across tabs and pages. Select the station icon to see how to craft that station. Hover or focus an ingredient or result for its tooltip. Ingredient groups rotate available previews every two seconds and pause while a group is hovered or focused or while its tooltip is open. Reduced motion keeps the preview still. Tagged ingredients show a **#** marker. A tag with one known complete match links straight to that item. Open an ingredient group to see its exported tag names and all exported examples in a second dialog. Right-click a displayed ingredient or press **Shift + F10** on its focused slot to see recipes that use that item. The exporter can cap the examples at 32 and combines examples from multiple tags into one list per ingredient. Following a recipe link replaces the displayed item. Closing the recipe dialog returns to the underlying page. Turn on **F3 + H** to select a stack variant and expand its NBT and components when available. Recipe links belong to a server instance and can open over its Items page, Players page, or server home. For example, `#/server/atm10/players?item=minecraft%3Achest` opens the chest recipe over Players. The named `view=uses` and `ingredient` options stay in the URL fragment and can appear in any order. Opening a group adds its recipe ID and input slot to the fragment so the link restores both dialogs. Closing that group returns to the recipe. Earlier item detail links still work, and links without a server alias open the default server. Keep the original ZIP private and only import exports whose item information is intended for public display.

For a Caddy deployment, serve the built site from `dist/`. Reverse proxy `/item-catalog/*`, `/api/item-search`, `/api/item-recipe-uses`, and `/api/live` to the same Node service as the player and server directory APIs. Caddy’s `reverse_proxy` handles the WebSocket upgrade on `/api/live`. The catalog route serves manifests, import status, pages, previews, atlases, item details, and payloads. Manifests and import status use `Cache-Control: no-cache` and support revalidation. Revision assets, including tooltip and recipe payloads, are immutable and can be served from the browser cache for a year. Keep instance directories outside the static web root so configuration, ZIPs, and search indexes stay private. A revision in a private catalog directory keeps its database alongside its manifest. When the shared catalog is under `public/` or `dist/`, its revision databases are stored under `data/item-catalog-databases/`. Include that directory when backing up a shared static catalog. Catalog data can be updated independently of the site build.

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

## Microsoft sign-in

The site and Storybook work with sign-in left unconfigured. When ready, use the [Microsoft SSO setup guide](docs/microsoft-sso.md) to configure a local development registration, a shared HTTPS preview, or the production site.

## Storybook

After `npm ci`, run `npm run storybook` and open `http://127.0.0.1:6006/`. If the port is in use, run `npm run storybook -- --port 6007`.

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

In the [grass block scene](src/portrait/blockScene.ts), the block rolls to the left after bumping the seated player. The other player claims the seat while the first investigates, then the first carries the block away. [The loop](src/portrait/portraitAnimation.ts) follows the order in [portrait-players.json](portrait-players.json). The first player performs the solo scene, then each player loses their seat to the next, wrapping back to the first player. The default cast includes [nightware6's local 64 × 64 classic Java skin](assets/nightware6-56ec53e9f367.png) from the [Minecraft texture service](https://textures.minecraft.net/texture/56ec53e9f3674c0f7aa8e99d2233002529968a1aa1428dafab94f399e0fa1463). The grass block uses an [original pixel texture](src/portrait/grassBlock.ts).

The [renderer](src/portrait/renderPortrait.ts) adapts WebCraft Armor Preview's expanded outer skin, depth testing, nearest-neighbor texture sampling, and two-light shading. It supersamples the outlines to smooth the edges in motion.

[NugwaPortrait](src/portrait/NugwaPortrait.tsx) plays the animation in Canvas 2D while the card and browser window are active. Playback resumes from the same point after switching windows or scrolling away. If the canvas fails, the card loads the transparent [animated PNG](assets/nugwa-animated.png). The transparent [seated PNG](assets/nugwa-seated.png) is shown while the canvas loads and whenever reduced motion is enabled. Both images use the same skins, renderer, and animation frames as the canvas. They are served as static assets and can be hosted independently.

Edit [portrait-players.json](portrait-players.json) to add or reorder distinct Minecraft Java usernames with public custom skins. A list with one name plays only the solo scene. Run `npm run export:nugwa` after editing the cast, poses, scenes, or renderer. It downloads skins for new names from Minecraft's profile and texture services, reuses saved skins for existing names, and regenerates the cast and both PNGs. Run `npm run export:nugwa -- --refresh-skins` to fetch updated skins for names already in the cast. The site reads the generated assets locally.

## Fonts

Headings use [Pixelify Sans](https://github.com/google/fonts/tree/main/ofl/pixelifysans) and body text uses [Barlow](https://github.com/google/fonts/tree/main/ofl/barlow). Server statistics use [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed), with installed system fonts available as fallbacks for other scripts. The build includes the Latin and Latin Extended WOFF2 files and the licenses for [Pixelify Sans](public/licenses/pixelify-sans-ofl.txt) and [Barlow](public/licenses/barlow-ofl.txt).

## History and contribution guidance

The earlier winter scene with a day cycle, layer controls, and technical notes is in commit `d7567392f459a06d22b68db41c1603c8372496bd`. The [winter reference](references/winter-scene.png) and [depth map](references/depth-map.png) are available in the repository.

See [AGENTS.md](AGENTS.md) for the repository language, workflow, and verification guidance.
