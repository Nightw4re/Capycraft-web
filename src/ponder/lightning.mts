import { isRecord } from '../objectPatch.mts';
import { transformPonderVertex } from './rigidParts.mts';

const maxBolts = 16;
const verticesPerBolt = 896;
const rowBytes = 56;
const stride = 16;
const seedMask = (1n << 48n) - 1n;
const multiplier = 25214903917n;
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const f = Math.fround;
export const maxPonderLightningVertexBytes = maxBolts * verticesPerBolt * stride;

export function isPonderLightningDraw(draw: Record<string, unknown>) {
  const { shader, mode, vertexCount, indexCount, attributes } = draw;
  if (shader !== 'rendertype_lightning' || mode !== 'QUADS' || draw.stride !== stride
    || typeof vertexCount !== 'number' || !Number.isSafeInteger(vertexCount) || vertexCount < verticesPerBolt
    || vertexCount > maxBolts * verticesPerBolt || vertexCount % verticesPerBolt || indexCount !== vertexCount / 4 * 6
    || !Array.isArray(attributes) || attributes.length !== 2) return false;
  return [['Position', 0, 'FLOAT', 3], ['Color', 12, 'UBYTE', 4]].every(([name, offset, type, count]) =>
    attributes.some(value => isRecord(value) && value.name === name && value.offset === offset
      && value.type === type && value.count === count));
}

function visitBolts(bytes: Uint8Array, visit?: (seed: bigint, pose: Float32Array) => void) {
  if (bytes.length < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  if (!count || count > maxBolts || bytes.length !== 2 + count * rowBytes) return;
  for (let i = 0; i < count; i++) {
    const at = 2 + i * rowBytes;
    const seed = data.getBigUint64(at, true);
    const pose = Float32Array.from({ length: 12 }, (_, lane) => data.getFloat32(at + 8 + lane * 4, true));
    if (seed > seedMask || !pose.every(value => Math.abs(value) <= 1e6)) return;
    visit?.(seed, pose);
  }
  return count * verticesPerBolt;
}

export function ponderLightningVertexCount(bytes: Uint8Array) {
  return visitBolts(bytes);
}

function legacyRandom(seed: bigint) {
  let state = (seed ^ multiplier) & seedMask;
  return (bound: number) => {
    for (;;) {
      state = (state * multiplier + 11n) & seedMask;
      const bits = Number(state >> 17n);
      const value = bits % bound;
      // Java rejects values whose signed 32-bit sum overflows.
      if (bits - value + (bound - 1) <= 0x7fffffff) return value;
    }
  };
}

export function buildPonderLightningVertices(bytes: Uint8Array) {
  const count = ponderLightningVertexCount(bytes);
  if (!count) return;
  const buffer = new ArrayBuffer(count * stride);
  const target = new DataView(buffer);
  let cursor = 0;
  visitBolts(bytes, (seed, pose) => {
    const point = (x: number, y: number, z: number, width: number, [sideX, sideZ]: typeof corners[number]) => {
      const px = f(x + sideX * width), pz = f(z + sideZ * width);
      for (let axis = 0; axis < 3; axis++) {
        target.setFloat32(cursor + axis * 4, transformPonderVertex(pose, axis, px, y, pz, pose[axis + 9]), true);
      }
      target.setUint32(cursor + 12, 0x4c7f7272, true);
      cursor += stride;
    };
    const mainRandom = legacyRandom(seed);
    const centerX = new Int32Array(8), centerZ = new Int32Array(8);
    let endX = 0, endZ = 0;
    for (let segment = 7; segment >= 0; segment--) {
      centerX[segment] = endX;
      centerZ[segment] = endZ;
      endX += mainRandom(11) - 5;
      endZ += mainRandom(11) - 5;
    }
    for (let layer = 0; layer < 4; layer++) {
      const next = legacyRandom(seed);
      for (let branch = 0; branch < 3; branch++) {
        const top = 7 - branch;
        const bottom = branch ? top - 2 : 0;
        const bound = branch ? 31 : 11;
        const half = bound >>> 1;
        let x = centerX[top] - endX, z = centerZ[top] - endZ;
        for (let segment = top; segment >= bottom; segment--) {
          const nextX = x + (next(bound) - half), nextZ = z + (next(bound) - half);
          const base = f(f(0.1) + f(layer * f(0.2)));
          const upper = branch ? base : f(base * f(f(segment * f(0.1)) + 1));
          const lower = branch ? base : f(base * f(f((segment - 1) * f(0.1)) + 1));
          for (let side = 0; side < 4; side++) {
            const a = corners[side], b = corners[(side + 1) % 4];
            point(nextX, segment * 16, nextZ, lower, a);
            point(x, (segment + 1) * 16, z, upper, a);
            point(x, (segment + 1) * 16, z, upper, b);
            point(nextX, segment * 16, nextZ, lower, b);
          }
          x = nextX;
          z = nextZ;
        }
      }
    }
  });
  return buffer;
}
