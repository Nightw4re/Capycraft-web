import { maxTextureSide, ponderGeometryPath, ponderMeshSlice, ponderResource, type PonderDraw, type PonderFrame, type PonderManifest } from './format.mts';
import { ponderMeshStreams } from './meshStreams.mts';
import { ponderFluidMesh, ponderFluidMeshSize } from './fluidFaces.mts';
import { maxPonderParticleVerticesBytes } from './particleQuads.mts';
import { maxRigidVertexBytes } from './rigidParts.mts';
import { maxOutlineVertexBytes } from './outlineCuboids.mts';
import { maxPonderBoxFaceVertexBytes } from './boxFaces.mts';
import { maxPonderLightningVertexBytes } from './lightning.mts';
import { maxPonderGlintVertexBytes } from './glintParts.mts';
import { ponderPlatformShadowAsset, ponderPlatformShadowBytes } from './platformShadow.mts';
import { drawPonder2d, supportsPonderDraw2d, type PonderPixels } from './raster2d.mts';
import { createPonderAtlasPlayback, ponderAtlasTextureKey } from './atlasPlayback';

type Cached = { data: ArrayBuffer | PonderPixels; size: number };

const cacheBudget = 40 * 1024 ** 2;
const maxFrameAssets = 192;
const maxSurfacePixels = 384 * 1024;
const maxSurfaceSide = 768;
const maxTexturePixels = 4 * 1024 ** 2;
const drawBudget = { vertices: 96_000, primitives: 48_000, samples: 3_000_000 };

function pngDimensions(bytes: ArrayBuffer) {
  if (bytes.byteLength < 33) return;
  const header = new DataView(bytes);
  if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
    || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) return;
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!width || width > maxTextureSide || !height || height > maxTextureSide || width * height > maxTexturePixels) return;
  return { width, height };
}

async function browserImage(bytes: ArrayBuffer) {
  const blob = new Blob([bytes], { type: 'image/png' });
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      return { source: bitmap, release: () => bitmap.close() };
    } catch {
      // Some browsers expose the method without supporting the requested PNG decoding options.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function createPonderRenderer2d(canvas: HTMLCanvasElement, manifest: PonderManifest, readAsset: (path: string) => Promise<ArrayBuffer>) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Ponder Canvas 2D is unavailable');
  const ctx = context;
  const atlasPlayback = createPonderAtlasPlayback(readAsset);
  const scale = Math.min(1, maxSurfaceSide / Math.max(manifest.width, manifest.height),
    Math.sqrt(maxSurfacePixels / (manifest.width * manifest.height)));
  const width = Math.max(1, Math.floor(manifest.width * scale));
  const height = Math.max(1, Math.floor(manifest.height * scale));
  canvas.width = width;
  canvas.height = height;
  const image = ctx.createImageData(width, height);
  const depth = new Float32Array(width * height);
  const surface = { width, height, data: image.data, depth };
  const scratch = document.createElement('canvas');
  const textureContext = scratch.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, Cached>();
  let animatedAtlases = new Map<string, PonderPixels>();
  let cachedBytes = 0;
  let disposed = false;

  function cached(path: string) {
    const asset = cache.get(path);
    if (asset) {
      cache.delete(path);
      cache.set(path, asset);
    }
    return asset?.data;
  }

  function retain(path: string, data: Cached['data'], size: number) {
    if (disposed || size > cacheBudget || cache.has(path)) return;
    for (const [key, asset] of cache) {
      if (cachedBytes + size <= cacheBudget) break;
      cache.delete(key);
      cachedBytes -= asset.size;
    }
    cache.set(path, { data, size });
    cachedBytes += size;
  }

  async function load(path: string, budget: { bytes: number }, current: () => boolean) {
    if (cached(path)) return;
    const slice = ponderMeshSlice(path);
    const mesh = slice?.geometry ? undefined : slice ?? ponderMeshStreams(path);
    const fluid = ponderFluidMesh(path);
    const limit = mesh?.size ?? (fluid ? ponderFluidMeshSize(fluid) : undefined)
      ?? (path === ponderPlatformShadowAsset ? ponderPlatformShadowBytes : undefined);
    const stored = limit === undefined ? ponderResource(ponderGeometryPath(path)) : { kind: 'mesh', limit };
    const resource = stored?.kind === 'particle-quads' ? { kind: 'mesh', limit: maxPonderParticleVerticesBytes }
      : stored?.kind === 'outline-cuboids' ? { kind: 'mesh', limit: maxOutlineVertexBytes }
      : stored?.kind === 'box-faces' ? { kind: 'mesh', limit: maxPonderBoxFaceVertexBytes }
      : stored?.kind === 'lightning' ? { kind: 'mesh', limit: maxPonderLightningVertexBytes }
      : stored?.kind === 'rigid-glint' ? { kind: 'mesh', limit: maxPonderGlintVertexBytes }
      : stored?.kind === 'rigid-batch' ? { kind: 'mesh', limit: maxRigidVertexBytes } : stored;
    if (resource?.kind !== 'mesh' && resource?.kind !== 'image') return;
    try {
      const bytes = await readAsset(path);
      if (disposed || !current() || bytes.byteLength > resource.limit) return;
      budget.bytes -= bytes.byteLength;
      if (budget.bytes < 0) return;
      if (resource.kind === 'mesh') {
        retain(path, bytes, bytes.byteLength);
        return;
      }
      const dimensions = pngDimensions(bytes);
      if (!dimensions || !textureContext) return;
      budget.bytes -= dimensions.width * dimensions.height * 4;
      if (budget.bytes < 0) return;
      const decoded = await browserImage(bytes);
      try {
        if (disposed || !current()) return;
        scratch.width = dimensions.width;
        scratch.height = dimensions.height;
        textureContext.drawImage(decoded.source, 0, 0);
        const pixels = textureContext.getImageData(0, 0, dimensions.width, dimensions.height);
        retain(path, pixels, pixels.data.byteLength);
      } finally {
        decoded.release();
        scratch.width = 1;
        scratch.height = 1;
      }
    } catch {
      // A draw with an unreadable required mesh or base texture can be omitted independently.
    }
  }

  function mesh(path?: string) {
    const data = path && cached(path);
    return data instanceof ArrayBuffer ? data : undefined;
  }

  function texture(path?: string) {
    const data = path ? cached(path) : undefined;
    return data && !(data instanceof ArrayBuffer) ? data : undefined;
  }

  async function render(frame: PonderFrame, current: () => boolean, tick = 0) {
    if (disposed || !current()) return;
    const supports = (draw: PonderDraw) => draw.vertexCount <= drawBudget.vertices && supportsPonderDraw2d(draw);
    const list = frame.draws.filter(supports);
    const overlayStart = manifest.blockModels && frame.overlayStart !== undefined && frame.overlayStart < frame.draws.length
      ? frame.draws.slice(0, frame.overlayStart).filter(supports).length : -1;
    const required = new Set<string>();
    for (const draw of list) {
      required.add(draw.vertices);
      if (draw.indices) required.add(draw.indices);
      for (const asset of Object.values(draw.textures)) required.add(asset.image);
      const next = draw.textures[0]?.transition;
      if (next) required.add(next.image);
    }
    const queue = [...required].slice(0, maxFrameAssets);
    const loading = { bytes: cacheBudget };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(queue.length, 3) }, async () => {
      while (!disposed && current() && loading.bytes > 0 && next < queue.length) await load(queue[next++], loading, current);
    }));
    if (disposed || !current()) return;
    const atlases = new Map<string, PonderPixels | undefined>();
    const nextAnimatedAtlases = new Map<string, PonderPixels>();
    let atlasBytes = 0;
    let staticTextures = false;
    for (const draw of list) {
      const base = draw.textures[0];
      if (!base?.atlasAnimation) continue;
      const key = ponderAtlasTextureKey(base.image, base.atlasAnimation);
      if (atlases.has(key)) continue;
      const still = texture(base.image);
      atlases.set(key, still);
      if (!still) continue;
      try {
        if (atlasBytes + still.data.byteLength > cacheBudget) throw new Error('Ponder atlas budget exceeded');
        const patches = await atlasPlayback.sample(base.atlasAnimation, still.width, still.height, tick);
        if (disposed || !current()) return;
        const data = animatedAtlases.get(key)?.data ?? new Uint8ClampedArray(still.data);
        for (const { x, y, width, height, pixels } of patches) {
          for (let row = 0; row < height; row++) {
            data.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * still.width + x) * 4);
          }
        }
        const animated = { width: still.width, height: still.height, data };
        atlases.set(key, animated);
        nextAnimatedAtlases.set(key, animated);
        atlasBytes += data.byteLength;
      } catch {
        if (disposed || !current()) return;
        staticTextures = true;
      }
    }
    depth.fill(1);
    image.data.fill(0);
    const budget = { ...drawBudget };
    let rendered = 0;
    for (const [index, draw] of list.entries()) {
      if (index === overlayStart) depth.fill(1);
      const vertices = mesh(draw.vertices);
      if (!vertices) continue;
      const indices = mesh(draw.indices);
      const base = draw.textures[0];
      const basePixels = base?.atlasAnimation ? atlases.get(ponderAtlasTextureKey(base.image, base.atlasAnimation)) : texture(base?.image);
      const images = [basePixels, texture(draw.textures[1]?.image), texture(draw.textures[2]?.image), texture(base?.transition?.image)];
      if (drawPonder2d(surface, draw, vertices, indices, images, manifest.diffuseLights, budget)) rendered++;
    }
    if (disposed || !current()) return;
    ctx.putImageData(image, 0, 0);
    animatedAtlases = nextAnimatedAtlases;
    return {
      omitted: frame.omitted + frame.draws.length - rendered,
      staticTextures: staticTextures || list.some(draw => Object.values(draw.textures).some(texture => texture.animation || texture.animated)),
    };
  }

  return {
    render,
    dispose() {
      disposed = true;
      atlasPlayback.dispose();
      cache.clear();
      animatedAtlases.clear();
      cachedBytes = 0;
    },
  };
}
