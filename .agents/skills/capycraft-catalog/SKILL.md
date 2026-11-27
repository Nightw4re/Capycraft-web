---
name: capycraft-catalog
description: Work on Capycraft WebCraft catalog imports, recipe indexes, and Ponder archives or playback. Covers export compatibility and revision publication.
---

# Capycraft catalog and Ponder

Use this workflow for archive-to-browser changes. For a UI-only change, start with the affected component and the relevant [Items guide](../../../docs/items.md) or [Ponder guide](../../../docs/ponder.md).

1. Identify the server alias, archive sections, and active revision. Use the [catalog publishing guide](../../../docs/catalog-publishing.md) for inbox, validation, storage, and compatibility behavior. Start with `scripts/import-items.mjs` for shared ingestion and `scripts/import-ponder.mjs` for scene ingestion.
2. Trace the changed boundary into `server/itemCatalog.mts` or `server/ponder.mts` and the corresponding browser reader. Keep revisions usable for existing archives and follow the [catalog storage policy](../../../docs/catalog-publishing.md#catalog-and-sensitive-data-storage).
3. Use the smallest check described in the relevant guide. For captured frames, prefer the offline `node scripts/verify-ponder.mjs <export.zip>` workflow. Use the running-site Playwright scenarios when the browser interaction needs coverage and the fixtures are present.
