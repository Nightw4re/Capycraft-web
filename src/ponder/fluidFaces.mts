import { isRecord } from '../objectPatch.mts';
import { ponderResource, type PonderDraw, type PonderTexture } from './format.mts';
import { ponderSpriteImage, readPonderSpriteFrames, type SpriteAnimation } from './spriteAnimation.mts';

const directions = ['down', 'up', 'north', 'south', 'west', 'east'];
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const stride = 24;
const maxTiles = 1024;
const meshPrefix = 'fluid-face:';
type FaceGeometry = [number, number, number, number, number, number, number, number, number];
export type FluidFace = {
  geometry: FaceGeometry; transform: number[]; tint: number; image: string; lightmap: string;
  frames?: ReturnType<typeof readPonderSpriteFrames>; interpolate?: true; spriteAnimation?: number;
};

function finite(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function texture(value: unknown): value is string {
  return typeof value === 'string' && ponderResource(value)?.kind === 'image';
}

function readGeometry(value: unknown): FaceGeometry | undefined {
  if (!Array.isArray(value) || value.length !== 9 || !value.every(item => finite(item, 16_777_215))) return;
  const [direction, left, bottom, right, top, plane, scale, shrink, light] = value.map(Math.fround);
  if (!Number.isInteger(direction) || !directions[direction] || left >= right || bottom >= top
    || [left, bottom, right, top, plane].some(item => !finite(item, 4096))
    || !(scale > 0 && scale <= 1) || shrink < 0 || shrink > 1 || light < 0
    || value[0] !== direction || value[8] !== light || !Number.isInteger(light)) return;
  return [direction, left, bottom, right, top, plane, scale, shrink, light];
}

function tiles([, left, bottom, right, top]: FaceGeometry) {
  return (Math.ceil(right) - Math.floor(left)) * (Math.ceil(top) - Math.floor(bottom));
}

export function readPonderFluidFaces(value: unknown, spriteAnimations: readonly SpriteAnimation[] = []): FluidFace[] | undefined {
  if (!Array.isArray(value) || value.length > 256) return;
  const faces: FluidFace[] = [];
  let count = 0;
  for (const entry of value) {
    if (!isRecord(entry)) return;
    const { transform, tint, image, lightmap, frames, interpolate, spriteAnimation } = entry;
    const geometry = readGeometry(entry.geometry);
    if (!geometry || !Array.isArray(transform) || transform.length !== 16
      || !transform.every(item => finite(item, 1e6)) || !finite(tint, 2 ** 31) || tint >= 2 ** 31 || !Number.isInteger(tint)
      || !texture(image) || !texture(lightmap)) return;
    const animation = readPonderSpriteFrames(frames);
    if (frames !== undefined && !animation) return;
    if (interpolate !== undefined && (interpolate !== true || !animation)) return;
    if (spriteAnimation !== undefined && (typeof spriteAnimation !== 'number' || !Number.isInteger(spriteAnimation)
      || spriteAnimation < 0 || spriteAnimation >= spriteAnimations.length || animation)) return;
    count += tiles(geometry);
    if (count > maxTiles) return;
    faces.push({ geometry, transform, tint, image, lightmap, ...(animation && { frames: animation }),
      ...(interpolate && { interpolate }), ...(typeof spriteAnimation === 'number' && { spriteAnimation }) });
  }
  return faces;
}

export function ponderFluidMesh(path: string) {
  if (!path.startsWith(meshPrefix) || path.length > 300) return;
  try {
    const geometry = readGeometry(JSON.parse(path.slice(meshPrefix.length)));
    if (geometry && tiles(geometry) <= maxTiles) return geometry;
  } catch {
    return undefined;
  }
}

export function ponderFluidMeshSize(geometry: FaceGeometry) {
  return tiles(geometry) * 4 * stride;
}

function corners(direction: number, loU: number, loV: number, hiU: number, hiV: number, plane: number) {
  // Keep the same winding and UV origin as Catnip's tiled fluid surface.
  if (direction === 4) return [[plane, hiV, loU], [plane, loV, loU], [plane, loV, hiU], [plane, hiV, hiU]];
  if (direction === 5) return [[plane, hiV, hiU], [plane, loV, hiU], [plane, loV, loU], [plane, hiV, loU]];
  if (direction === 2) return [[hiU, hiV, plane], [hiU, loV, plane], [loU, loV, plane], [loU, hiV, plane]];
  if (direction === 3) return [[loU, hiV, plane], [loU, loV, plane], [hiU, loV, plane], [hiU, hiV, plane]];
  if (direction === 1) return [[loU, plane, loV], [loU, plane, hiV], [hiU, plane, hiV], [hiU, plane, loV]];
  return [[loU, plane, hiV], [loU, plane, loV], [hiU, plane, loV], [hiU, plane, hiV]];
}

export function buildPonderFluidMesh(geometry: FaceGeometry) {
  const [direction, left, bottom, right, top, plane, scale, shrink, light] = geometry;
  const bytes = new ArrayBuffer(ponderFluidMeshSize(geometry));
  const buffer = new DataView(bytes);
  const sample = (coordinate: number) => Math.fround(coordinate * scale) * (1 - shrink) + scale * 0.5 * shrink;
  let offset = 0;
  for (let u = left; u < right;) {
    const hiU = Math.min(right, Math.floor(u) + 1);
    const reverse = direction === 2 || direction === 5;
    const u0 = sample(reverse ? Math.ceil(hiU) - hiU : u - Math.floor(u));
    const u1 = sample(reverse ? Math.ceil(hiU) - u : hiU - Math.floor(u));
    for (let v = bottom; v < top;) {
      const hiV = Math.min(top, Math.floor(v) + 1);
      const v0 = sample(direction === 1 ? v - Math.floor(v) : Math.ceil(hiV) - hiV);
      const v1 = sample(direction === 1 ? hiV - Math.floor(v) : Math.ceil(hiV) - v);
      const uv = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      corners(direction, u, v, hiU, hiV, plane).forEach(([x, y, z], vertex) => {
        buffer.setFloat32(offset, x, true);
        buffer.setFloat32(offset + 4, y, true);
        buffer.setFloat32(offset + 8, z, true);
        buffer.setFloat32(offset + 12, uv[vertex][0], true);
        buffer.setFloat32(offset + 16, uv[vertex][1], true);
        buffer.setUint16(offset + 20, light & 0xffff, true);
        buffer.setUint16(offset + 22, light >>> 16, true);
        offset += stride;
      });
      v = hiV;
    }
    u = hiU;
  }
  return bytes;
}

export function ponderFluidDraws(faces: readonly FluidFace[], projection: Float32Array, tick = 0,
  spriteAnimations: readonly SpriteAnimation[] = []): { depth: number; draw: PonderDraw }[] {
  const descriptor = (texture: Pick<PonderTexture, 'image' | 'transition'>, minFilter: number, magFilter: number) =>
    ({ ...texture, minFilter, magFilter, wrapS: 33071, wrapT: 33071 });
  const position = (geometry: FaceGeometry) => {
    const points = corners(geometry[0], ...geometry.slice(1, 6) as [number, number, number, number, number]);
    return points[0].map((value, axis) => (value + points[2][axis]) / 2);
  };
  const depth = (face: FluidFace) => {
    const [x, y, z] = position(face.geometry);
    const m = face.transform;
    return m[2] * x + m[6] * y + m[10] * z + m[14];
  };
  return faces.map(face => {
    const sprite = face.spriteAnimation === undefined ? face : spriteAnimations[face.spriteAnimation];
    const draw: PonderDraw = {
      shader: 'rendertype_translucent',
      mode: 'QUADS',
      vertices: meshPrefix + JSON.stringify(face.geometry),
      vertexCount: tiles(face.geometry) * 4,
      indexCount: tiles(face.geometry) * 6,
      stride,
      attributes: [
        { name: 'Position', type: 'FLOAT', offset: 0, count: 3 },
        { name: 'UV0', type: 'FLOAT', offset: 12, count: 2 },
        { name: 'UV2', type: 'SHORT', offset: 20, count: 2 },
      ],
      textures: { 0: descriptor(ponderSpriteImage(face.image, sprite?.frames, tick, sprite?.interpolate), 9986, 9728),
        2: descriptor({ image: face.lightmap }, 9729, 9729) },
      projection,
      modelView: new Float32Array(face.transform),
      textureMatrix: identity,
      color: Float32Array.of((face.tint >>> 16 & 255) / 255, (face.tint >>> 8 & 255) / 255,
        (face.tint & 255) / 255, (face.tint >>> 24) / 255),
      depthTest: true,
      depthFunction: 515,
      depthWrite: true,
      cull: true,
      blend: true,
      blendFactors: [770, 771, 1, 771],
    };
    return { depth: depth(face), draw };
  });
}
