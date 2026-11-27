# Publish WebCraft catalogs

## Publish a catalog update

1. In the Minecraft client with the Universium WebCraft exporter, run `/webcraft export` and choose **Export item catalog and inventory**. Use a full item catalog export for production. Each import replaces the selected instance's catalog. A test export or a filtered export will publish only the entries it contains.
2. Copy the archive into the instance's `imports/` directory on the host running the Capycraft Node API. The default ATM10 path is `data/instances/atm10/imports/`, relative to the project root. Use a temporary name such as `previews.zip.part` during the transfer. When the copy finishes and the inbox has no pending `previews.zip`, rename the temporary file to `previews.zip`.
3. Leave the Node API running. It picks up the archive automatically. Select the instance on the site to follow progress, then open **Items** to check the published catalog.

The instance's `imports/` directory sits next to its `server.json`. If `CAPYCRAFT_INSTANCE_DIR` points elsewhere, use that instance directory on the API host. The shared `data/item-imports/` inbox still works for the default server or the server selected with `CAPYCRAFT_ITEM_SERVER`.

### Archive formats and images

For standalone previews, the importer prefers an animated WebP or APNG from `animations/` and otherwise uses the WebP or PNG in `previews/`. Animated icons are served as individual images. Fluid icons come from the texture references in WebCraft machine recipes. The importer preserves animated WebP and APNG textures in the catalog and machine slots. Tooltip, stack, and recipe documents can come from standalone JSON files or the shared bundles in newer WebCraft exports. The importer resolves compact crafting ingredient tags from the exported tag documents. Resubmitting an older archive can rebuild its catalog after importer changes.

WebCraft can optionally pack static previews into atlases. The UTF-8 `previews/atlas-index.json` file specifies `version: 1`, `tileSize: 64`, `columns: 10`, `rows: 10`, an ordered `atlases` array of lowercase SHA-256 hashes, and a `sprites` object mapping existing preview keys to zero-based `[atlasIndex, tileIndex]` pairs. Each `previews/atlases/<sha256>.webp` is a 640 × 640 lossless WebP named for the hash of its exact bytes. Tiles run left to right and top to bottom, with transparent unused pixels. A mapped tile replaces that key's standalone static preview. Exports keep animated previews and their static fallbacks as individual files.

Capycraft copies exported atlas pages into either catalog storage mode and uses their tile positions in the Items grid, search results, and recipe previews. Direct icon URLs can serve a lossless tile crop on demand. An archive without an atlas index imports with individual previews. Atlases in older published revisions remain available under their existing URLs.

Advancement icons use the archive's advancement preview index when available, including stack-specific models and items outside the visible catalog. Export **Items and previews** with a current WebCraft client in a singleplayer world with the matching modpack and datapacks for complete coverage. Older archives can supply the item's ordinary catalog image. Each category uses the icon of its root advancement.

### Inbox lifecycle

The Node API creates the inbox and checks for `previews.zip` at startup and every 30 seconds. It takes the ZIP into processing and skips checks while an import is running. A new ZIP can wait in the inbox for the next check. After publishing a catalog or finding that the archive matches the active catalog, the importer removes the submitted copy. A failed archive is kept as `.failed.zip` until the next failure replaces it or the next success removes it. To use another inbox location, set `CAPYCRAFT_ITEM_IMPORT_DIR` in `.env.local` or the service environment. Keep the inbox outside `public/`, `dist/`, and the live catalog directory.

Each instance writes one diagnostic log at `data/item-import-logs/<server>/latest.log`. A new import replaces that file. A successful import removes it. A failed or interrupted import leaves it in place for debugging. The log contains timestamps, elapsed time, phase changes, progress updates every 15 seconds, recipe index counts and compressed bytes, and any final error. The web status is stored separately. Manual imports use the same diagnostic log.

### Manual imports and migration

Deploy the updated Node API and frontend before importing an atlas-enabled ZIP. The running API chooses the inbox worker mode at startup. To import a ZIP explicitly, run the following from the project root.

```sh
npm run import:items -- /path/to/previews.zip
```

The [import script](../scripts/import-items.mjs) leaves an explicitly supplied archive in place. Set `CAPYCRAFT_ITEM_SERVER` to choose the configured instance for an explicit import. New catalogs are prepared in `catalog/` alongside that instance's `server.json` and `imports/`. Existing catalogs in the shared catalog directory keep their location. To move a file-backed catalog into its instance directory, stop the API and any running imports, move the entire catalog into `catalog/`, and restart the API and local Vite server. For a SQLite-backed catalog in the static directory, re-import the WebCraft ZIP with the new location configured. The default instance without a `server.json` uses the shared directory, `public/item-catalog/` by default. Set `CAPYCRAFT_ITEM_CATALOG_DIR` to point to an existing shared directory in a different location. The importer copies preview images and atlases from the archive without re-encoding them. For standalone previews, it prefers WebP when both formats are available. New revisions store the original preview bytes, item data, and indexes in one SQLite database. The importer runs at reduced process priority when supported and checks host CPU usage between batches of items. The revision's `import-metrics.json` records counts and sizes for ZIP reads and SQLite writes.

The ingredient options dialog can show icons for items outside the imported catalog when the WebCraft ZIP includes `catalog-data/recipe-item-previews.json`. These icons are stored with the revision and used in the dialog. Catalog browsing, search and item links still use the regular item list. Older archives can omit this index.

### Live publication

The site subscribes to the selected server through `/api/live`. The API watches the catalog directory and sends import status and catalog changes, including imports started from the command line. The notice shows one overall percentage and the current step out of the number of steps for the archive. Each applicable step carries an equal share of the total. Expand the notice to see archive checks and reading, Ponder scenes and schematics, catalog items and images, recipe-use indexing, and publication. Counts show progress within the active step for scenes, schematics, items, and recipe ingredients. Steps the archive does not require are skipped. For archive checks and publication, timings from previous successful imports can estimate progress within the step.

First imports publish completed items in batches. During updates, visitors can keep using the existing catalog. The importer stages the replacement in a separate directory and switches `catalog.json` in one filesystem operation after all files are ready. The notice clears and open Items views load the new revision. The previous complete revision remains available as the only backup. Its own `catalog.json` is stored inside its revision directory. A failed update leaves the current catalog available.

### Machine and fluid recipes

Use a full WebCraft export containing machine recipes to publish them with the replacement catalog. The importer reads both recipes stored directly in result files and recipes referenced through shared groups. Production recipes captured from JEI or EMI appear under the machines that run them. The cards use the exported slot positions and show item counts and fluid amounts. **Ingredients and results** appears when the diagram leaves out exported alternatives or slots without positions. A complete machine recipe replaces the result-only entry with the same recipe ID in **Other**.

Fluids with exported production recipes appear as searchable catalog entries alongside items such as filled buckets. The importer reads their recipe files from `catalog-data/machine-recipes/fluids/`. A fluid recipe file can supply a display `name` and a `previewKey` pointing to a standalone preview or an atlas tile. When those fields are absent, the catalog derives the name from the fluid ID and uses a generic drop icon.

## Serving and storage

Use the [production Caddy routes](deployment.md#caddy-routes) for catalog, search, and live requests. The catalog route serves manifests, import status, pages, previews, atlases, item details, and payloads. Manifests and import status use `Cache-Control: no-cache` and support revalidation. Revision assets, including tooltip and recipe payloads, are immutable and can be served from the browser cache for a year. Keep instance directories outside the static web root so configuration, ZIPs, and search indexes stay private. A revision in a private catalog directory keeps its database alongside its manifest. When the shared catalog is under `public/` or `dist/`, its revision databases are stored under `data/item-catalog-databases/`. Include that directory when backing up a shared static catalog. Catalog data can be updated independently of the site build.

## Optional shared recipe cache

For shared caching of recipe-use queries, build Caddy with [cache-handler](https://github.com/caddyserver/cache-handler) and add `cache` to its global options. Import [the recipe cache route](../deploy/recipe-cache.caddy) before any catch-all handler and pass the Node API address. See the [deployment instructions](deployment.md#caddy-routes) for the API matcher.

```caddyfile
import deploy/recipe-cache.caddy 127.0.0.1:8787
```

The route caches successful recipe-use responses for 30 minutes. The cache key includes the query parameters for catalog server, revision, ingredient ID, and ingredient kind. Recipe details display the catalog publication time from `X-Catalog-Published-At`. The timestamp belongs to the revision and remains the same when a cache serves it. Older revisions use their own manifest file's modification time.

## Recipe uses index

SQLite imports prepare a gzip recipe-uses response for each ingredient. Ingredients with the same ordered recipe list share a response. The Node API serves those bytes directly to gzip-capable clients and decompresses them for clients requesting identity encoding. For an older published catalog with a legacy recipe-uses index, prepare these responses without reimporting the ZIP. Pass the directory that contains `catalog.json`.

```sh
node scripts/index-recipe-uses.mts data/instances/atm10/catalog
```

Keep the generated `*.recipe-uses.sqlite` alongside the revision assets when backing up an upgraded catalog. For shared catalogs in the static directory, the index is placed under `data/item-catalog-databases/` with the other revision databases.

## Isolated import benchmark

To check a WebCraft catalog ZIP in isolation, run the [benchmark script](../scripts/benchmark-item-import.mjs) from the project root. It uses temporary catalogs for file and SQLite storage and verifies matching manifests across both. Its output includes the number of copied atlases. Pass an atlas-enabled archive to exercise atlas import, or a legacy archive to check direct preview import. The optional final argument sets the number of runs per storage mode.

```sh
node scripts/benchmark-item-import.mjs /path/to/previews.zip 1
```

## Catalog and sensitive data storage

Keep the public item catalog unencrypted at rest, including its SQLite databases. If a future feature stores sensitive data, use a separate encrypted database with its own key and restricted server-side access. Keep the key separate from the database file and keep sensitive records out of the public catalog.
