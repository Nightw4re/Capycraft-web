import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { ponderBlockModelsPath, ponderFramePath, ponderGeometryPath, ponderMeshBundlePath, ponderMeshSlice, ponderPickingChunkPath, ponderPickingChunkTicks, ponderPlaybackPath, ponderResource, readPonderFrame, readPonderIndex,
  readPonderManifest } from '../src/ponder/format.mts';
import { readPonderPicking } from '../src/ponder/picking.mts';
import { createPonderPickingChunk, validatePonderPickingChunk } from '../src/ponder/pickingChunks.mts';
import { readPonderBlockModels, readPonderCompactLayout } from '../src/ponder/compact.mts';
import { encodePonderTimelinePatches, readPonderTimelinePatches } from '../src/ponder/timeline.mts';
import { assemblePonderMesh, ponderMeshStreams } from '../src/ponder/meshStreams.mts';
import { readPonderFluidFaces } from '../src/ponder/fluidFaces.mts';
import { ponderAtlasCopyFits, ponderAtlasFrameFits, readPonderAtlasAnimation } from '../src/ponder/atlasAnimation.mts';
import { isPonderParticleAttributeLayout, ponderParticleQuadCount, ponderParticleVersion } from '../src/ponder/particleQuads.mts';
import { isPonderOutlineDraw, outlineCuboidVertices, ponderOutlineCuboidCount } from '../src/ponder/outlineCuboids.mts';
import { isPonderBoxFaceDraw, ponderBoxFaceVersion, ponderBoxFaceVertexCount, readPonderMixedBoxFaces } from '../src/ponder/boxFaces.mts';
import { isPonderGlintDraw, readPonderGlintBatch } from '../src/ponder/glintParts.mts';
import { isPonderLightningDraw, ponderLightningVertexCount } from '../src/ponder/lightning.mts';
import { isPonderRigidAttributeLayout, ponderRigidAttributeCount, ponderRigidBatchVersion, ponderRigidNormalLayout,
  ponderRigidNormalPaletteCount, ponderRigidPartVertexCount,
  readPonderRigidBatch } from '../src/ponder/rigidParts.mts';
import { applyPonderSceneOffset, applyPonderSceneTransform, createPonderEventState } from '../server/ponderEvents.mts';
import { isPonderTimelinePath, ponderDefinitionsLimit, ponderDefinitionsPath, ponderSchematicHash, ponderSchematicLimit,
  ponderTimelineChunkTicks,
  readPonderDefinitions } from '../server/ponderDefinitions.mts';
import { activePonder, ponderIndexLimit, ponderIndexPath } from '../server/ponderStorage.mts';

const maxInputImage = 64 * 1024 ** 2;
const maxTextureSide = 2048;
const maxPublishedBytes = 4 * 1024 ** 3;
const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const timelineFields = new Set(['scene', 'sceneToGui', 'overlay', 'captions', 'picking', 'sceneOffset', 'sceneTransform',
  'layout', 'movingLayout', 'fluidFaces', 'events']);

function removeRevision(directory, path) {
  if (dirname(resolve(path)) !== resolve(directory)) throw new Error('Invalid Ponder staging directory.');
  return rm(path, { recursive: true, force: true });
}

function revisionWriter(zip, entries, staging) {
  let totalBytes = 0;
  const folders = new Set();

  async function read(name, limit) {
    const entry = entries.get(name);
    if (!entry || entry.uncompressedSize < 1 || entry.uncompressedSize > limit) {
      throw new Error('Missing or oversized Ponder resource: ' + name);
    }
    return buffer(await zip.openReadStreamPromise(entry));
  }

  async function write(name, bytes) {
    totalBytes += bytes.length;
    if (totalBytes > maxPublishedBytes) throw new Error('Ponder export exceeds the storage limit.');
    const file = join(staging, name);
    const folder = dirname(file);
    if (!folders.has(folder)) {
      await mkdir(folder, { recursive: true });
      folders.add(folder);
    }
    await writeFile(file, bytes);
  }

  return { read, write };
}

async function publishScenes({ read, write }, pace, playback, report) {
  const assets = new Map();
  const imageSizes = new Map();
  const atlasAnimations = new Map();
  const validatedAtlasPages = new Set();
  const meshSizes = new Map();
  const particleCounts = new Map();
  const outlineCounts = new Map();
  const glintVertexCounts = new Map();
  const lightningVertexCounts = new Map();
  const rigidVertexCounts = new Map();
  const rigidCornerParts = new Set();
  const rigidPartNormals = new Map();
  const rigidNormalPaletteCounts = new Map();
  const pickingSnapshots = new Map();
  const meshChunks = new Map();
  const meshStreams = new Map();
  const writtenMeshChunks = new Set();
  const verifiedSlices = new Set();
  const verifiedStreams = new Set();
  function rememberMeshStream(path, bytes) {
    if (!meshStreams.delete(path) && meshStreams.size >= 48) meshStreams.delete(meshStreams.keys().next().value);
    meshStreams.set(path, bytes);
  }

  async function streamReference(path, streams) {
    if (verifiedStreams.has(path)) return;
    const parts = [];
    for (const part of streams.parts) {
      await asset(part.path, 'mesh', undefined, true);
      if (meshSizes.get(part.path) !== part.bytes) throw new Error('Invalid Ponder mesh stream size: ' + part.path);
      const bytes = meshStreams.get(part.path) ?? await read(part.path, part.bytes);
      rememberMeshStream(part.path, bytes);
      parts.push(bytes);
    }
    const rebuilt = assemblePonderMesh(streams, parts);
    if (!rebuilt || digest(rebuilt) !== streams.digest) throw new Error('Invalid Ponder mesh stream checksum: ' + path);
    verifiedStreams.add(path);
  }

  function assertSliceScene(slice, directory, path) {
    if (posix.dirname(slice.path) !== `${directory}/meshes`) throw new Error('Ponder mesh belongs to another scene: ' + path);
  }
  async function readSlice(path, slice) {
    let bytes = meshChunks.get(slice.path);
    if (!bytes) {
      await pace();
      bytes = await read(slice.path, ponderResource(slice.path).limit);
      if (meshChunks.size >= 4) meshChunks.delete(meshChunks.keys().next().value);
      meshChunks.set(slice.path, bytes);
    }
    const selected = bytes.subarray(slice.offset, slice.offset + slice.size);
    if (selected.length !== slice.size || (!verifiedSlices.has(path) && digest(selected) !== slice.digest)) {
      throw new Error('Ponder mesh slice has an invalid checksum or range: ' + path);
    }
    if (!writtenMeshChunks.has(slice.path)) {
      await write(slice.path, bytes);
      writtenMeshChunks.add(slice.path);
    }
    verifiedSlices.add(path);
    return selected;
  }
  async function meshReference(path, directory) {
    const slice = ponderMeshSlice(path);
    if (!slice) return asset(path, 'mesh');
    assertSliceScene(slice, directory, path);
    if (slice.geometry) throw new Error('Expected unencoded Ponder mesh: ' + path);
    if (!verifiedSlices.has(path)) await readSlice(path, slice);
  }
  async function pickingSnapshot(name) {
    if (pickingSnapshots.has(name)) return pickingSnapshots.get(name);
    const resource = ponderResource(name);
    if (resource?.kind !== 'picking') throw new Error('Invalid Ponder picking reference: ' + name);
    const bytes = await read(name, resource.limit);
    if (digest(bytes) !== resource.digest) throw new Error('Ponder resource has an invalid checksum: ' + name);
    const snapshot = readPonderPicking(JSON.parse(bytes.toString()));
    if (!snapshot) throw new Error('Invalid Ponder picking data: ' + name);
    if (pickingSnapshots.size >= 64) pickingSnapshots.delete(pickingSnapshots.keys().next().value);
    pickingSnapshots.set(name, snapshot);
    return snapshot;
  }

  async function validateRigidBatchAssets(batch) {
    for (const part of batch.parts) {
      await asset(part.path, 'rigid-part');
      if (rigidVertexCounts.get(part.path) !== part.count) throw new Error('Invalid Ponder rigid part length: ' + part.path);
      if (part.faceNormals && !rigidCornerParts.has(part.path)) throw new Error('Invalid Ponder rigid cuboid corners: ' + part.path);
      const normalLayout = rigidPartNormals.get(part.path);
      if (part.normals) {
        await asset(part.normals, 'rigid-normals');
        if (rigidNormalPaletteCounts.get(part.normals) !== normalLayout.normals) {
          throw new Error('Invalid Ponder rigid normal palette length: ' + part.normals);
        }
      } else if (!normalLayout.axisAligned) {
        throw new Error('Missing Ponder rigid normal palette: ' + part.path);
      }
      if (part.attributes) {
        await asset(part.attributes, 'rigid-attributes');
        if (rigidVertexCounts.get(part.attributes) !== part.count) {
          throw new Error('Invalid Ponder rigid attribute length: ' + part.attributes);
        }
      }
    }
  }

  async function asset(name, kind, directory, retainStream = false) {
    const slice = directory === undefined ? undefined : ponderMeshSlice(name);
    if (slice) assertSliceScene(slice, directory, name);
    const cached = assets.get(name);
    if (cached) return cached;
    const geometry = slice?.geometry ?? name;
    const resource = ponderResource(geometry);
    if (resource?.kind !== kind || !resource.digest) throw new Error('Invalid Ponder resource reference: ' + name);
    if (!slice) await pace();
    let bytes = slice ? await readSlice(name, slice) : await read(name, kind === 'image' ? maxInputImage : resource.limit);
    if (!slice && digest(bytes) !== resource.digest) throw new Error('Ponder resource has an invalid checksum: ' + name);
    let output = name;
    if (kind === 'image') {
      if (bytes.length < 33 || !bytes.subarray(0, pngHeader.length).equals(pngHeader)) {
        throw new Error('Invalid Ponder texture: ' + name);
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (!width || !height || width > 8192 || height > 8192) throw new Error('Invalid Ponder texture dimensions: ' + name);
      imageSizes.set(name, [width, height]);
      if (width > maxTextureSide || height > maxTextureSide || bytes.length > resource.limit) {
        bytes = await sharp(bytes, { limitInputPixels: 8192 ** 2 }).resize({
          width: maxTextureSide, height: maxTextureSide, fit: 'inside', kernel: 'nearest', withoutEnlargement: true,
        }).png().toBuffer();
        output = 'ponder/textures/' + digest(bytes) + '.png';
      } else {
        // Decode once so corrupt PNG payloads cannot make it into a published scene.
        await sharp(bytes).stats();
      }
    } else if (kind === 'particle-quads') {
      const count = ponderParticleQuadCount(bytes, ponderParticleVersion(geometry));
      if (!count) throw new Error('Invalid Ponder particle quads: ' + name);
      particleCounts.set(name, count);
    } else if (kind === 'outline-cuboids') {
      const count = ponderOutlineCuboidCount(bytes);
      if (!count) throw new Error('Invalid Ponder outline cuboids: ' + name);
      outlineCounts.set(name, count);
    } else if (kind === 'box-faces') {
      const version = ponderBoxFaceVersion(geometry);
      const mixed = version === 4 ? readPonderMixedBoxFaces(bytes, version) : undefined;
      const count = version === 4 ? mixed?.vertices : ponderBoxFaceVertexCount(bytes, version);
      if (!count) throw new Error('Invalid Ponder box faces: ' + name);
      for (const run of mixed?.runs ?? []) {
        if (run.kind === 'rigid') await validateRigidBatchAssets(run.batch);
      }
      rigidVertexCounts.set(name, count);
    } else if (kind === 'rigid-part') {
      const count = ponderRigidPartVertexCount(bytes);
      if (!count) throw new Error('Invalid Ponder rigid part: ' + name);
      rigidVertexCounts.set(name, count);
      if (ponderRigidPartVertexCount(bytes, true)) rigidCornerParts.add(name);
      const { count: normals, axisAligned } = ponderRigidNormalLayout(bytes);
      rigidPartNormals.set(name, { normals, axisAligned });
    } else if (kind === 'rigid-attributes') {
      const count = ponderRigidAttributeCount(bytes);
      if (!count) throw new Error('Invalid Ponder rigid attributes: ' + name);
      rigidVertexCounts.set(name, count);
    } else if (kind === 'rigid-normals') {
      const count = ponderRigidNormalPaletteCount(bytes);
      if (!count) throw new Error('Invalid Ponder rigid normal palette: ' + name);
      rigidNormalPaletteCounts.set(name, count);
    } else if (kind === 'rigid-batch') {
      const batch = readPonderRigidBatch(bytes, ponderRigidBatchVersion(geometry));
      if (!batch) throw new Error('Invalid Ponder rigid batch: ' + name);
      await validateRigidBatchAssets(batch);
      rigidVertexCounts.set(name, batch.vertices);
    } else if (kind === 'rigid-glint') {
      const batch = readPonderGlintBatch(bytes);
      if (!batch) throw new Error('Invalid Ponder glint batch: ' + name);
      for (const part of batch.parts) {
        await asset(part.path, 'rigid-part');
        if (rigidVertexCounts.get(part.path) !== part.count) throw new Error('Invalid Ponder glint part length: ' + part.path);
      }
      glintVertexCounts.set(name, batch.vertices);
    } else if (kind === 'lightning') {
      const count = ponderLightningVertexCount(bytes);
      if (!count) throw new Error('Invalid Ponder lightning batch: ' + name);
      lightningVertexCounts.set(name, count);
    } else if (kind !== 'mesh') {
      const json = JSON.parse(bytes.toString());
      if (kind === 'picking' && !readPonderPicking(json)) throw new Error('Invalid Ponder picking data: ' + name);
    }
    if (bytes.length > resource.limit) throw new Error('Normalized Ponder resource is too large: ' + name);
    if (!slice) await write(output, bytes);
    if (kind === 'mesh') meshSizes.set(name, bytes.length);
    if (retainStream) rememberMeshStream(name, bytes);
    assets.set(name, output);
    return output;
  }

  async function publishSprite(draw) {
    if (draw.image !== undefined) draw.image = await publishTexture(draw);
    if (draw.frames) {
      const frames = [];
      for (const [image, duration] of draw.frames) frames.push([await asset(image, 'image'), duration]);
      draw.frames = frames;
    }
  }

  async function publishTexture(texture) {
    const image = await asset(texture.image, 'image');
    if (texture.atlasAnimation !== undefined) {
      if (image !== texture.image) throw new Error('Ponder animated atlas cannot be resized: ' + texture.image);
      await publishAtlasAnimation(texture.atlasAnimation, texture.image);
    }
    return image;
  }

  async function publishAtlasAnimation(path, image) {
    const key = `${path}:${image}`;
    if (validatedAtlasPages.has(key)) return;
    let copies = atlasAnimations.get(path);
    if (!copies) {
      await asset(path, 'animation');
      copies = readPonderAtlasAnimation(JSON.parse((await read(path, ponderResource(path).limit)).toString()));
      if (!copies) throw new Error('Invalid Ponder atlas animation: ' + path);
      for (const copy of copies) {
        if (await asset(copy.image, 'image') !== copy.image || !ponderAtlasFrameFits(copy, ...imageSizes.get(copy.image))) {
          throw new Error('Invalid Ponder atlas animation sheet: ' + copy.image);
        }
      }
      atlasAnimations.set(path, copies);
    }
    if (!copies.every(copy => ponderAtlasCopyFits(copy, ...imageSizes.get(image)))) {
      throw new Error('Ponder atlas animation extends outside its texture: ' + image);
    }
    validatedAtlasPages.add(key);
  }

  async function normalizeDraw(draw, directory) {
    const vertices = typeof draw?.vertices === 'string' ? draw.vertices : '';
    const streams = ponderMeshStreams(vertices);
    const kind = ponderResource(ponderGeometryPath(vertices))?.kind;
    if (kind === 'particle-quads') {
      await asset(vertices, 'particle-quads', directory);
      const count = particleCounts.get(vertices);
      if (count * 4 !== draw.vertexCount || count * 6 !== draw.indexCount || draw.stride !== 28
        || draw.mode !== 'QUADS' || draw.shader !== 'particle' || draw.indices !== undefined
        || !isPonderParticleAttributeLayout(draw.attributes)) {
        throw new Error('Invalid Ponder particle draw: ' + vertices);
      }
    } else if (kind === 'rigid-batch') {
      await asset(vertices, 'rigid-batch', directory);
      if (rigidVertexCounts.get(vertices) !== draw.vertexCount || draw.indexCount !== draw.vertexCount / 4 * 6
        || draw.stride !== 36 || draw.mode !== 'QUADS' || !isPonderRigidAttributeLayout(draw.attributes)) {
        throw new Error('Invalid Ponder rigid draw: ' + vertices);
      }
    } else if (kind === 'box-faces') {
      await asset(vertices, 'box-faces', directory);
      if (rigidVertexCounts.get(vertices) !== draw.vertexCount || !isPonderBoxFaceDraw(draw, ponderBoxFaceVersion(ponderGeometryPath(vertices)))) {
        throw new Error('Invalid Ponder box face draw: ' + vertices);
      }
    } else if (kind === 'outline-cuboids') {
      await asset(vertices, 'outline-cuboids', directory);
      if (outlineCounts.get(vertices) * outlineCuboidVertices !== draw.vertexCount || !isPonderOutlineDraw(draw)) {
        throw new Error('Invalid Ponder outline draw: ' + vertices);
      }
    } else if (kind === 'rigid-glint') {
      await asset(vertices, 'rigid-glint', directory);
      if (glintVertexCounts.get(vertices) !== draw.vertexCount || !isPonderGlintDraw(draw)) {
        throw new Error('Invalid Ponder glint draw: ' + vertices);
      }
    } else if (kind === 'lightning') {
      await asset(vertices, 'lightning', directory);
      if (lightningVertexCounts.get(vertices) !== draw.vertexCount || !isPonderLightningDraw(draw)) {
        throw new Error('Invalid Ponder lightning draw: ' + vertices);
      }
    } else if (streams) {
      if (streams.count !== draw.vertexCount || streams.stride !== draw.stride) throw new Error('Invalid Ponder mesh stream layout.');
      await streamReference(vertices, streams);
    } else {
      if (/#v[12]:/.test(vertices)) throw new Error('Invalid Ponder mesh stream reference.');
      if (kind !== 'mesh' && !ponderMeshSlice(vertices)) return draw;
      await meshReference(vertices, directory);
    }
    if (draw.indices !== undefined) await meshReference(draw.indices, directory);
    let textures = draw.textures;
    for (const [slot, texture] of Object.entries(draw.textures ?? {})) {
      if (!texture || typeof texture.image !== 'string') continue;
      const image = await publishTexture(texture);
      if (texture.animation !== undefined) await asset(texture.animation, 'animation');
      if (image === texture.image) continue;
      if (slot !== '0') throw new Error('Cannot resize a Ponder overlay or lightmap.');
      if (textures === draw.textures) textures = { ...textures };
      textures[slot] = { ...texture, image };
    }
    return textures === draw.textures ? draw : { ...draw, textures };
  }

  const index = playback ?? readPonderIndex(JSON.parse((await read(ponderIndexPath, ponderIndexLimit)).toString()));
  if (!index) throw new Error('Invalid Ponder scene index.');
  await report?.start('ponder-scenes', index.scenes.length);
  await write(ponderIndexPath, Buffer.from(JSON.stringify(index)));
  let blockModels;
  let spriteAnimations;
  let scenesWritten = 0;
  for (const scene of index.scenes) {
    const manifestBytes = await read(scene.manifest, ponderResource(scene.manifest).limit);
    const document = JSON.parse(manifestBytes.toString());
    const manifest = readPonderManifest(document);
    if (!manifest || manifest.layoutChunks || (playback && manifest.frameTicks)) throw new Error('Invalid Ponder scene: ' + scene.id);
    const layoutChunks = playback && manifest.blockModels;
    if (manifest.blockModels && blockModels === undefined) {
      const resource = ponderResource(manifest.blockModels);
      const models = readPonderBlockModels(JSON.parse((await read(manifest.blockModels, resource.limit)).toString()));
      if (!models) throw new Error('Invalid Ponder shared block models.');
      blockModels = models.models;
      spriteAnimations = models.spriteAnimations;
      for (const animation of spriteAnimations ?? []) await publishSprite(animation);
      for (const model of models.models) {
        for (const draw of model) {
          await asset(draw.vertices, 'mesh');
          if (meshSizes.get(draw.vertices) !== draw.vertexCount * 24) throw new Error('Invalid Ponder block mesh size.');
          await publishSprite(draw);
        }
      }
      await write(manifest.blockModels, Buffer.from(JSON.stringify(models)));
    }
    const frameTicks = [];
    const frameLimit = ponderResource(ponderFramePath(scene, 0)).limit;
    const directory = posix.dirname(scene.manifest);
    const eventState = playback && createPonderEventState();
    let events;
    let chunk;
    let state;
    const normalizedDraws = new WeakMap();
    const decodedDraws = new WeakMap();
    let previousSource;
    let previousFrame;
    let publishedChunk;
    let normalizedFields;
    let pickingChunk;
    let previousPicking;
    let publishedPicking;
    async function writePickingChunk(tick) {
      const path = ponderPickingChunkPath(scene, tick);
      const bytes = Buffer.from(JSON.stringify(pickingChunk.document()));
      if (bytes.length > ponderResource(path).limit) throw new Error('Ponder picking chunk exceeds the storage limit: ' + path);
      await write(path, bytes);
    }
    async function writePlaybackChunk(start) {
      const path = ponderPlaybackPath(scene, start);
      const bytes = Buffer.from(encodePonderTimelinePatches(publishedChunk, ponderMeshBundlePath(scene, start)));
      if (bytes.length > ponderResource(path).limit) throw new Error('Ponder playback chunk exceeds the storage limit: ' + path);
      await write(path, bytes);
    }
    const ticks = manifest.frameTicks ?? { *[Symbol.iterator]() { for (let i = 0; i < manifest.frameCount; i++) yield i; } };
    for (const tick of ticks) {
      const path = ponderFramePath(scene, tick);
      const offset = tick % ponderTimelineChunkTicks;
      const pickingOffset = tick % ponderPickingChunkTicks;
      if (layoutChunks && pickingOffset === 0) {
        if (pickingChunk) await writePickingChunk(tick - 1);
        pickingChunk = undefined;
        previousPicking = undefined;
      }
      let frame;
      let retainsSource = false;
      let unchanged = () => false;
      if (playback) {
        if (offset === 0) {
          if (layoutChunks) {
            if (publishedChunk) await writePlaybackChunk(tick - ponderTimelineChunkTicks);
            await pace();
          }
          const count = Math.min(ponderTimelineChunkTicks, manifest.frameCount - tick);
          const data = await read(`${directory}/timeline/${tick}.json`, count * (frameLimit + 1) + 2);
          chunk = readPonderTimelinePatches(JSON.parse(data.toString()), count, ponderMeshBundlePath(scene, tick));
          if (!chunk) throw new Error('Invalid Ponder timeline: ' + scene.id);
          if (layoutChunks) publishedChunk = Array(count).fill({});
          events = [];
        }
        const patch = chunk[offset];
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)
          || Object.keys(patch).some(field => !timelineFields.has(field))) {
          throw new Error('Invalid Ponder timeline patch: ' + scene.id + ' at tick ' + tick);
        }
        const { events: changes, ...drawPatch } = patch;
        if (changes !== undefined) {
          if (!eventState.apply(changes)) throw new Error('Invalid Ponder events: ' + scene.id + ' at tick ' + tick);
          events.push([tick, changes]);
        }
        if (events.length && offset + 1 === chunk.length) {
          await write(`${directory}/events/${tick - offset}.json`, Buffer.from(JSON.stringify(events)));
        }
        if (state && !Object.keys(drawPatch).length && !(layoutChunks && offset === 0)) continue;
        state = { ...state, ...drawPatch };
        retainsSource = Boolean(layoutChunks && state.sceneOffset === undefined && state.sceneTransform == null);
        if (retainsSource) {
          unchanged = field => previousSource !== undefined && previousSource[field] === state[field];
          frame = { ...state };
          // Timeline edits share untouched draws. Asset normalization copies only changed textures.
          for (const layer of ['scene', 'overlay']) {
            frame[layer] = unchanged(layer) ? previousFrame[layer] : state[layer];
          }
          if (frame.fluidFaces !== undefined && unchanged('fluidFaces')) frame.fluidFaces = previousFrame.fluidFaces;
        } else {
          frame = structuredClone(state);
          if ((frame.sceneOffset !== undefined && frame.sceneTransform != null)
            || !applyPonderSceneOffset(frame.scene, frame.sceneOffset) || !applyPonderSceneTransform(frame.scene, frame.sceneTransform)) {
            throw new Error('Invalid Ponder scene motion: ' + scene.id + ' at tick ' + tick);
          }
        }
        delete frame.sceneOffset;
        delete frame.sceneTransform;
        if (!layoutChunks) frameTicks.push(tick);
      } else {
        frame = JSON.parse((await read(path, frameLimit)).toString());
      }
      if (!layoutChunks) await pace();
      if (!['scene', 'overlay', 'sceneToGui', 'captions'].every(unchanged)) {
        const decoded = readPonderFrame(frame, retainsSource ? decodedDraws : undefined);
        if (!decoded || (frame.scene.length && !decoded.draws.length && decoded.omitted)
          || (playback && frame.captions.length !== decoded.captions.length)) {
          throw new Error('Invalid Ponder frame: ' + path);
        }
      }
      if (!unchanged('layout') && (manifest.blockModels ? !readPonderCompactLayout(frame.layout, blockModels) : frame.layout !== undefined)) {
        throw new Error('Invalid Ponder block layout: ' + path);
      }
      if (!unchanged('movingLayout') && frame.movingLayout !== undefined
        && (!manifest.blockModels || !readPonderCompactLayout(frame.movingLayout, blockModels))) {
        throw new Error('Invalid Ponder moving layout: ' + path);
      }
      if (!unchanged('fluidFaces') && frame.fluidFaces !== undefined) {
        const faces = manifest.blockModels && readPonderFluidFaces(frame.fluidFaces, spriteAnimations);
        if (!faces) throw new Error('Invalid Ponder fluid faces: ' + path);
        for (const face of faces) {
          await publishSprite(face);
          face.lightmap = await asset(face.lightmap, 'image');
        }
        frame.fluidFaces = faces;
      }
      if (frame.picking !== undefined) {
        if (ponderResource(frame.picking)?.kind === 'picking-chunk') {
          const path = ponderPickingChunkPath(scene, tick);
          if (!layoutChunks || frame.picking !== path) throw new Error('Invalid Ponder picking chunk reference: ' + frame.picking);
          if (publishedPicking !== path) {
            const bytes = await read(path, ponderResource(path).limit);
            const chunk = JSON.parse(bytes.toString());
            const last = Math.min(manifest.frameCount - tick + pickingOffset, ponderPickingChunkTicks) - 1;
            if (!validatePonderPickingChunk(chunk, last)) {
              throw new Error('Invalid Ponder picking chunk: ' + path);
            }
            await write(path, bytes);
            publishedPicking = path;
          }
        } else if (layoutChunks) {
          if (frame.picking !== previousPicking) {
            pickingChunk ??= createPonderPickingChunk();
            pickingChunk.append(pickingOffset, await pickingSnapshot(frame.picking));
            previousPicking = frame.picking;
          }
          frame.picking = ponderPickingChunkPath(scene, tick);
        } else await asset(frame.picking, 'picking');
      }
      for (const layer of ['scene', 'overlay']) {
        if (unchanged(layer)) continue;
        const draws = frame[layer];
        let normalized = draws;
        for (const [index, draw] of draws.entries()) {
          const reusable = retainsSource && draw !== null && typeof draw === 'object';
          let next = reusable ? normalizedDraws.get(draw) : undefined;
          if (next === undefined) {
            next = await normalizeDraw(draw, directory);
            if (reusable) normalizedDraws.set(draw, next);
          }
          if (next !== draw) {
            if (normalized === draws) normalized = draws.slice();
            normalized[index] = next;
          }
        }
        frame[layer] = normalized;
      }
      if (layoutChunks) {
        // Checkpoints make every chunk independently seekable. Store only changed fields after the first tick.
        const fields = new Map();
        const changed = {};
        let frameBytes = 2;
        for (const [key, value] of Object.entries(frame)) {
          const previous = normalizedFields?.get(key);
          let field = previous;
          if (!previous || !Object.is(previous.value, value)) {
            const json = JSON.stringify(value);
            const bytes = json === undefined ? 0 : Buffer.byteLength(JSON.stringify(key)) + 1 + Buffer.byteLength(json);
            field = { value, json, bytes };
          }
          if (field.bytes) frameBytes += field.bytes + (frameBytes > 2 ? 1 : 0);
          if (previous?.json !== field.json) changed[key] = value;
          fields.set(key, field);
        }
        if (frameBytes > frameLimit) throw new Error('Ponder frame exceeds the storage limit: ' + path);
        publishedChunk[offset] = offset === 0 ? frame : changed;
        normalizedFields = fields;
        previousSource = retainsSource ? state : undefined;
        previousFrame = frame;
      } else {
        const bytes = Buffer.from(JSON.stringify(frame));
        if (bytes.length > frameLimit) throw new Error('Ponder frame exceeds the storage limit: ' + path);
        await write(path, bytes);
      }
    }
    if (layoutChunks) {
      await writePlaybackChunk(Math.floor((manifest.frameCount - 1) / ponderTimelineChunkTicks) * ponderTimelineChunkTicks);
      if (pickingChunk) await writePickingChunk(manifest.frameCount - 1);
      document.layoutChunks = true;
    } else if (playback && frameTicks.length !== manifest.frameCount) document.frameTicks = frameTicks;
    await write(scene.manifest, playback ? Buffer.from(JSON.stringify(document)) : manifestBytes);
    report?.advance(++scenesWritten);
  }
  return index.scenes.length;
}

async function publishDefinitions({ read, write }, pace, definitions, bytes, report) {
  await report?.start('ponder-definitions', definitions.schematics.size);
  let schematicsWritten = 0;
  for (const [path, hash] of definitions.schematics) {
    await pace();
    const schematic = await read(path, ponderSchematicLimit);
    if (digest(schematic) !== hash) throw new Error('Ponder resource has an invalid checksum: ' + path);
    const nbt = gunzipSync(schematic, { maxOutputLength: 64 * 1024 ** 2 });
    if (nbt.length < 4 || nbt[0] !== 10) throw new Error('Invalid Ponder schematic: ' + path);
    await write(path, schematic);
    report?.advance(++schematicsWritten);
  }
  await write(ponderDefinitionsPath, bytes);
  return definitions.registrations;
}

export async function preparePonderImport(archive, directory, sourceHash, revision, pace = () => {}, report) {
  const zip = await yauzl.openPromise(archive, { autoClose: false, strictFileNames: true });
  let staging;
  const revisions = join(directory, 'revisions');
  let hasCatalog = false;
  try {
    const entries = new Map();
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (name === 'catalog.json') hasCatalog = true;
      else if (name !== 'format.txt' && name !== ponderIndexPath && name !== ponderDefinitionsPath
        && !ponderResource(name) && !ponderSchematicHash(name) && !isPonderTimelinePath(name)) continue;
      if (entries.has(name)) throw new Error('Duplicate WebCraft export entry: ' + name);
      entries.set(name, entry);
    }
    const hasFrames = entries.has(ponderIndexPath);
    const hasDefinitions = entries.has(ponderDefinitionsPath);
    if (!hasFrames && !hasDefinitions) {
      await report?.plan({ hasCatalog, writeScenes: false, writeDefinitions: false });
      return { hasCatalog };
    }
    const format = entries.get('format.txt');
    if (!format || format.uncompressedSize > 64
      || !/^webcraft-previews-v1\/[\d.]+$/.test((await buffer(await zip.openReadStreamPromise(format))).toString().trim())) {
      throw new Error('Expected a WebCraft previews v1 archive.');
    }
    const active = await activePonder(directory);
    const { definitions: activeDefinitions, ...activeScenes } = active ?? {};
    const definitionEntry = entries.get(ponderDefinitionsPath);
    let definitionsBytes;
    let definitionIndex;
    if (definitionEntry) {
      if (definitionEntry.uncompressedSize > ponderDefinitionsLimit) throw new Error('Oversized Ponder definitions index.');
      definitionsBytes = await buffer(await zip.openReadStreamPromise(definitionEntry));
      definitionIndex = readPonderDefinitions(JSON.parse(definitionsBytes.toString('utf8')));
      if (!definitionIndex || (hasFrames && definitionIndex.playback)) throw new Error('Invalid Ponder definitions index.');
    }
    const hasScenes = hasFrames || Boolean(definitionIndex?.playback);
    const layoutChunks = Boolean(definitionIndex?.playback && entries.has(ponderBlockModelsPath));
    const writeScenes = hasScenes && (activeScenes.sourceHash !== sourceHash || (layoutChunks && !activeScenes.pickingChunks));
    const writeDefinitions = hasDefinitions && activeDefinitions?.sourceHash !== sourceHash;
    await report?.plan({ hasCatalog, writeScenes, writeDefinitions });
    if (!writeScenes && !writeDefinitions) {
      return { hasCatalog, current: hasScenes ? activeScenes.revision : activeDefinitions?.revision };
    }

    await mkdir(revisions, { recursive: true });
    staging = await mkdtemp(join(revisions, '.import-'));
    const writer = revisionWriter(zip, entries, staging);
    const scenes = writeScenes ? await publishScenes(writer, pace, definitionIndex?.playback, report) : undefined;
    const definitions = writeDefinitions ? await publishDefinitions(writer, pace, definitionIndex, definitionsBytes, report) : undefined;
    const published = join(revisions, revision);
    const pointer = join(directory, '.' + revision + '.json');
    const next = {
      ...(writeScenes ? { revision, previous: activeScenes.revision, sourceHash, layoutChunks, pickingChunks: layoutChunks } : activeScenes),
      definitions: writeDefinitions ? { revision, previous: activeDefinitions?.revision, sourceHash } : activeDefinitions,
    };
    return {
      hasCatalog,
      scenes,
      definitions,
      async publish() {
        await rename(staging, published);
        staging = undefined;
        try {
          await writeFile(pointer, JSON.stringify(next), { flag: 'wx' });
          await rename(pointer, join(directory, 'active.json'));
        } catch (error) {
          await rm(pointer, { force: true });
          await removeRevision(revisions, published);
          throw error;
        }
        const retained = new Set([next.revision, next.previous, next.definitions?.revision, next.definitions?.previous]);
        for (const obsolete of new Set([activeScenes.previous, activeDefinitions?.previous])) {
          if (obsolete && !retained.has(obsolete)) {
            await removeRevision(revisions, join(revisions, obsolete))
              .catch(error => console.warn('Ponder published, but an obsolete revision could not be removed: ' + error.message));
          }
        }
      },
      async discard() {
        if (staging) await removeRevision(revisions, staging);
      },
    };
  } catch (error) {
    if (staging) await removeRevision(revisions, staging);
    throw error;
  } finally {
    zip.close();
  }
}
