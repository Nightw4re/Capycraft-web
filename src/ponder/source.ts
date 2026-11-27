import { ponderFramePath, ponderFrameTick, ponderGeometryPath, ponderMeshBundlePath, ponderMeshSlice, ponderPickingChunkTicks, ponderPlaybackChunkTicks, ponderPlaybackPath, ponderResource, ponderUrl,
  readPonderFrame, readPonderManifest, readPonderPlaybackChunk, type PonderFrame, type PonderManifest, type PonderScene } from './format.mts';
import { ponderGuideIndexLimit, readPonderGuideIndex } from './guides.mts';
import { readPonderPicking, type PonderPickingGroup } from './picking.mts';
import { readPonderPickingChunk } from './pickingChunks.mts';
import { compactPonderDraws, readPonderBlockModels, readPonderCompactLayout } from './compact.mts';
import { isRecord } from '../objectPatch.mts';
import { assemblePonderMesh, ponderMeshStreams } from './meshStreams.mts';
import { buildPonderFluidMesh, ponderFluidMesh, readPonderFluidFaces } from './fluidFaces.mts';
import { buildPonderParticleVertices, ponderParticleVersion } from './particleQuads.mts';
import { buildPonderRigidVertices, ponderRigidBatchVersion, readPonderRigidBatch, rigidAttributeBytes } from './rigidParts.mts';
import { buildPonderOutlineVertices } from './outlineCuboids.mts';
import { assemblePonderMixedBoxFaces, buildPonderBoxFaceVertices, ponderBoxFaceVersion, readPonderMixedBoxFaces } from './boxFaces.mts';
import { buildPonderLightningVertices } from './lightning.mts';
import { buildPonderGlintVertices, readPonderGlintBatch } from './glintParts.mts';
import { ponderPlatformShadowAsset, ponderPlatformShadowMesh } from './platformShadow.mts';

export class PonderUnavailable extends Error {}

export async function readPonderGuides(server: string, signal: AbortSignal) {
  const response = await fetch(ponderUrl(server) + '&mode=guides', { signal });
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
    || Number(response.headers.get('content-length')) > ponderGuideIndexLimit) return;
  return readPonderGuideIndex(await response.json());
}

export async function readPonderResponse(server: string, signal: AbortSignal, path?: string, revision?: string) {
  const resource = path === undefined ? { mime: 'application/json', limit: 2 * 1024 ** 2 } : ponderResource(path);
  if (!resource) throw new Error('Invalid Ponder resource');
  let response: Response;
  try {
    response = await fetch(ponderUrl(server, path, revision), { signal });
  } catch {
    throw new PonderUnavailable();
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 503) throw new PonderUnavailable();
    throw new Error('Ponder resource rejected');
  }
  if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== resource.mime
    || Number(response.headers.get('content-length')) > resource.limit) throw new Error('Invalid Ponder response');
  return response;
}

export function createPonderSource(server: string, scene: PonderScene, signal: AbortSignal, revision: string) {
  const frames = new Map<number, Promise<PonderFrame>>();
  const playbackChunks = new Map<number, Promise<Record<string, unknown>[]>>();
  const composedFrames = new WeakMap<Record<string, unknown>, PonderFrame>();
  const assets = new Map<string, Promise<ArrayBuffer>>();
  const meshChunks = new Map<string, Promise<ArrayBuffer>>();
  const meshStreams = new Map<string, Promise<Uint8Array>>();
  const failedAssets = new Map<string, { error: unknown; retryAt: number }>();
  const picking = new Map<string, Promise<PonderPickingGroup[] | undefined>>();
  const pickingChunks = new Map<string, Promise<unknown>>();
  let speculativeFrames = 0;
  let frameTicks: number[] | undefined;
  let chunkedFrameCount = 0;
  let compact: { palette: NonNullable<ReturnType<typeof readPonderBlockModels>>; manifest: PonderManifest } | undefined;

  async function frameData(tick: number): Promise<unknown> {
    if (!chunkedFrameCount) {
      const response = await readPonderResponse(server, signal, ponderFramePath(scene, tick), revision);
      return response.json();
    }
    const start = tick - tick % ponderPlaybackChunkTicks;
    let chunk = playbackChunks.get(start);
    if (chunk) {
      playbackChunks.delete(start);
    } else {
      while (playbackChunks.size >= 4) playbackChunks.delete(playbackChunks.keys().next().value!);
      const count = Math.min(ponderPlaybackChunkTicks, chunkedFrameCount - start);
      chunk = readPonderResponse(server, signal, ponderPlaybackPath(scene, start), revision).then(async response => {
        const snapshots = readPonderPlaybackChunk(await response.json(), count, ponderMeshBundlePath(scene, start));
        if (!snapshots) throw new Error('Invalid Ponder playback chunk');
        return snapshots;
      }).catch(error => {
        if (playbackChunks.get(start) === chunk) playbackChunks.delete(start);
        throw error;
      });
    }
    playbackChunks.set(start, chunk);
    return (await chunk)[tick - start];
  }

  function frame(tick: number) {
    tick = ponderFrameTick(tick, frameTicks);
    const cached = frames.get(tick);
    if (cached) {
      frames.delete(tick);
      frames.set(tick, cached);
      return cached;
    }
    while (frames.size >= 32) frames.delete(frames.keys().next().value!);
    const load = frameData(tick)
      .then(data => {
        if (!isRecord(data)) throw new Error('Invalid Ponder frame');
        const composed = composedFrames.get(data);
        if (composed) return composed;
        const frame = readPonderFrame(data);
        if (!frame) throw new Error('Invalid Ponder frame');
        if (compact) {
          const { models, spriteAnimations } = compact.palette;
          const layout = readPonderCompactLayout(data.layout, models);
          const moving = data.movingLayout === undefined ? [] : readPonderCompactLayout(data.movingLayout, models);
          const fluids = data.fluidFaces === undefined ? [] : readPonderFluidFaces(data.fluidFaces, spriteAnimations);
          if (!layout || !moving || !fluids) throw new Error('Invalid Ponder block or fluid layout');
          const groups = [...layout, ...moving];
          const { width, height, platformShadow } = compact.manifest;
          const result = compactPonderDraws(frame, groups, models, width, height, fluids, tick, platformShadow, spriteAnimations);
          if (!fluids.some(face => face.frames || face.spriteAnimation !== undefined) && !groups.some(group => group.blocks.some(block =>
            models[block[3]]?.some(draw => draw.frames || draw.spriteAnimation !== undefined)))) composedFrames.set(data, result);
          return result;
        }
        return frame;
      }).catch(error => {
        if (frames.get(tick) === load) frames.delete(tick);
        throw error;
      });
    frames.set(tick, load);
    return load;
  }

  function readAsset(path: string) {
    const cached = assets.get(path);
    if (cached) return cached;
    const failure = failedAssets.get(path);
    if (failure && Date.now() < failure.retryAt) return Promise.reject(failure.error);
    failedAssets.delete(path);
    const load = readPonderResponse(server, signal, path, revision)
      .then(response => response.arrayBuffer())
      .catch(error => {
        if (!signal.aborted) {
          while (failedAssets.size >= 64) failedAssets.delete(failedAssets.keys().next().value!);
          failedAssets.set(path, { error, retryAt: Date.now() + 30_000 });
        }
        throw error;
      })
      .finally(() => { assets.delete(path); });
    assets.set(path, load);
    return load;
  }

  function readMeshStream(path: string, size?: number) {
    let load = meshStreams.get(path);
    if (load) meshStreams.delete(path);
    else {
      if (meshStreams.size >= 48) meshStreams.delete(meshStreams.keys().next().value!);
      load = readAsset(path).then(bytes => {
        if (size !== undefined && bytes.byteLength !== size) throw new Error('Invalid Ponder mesh stream size');
        return new Uint8Array(bytes);
      }).catch(error => {
        if (meshStreams.get(path) === load) meshStreams.delete(path);
        throw error;
      });
    }
    meshStreams.set(path, load);
    return load;
  }

  async function readGeometryBytes(path: string) {
    const slice = ponderMeshSlice(path);
    if (!slice) return readAsset(path);
    let chunk = meshChunks.get(slice.path);
    if (chunk) meshChunks.delete(slice.path);
    else {
      if (meshChunks.size >= 4) meshChunks.delete(meshChunks.keys().next().value!);
      chunk = readAsset(slice.path).catch(error => {
        if (meshChunks.get(slice.path) === chunk) meshChunks.delete(slice.path);
        throw error;
      });
    }
    meshChunks.set(slice.path, chunk);
    const bytes = await chunk;
    if (slice.offset + slice.size > bytes.byteLength) throw new Error('Invalid Ponder mesh slice');
    return bytes.slice(slice.offset, slice.offset + slice.size);
  }

  async function buildRigidBatch(batch: NonNullable<ReturnType<typeof readPonderRigidBatch>>) {
    const parts: Uint8Array[] = [];
    const attributes: (Uint8Array | undefined)[] = [];
    const normals: (Uint8Array | undefined)[] = [];
    for (let index = 0; index < batch.parts.length; index += 8) {
      const resources = await Promise.all(batch.parts.slice(index, index + 8).map(part => Promise.all([
        readMeshStream(part.path, part.count * 24),
        part.attributes ? readMeshStream(part.attributes, part.count * rigidAttributeBytes) : undefined,
        part.normals ? readMeshStream(part.normals) : undefined,
      ])));
      for (const [vertices, values, palette] of resources) {
        parts.push(vertices);
        attributes.push(values);
        normals.push(palette);
      }
    }
    const mesh = buildPonderRigidVertices(batch, parts, attributes, normals);
    if (!mesh) throw new Error('Invalid Ponder rigid geometry');
    return mesh;
  }

  return {
    frame,
    prefetch(first: number, end: number) {
      for (let tick = first; tick < end && speculativeFrames < 4; tick++) {
        if (frames.has(ponderFrameTick(tick, frameTicks))) continue;
        speculativeFrames++;
        void frame(tick).catch(() => {}).finally(() => { speculativeFrames--; });
      }
    },
    async asset(path: string) {
      if (path === ponderPlatformShadowAsset) return ponderPlatformShadowMesh();
      const fluid = ponderFluidMesh(path);
      if (fluid) return buildPonderFluidMesh(fluid);
      const geometry = ponderGeometryPath(path);
      const kind = ponderResource(geometry)?.kind;
      if (kind === 'rigid-batch') {
        const batch = readPonderRigidBatch(new Uint8Array(await readGeometryBytes(path)), ponderRigidBatchVersion(geometry));
        if (!batch) throw new Error('Invalid Ponder rigid batch');
        return buildRigidBatch(batch);
      }
      if (kind === 'particle-quads') {
        const packed = new Uint8Array(await readGeometryBytes(path));
        const mesh = buildPonderParticleVertices(packed, ponderParticleVersion(geometry));
        if (!mesh) throw new Error('Invalid Ponder particle quads');
        return mesh;
      }
      if (kind === 'outline-cuboids') {
        const vertices = buildPonderOutlineVertices(new Uint8Array(await readGeometryBytes(path)));
        if (!vertices) throw new Error('Invalid Ponder outline cuboids');
        return vertices;
      }
      if (kind === 'box-faces') {
        const bytes = new Uint8Array(await readGeometryBytes(path));
        const version = ponderBoxFaceVersion(geometry);
        if (version === 4) {
          const mixed = readPonderMixedBoxFaces(bytes, version);
          if (!mixed) throw new Error('Invalid Ponder mixed box faces');
          const rigidVertices: ArrayBuffer[] = [];
          for (const run of mixed.runs) {
            if (run.kind === 'rigid') rigidVertices.push(await buildRigidBatch(run.batch));
          }
          const vertices = assemblePonderMixedBoxFaces(mixed, rigidVertices);
          if (!vertices) throw new Error('Invalid Ponder mixed box vertices');
          return vertices;
        }
        const vertices = buildPonderBoxFaceVertices(bytes, version);
        if (!vertices) throw new Error('Invalid Ponder box faces');
        return vertices;
      }
      if (kind === 'lightning') {
        const vertices = buildPonderLightningVertices(new Uint8Array(await readGeometryBytes(path)));
        if (!vertices) throw new Error('Invalid Ponder lightning');
        return vertices;
      }
      if (kind === 'rigid-glint') {
        const batch = readPonderGlintBatch(new Uint8Array(await readGeometryBytes(path)));
        if (!batch) throw new Error('Invalid Ponder glint batch');
        const parts: Uint8Array[] = [];
        for (let index = 0; index < batch.parts.length; index += 8) {
          parts.push(...await Promise.all(batch.parts.slice(index, index + 8)
            .map(part => readMeshStream(part.path, part.count * 24))));
        }
        const vertices = buildPonderGlintVertices(batch, parts);
        if (!vertices) throw new Error('Invalid Ponder glint geometry');
        return vertices;
      }
      const streams = ponderMeshStreams(path);
      if (streams) {
        const parts = await Promise.all(streams.parts.map(part => readMeshStream(part.path, part.bytes)));
        const mesh = assemblePonderMesh(streams, parts);
        if (!mesh) throw new Error('Invalid Ponder mesh streams');
        return mesh.buffer;
      }
      return readGeometryBytes(path);
    },
    async picking(path: string, tick: number) {
      if (ponderResource(path)?.kind === 'picking-chunk') {
        let chunk = pickingChunks.get(path);
        if (!chunk) {
          if (pickingChunks.size >= 4) pickingChunks.delete(pickingChunks.keys().next().value!);
          chunk = readPonderResponse(server, signal, path, revision).then(response => response.json());
          pickingChunks.set(path, chunk);
        }
        try {
          return readPonderPickingChunk(await chunk, tick % ponderPickingChunkTicks);
        } catch {
          if (pickingChunks.get(path) === chunk) pickingChunks.delete(path);
          return undefined;
        }
      }
      const cached = picking.get(path);
      if (cached) return cached;
      if (picking.size >= 64) picking.delete(picking.keys().next().value!);
      const load = readPonderResponse(server, signal, path, revision)
        .then(async response => readPonderPicking(await response.json()))
        .catch(() => {
          if (picking.get(path) === load) picking.delete(path);
          return undefined;
        });
      picking.set(path, load);
      return load;
    },
    async manifest() {
      const data = await readPonderResponse(server, signal, scene.manifest, revision);
      const manifest = readPonderManifest(await data.json());
      if (!manifest) throw new Error('Invalid Ponder manifest');
      frameTicks = manifest.frameTicks;
      chunkedFrameCount = manifest.layoutChunks ? manifest.frameCount : 0;
      if (manifest.blockModels) {
        const response = await readPonderResponse(server, signal, manifest.blockModels, revision);
        const palette = readPonderBlockModels(await response.json());
        if (!palette) throw new Error('Invalid Ponder block models');
        compact = { palette, manifest };
      }
      return manifest;
    },
  };
}
