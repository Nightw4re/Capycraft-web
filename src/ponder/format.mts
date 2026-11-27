import { isRecord } from '../objectPatch.mts';
import { ponderMeshStreams } from './meshStreams.mts';
import { readPonderTimelinePatches } from './timeline.mts';
import { isPonderParticleAttributeLayout, maxPonderParticleQuads } from './particleQuads.mts';
import { isPonderRigidAttributeLayout, maxRigidVertexBytes, ponderRigidBatchVersion } from './rigidParts.mts';
import { isPonderOutlineDraw } from './outlineCuboids.mts';
import { isPonderGlintDraw } from './glintParts.mts';
import { isPonderBoxFaceDraw, ponderBoxFaceVersion } from './boxFaces.mts';
import { isPonderLightningDraw } from './lightning.mts';

export const ponderPath = '/api/ponder';
export const ponderBlockModelsPath = 'ponder/block-models.json';
export const ponderPlaybackChunkTicks = 16;
export const ponderPickingChunkTicks = 64;
export const maxTextureSide = 4096;
const idPattern = '[a-f0-9]{64}';
const manifestPath = new RegExp(`^ponder/scenes/${idPattern}/scene\\.json$`);
const framePath = new RegExp(`^ponder/scenes/${idPattern}/frames/(0|[1-9][0-9]{0,4})\\.json$`);
const playbackPath = new RegExp(`^ponder/scenes/${idPattern}/playback/(0|[1-9][0-9]{0,4})\\.json$`);
const pickingChunkPath = new RegExp(`^ponder/scenes/${idPattern}/picking/(0|[1-9][0-9]{0,4})\\.json$`);
const meshChunkPattern = `ponder/scenes/${idPattern}/meshes/(0|[1-9][0-9]{0,4})\\.bin`;
const meshChunkPath = new RegExp(`^${meshChunkPattern}$`);
const meshSlicePath = new RegExp(`^(${meshChunkPattern})#(0|[1-9][0-9]{0,6}):([1-9][0-9]{0,3}):(${idPattern})(?::(particle-quads/v[1234]|outline-cuboids/v1|box-faces/v[1234]|rigid-batches/v[12345]|rigid-glint/v1|lightning/v1))?$`);
const resourcePaths = [
  ['mesh', new RegExp(`^ponder/meshes/(${idPattern})\\.bin$`), 'application/octet-stream', 16],
  ['particle-quads', new RegExp(`^ponder/particle-quads/v[1234]/(${idPattern})\\.bin$`), 'application/octet-stream', 2],
  ['outline-cuboids', new RegExp(`^ponder/outline-cuboids/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['box-faces', new RegExp(`^ponder/box-faces/v[1234]/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['lightning', new RegExp(`^ponder/lightning/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['rigid-batch', new RegExp(`^ponder/rigid-batches/v[12345]/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['rigid-part', new RegExp(`^ponder/rigid-parts/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['rigid-attributes', new RegExp(`^ponder/rigid-attributes/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['rigid-normals', new RegExp(`^ponder/rigid-normals/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['rigid-glint', new RegExp(`^ponder/rigid-glint/v1/(${idPattern})\\.bin$`), 'application/octet-stream', 1],
  ['image', new RegExp(`^ponder/textures/(${idPattern})\\.png$`), 'image/png', 16],
  ['animation', new RegExp(`^ponder/textures/(${idPattern})\\.json$`), 'application/json', 4],
  ['picking', new RegExp(`^ponder/picking/(${idPattern})\\.json$`), 'application/json', 4],
] as const;
const mib = 1024 ** 2;
const meshChunkLimit = 4 * mib;

export function ponderMeshSlice(path: string) {
  const match = meshSlicePath.exec(path);
  if (!match || Number(match[2]) % ponderPlaybackChunkTicks !== 0) return;
  const offset = Number(match[3]), size = Number(match[4]);
  if (size > 1024 || offset + size > meshChunkLimit) return;
  const geometry = match[6] ? `ponder/${match[6]}/${match[5]}.bin` : undefined;
  return { path: match[1], offset, size, digest: match[5], geometry };
}

/** The codec address remains available when its data is carried in a section bundle. */
export function ponderGeometryPath(path: string) {
  return ponderMeshSlice(path)?.geometry ?? path;
}

export function ponderResource(path: string) {
  if (path === ponderBlockModelsPath) return { kind: 'models', mime: 'application/json', limit: 16 * mib };
  if (manifestPath.test(path)) return { kind: 'manifest', mime: 'application/json', limit: 768 * 1024 };
  if (framePath.test(path)) return { kind: 'frame', mime: 'application/json', limit: 4 * mib };
  const playback = playbackPath.exec(path);
  if (playback && Number(playback[1]) % ponderPlaybackChunkTicks === 0) {
    return { kind: 'playback', mime: 'application/json', limit: ponderPlaybackChunkTicks * (4 * mib + 1) + 2 };
  }
  const picking = pickingChunkPath.exec(path);
  if (picking && Number(picking[1]) % ponderPickingChunkTicks === 0) {
    return { kind: 'picking-chunk', mime: 'application/json', limit: 32 * mib };
  }
  const meshChunk = meshChunkPath.exec(path);
  if (meshChunk && Number(meshChunk[1]) % ponderPlaybackChunkTicks === 0) {
    return { kind: 'mesh-chunk', mime: 'application/octet-stream', limit: meshChunkLimit };
  }
  for (const [kind, pattern, mime, limit] of resourcePaths) {
    const match = pattern.exec(path);
    if (match) return { kind, mime, limit: limit * mib, digest: match[1] };
  }
}

export function ponderUrl(server: string, path?: string, revision?: string) {
  const query = new URLSearchParams({ server });
  if (path !== undefined) query.set('path', path);
  if (revision !== undefined) query.set('revision', revision);
  return `${ponderPath}?${query}`;
}

export type PonderScene = {
  id: string; title: string; schematic: string; items: string[]; manifest: string; itemOrder?: number[];
};
export type PonderManifest = {
  width: number; height: number; ticksPerSecond: number; frameCount: number; keyframes: number[];
  frameTicks?: number[];
  layoutChunks?: true;
  blockModels?: typeof ponderBlockModelsPath;
  platformShadow?: [x: number, z: number, size: number];
  diffuseLights: [Float32Array, Float32Array];
};
export type PonderCaption = { text: string; color: number; opacity: number; anchor?: Float32Array };
export type PonderAttribute = { name: string; offset: number; type: string; count: number };
export const maxPonderAtlasRegions = 16;
export type PonderAtlasRegion = readonly [uMin: number, vMin: number, uMax: number, vMax: number,
  scaleU: number, scaleV: number, offsetU: number, offsetV: number];
export type PonderTexture = {
  image: string; animation?: string; animated?: true; transition?: { image: string; weight: number };
  atlasAnimation?: string;
  atlasRegions?: readonly PonderAtlasRegion[];
  minFilter: number; magFilter: number; wrapS: number; wrapT: number;
};
export type PonderDraw = {
  mode: string; vertexCount: number; indexCount: number; stride: number;
  vertices: string; indices?: string; indexType?: 'SHORT' | 'INT';
  attributes: PonderAttribute[]; shader: string; textures: Record<string, PonderTexture>;
  projection: Float32Array; modelView: Float32Array; textureMatrix: Float32Array; color: Float32Array;
  depthTest: boolean; depthFunction: number; depthWrite: boolean; cull: boolean;
  blend: boolean; blendFactors?: [number, number, number, number]; lineWidth?: number;
};

export function usesPonderEntityLighting(shader: string) {
  return shader.startsWith('rendertype_entity') || shader === 'rendertype_armor_cutout_no_cull';
}

export function ponderLightmapMode(shader: string) {
  switch (shader) {
    case 'rendertype_solid': case 'rendertype_cutout': case 'rendertype_cutout_mipped': case 'rendertype_translucent':
      return 'filtered-color';
    case 'rendertype_entity_solid': case 'rendertype_entity_cutout': case 'rendertype_entity_cutout_no_cull':
    case 'rendertype_entity_cutout_no_cull_z_offset': case 'rendertype_entity_translucent':
      return 'separate';
    default: return 'color';
  }
}

export const ponderUnlitEntityShader = 'neoforge:rendertype_entity_unlit_translucent';
export const ponderLineShader = 'rendertype_lines';
// Minecraft emits each line endpoint twice and expands the copies to opposite sides in the vertex shader.
export const ponderLineIndices = [0, 1, 2, 3, 2, 1] as const;
export const ponderQuadIndices = [0, 1, 2, 2, 3, 0] as const;
export const ponderLineViewScale = 255 / 256;

export function supportsPonderWideLine(draw: PonderDraw) {
  const { shader, mode, lineWidth, vertexCount, indexCount, indices, attributes } = draw;
  return shader === ponderLineShader && (mode === 'LINES' || mode === 'LINE_STRIP')
    && typeof lineWidth === 'number' && lineWidth > 0 && Number.isFinite(Math.fround(lineWidth))
    && vertexCount >= 4 && vertexCount % (mode === 'LINES' ? 4 : 2) === 0
    && (indices !== undefined || indexCount === (mode === 'LINES' ? vertexCount / 4 * 6 : vertexCount))
    && attributes.some(attribute => attribute.name === 'Normal' && attribute.count === 3);
}

export function ponderCutout(draw: PonderDraw) {
  if (draw.shader === ponderUnlitEntityShader || draw.shader === ponderLineShader) return 0;
  if (draw.shader === 'rendertype_crumbling') return .1 * draw.color[3];
  return /cutout|text|particle|glint/.test(draw.shader) ? .1 : .003;
}
export type PonderFrame = {
  draws: PonderDraw[]; captions: PonderCaption[]; omitted: number; sceneToGui: Float32Array;
  overlayStart?: number;
  picking?: string;
};

function integer(input: unknown, min: number, max: number): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= min && input <= max;
}

function string(input: unknown, max: number): input is string {
  return typeof input === 'string' && input.length <= max;
}

function floats(data: unknown, size: number) {
  if (Array.isArray(data) && data.length === size
    && data.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9)) {
    return new Float32Array(data);
  }
}

function address(input: unknown, kind: string): input is string {
  if (typeof input !== 'string') return false;
  if (ponderResource(input)?.kind === kind) return true;
  const slice = kind === 'mesh' ? ponderMeshSlice(input) : undefined;
  return !!slice && !slice.geometry;
}

export function readPonderIndex(data: unknown) {
  if (!isRecord(data) || data.version !== 1 || !string(data.locale, 32)
    || !Array.isArray(data.scenes) || data.scenes.length > 10_000) return;
  const scenes: PonderScene[] = [];
  const paths = new Set<string>();
  for (const entry of data.scenes) {
    if (!isRecord(entry)) return;
    const { id, title, schematic, items, manifest, itemOrder } = entry;
    if (!string(id, 512) || !string(title, 1024) || !string(schematic, 512) || !address(manifest, 'manifest')
      || paths.has(manifest) || !Array.isArray(items) || items.length > 512 || !items.every(item => string(item, 512))) return;
    if (itemOrder !== undefined && (!Array.isArray(itemOrder) || itemOrder.length !== items.length
      || !itemOrder.every(rank => integer(rank, 0, 25_000)))) return;
    paths.add(manifest);
    scenes.push({ id, title, schematic, items, manifest, ...(itemOrder && { itemOrder }) });
  }
  return { version: 1, locale: data.locale, scenes };
}

export function readPonderManifest(data: unknown): PonderManifest | undefined {
  if (!isRecord(data)) return;
  const { width, height, ticksPerSecond, frameCount, keyframes, frameTicks, blockModels, diffuseLights, layoutChunks, platformShadow } = data;
  if (!integer(width, 1, 1920) || !integer(height, 1, 1080) || !integer(ticksPerSecond, 1, 60)
    || !integer(frameCount, 1, 100_000) || !Array.isArray(keyframes) || keyframes.length > 1024
    || !keyframes.every(tick => integer(tick, 0, frameCount)) || !Array.isArray(diffuseLights) || diffuseLights.length !== 2) return;
  const first = floats(diffuseLights[0], 3);
  const second = floats(diffuseLights[1], 3);
  if (!first || !second) return;
  if (blockModels !== undefined && blockModels !== ponderBlockModelsPath) return;
  let shadow: PonderManifest['platformShadow'];
  if (platformShadow !== undefined) {
    if (!blockModels || !Array.isArray(platformShadow) || platformShadow.length !== 3
      || !integer(platformShadow[0], -4096, 4096) || !integer(platformShadow[1], -4096, 4096)
      || !integer(platformShadow[2], 1, 4096)) return;
    shadow = [platformShadow[0], platformShadow[1], platformShadow[2]];
  }
  if (layoutChunks !== undefined && (layoutChunks !== true || !blockModels || frameTicks !== undefined)) return;
  if (frameTicks !== undefined && (!Array.isArray(frameTicks) || frameTicks[0] !== 0 || frameTicks.length > frameCount
    || !frameTicks.every((tick, index) => integer(tick, 0, frameCount - 1) && (index === 0 || tick > frameTicks[index - 1])))) return;
  return {
    width, height, ticksPerSecond, frameCount, diffuseLights: [first, second], ...(frameTicks && { frameTicks }),
    ...(blockModels && { blockModels }), ...(layoutChunks && { layoutChunks }),
    ...(shadow && { platformShadow: shadow }),
    keyframes: [...new Set(keyframes.map(tick => Math.min(tick, frameCount - 1)))].sort((a, b) => a - b),
  };
}

export function ponderFrameTick(tick: number, frameTicks: readonly number[] | undefined) {
  if (!frameTicks) return tick;
  let low = 0, high = frameTicks.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (frameTicks[mid] <= tick) low = mid;
    else high = mid;
  }
  return frameTicks[low];
}

const bytesByType: Record<string, number> = { BYTE: 1, UBYTE: 1, SHORT: 2, USHORT: 2, FLOAT: 4 };
const minFilters = [9728, 9729, 9984, 9985, 9986, 9987];
const magFilters = [9728, 9729];
const wraps = [10497, 33071, 33648];
const blendFactors = [0, 1, 768, 769, 770, 771, 772, 773, 774, 775, 776, 32769, 32770, 32771, 32772];

function oneOf(field: unknown, allowed: readonly number[]): field is number {
  return typeof field === 'number' && allowed.includes(field);
}

function readAtlasRegions(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > maxPonderAtlasRegions) return;
  const regions: PonderAtlasRegion[] = [];
  const tolerance = 1e-6;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 8
      || Array.from(row).some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8192)) return;
    if (row[0] < 0 || row[1] < 0 || row[2] > 1 || row[3] > 1) return;
    const [uMin, vMin, uMax, vMax, scaleU, scaleV, offsetU, offsetV] = row.map(Math.fround);
    if (uMin >= uMax || vMin >= vMax || scaleU <= 0 || scaleV <= 0
      || uMin * scaleU + offsetU < -tolerance || vMin * scaleV + offsetV < -tolerance
      || uMax * scaleU + offsetU > 1 + tolerance || vMax * scaleV + offsetV > 1 + tolerance
      || regions.some(([left, top, right, bottom]) => left < uMax && right > uMin && top < vMax && bottom > vMin)) return;
    regions.push([uMin, vMin, uMax, vMax, scaleU, scaleV, offsetU, offsetV]);
  }
  return regions;
}

function readDraw(data: unknown): PonderDraw | undefined {
  if (!isRecord(data)) return;
  const { mode, vertexCount, indexCount, stride, vertices, indices, indexType, attributes, shader, textures,
    depthTest, depthFunction, depthWrite, cull, blend, blendFactors: factors, lineWidth } = data;
  const streams = typeof vertices === 'string' ? ponderMeshStreams(vertices) : undefined;
  const geometry = typeof vertices === 'string' ? ponderGeometryPath(vertices) : '';
  const resource = ponderResource(geometry)?.kind;
  const particles = resource === 'particle-quads';
  const rigid = resource === 'rigid-batch';
  const outline = resource === 'outline-cuboids';
  const boxFaces = resource === 'box-faces';
  const lightning = resource === 'lightning';
  const glint = resource === 'rigid-glint';
  if (!string(mode, 32) || !integer(vertexCount, 1, 1_000_000) || !integer(indexCount, 0, 3_000_000)
    || !integer(stride, 1, 255) || typeof vertices !== 'string'
    || (!streams && !particles && !rigid && !outline && !boxFaces && !glint && !lightning && !address(vertices, 'mesh'))
    || (streams && (streams.stride !== stride || streams.count !== vertexCount)) || vertexCount * stride > 16 * mib
    || (particles && (shader !== 'particle' || mode !== 'QUADS' || stride !== 28 || indices !== undefined
      || vertexCount > 4 * maxPonderParticleQuads || vertexCount % 4 || indexCount !== vertexCount / 4 * 6
      || !isPonderParticleAttributeLayout(attributes)))
    || (rigid && (mode !== 'QUADS' || stride !== 36 || vertexCount % 4 || vertexCount * 36 > maxRigidVertexBytes
      || (ponderRigidBatchVersion(geometry) === 3 && indices !== undefined)
      || indexCount !== vertexCount / 4 * 6 || !isPonderRigidAttributeLayout(attributes)))
    || (outline && !isPonderOutlineDraw(data))
    || (boxFaces && !isPonderBoxFaceDraw(data, ponderBoxFaceVersion(geometry)))
    || (lightning && !isPonderLightningDraw(data))
    || (glint && !isPonderGlintDraw(data))
    || (indices !== undefined && (!address(indices, 'mesh') || (indexType !== 'SHORT' && indexType !== 'INT')))
    || !Array.isArray(attributes) || attributes.length > 16 || !string(shader, 128)
    || !isRecord(textures) || Object.keys(textures).length > 3
    || typeof depthTest !== 'boolean' || !integer(depthFunction, 512, 519)
    || typeof depthWrite !== 'boolean' || typeof cull !== 'boolean' || typeof blend !== 'boolean') return;
  const projection = floats(data.projection, 16), modelView = floats(data.modelView, 16);
  const textureMatrix = floats(data.textureMatrix, 16), color = floats(data.color, 4);
  if (!projection || !modelView || !textureMatrix || !color) return;
  let blendValues: PonderDraw['blendFactors'];
  if (blend) {
    if (!Array.isArray(factors) || factors.length !== 4 || !factors.every(value => oneOf(value, blendFactors))) return;
    blendValues = [factors[0], factors[1], factors[2], factors[3]];
  }
  const layout: PonderAttribute[] = [];
  for (const attribute of attributes) {
    if (!isRecord(attribute)) return;
    const { name, offset, type, count } = attribute;
    if (!string(name, 32) || layout.some(existing => existing.name === name) || !string(type, 16)
      || !Object.hasOwn(bytesByType, type) || !integer(count, 1, 4) || !integer(offset, 0, stride - 1)) return;
    const bytes = bytesByType[type];
    if (offset % bytes || stride % bytes || offset + count * bytes > stride) return;
    layout.push({ name, offset, type, count });
  }
  const sampled: PonderDraw['textures'] = {};
  for (const [slot, texture] of Object.entries(textures)) {
    if (!/^[012]$/.test(slot) || !isRecord(texture)) return;
    const { image, animation, atlasAnimation, animated, transition, atlasRegions, minFilter, magFilter, wrapS, wrapT } = texture;
    if (!address(image, 'image') || (animation !== undefined && !address(animation, 'animation'))
      || (atlasAnimation !== undefined && (slot !== '0' || animation !== undefined || transition !== undefined || !address(atlasAnimation, 'animation')))
      || (animated !== undefined && animated !== true) || !oneOf(minFilter, minFilters) || !oneOf(magFilter, magFilters)
      || !oneOf(wrapS, wraps) || !oneOf(wrapT, wraps)) return;
    const regions = atlasRegions === undefined ? undefined : readAtlasRegions(atlasRegions);
    if (atlasRegions !== undefined && (!regions || slot !== '0' || animation !== undefined || transition !== undefined)) return;
    if (((shader === 'rendertype_eyes' || shader === 'rendertype_crumbling') && slot !== '0')
      || ((shader === 'rendertype_entity_no_outline' || shader === 'rendertype_armor_cutout_no_cull') && slot === '1')) continue;
    sampled[slot] = { image, animation, ...(atlasAnimation && { atlasAnimation }), ...(animated && { animated }),
      ...(regions && { atlasRegions: regions }), minFilter, magFilter, wrapS, wrapT };
  }
  const draw: PonderDraw = {
    mode, vertexCount, indexCount, stride, vertices, indices, indexType: indices === undefined ? undefined : indexType as 'SHORT' | 'INT',
    attributes: layout, shader, textures: sampled, projection, modelView, textureMatrix, color,
    // These stock block passes cull back faces. Legacy captures can inherit
    // another pass's cull state even when the glass or fluid mesh is unchanged.
    depthTest, depthFunction, depthWrite,
    cull: cull || shader === 'rendertype_cutout_mipped' || shader === 'rendertype_translucent',
    blend, blendFactors: blendValues,
    ...(shader === ponderLineShader && typeof lineWidth === 'number' && { lineWidth }),
  };
  if ((shader === ponderLineShader || mode === 'LINES' || mode === 'LINE_STRIP') && !supportsPonderWideLine(draw)) return;
  return draw;
}

function captionOverlayEnd(draws: readonly PonderDraw[], start: number) {
  // V1 captures the caption outline and shadow, optional fill, then the glyphs.
  const [outline, shadow, background, fill] = draws.slice(start, start + 4);
  if (outline?.shader !== 'position_color' || outline.vertexCount !== 20
    || shadow?.shader !== 'position_color' || shadow.vertexCount !== 16) return start;
  const hasFill = background?.shader === 'rendertype_gui' && background.vertexCount === 4
    && fill?.shader === 'rendertype_gui' && fill.vertexCount === 4;
  let end = start + (hasFill ? 4 : 2);
  if (draws[end]?.shader !== 'rendertype_text') return start;
  while (draws[end]?.shader === 'rendertype_text') end++;
  return end;
}

export function readPonderFrame(data: unknown, drawCache?: WeakMap<object, PonderDraw | undefined>): PonderFrame | undefined {
  if (!isRecord(data) || !Array.isArray(data.scene) || !Array.isArray(data.overlay)
    || data.scene.length + data.overlay.length > 256 || !Array.isArray(data.captions) || data.captions.length > 64) return;
  const sceneToGui = floats(data.sceneToGui, 16);
  if (!sceneToGui) return;
  const draws: PonderDraw[] = [];
  let omitted = 0;
  function readDraws(entries: unknown[], target: PonderDraw[]) {
    for (const entry of entries) {
      let draw;
      if (drawCache && isRecord(entry)) {
        if (!drawCache.has(entry)) drawCache.set(entry, readDraw(entry));
        draw = drawCache.get(entry);
      } else draw = readDraw(entry);
      if (draw) target.push(draw);
      else omitted++;
    }
  }
  readDraws(data.scene, draws);
  const overlayStart = draws.length;
  const overlay: PonderDraw[] = [];
  readDraws(data.overlay, overlay);
  const captions: PonderCaption[] = [];
  for (const caption of data.captions) {
    if (!isRecord(caption)) continue;
    const { text, color, opacity } = caption;
    if (!string(text, 16_384) || !integer(color, -0x80000000, 0xffffffff)
      || typeof opacity !== 'number' || !Number.isFinite(opacity)) continue;
    captions.push({ text, color, opacity: Math.min(1, Math.max(0, opacity)), anchor: floats(caption.anchor, 3) });
  }
  const hasReadableCaption = captions.some(caption => caption.opacity > 0 && caption.text.trim());
  if (hasReadableCaption && overlay.length === data.overlay.length) {
    for (let i = 0; i < overlay.length;) {
      const end = captionOverlayEnd(overlay, i);
      if (end > i) i = end;
      else draws.push(overlay[i++]);
    }
  } else draws.push(...overlay);
  return { draws, captions, omitted, sceneToGui,
    ...(draws.length > overlayStart && { overlayStart }),
    ...((address(data.picking, 'picking') || address(data.picking, 'picking-chunk')) && { picking: data.picking }) };
}

export function ponderFramePath(scene: PonderScene, tick: number) {
  return scene.manifest.replace(/scene\.json$/, `frames/${tick}.json`);
}

export function ponderPlaybackPath(scene: PonderScene, start: number) {
  return scene.manifest.replace(/scene\.json$/, `playback/${start}.json`);
}

export function ponderMeshBundlePath(scene: PonderScene, start: number) {
  return scene.manifest.replace(/scene\.json$/, `meshes/${start}.bin`);
}

export function ponderPickingChunkPath(scene: PonderScene, tick: number) {
  const start = tick - tick % ponderPickingChunkTicks;
  return scene.manifest.replace(/scene\.json$/, `picking/${start}.json`);
}

export function readPonderPlaybackChunk(data: unknown, count: number, bundle?: string) {
  const patches = readPonderTimelinePatches(data, count, bundle);
  if (!patches) return;
  const frames: Record<string, unknown>[] = [];
  for (const patch of patches) {
    const previous = frames.at(-1);
    frames.push(previous && !Object.keys(patch).length ? previous : { ...previous, ...patch });
  }
  return frames;
}
