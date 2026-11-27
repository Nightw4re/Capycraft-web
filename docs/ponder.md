# Ponder scenes

## Open a scene

Use the item tooltip in [Items](items.md). The previous standalone Ponder tab has been replaced by item-linked playback.

When an item has an exported scene on the selected server, pin its tooltip and choose **Ponder** or use the displayed shortcut. The player opens in a dialog. The scene picker appears when the item has several scenes. When the archive includes storyboard registrations, the picker follows the registered order for that item. Playback starts when the scene becomes visible unless reduced motion is enabled. The playback panel contains Play and Pause, Restart, Previous Keyframe, Next Keyframe, and the timeline. Markers below the timeline jump to the exported keyframes at their recorded positions. The player draws exported frame geometry and textures in WebGL 2. The exported `captions` appear over the scene in the site's font and the capture language. An arrow points to the exported anchor when it is visible in the frame. The player fits the caption box to the available space. Web captions replace standalone text bubbles. Mixed and image overlays stay on the canvas.

The pump scene lets visitors inspect its working parts. The platform remains visible and blocks selection of parts behind it. For other v1 scenes, the items associated with the scene are the inspectable parts.

## Import and storage

Capture Ponder scenes in a Minecraft client with WebCraft Exporter. Use the [catalog inbox or explicit import command](catalog-publishing.md#publish-a-catalog-update) for the target instance. A Ponder-only export updates scenes without replacing the item catalog. An item-only export leaves the existing scenes available. When an export includes both sections, Capycraft validates the Ponder files before publishing. The Minecraft server does not need the ZIP or the WebCraft Ponder add-on for this workflow.

Capycraft stores scene files and their referenced resources in the private `.ponder` directory under the configured instance root. The import verifies documents, references, asset checksums, and size limits. Large base textures are resized for browser playback. A failed import leaves the previous scenes available. The browser revalidates the index at `GET /api/ponder?server=<alias>` and fetches the opened scene's resources by revision. Revision responses are immutable and can be served with the Minecraft server offline.

WebCraft's `ponder-definitions` archives use the same import inbox. Capycraft validates each resolved timeline against the definition's item registrations, checks its compressed NBT and rendering assets, and publishes the changed frames for the web player. Captions remain text. The import preserves the item catalog. Older definitions archives containing instruction metadata and schematics preserve the existing playback revision and provide text guides.

For newer timelines, the importer validates and stores resolved block, section, and effect events privately. It applies supported rigid motion to shared opaque meshes when compiling playback frames. The platform shadow follows camera motion independently of the blocks. Animated block entities and custom effects still use exported draw data.

## Playback formats

Compact WebCraft Ponder exports (`--sections ponder`, previously `--sections ponder-compact`) contain a shared baked block-model palette and layout snapshots. The importer publishes 16-tick visual chunks with a checkpoint and subsequent changes. Chunks can store individual draw and placement edits, and item registrations can reference shared scene definitions. The importer also reads the earlier inline definitions and timeline arrays. The browser fetches the chunk for the current position, caches recent chunks, and assembles each frame locally using shared meshes and sprite textures. Captured meshes with shared vertex streams are reconstructed byte for byte. The player can seek to a chunk without loading earlier chunks. Block picking uses separate 64-tick chunks with shared shapes and changes to placements and transforms. The player requests these when a visitor moves the pointer over the scene, clicks it, or opens the parts list. Coverage of custom renderers and material behavior varies by scene.

For supported Catnip fluid surfaces, playback builds tiled quads locally from exported face dimensions, pose, sprite, tint and light data. The importer validates the faces and their texture references before publishing a scene.

The player sorts translucent standalone liquid faces and procedural fluid surfaces together in camera depth before drawing the shared glass shells. New exports supply face centers on the shared models. Older model entries use their block center.

Shared model placements can include a local offset from the integer block coordinates. The player applies it in the section's coordinate system. Picking keeps the original block coordinates and uses the exported game outline.

Timeline sections can share repeated draw attributes, texture descriptors, matrices and mesh references across scene and overlay draws. The player expands these references within the section before applying the changes for each tick.

Captured geometry with shared vertex attributes can use an exact palette for its position stream. The importer verifies the reconstructed mesh checksum and the player reconstructs all original coordinate bits on demand. Older mesh streams remain readable.

Supported particle batches store one parameter record per quad. Version 3 derives shared opposite diagonals. Version 4 shares unscaled sprite orientations and stores each particle's center and size. Both versions store float corrections only for quads that need them. The browser recreates the original vertex data in submission order and uses the original texture, blend and depth settings.

Supported animated entity draws reference shared local model parts and their per-frame poses. The browser assembles their vertex buffers in the original order, including transformed normals for lighting, and reuses the draw's original index buffer when present.

A mixed entity box-face draw can contain rectangular faces, shared rigid model parts, and original vertex records. The importer checks the referenced model parts before publishing a scene. The browser reconstructs their combined vertex buffer in submission order and preserves the original index buffer for blending.

A draw using a packed block-atlas page supplies a mapping from source UV regions to the page. WebGL and Canvas 2D apply this mapping after the draw's texture matrix. The draw keeps its original vertices and index order, and the sampled regions retain their original pixel resolution.

Moving part poses from newer compact exports use the same palette as static blocks. The player applies each part's pose and texture offset independently, then combines the result with the captured fluid, entity, and particle draws.

Packed WebCraft ZIPs already contain picking chunks and small-mesh bundles. The importer validates all intermediate picking snapshots in one pass through each chunk and reuses the validated block outlines within it. It reuses validated draws carried forward by timeline edits and copies draws whose texture references change during import. It also validates each mesh slice and stores the bundle as one file. The browser fetches the bundle once and reuses it for the meshes in that section. Earlier archives still import through the same inbox.

Timeline chunk version 9 restores repeated matrix coefficients for planar rotations before applying a placement change. The importer and browser accept the earlier fixed-point matrix encoding as well. Each seekable chunk still carries its own starting state.

Version 10 shortens moving layout edits. The list begins with the new placement count. A single string edit updates a matrix, a nonnegative scalar selects a shared pose, and a negative scalar `-1 - index` selects shared texture offsets. Other edits keep the existing tuple form. The importer and browser use the same decoder, so backward seeks and chunk boundaries retain their previous semantics.

The item dialog can also show a text guide from the resolved captions in a definition. `GET /api/ponder?server=<alias>&mode=guides` serves the ordered captions and item associations. A captured scene takes precedence when both formats cover the same item, scene ID and schematic. When the playback index includes registration order, the picker uses that order for the selected item. Links to a selected scene also include its schematic so variants with the same scene ID can be opened separately.

Playback uses built-in shader equivalents for common opaque, cutout, translucent, text, and entity draws, in capture order. WebGL 2 renders at the display's pixel density within a bounded resolution. If WebGL 2 is unavailable or its context is lost, a bounded Canvas 2D renderer plays the captured frames in software. Its lower resolution and simpler texture sampling keep CPU rendering practical. Section buttons jump to captured keyframes. For scenes that contain block outlines, hover to locate a block or click to pause and inspect it. The keyboard-accessible parts list shows the same information. Animated atlases use the captured still texture, while recorded geometry and particles still move. If a texture or mesh is unavailable, playback continues with the resources that loaded and reports that the visuals are incomplete. Free camera controls, custom Minecraft shaders, and exact lighting and fog are outside this player.

## Offline archive verification

Run `node scripts/verify-ponder.mjs "<export.zip>" 240` to verify a full ATM10 Ponder export offline. The script imports into a temporary revision and samples the beginning, middle, end, and first keyframe of each scene through the playback reader. It verifies picking snapshots, reconstructs geometry, and checks mesh, index and texture resources against their checksums. It reports the import time, archive size and resource counts. When the export includes draw coverage diagnostics, it also reports the excluded draw snapshots by shader. The script removes the temporary revision. The scene count is optional.

Pass repeatable `--sample <scene@tick>` arguments to check specific frames in an existing export. Append `=rigid-batch-v4`, `=rigid-glint`, or another geometry kind from the report to require that frame to use it. For example, `--sample create:contraption_controls@452=rigid-batch-v4 --sample create_enchantment_industry:experience.intro@155=rigid-glint` checks both codecs using a recent ATM10 export that includes those scenes. The report lists captions, picking availability and omitted draws for each requested frame. These checks run without Minecraft or a web server.

If an ID or schematic matches several scenes, quote a selector with both values. For example, `--sample "kubejs:fission_mek|kubejs:fission_mek@60"` selects the reactor introduction while excluding the fuel assembly and port scenes.

Add `--verify-seeks` to load the first and last frames, frames around the playback and picking chunk boundaries, and the requested samples in both directions. The verifier checks that the frames and picking results agree, that loading frames leaves picking data unloaded, and that repeated interaction at a tick uses cached picking data. With `--sample` this check covers the selected scenes. Otherwise it covers every scene in the archive.

Add `--all-frames` to check every tick, with its geometry, textures, and available picking data. For a release candidate, use `--require-complete` to check every tick and fail on any omitted draw or placement. This strict mode also requires export diagnostics and fails if they report missing static models or excluded draw snapshots. These checks validate the decoded data. Compare representative scenes with the game to verify their appearance.

Use `node scripts/verify-ponder.mjs "<export.zip>" 240 --audit-layout` for a quicker diagnosis of a compact ATM10 archive. It reads every tick directly from the ZIP and lists the first and last affected tick, missing model placements, and unrecognized draws per scene. This check leaves the ZIP and published revisions untouched. Use full verification to also check mesh and texture resources, picking, and playback.

The layout audit lists scenes that reference still atlas images marked as containing animated sprites. A padded atlas region can include neighboring sprites, so these counts identify candidate scenes for a visual check. Shared block and fluid sprites with their own animation frames are outside this count.

Captured atlas draws and shared static or moving models can provide `atlasAnimation`, a content-addressed list of sprite copies. Each copy references a shared PNG sheet and lists Minecraft frame indices, tick durations, the destination pixel rectangle, and the crop within a source frame. Import verifies both rectangles and the frame indices at original resolution. Both WebGL and Canvas select the sprite frames from the scene tick, including when seeking backwards. For the RGBA sheets produced by Minecraft, Canvas decodes the original bytes before interpolation to preserve RGB beneath transparency. The player fetches each shared sheet as needed. Run `npm run test:e2e -- ponder-atlas.spec.mjs` for a standalone Chromium check of captured and shared model draws in both renderers.

Both renderers sample captured lightmaps at the vertices. The block shaders use filtered lightmap coordinates and the particle and text shaders use direct texels. Entity shaders that apply an overlay before illumination interpolate the lightmap color independently. Compact shared parts can still contain shading evaluated by the exporter in their local pose.

Pass a baseline ZIP after the expected scene count and add `--verify-captions` to compare the published caption text, appearance, and position at every tick. Use `--audit-captions` with the same ZIPs to compare only archived captions and scene timing without importing either ZIP. Both checks report ticks where simultaneous captions are emitted in a different order.

Add `--audit-captured` to group captured vertex payloads by shader, primitive mode, and vertex stride. The report counts each stored vertex payload once in the overall total and separately within each relevant family and scene. Family and scene byte counts can overlap. Index buffers, compact effect codecs, and unused data do not count as captured vertex payloads.

Pass a baseline ZIP after the expected count to compare scene IDs, schematics, item associations, timing, and uncompressed size with an earlier export of the same pack.

Run `node --test tests/ponder.test.mts` to check v1 parsing, import validation, and the local API resource allowlist.

## Browser regression tests for ATM10

Run the Playwright suite against a running Capycraft site and API with the English ATM10 item catalog and Ponder data loaded. The default address is `http://127.0.0.1:5173`. Set `CAPYCRAFT_E2E_URL` to test another Capycraft address. The suite connects to the existing site and uses a fresh browser context for each test.

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
npm run test:e2e -- --headed --grep "Fluid Pipe opens the correct animation"
```

The [ATM10 browser scenarios](../tests/e2e/item-ponder.spec.mjs) check lore colors and formatting, item pinning and recipe navigation, the persistent F3 + H toggle, the item-specific Stick shortcut, Ponder availability, scene selection and playback, the Fluid Pipe caption at 23.7 seconds, and the touch layout. On failure, `test-results/` contains a screenshot or trace when available. Open a trace with `npx playwright show-trace <trace.zip>`.

Use `node scripts/compare-ponder-reference.mjs "<previews.zip>" "<report-directory>"` with a WebCraft export made using `--ponder-reference-ticks`. The script imports into a temporary directory and renders matching scene ticks in headless Chromium without a running API or Vite server. The report includes both PNGs, foreground overlap, and RGB differences. It reports missing assets and omitted draws separately from visual differences. The scene ticks match, but Minecraft's atlas can be at a different animation phase because it also ticks outside the Ponder scene.

Run `npm run test:e2e -- tests/e2e/ponder-renderer.spec.mjs` to verify sprite interpolation and the GUI depth layer in Chromium without a running Capycraft server. The test checks the rendered pixels, including the current sprite's alpha and the order of depth-tested GUI models.

The KubeJS reactor scenario checks the animated scene when published and the ordered text guide otherwise. After a full timeline import, set `$env:CAPYCRAFT_E2E_REQUIRE_KUBEJS_ANIMATION = '1'` before running the suite to require animated playback for that scene.
