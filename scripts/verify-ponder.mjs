import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import yauzl from 'yauzl';
import { createPonder } from '../server/ponder.mts';
import { readPonderBlockModels, readPonderCompactLayout } from '../src/ponder/compact.mts';
import { ponderDefinitionsLimit, ponderDefinitionsPath, readPonderDefinitions } from '../server/ponderDefinitions.mts';
import { ponderIndexLimit, ponderIndexPath } from '../server/ponderStorage.mts';
import { ponderFramePath, ponderGeometryPath, ponderMeshBundlePath, ponderMeshSlice, ponderPickingChunkTicks, ponderPlaybackChunkTicks, ponderPlaybackPath, ponderResource, ponderUrl,
  readPonderFrame, readPonderIndex, readPonderManifest } from '../src/ponder/format.mts';
import { readPonderTimelinePatches } from '../src/ponder/timeline.mts';
import { ponderMeshStreams } from '../src/ponder/meshStreams.mts';
import { ponderBoxFaceVersion } from '../src/ponder/boxFaces.mts';
import { ponderParticleVersion } from '../src/ponder/particleQuads.mts';
import { ponderPlatformShadowAsset } from '../src/ponder/platformShadow.mts';
import { ponderRigidBatchVersion } from '../src/ponder/rigidParts.mts';
import { createPonderSource } from '../src/ponder/source.ts';
import { readPonderAtlasAnimation } from '../src/ponder/atlasAnimation.mts';
import { preparePonderImport } from './import-ponder.mjs';

const { positionals: [archive, expected, baseline, ...extra], values } = parseArgs({
  allowPositionals: true, options: { sample: { type: 'string', multiple: true }, 'verify-seeks': { type: 'boolean' },
    'all-frames': { type: 'boolean' }, 'require-complete': { type: 'boolean' }, 'audit-layout': { type: 'boolean' },
    'audit-captured': { type: 'boolean' }, 'verify-captions': { type: 'boolean' }, 'audit-captions': { type: 'boolean' } },
});
const expectedScenes = expected === undefined ? undefined : Number(expected);
if (!archive || extra.length || (expectedScenes !== undefined && (!Number.isSafeInteger(expectedScenes) || expectedScenes < 1))) {
  process.stderr.write('Usage: node scripts/verify-ponder.mjs <export.zip> [expected-scene-count [baseline.zip]] [--sample <scene@tick[=geometry-kind]>]... [--verify-seeks] [--verify-captions] [--all-frames] [--require-complete]\n'
    + '       node scripts/verify-ponder.mjs <export.zip> [expected-scene-count] --audit-layout [--audit-captured]\n'
    + '       node scripts/verify-ponder.mjs <export.zip> <expected-scene-count> <baseline.zip> --audit-captions\n');
  process.exitCode = 1;
} else if (values['audit-captions']) {
  assert.ok(baseline && !values.sample && !values['audit-layout'] && !values['audit-captured'] && !values['verify-seeks']
    && !values['all-frames'] && !values['require-complete'] && !values['verify-captions'], 'Caption audit requires only a baseline ZIP.');
  await auditCaptions(archive, baseline, expectedScenes);
} else if (values['audit-layout']) {
  assert.ok(!baseline && !values.sample && !values['verify-seeks'] && !values['all-frames'] && !values['require-complete'] && !values['verify-captions'],
    'Layout audit runs independently of import and playback verification options.');
  await auditLayout(archive, expectedScenes, values['audit-captured']);
} else {
  assert.ok(!values['audit-captured'], '--audit-captured requires --audit-layout.');
  assert.ok(!values['verify-captions'] || baseline, '--verify-captions requires a baseline ZIP.');
  await verify(archive, expectedScenes, baseline, values);
}

async function openCaptionReference(path) {
  const zip = await yauzl.openPromise(path, { autoClose: false, strictFileNames: true });
  const entries = new Map();
  try {
    for await (const entry of zip.eachEntry()) {
      assert.ok(!entries.has(entry.fileName), `Duplicate baseline entry: ${entry.fileName}`);
      entries.set(entry.fileName, entry);
    }
  } catch (error) {
    zip.close();
    throw error;
  }
  async function read(name, limit) {
    const entry = entries.get(name);
    assert.ok(entry && entry.uncompressedSize <= limit, `Missing or oversized baseline entry: ${name}`);
    return JSON.parse((await buffer(await zip.openReadStreamPromise(entry))).toString());
  }
  function frames(scene, frameCount) {
    let start = -1;
    let captions;
    let state = {};
    return async tick => {
      const chunkStart = tick - tick % ponderPlaybackChunkTicks;
      const name = scene.manifest.replace(/scene\.json$/, `timeline/${chunkStart}.json`);
      if (!entries.has(name)) {
        const path = ponderFramePath(scene, tick);
        const frame = readPonderFrame(await read(path, ponderResource(path).limit));
        assert.ok(frame, `Invalid baseline frame at tick ${tick}.`);
        return frame.captions;
      }
      if (start !== chunkStart) {
        const count = Math.min(ponderPlaybackChunkTicks, frameCount - chunkStart);
        const limit = ponderResource(ponderPlaybackPath(scene, chunkStart)).limit;
        const patches = readPonderTimelinePatches(await read(name, limit), count, ponderMeshBundlePath(scene, chunkStart));
        assert.ok(patches, `Invalid baseline timeline at tick ${chunkStart}.`);
        captions = patches.map(patch => {
          state = { ...state, ...patch };
          const frame = readPonderFrame({ ...state, scene: [], overlay: [] });
          assert.ok(frame, `Invalid baseline caption data at tick ${chunkStart}.`);
          return frame.captions;
        });
        start = chunkStart;
      }
      return captions[tick - start];
    };
  }
  return { frames, close: () => zip.close() };
}

function captionComparison(actual, expected, location) {
  if (isDeepStrictEqual(actual, expected)) return 0;
  const byContent = captions => captions.map(({ text, color, opacity, anchor }) =>
    JSON.stringify([text, color, opacity, anchor && Array.from(anchor)])).sort();
  assert.deepEqual(byContent(actual), byContent(expected), `Playback captions differ from the baseline at ${location}.`);
  return 1;
}

async function auditCaptions(path, baselinePath, expectedScenes) {
  const [archive, baseline] = await Promise.all([archiveInfo(path, false), archiveInfo(baselinePath, false)]);
  if (expectedScenes !== undefined) assert.equal(archive.index.scenes.length, expectedScenes, 'Unexpected Ponder scene count.');
  assert.deepEqual(sceneAssociations(archive.index), sceneAssociations(baseline.index), 'Scene associations differ from the baseline.');
  const oldScenes = new Map(baseline.index.scenes.map(scene => [sceneAssociation(scene), scene]));
  const current = await openCaptionReference(path);
  let reference;
  try {
    reference = await openCaptionReference(baselinePath);
    let captionFramesCompared = 0, captionFramesReordered = 0;
    const reorderedScenes = [];
    for (const scene of archive.index.scenes) {
      const old = oldScenes.get(sceneAssociation(scene));
      const { frameCount } = archive.timings.get(scene.manifest);
      assert.deepEqual(archive.timings.get(scene.manifest), baseline.timings.get(old.manifest), `Timing differs for ${scene.id}.`);
      const readCurrent = current.frames(scene, frameCount);
      const readReference = reference.frames(old, frameCount);
      let reordered = 0;
      for (let tick = 0; tick < frameCount; tick++) {
        reordered += captionComparison(await readCurrent(tick), await readReference(tick), `${scene.id} tick ${tick}`);
      }
      captionFramesCompared += frameCount;
      captionFramesReordered += reordered;
      if (reordered) reorderedScenes.push({ id: scene.id, schematic: scene.schematic, frames: reordered });
    }
    console.log(JSON.stringify({ scenes: archive.index.scenes.length, captionFramesCompared, captionFramesReordered, reorderedScenes }, null, 2));
  } finally {
    current.close();
    reference?.close();
  }
}

async function archiveInfo(path, readRevision = true) {
  const zip = await yauzl.openPromise(path, { autoClose: false, strictFileNames: true });
  const formats = { definitions: 0, models: 0, meshAssets: 0, effects: 0, textures: 0, timelines: 0, other: 0 };
  const filesByFormat = Object.fromEntries(Object.keys(formats).map(key => [key, 0]));
  let legacyIndex;
  let playbackIndex;
  let registrations;
  let coverage;
  let staticModelDiagnostics;
  let packedBytes = 0;
  const timings = new Map();
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (name === 'export-diagnostics.json' && entry.uncompressedSize <= 4 * 1024 ** 2) {
        const report = JSON.parse(await buffer(await zip.openReadStreamPromise(entry)));
        const excluded = report?.ponder?.excludedDrawSnapshotsByScene;
        const missingModels = report?.ponder?.scenes;
        if (Array.isArray(missingModels) && missingModels.every(scene =>
          typeof scene?.id === 'string' && typeof scene.schematic === 'string' && Array.isArray(scene.missingStaticModels)
          && scene.missingStaticModels.every(state => typeof state === 'string'))) {
          staticModelDiagnostics = missingModels.map(({ id, schematic }) => JSON.stringify([id, schematic])).sort();
          coverage = { ...coverage, scenesWithMissingStaticModels: missingModels
            .filter(scene => scene.missingStaticModels.length)
            .map(({ id, schematic, missingStaticModels: states }) => ({ id, schematic, states })) };
        }
        if (excluded && typeof excluded === 'object' && !Array.isArray(excluded)) {
          const shaders = new Map();
          for (const scene of Object.values(excluded)) {
            for (const [shader, count] of Object.entries(scene ?? {})) {
              if (Number.isSafeInteger(count) && count >= 0) shaders.set(shader, (shaders.get(shader) ?? 0) + count);
            }
          }
          coverage = { ...coverage, scenesWithExcludedDraws: Object.keys(excluded).length,
            excludedDrawSnapshotsByShader: Object.fromEntries([...shaders].sort((a, b) => b[1] - a[1])) };
        }
      }
      if (!name.startsWith('ponder/') || name.endsWith('/')) continue;
      if (name === ponderIndexPath) {
        assert.equal(legacyIndex, undefined, 'Duplicate Ponder index.');
        assert.ok(entry.uncompressedSize <= ponderIndexLimit, 'Ponder index is too large.');
        legacyIndex = readPonderIndex(JSON.parse(await buffer(await zip.openReadStreamPromise(entry))));
        assert.ok(legacyIndex, 'Invalid Ponder index in the ZIP.');
      } else if (name === ponderDefinitionsPath) {
        assert.ok(entry.uncompressedSize <= ponderDefinitionsLimit, 'Ponder definitions are too large.');
        const definitions = JSON.parse(await buffer(await zip.openReadStreamPromise(entry)));
        if (definitions.playback) {
          const registered = readPonderDefinitions(definitions);
          assert.ok(registered?.playback, 'Ponder playback index does not match the registered item and scene links.');
          ({ playback: playbackIndex, registrations } = registered);
        }
      }
      const resource = ponderResource(name);
      if (resource?.kind === 'manifest') {
        assert.ok(entry.uncompressedSize <= resource.limit, `Ponder scene manifest is too large: ${name}`);
        const manifest = readPonderManifest(JSON.parse(await buffer(await zip.openReadStreamPromise(entry))));
        assert.ok(manifest, `Invalid Ponder scene manifest: ${name}`);
        const { ticksPerSecond, frameCount, keyframes } = manifest;
        timings.set(name, { ticksPerSecond, frameCount, keyframes });
      }
      const group = name === ponderDefinitionsPath ? 'definitions'
        : name === 'ponder/block-models.json' || name.startsWith('ponder/rigid-parts/') ? 'models'
        : name.startsWith('ponder/meshes/') || /^ponder\/scenes\/[^/]+\/meshes\//.test(name) ? 'meshAssets'
        : name.startsWith('ponder/particle-quads/') || name.startsWith('ponder/outline-cuboids/') || name.startsWith('ponder/box-faces/')
          || name.startsWith('ponder/rigid-batches/')
          || name.startsWith('ponder/rigid-attributes/') || name.startsWith('ponder/rigid-normals/')
          || name.startsWith('ponder/rigid-glint/') || name.startsWith('ponder/lightning/') ? 'effects'
        : name.startsWith('ponder/textures/') ? 'textures'
        : /^ponder\/scenes\/[^/]+\/(?:frames|timeline)\//.test(name) ? 'timelines' : 'other';
      formats[group] += entry.uncompressedSize;
      filesByFormat[group]++;
      packedBytes += entry.compressedSize;
    }
  } finally {
    zip.close();
  }
  const index = playbackIndex ?? legacyIndex;
  assert.ok(index, 'Missing Ponder index in the ZIP.');
  let revision;
  if (readRevision) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    revision = hash.digest('hex');
  }
  return { index, timings, revision, packedBytes, expandedBytes: Object.values(formats).reduce((sum, bytes) => sum + bytes, 0),
    formats, filesByFormat, coverage, staticModelDiagnostics, registrations };
}

function sceneAssociation(scene) {
  return JSON.stringify([scene.id, scene.schematic, [...scene.items].sort()]);
}

function sceneAssociations(index) { return index.scenes.map(sceneAssociation).sort(); }

/** Inspects every archived placement without importing its geometry or creating a revision. */
async function auditLayout(path, expectedCount, includeCaptured) {
  const { index } = await archiveInfo(path, false);
  if (expectedCount !== undefined) assert.equal(index.scenes.length, expectedCount, 'Unexpected Ponder scene count.');
  const zip = await yauzl.openPromise(path, { autoClose: false, strictFileNames: true });
  try {
    const entries = new Map();
    for await (const entry of zip.eachEntry()) {
      assert.ok(!entries.has(entry.fileName), `Duplicate archive entry: ${entry.fileName}`);
      entries.set(entry.fileName, entry);
    }
    const read = async (name, limit) => {
      const entry = entries.get(name);
      assert.ok(entry && entry.uncompressedSize <= limit, `Missing or oversized archive entry: ${name}`);
      return JSON.parse((await buffer(await zip.openReadStreamPromise(entry))).toString());
    };
    const models = new Map();
    const affectedScenes = [];
    const capturedAtlasAnimationScenes = [];
    const captured = includeCaptured ? capturedDrawAudit(entries) : undefined;
    let frames = 0;
    let framesWithOmissions = 0;
    let omittedPlacements = 0;
    let omittedDraws = 0;
    for (const scene of index.scenes) {
      const manifest = readPonderManifest(await read(scene.manifest, ponderResource(scene.manifest).limit));
      assert.ok(manifest?.blockModels, `Layout audit needs a compact timeline for ${scene.id}.`);
      if (!models.has(manifest.blockModels)) {
        const palette = readPonderBlockModels(await read(manifest.blockModels, ponderResource(manifest.blockModels).limit));
        assert.ok(palette, 'Invalid shared block model palette.');
        models.set(manifest.blockModels, palette.models);
      }
      const modelPalette = models.get(manifest.blockModels);
      const counts = new WeakMap();
      const draws = new WeakMap();
      const animatedTextures = new WeakMap();
      const animatedAtlasImages = new Set();
      let framesUsingAnimatedAtlas = 0;
      let state = {};
      let affected;
      const missingPlacements = (layout, tick) => {
        if (counts.has(layout)) return counts.get(layout);
        const groups = readPonderCompactLayout(layout, modelPalette);
        assert.ok(groups, `Invalid layout in ${scene.id} at tick ${tick}.`);
        const count = groups.reduce((sum, group) => sum + group.blocks.filter(block => block[3] === -1).length, 0);
        counts.set(layout, count);
        return count;
      };
      for (let start = 0; start < manifest.frameCount; start += ponderPlaybackChunkTicks) {
        const count = Math.min(ponderPlaybackChunkTicks, manifest.frameCount - start);
        const name = scene.manifest.replace(/scene\.json$/, `timeline/${start}.json`);
        const limit = ponderResource(ponderPlaybackPath(scene, start)).limit;
        const patches = readPonderTimelinePatches(await read(name, limit), count, ponderMeshBundlePath(scene, start));
        assert.ok(patches, `Invalid timeline for ${scene.id} at tick ${start}.`);
        for (const [offset, patch] of patches.entries()) {
          const tick = start + offset;
          state = { ...state, ...patch };
          const frame = readPonderFrame(state, draws);
          assert.ok(frame, `Invalid frame in ${scene.id} at tick ${tick}.`);
          let usesAnimatedAtlas = false;
          for (const draw of frame.draws) {
            if (captured) captured.record(draw, scene, tick);
            let images = animatedTextures.get(draw);
            if (images === undefined) {
              images = Object.values(draw.textures).filter(texture => texture.animated || texture.animation || texture.atlasAnimation)
                .map(texture => texture.image);
              animatedTextures.set(draw, images);
            }
            if (!images.length) continue;
            usesAnimatedAtlas = true;
            for (const image of images) animatedAtlasImages.add(image);
          }
          if (usesAnimatedAtlas) framesUsingAnimatedAtlas++;
          const missing = missingPlacements(state.layout, tick)
            + (state.movingLayout === undefined ? 0 : missingPlacements(state.movingLayout, tick));
          frames++;
          omittedDraws += frame.omitted;
          omittedPlacements += missing;
          if (!missing && !frame.omitted) continue;
          framesWithOmissions++;
          affected ??= { id: scene.id, schematic: scene.schematic, firstTick: tick, lastTick: tick, frames: 0,
            omittedPlacements: 0, omittedDraws: 0 };
          affected.lastTick = tick;
          affected.frames++;
          affected.omittedPlacements += missing;
          affected.omittedDraws += frame.omitted;
        }
      }
      if (affected) affectedScenes.push(affected);
      if (framesUsingAnimatedAtlas) capturedAtlasAnimationScenes.push({ id: scene.id, schematic: scene.schematic,
        frames: framesUsingAnimatedAtlas, stillImages: animatedAtlasImages.size });
    }
    console.log(JSON.stringify({ scenes: index.scenes.length, frames, framesWithOmissions, omittedPlacements, omittedDraws,
      affectedScenes: affectedScenes.sort((a, b) => b.frames - a.frames),
      capturedAtlasAnimationScenes: capturedAtlasAnimationScenes.sort((a, b) => b.frames - a.frames),
      ...(captured && { captured: captured.summary() }) }, null, 2));
  } finally {
    zip.close();
  }
}

/** Counts retained vertex payloads without loading any geometry or double-counting shared byte planes. */
function capturedDrawAudit(entries) {
  const metadata = new WeakMap();
  const families = new Map();
  const assets = new Map();
  const record = (draw, scene, tick) => {
    if (!metadata.has(draw)) {
      const path = draw.vertices;
      const slice = ponderMeshSlice(path);
      const stream = ponderMeshStreams(path);
      const standalone = ponderResource(path);
      const parts = slice && !slice.geometry ? [[path, slice.size]]
        : stream ? stream.parts.map(part => [part.path, part.bytes])
          : standalone?.kind === 'mesh' ? [[path, entries.get(path)?.uncompressedSize]] : undefined;
      if (parts) {
        for (const [part, size] of parts) {
          const range = ponderMeshSlice(part);
          const entry = entries.get(range?.path ?? part);
          assert.ok(entry && (range ? range.offset + size <= entry.uncompressedSize : size === entry.uncompressedSize),
            `Missing or truncated captured vertex resource: ${part}`);
        }
        const key = JSON.stringify([draw.shader, draw.mode, draw.stride]);
        if (!families.has(key)) families.set(key, { shader: draw.shader, mode: draw.mode, stride: draw.stride,
          drawSnapshots: 0, resources: new Map(), scenes: new Map() });
        metadata.set(draw, { family: families.get(key), parts });
      } else metadata.set(draw, null);
    }
    const match = metadata.get(draw);
    if (!match) return;
    const { family, parts } = match;
    family.drawSnapshots++;
    if (!family.scenes.has(scene)) family.scenes.set(scene, { id: scene.id, schematic: scene.schematic,
      firstTick: tick, lastTick: tick, drawSnapshots: 0, resources: new Map() });
    const affected = family.scenes.get(scene);
    affected.lastTick = tick;
    affected.drawSnapshots++;
    for (const [part, size] of parts) {
      assets.set(part, size);
      family.resources.set(part, size);
      affected.resources.set(part, size);
    }
  };
  const total = parts => [...parts.values()].reduce((sum, size) => sum + size, 0);
  const highestBytesFirst = (a, b) => b.storedVertexBytes - a.storedVertexBytes;
  return { record, summary: () => ({
    resources: assets.size,
    storedVertexBytes: total(assets),
    families: [...families.values()].map(({ resources, scenes, ...family }) => ({ ...family,
      storedVertexBytes: total(resources), resources: resources.size, sceneCount: scenes.size,
      largestScenes: [...scenes.values()].map(({ resources, ...scene }) => ({
        ...scene, storedVertexBytes: total(resources),
      })).sort(highestBytesFirst).slice(0, 8),
    })).sort(highestBytesFirst),
  }) };
}

function resolveSamples(index, entries) {
  const samples = new Map();
  for (const entry of entries) {
    const sample = /^([^@]+)@(\d+)(?:=([a-z0-9-]+))?$/.exec(entry);
    assert.ok(sample && Number.isSafeInteger(Number(sample[2])), `Invalid Ponder sample: ${entry}`);
    const [, name, tick, geometry] = sample;
    const [id, schematic, ...extra] = name.split('|');
    assert.ok(id && schematic !== '' && !extra.length, `Invalid Ponder scene selector: ${name}`);
    const scenes = index.scenes.filter(scene => schematic === undefined
      ? scene.id === id || scene.schematic === id
      : scene.id === id && scene.schematic === schematic);
    assert.equal(scenes.length, 1, `Expected exactly one scene for sample ${entry}; use a unique ID or ID|schematic.`);
    const key = sceneAssociation(scenes[0]);
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key).push({ tick: Number(tick), geometry });
  }
  return samples;
}

function geometryKind(path, captured) {
  if (captured) return 'captured-mesh';
  if (path.startsWith('fluid-face:')) return 'fluid-face';
  if (path === ponderPlatformShadowAsset) return 'platform-shadow';
  const geometry = ponderGeometryPath(path);
  const kind = ponderResource(geometry)?.kind;
  if (kind === 'rigid-batch') return `rigid-batch-v${ponderRigidBatchVersion(geometry)}`;
  if (kind === 'particle-quads') {
    const version = ponderParticleVersion(geometry);
    if (version >= 3) return `particle-quads-v${version}`;
  }
  if (kind === 'box-faces') {
    const version = ponderBoxFaceVersion(geometry);
    if (version >= 3) return `box-faces-v${version}`;
  }
  if (['particle-quads', 'outline-cuboids', 'box-faces', 'rigid-glint', 'lightning'].includes(kind)) return kind;
}

function offlineFetch(handler, onRequest) {
  return async url => {
    const request = new URL(url, 'http://ponder-verification.local');
    assert.equal(request.origin, 'http://ponder-verification.local');
    assert.equal(request.pathname, '/api/ponder');
    onRequest(request.searchParams.get('path'));
    const headers = new Headers();
    let response;
    let status = 200;
    await handler({ method: 'GET', url: request.pathname + request.search, headers: {} }, {
      setHeader(name, value) { headers.set(name, String(value)); },
      writeHead(code, values) {
        status = code;
        for (const [name, value] of Object.entries(values ?? {})) headers.set(name, String(value));
        return this;
      },
      end(body) { response = new Response(body == null ? null : body, { status, headers }); },
    });
    assert.ok(response, 'The Ponder route completed without a response.');
    return response;
  };
}

async function verifySeeks(newSource, manifest, requestedTicks, pickingRequests) {
  const last = manifest.frameCount - 1;
  const ticks = new Set([0, last, ...requestedTicks]);
  for (const boundary of [ponderPlaybackChunkTicks, ponderPickingChunkTicks]) {
    for (const tick of [boundary - 1, boundary, boundary + 1]) {
      if (tick <= last) ticks.add(tick);
    }
  }
  const ascending = [...ticks].sort((a, b) => a - b);
  const forward = newSource();
  const backward = newSource();
  await forward.manifest();
  await backward.manifest();
  const beforeFrames = pickingRequests();
  const forwardFrames = new Map();
  for (const tick of ascending) forwardFrames.set(tick, await forward.frame(tick));
  for (const tick of [...ascending].reverse()) {
    assert.deepEqual(await backward.frame(tick), forwardFrames.get(tick), `Seeking backwards changed frame ${tick}.`);
  }
  assert.equal(pickingRequests(), beforeFrames, 'Loading playback frames fetched block picking data before interaction.');
  const forwardPicking = new Map();
  for (const [tick, frame] of forwardFrames) {
    if (!frame.picking) continue;
    const result = await forward.picking(frame.picking, tick);
    assert.ok(result, `Failed to reconstruct block picking at tick ${tick}.`);
    const beforeRepeat = pickingRequests();
    assert.deepEqual(await forward.picking(frame.picking, tick), result, `Repeated interaction changed picking at tick ${tick}.`);
    assert.equal(pickingRequests(), beforeRepeat, `Repeated interaction fetched picking again at tick ${tick}.`);
    forwardPicking.set(tick, result);
  }
  for (const [tick, result] of [...forwardPicking].reverse()) {
    assert.deepEqual(await backward.picking(forwardFrames.get(tick).picking, tick), result, `Seeking backwards changed picking at tick ${tick}.`);
  }
  return { ticks: ascending, pickingSnapshots: forwardPicking.size, keyframes: manifest.keyframes.length };
}

async function verify(path, expectedCount, baselinePath, options) {
  const checkSeeks = options['verify-seeks'];
  const requireComplete = options['require-complete'];
  const checkCaptions = options['verify-captions'];
  const allFrames = requireComplete || options['all-frames'] || checkCaptions;
  const archive = await archiveInfo(path);
  const samples = resolveSamples(archive.index, options.sample ?? []);
  const expected = baselinePath ? await archiveInfo(baselinePath, false) : undefined;
  if (expectedCount !== undefined) assert.equal(archive.index.scenes.length, expectedCount, 'Unexpected Ponder scene count.');
  if (expected) assert.deepEqual(sceneAssociations(archive.index), sceneAssociations(expected.index),
    'The scene IDs, schematics, or item associations differ from the baseline.');
  const referenceScenes = new Map(expected?.index.scenes.map(scene => [sceneAssociation(scene), scene]));
  const { revision, expandedBytes, packedBytes, formats, filesByFormat, coverage } = archive;
  if (requireComplete) {
    assert.ok(archive.staticModelDiagnostics && coverage?.scenesWithExcludedDraws !== undefined,
      'Complete coverage requires an export with static model and excluded draw diagnostics.');
    assert.deepEqual(archive.staticModelDiagnostics, archive.index.scenes.map(({ id, schematic }) => JSON.stringify([id, schematic])).sort(),
      'Static model diagnostics must cover every scene in the archive.');
    assert.deepEqual(coverage.scenesWithMissingStaticModels, [], 'The export reports missing static models.');
    assert.equal(coverage.scenesWithExcludedDraws, 0, 'The export reports excluded draw snapshots.');
  }
  const base = await realpath(tmpdir());
  const storage = await mkdtemp(join(base, 'capycraft-ponder-verify-'));
  const originalFetch = globalThis.fetch;
  let captionReference;
  let completed = 0;
  try {
    if (checkCaptions) captionReference = await openCaptionReference(baselinePath);
    const importStarted = performance.now();
    const imported = await preparePonderImport(path, storage, revision, revision, undefined, {
      plan() {},
      start(phase, total) {
        if (phase === 'ponder-scenes') console.error(`Validating ${total} scenes from the ZIP`);
      },
      advance(count) {
        if (count % 20 === 0) console.error(`Validated ${count} resources in the current phase`);
      },
    });
    assert.ok(imported.scenes > 0, 'The archive has no playable Ponder scenes.');
    await imported.publish();
    const importMilliseconds = Math.round(performance.now() - importStarted);
    const alias = 'verify';
    let pickingRequests = 0;
    globalThis.fetch = offlineFetch(createPonder(new Map([[alias, storage]])), path => {
      const kind = checkSeeks && path && ponderResource(path)?.kind;
      if (kind === 'picking' || kind === 'picking-chunk') pickingRequests++;
    });
    const indexResponse = await fetch(ponderUrl(alias));
    assert.equal(indexResponse.status, 200);
    const index = readPonderIndex(await indexResponse.json());
    assert.ok(index);
    assert.equal(index.scenes.length, imported.scenes);
    assert.deepEqual(sceneAssociations(index), sceneAssociations(archive.index),
      'Published scene IDs, schematics, or item associations differ from the archive.');
    if (archive.registrations !== undefined) {
      const order = new Map(archive.index.scenes.map(scene => [sceneAssociation(scene), new Map(
        scene.items.map((item, index) => [item, scene.itemOrder[index]]))]));
      for (const scene of index.scenes) {
        assert.ok(scene.itemOrder, 'Published scene is missing its per-item playback order.');
        const expectedOrder = order.get(sceneAssociation(scene));
        assert.deepEqual(new Map(scene.items.map((item, index) => [item, scene.itemOrder[index]])), expectedOrder,
          'Published scene order differs from the item registrations.');
      }
    }

    const namespaces = new Map();
    const meshes = new Map();
    const indices = new Map();
    const textures = new Set();
    const summary = { scenes: 0, frames: 0, captions: 0, pickingSnapshots: 0, assembledGeometries: 0, framesWithOmissions: 0,
      omittedDrawsAndPlacements: 0, plainMeshes: 0, indexBuffers: 0, textureResources: 0,
      reconstructedGeometryByKind: {}, archivePonderPackedBytes: packedBytes,
      archivePonderExpandedBytes: expandedBytes, archivePonderBytesByFormat: formats, archivePonderFilesByFormat: filesByFormat,
      importMilliseconds, allFrames: Boolean(allFrames), registrations: archive.registrations, ...coverage };
    if (samples.size) summary.requestedSamples = [];
    if (checkSeeks) summary.seekVerification = [];
    if (checkCaptions) {
      summary.captionFramesCompared = 0;
      summary.captionFramesReordered = 0;
    }
    if (expected) {
      summary.baselinePonderExpandedBytes = expected.expandedBytes;
      summary.expandedPonderBytesSaved = expected.expandedBytes - expandedBytes;
    }
    for (const scene of index.scenes) {
      try {
        const newSource = () => createPonderSource(alias, scene, new AbortController().signal, revision);
        const source = newSource();
        const manifest = await source.manifest();
        const { ticksPerSecond, frameCount, keyframes } = manifest;
        const timing = { ticksPerSecond, frameCount, keyframes };
        assert.deepEqual(timing, archive.timings.get(scene.manifest), 'Published playback timing differs from the archive.');
        const referenceScene = referenceScenes.get(sceneAssociation(scene));
        if (expected) assert.deepEqual(timing, expected.timings.get(referenceScene?.manifest),
          'Playback timing differs from the baseline.');
        const last = manifest.frameCount - 1;
        const selected = samples.get(sceneAssociation(scene)) ?? [];
        assert.ok(selected.every(({ tick }) => tick <= last), `Requested sample exceeds the last tick (${last}).`);
        if (checkSeeks && (!samples.size || selected.length)) {
          const checked = await verifySeeks(newSource, manifest, selected.map(({ tick }) => tick), () => pickingRequests);
          summary.seekVerification.push({ id: scene.id, schematic: scene.schematic, ...checked });
        }
        const ticks = allFrames ? Array.from({ length: frameCount }, (_, tick) => tick)
          : new Set([last, 0, Math.floor(last / 2), manifest.keyframes.at(0) ?? 0, ...selected.map(({ tick }) => tick)]);
        const geometry = new Map();
        const baselineCaptions = captionReference?.frames(referenceScene, frameCount);
        for (const tick of ticks) {
          const frame = await source.frame(tick);
          if (baselineCaptions) {
            summary.captionFramesReordered += captionComparison(frame.captions, await baselineCaptions(tick), `tick ${tick}`);
            summary.captionFramesCompared++;
          }
          if (requireComplete) {
            assert.equal(frame.omitted, 0, `Playback omits draws or placements at tick ${tick}.`);
            if (manifest.blockModels) assert.ok(frame.picking, `Missing picking data at tick ${tick}.`);
          }
          const requirements = selected.filter(sample => sample.tick === tick);
          const kindsAtTick = new Set();
          if (frame.picking) {
            assert.ok(await source.picking(frame.picking, tick), 'Failed to reconstruct the picking data.');
            summary.pickingSnapshots++;
          }
          for (const draw of frame.draws) {
            if (draw.indices) {
              const bytesPerIndex = draw.indexType === 'INT' ? 4 : 2;
              const key = JSON.stringify([draw.indices, bytesPerIndex, draw.indexCount]);
              let maximum = indices.get(key);
              if (maximum === undefined) {
                const data = Buffer.from(await source.asset(draw.indices));
                assert.ok(data.length >= draw.indexCount * bytesPerIndex, 'Ponder index buffer is truncated.');
                const hash = ponderMeshSlice(draw.indices)?.digest ?? ponderResource(draw.indices)?.digest;
                assert.ok(hash, 'Missing checksum for Ponder index buffer.');
                assert.equal(createHash('sha256').update(data).digest('hex'), hash, 'Ponder index checksum differs.');
                maximum = -1;
                for (let i = 0; i < draw.indexCount; i++) {
                  maximum = Math.max(maximum, data.readUIntLE(i * bytesPerIndex, bytesPerIndex));
                }
                indices.set(key, maximum);
                summary.indexBuffers++;
              }
              assert.ok(maximum < draw.vertexCount, 'Ponder index addresses a missing vertex.');
            }
            for (const texture of Object.values(draw.textures)) {
              const paths = [texture.image, texture.transition?.image, texture.animation, texture.atlasAnimation];
              for (const path of paths) {
                if (!path || textures.has(path)) continue;
                const data = await source.asset(path);
                const hash = ponderResource(path)?.digest;
                assert.ok(hash, 'Missing checksum for Ponder texture resource.');
                assert.equal(createHash('sha256').update(new Uint8Array(data)).digest('hex'), hash, 'Ponder texture checksum differs.');
                if (path === texture.atlasAnimation) {
                  const copies = readPonderAtlasAnimation(JSON.parse(new TextDecoder().decode(data)));
                  assert.ok(copies, 'Invalid published Ponder atlas animation.');
                  for (const { image } of copies) paths.push(image);
                }
                textures.add(path);
                summary.textureResources++;
              }
            }
            const path = draw.vertices;
            const slice = ponderMeshSlice(path);
            const captured = slice?.geometry ? undefined : slice ?? ponderMeshStreams(path);
            const kind = geometryKind(path, captured);
            if (!kind) {
              const size = draw.vertexCount * draw.stride;
              if (!meshes.has(path)) {
                const data = await source.asset(path);
                const hash = ponderResource(path)?.digest;
                assert.ok(hash, 'Missing checksum for standalone Ponder mesh.');
                assert.equal(createHash('sha256').update(new Uint8Array(data)).digest('hex'), hash, 'Ponder mesh checksum differs.');
                meshes.set(path, data.byteLength);
                summary.plainMeshes++;
              }
              assert.equal(meshes.get(path), size, 'Standalone Ponder vertex count differs from the draw.');
              continue;
            }
            if (requirements.length) kindsAtTick.add(kind);
            if (geometry.has(path)) {
              assert.equal(geometry.get(path), draw.vertexCount * draw.stride, 'Reused geometry has an inconsistent vertex count.');
              continue;
            }
            const vertices = await source.asset(path);
            assert.equal(vertices.byteLength, draw.vertexCount * draw.stride, 'Assembled vertex count differs from the draw.');
            if (captured) {
              const digest = createHash('sha256').update(new Uint8Array(vertices)).digest('hex');
              assert.equal(digest, captured.digest, 'Assembled geometry differs from the original captured bytes.');
            }
            geometry.set(path, vertices.byteLength);
            summary.assembledGeometries++;
            summary.reconstructedGeometryByKind[kind] = (summary.reconstructedGeometryByKind[kind] ?? 0) + 1;
          }
          if (requirements.length) {
            for (const sample of requirements) {
              if (sample.geometry) assert.ok(kindsAtTick.has(sample.geometry)
                || (sample.geometry === 'particle-quads' && [...kindsAtTick].some(kind => kind.startsWith('particle-quads-v')))
                || (sample.geometry === 'box-faces' && [...kindsAtTick].some(kind => kind.startsWith('box-faces-v'))),
                `Missing ${sample.geometry} at tick ${tick}.`);
            }
            summary.requestedSamples.push({ id: scene.id, schematic: scene.schematic, tick, omitted: frame.omitted,
              picking: Boolean(frame.picking), captions: frame.captions.map(({ text }) => text), geometry: [...kindsAtTick].sort() });
          }
          summary.captions += frame.captions.length;
          if (frame.omitted) summary.framesWithOmissions++;
          summary.omittedDrawsAndPlacements += frame.omitted;
          summary.frames++;
        }
        const namespace = scene.schematic.split(':', 1)[0];
        namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + 1);
        summary.scenes++;
        completed++;
        if (completed % 20 === 0) console.error(`Decoded playback ${allFrames ? 'frames' : 'samples'} for ${completed}/${index.scenes.length} scenes`);
      } catch (error) {
        throw new Error(`Ponder playback check failed in “${scene.title}” (${scene.id}) after ${completed} scenes.`, { cause: error });
      }
    }
    console.log(JSON.stringify({ ...summary, scenesByNamespace: Object.fromEntries(namespaces) }, null, 2));
  } finally {
    captionReference?.close();
    globalThis.fetch = originalFetch;
    const target = await realpath(storage);
    assert.equal(dirname(target), base);
    assert.ok(basename(target).startsWith('capycraft-ponder-verify-'));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
