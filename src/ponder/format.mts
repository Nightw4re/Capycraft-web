import { isRecord } from '../objectPatch.mts';

export const ponderPath = '/api/ponder';
export const maxTextureSide = 4096;
const idPattern = '[a-f0-9]{64}';
const manifestPath = new RegExp(`^ponder/scenes/${idPattern}/scene\\.json$`);
const framePath = new RegExp(`^ponder/scenes/${idPattern}/frames/(0|[1-9][0-9]{0,4})\\.json$`);
const resourcePaths = [
  ['mesh', new RegExp(`^ponder/meshes/(${idPattern})\\.bin$`), 'application/octet-stream', 16],
  ['image', new RegExp(`^ponder/textures/(${idPattern})\\.png$`), 'image/png', 16],
  ['animation', new RegExp(`^ponder/textures/(${idPattern})\\.json$`), 'application/json', 4],
  ['picking', new RegExp(`^ponder/picking/(${idPattern})\\.json$`), 'application/json', 4],
] as const;
const mib = 1024 ** 2;

export function ponderResource(path: string) {
  if (manifestPath.test(path)) return { kind: 'manifest', mime: 'application/json', limit: 128 * 1024 };
  if (framePath.test(path)) return { kind: 'frame', mime: 'application/json', limit: 4 * mib };
  for (const [kind, pattern, mime, limit] of resourcePaths) {
    const match = pattern.exec(path);
    if (match) return { kind, mime, limit: limit * mib, digest: match[1] };
  }
}

export function ponderUrl(server: string, path?: string) {
  const query = new URLSearchParams({ server });
  if (path !== undefined) query.set('path', path);
  return `${ponderPath}?${query}`;
}

export type PonderScene = { id: string; title: string; schematic: string; items: string[]; manifest: string };
export type PonderManifest = {
  width: number; height: number; ticksPerSecond: number; frameCount: number; keyframes: number[];
  diffuseLights: [Float32Array, Float32Array];
};
export type PonderCaption = { text: string; color: number; opacity: number; anchor?: Float32Array };
export type PonderAttribute = { name: string; offset: number; type: string; count: number };
export type PonderTexture = { image: string; animation?: string; minFilter: number; magFilter: number; wrapS: number; wrapT: number };
export type PonderDraw = {
  mode: string; vertexCount: number; indexCount: number; stride: number;
  vertices: string; indices?: string; indexType?: 'SHORT' | 'INT';
  attributes: PonderAttribute[]; shader: string; textures: Record<string, PonderTexture>;
  projection: Float32Array; modelView: Float32Array; textureMatrix: Float32Array; color: Float32Array;
  depthTest: boolean; depthFunction: number; depthWrite: boolean; cull: boolean;
  blend: boolean; blendFactors?: [number, number, number, number];
};
export type PonderFrame = {
  draws: PonderDraw[]; captions: PonderCaption[]; omitted: number; sceneToGui: Float32Array;
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
  return typeof input === 'string' && ponderResource(input)?.kind === kind;
}

export function readPonderIndex(data: unknown) {
  if (!isRecord(data) || data.version !== 1 || !string(data.locale, 32)
    || !Array.isArray(data.scenes) || data.scenes.length > 10_000) return;
  const scenes: PonderScene[] = [];
  const paths = new Set<string>();
  for (const entry of data.scenes) {
    if (!isRecord(entry)) return;
    const { id, title, schematic, items, manifest } = entry;
    if (!string(id, 512) || !string(title, 1024) || !string(schematic, 512) || !address(manifest, 'manifest')
      || paths.has(manifest) || !Array.isArray(items) || items.length > 512 || !items.every(item => string(item, 512))) return;
    paths.add(manifest);
    scenes.push({ id, title, schematic, items, manifest });
  }
  return { version: 1, locale: data.locale, scenes };
}

export function readPonderManifest(data: unknown): PonderManifest | undefined {
  if (!isRecord(data)) return;
  const { width, height, ticksPerSecond, frameCount, keyframes, diffuseLights } = data;
  if (!integer(width, 1, 1920) || !integer(height, 1, 1080) || !integer(ticksPerSecond, 1, 60)
    || !integer(frameCount, 1, 100_000) || !Array.isArray(keyframes) || keyframes.length > 1024
    || !keyframes.every(tick => integer(tick, 0, frameCount)) || !Array.isArray(diffuseLights) || diffuseLights.length !== 2) return;
  const first = floats(diffuseLights[0], 3);
  const second = floats(diffuseLights[1], 3);
  if (!first || !second) return;
  return {
    width, height, ticksPerSecond, frameCount, diffuseLights: [first, second],
    keyframes: [...new Set(keyframes.map(tick => Math.min(tick, frameCount - 1)))].sort((a, b) => a - b),
  };
}

const bytesByType: Record<string, number> = { BYTE: 1, UBYTE: 1, SHORT: 2, USHORT: 2, FLOAT: 4 };
const minFilters = [9728, 9729, 9984, 9985, 9986, 9987];
const magFilters = [9728, 9729];
const wraps = [10497, 33071, 33648];
const blendFactors = [0, 1, 768, 769, 770, 771, 772, 773, 774, 775, 776, 32769, 32770, 32771, 32772];

function oneOf(field: unknown, allowed: readonly number[]): field is number {
  return typeof field === 'number' && allowed.includes(field);
}

function readDraw(data: unknown): PonderDraw | undefined {
  if (!isRecord(data)) return;
  const { mode, vertexCount, indexCount, stride, vertices, indices, indexType, attributes, shader, textures,
    depthTest, depthFunction, depthWrite, cull, blend, blendFactors: factors } = data;
  if (!string(mode, 32) || !integer(vertexCount, 1, 1_000_000) || !integer(indexCount, 0, 3_000_000)
    || !integer(stride, 1, 255) || !address(vertices, 'mesh') || vertexCount * stride > 16 * mib
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
    const { image, animation, minFilter, magFilter, wrapS, wrapT } = texture;
    if (!address(image, 'image') || (animation !== undefined && !address(animation, 'animation'))
      || !oneOf(minFilter, minFilters) || !oneOf(magFilter, magFilters) || !oneOf(wrapS, wraps) || !oneOf(wrapT, wraps)) return;
    sampled[slot] = { image, animation, minFilter, magFilter, wrapS, wrapT };
  }
  return {
    mode, vertexCount, indexCount, stride, vertices, indices, indexType: indices === undefined ? undefined : indexType as 'SHORT' | 'INT',
    attributes: layout, shader, textures: sampled, projection, modelView, textureMatrix, color,
    depthTest, depthFunction, depthWrite, cull, blend, blendFactors: blendValues,
  };
}

export function readPonderFrame(data: unknown): PonderFrame | undefined {
  if (!isRecord(data) || !Array.isArray(data.scene) || !Array.isArray(data.overlay)
    || data.scene.length + data.overlay.length > 256 || !Array.isArray(data.captions) || data.captions.length > 64) return;
  const sceneToGui = floats(data.sceneToGui, 16);
  if (!sceneToGui) return;
  const draws: PonderDraw[] = [];
  let omitted = 0;
  for (const entry of [...data.scene, ...data.overlay]) {
    const draw = readDraw(entry);
    if (draw) draws.push(draw);
    else omitted++;
  }
  const captions: PonderCaption[] = [];
  for (const caption of data.captions) {
    if (!isRecord(caption)) continue;
    const { text, color, opacity } = caption;
    if (!string(text, 2048) || !integer(color, -0x80000000, 0xffffffff)
      || typeof opacity !== 'number' || !Number.isFinite(opacity)) continue;
    captions.push({ text, color, opacity: Math.min(1, Math.max(0, opacity)), anchor: floats(caption.anchor, 3) });
  }
  return { draws, captions, omitted, sceneToGui };
}

export function ponderFramePath(scene: PonderScene, tick: number) {
  return scene.manifest.replace(/scene\.json$/, `frames/${tick}.json`);
}
