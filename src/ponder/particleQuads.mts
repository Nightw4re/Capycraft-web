import { isRecord } from '../objectPatch.mts';

const appearanceBytes = 24;
const correctionBytes = 6;
const sparseCorrectionBytes = 2 + correctionBytes;
const vertexBytes = 28;
const basisBytes = 24;
const scaledQuadBytes = 20;
export const maxPonderParticleQuads = 16_384;
export const maxPonderParticleVerticesBytes = maxPonderParticleQuads * 4 * vertexBytes;

const attributes = [
  ['Position', 0, 'FLOAT', 3],
  ['UV0', 12, 'FLOAT', 2],
  ['Color', 20, 'UBYTE', 4],
  ['UV2', 24, 'SHORT', 2],
] as const;

export function isPonderParticleAttributeLayout(value: unknown) {
  return Array.isArray(value) && value.length === attributes.length && attributes.every(([name, offset, type, count], i) => {
    const attribute = value[i];
    return isRecord(attribute) && attribute.name === name && attribute.offset === offset
      && attribute.type === type && attribute.count === count;
  });
}

export function ponderParticleVersion(path: string) {
  if (path.startsWith('ponder/particle-quads/v4/')) return 4;
  if (path.startsWith('ponder/particle-quads/v3/')) return 3;
  return path.startsWith('ponder/particle-quads/v2/') ? 2 : 1;
}

function correction(data: DataView, start: number, lane: number) {
  const encoded = data.getUint8(start + (lane >> 1)) >> ((lane & 1) * 4) & 15;
  return encoded < 8 ? encoded : encoded - 16;
}

function secondDiagonal(data: DataView, start: number, offset: number, first: number) {
  return offset < 0 ? -first : data.getFloat32(start + offset, true);
}

function readParticleBatch(bytes: Uint8Array, version: number) {
  const scaled = version === 4;
  const sparse = version === 3 || scaled;
  const headerBytes = sparse ? 8 : 4;
  if ((version !== 1 && version !== 2 && !sparse) || bytes.byteLength < headerBytes) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  const appearances = data.getUint16(2, true);
  const opposite = version === 3 ? data.getUint16(4, true) : 0;
  const bases = scaled ? data.getUint16(4, true) : 0;
  const sparseCorrections = sparse ? data.getUint16(6, true) : 0;
  if (opposite > 7 || sparseCorrections > count || (scaled && (bases < 1 || bases > count))) return;
  const secondOffsets: number[] = [];
  let appearanceOffset = 24;
  for (let axis = 0; axis < 3; axis++) {
    if (opposite & (1 << axis)) secondOffsets.push(-1);
    else {
      secondOffsets.push(appearanceOffset);
      appearanceOffset += 4;
    }
  }
  const quadBytes = scaled ? scaledQuadBytes : appearanceOffset + 2;
  if (scaled) appearanceOffset = 18;
  const basisStart = headerBytes + appearances * appearanceBytes;
  const quadStart = basisStart + bases * basisBytes;
  const correctionsStart = quadStart + count * quadBytes;
  const dense = version === 2;
  if (count < 1 || count > maxPonderParticleQuads || appearances < 1 || appearances > count
    || bytes.byteLength !== correctionsStart + (dense ? count * correctionBytes : sparseCorrections * sparseCorrectionBytes)) return;
  for (let index = 0; index < appearances; index++) {
    const start = headerBytes + index * appearanceBytes;
    for (let lane = 0; lane < 4; lane++) if (!Number.isFinite(data.getFloat32(start + lane * 4, true))) return;
  }
  for (let offset = basisStart; offset < quadStart; offset += 4) {
    if (!Number.isFinite(data.getFloat32(offset, true))) return;
  }
  const correctionOffsets = new Map<number, number>();
  let previousQuad = -1;
  for (let record = 0; record < sparseCorrections; record++) {
    const start = correctionsStart + record * sparseCorrectionBytes;
    const quad = data.getUint16(start, true);
    if (quad <= previousQuad || quad >= count) return;
    correctionOffsets.set(quad, start + 2);
    previousQuad = quad;
  }
  const scratch = new DataView(new ArrayBuffer(4));
  const geometry = (start: number) => {
    if (!scaled) return { basis: start + 12, scale: 1 };
    const index = data.getUint16(start + 16, true);
    if (index >= bases) return;
    return { basis: basisStart + index * basisBytes, scale: data.getFloat32(start + 12, true) };
  };
  const offsets = ({ basis, scale }: { basis: number; scale: number }, start: number, axis: number) => {
    const first = data.getFloat32(basis + axis * 4, true);
    return scaled ? [Math.fround(first * scale), Math.fround(data.getFloat32(basis + 12 + axis * 4, true) * scale)]
      : [first, secondDiagonal(data, start, secondOffsets[axis], first)];
  };
  for (let quad = 0; quad < count; quad++) {
    const start = quadStart + quad * quadBytes;
    const correctionOffset = dense ? correctionsStart + quad * correctionBytes : correctionOffsets.get(quad);
    const shape = geometry(start);
    if (!shape || data.getUint16(start + appearanceOffset, true) >= appearances) return;
    for (let axis = 0; axis < 3; axis++) {
      const center = data.getFloat32(start + axis * 4, true);
      const [first, second] = offsets(shape, start, axis);
      for (let corner = 0; corner < 4; corner++) {
        const offset = corner % 2 === 0 ? first : second;
        const value = Math.fround(center + (corner < 2 ? offset : -offset));
        if (!Number.isFinite(value)) return;
        if (correctionOffset !== undefined) {
          const delta = correction(data, correctionOffset, corner * 3 + axis);
          if (delta === -8) return;
          scratch.setFloat32(0, value, true);
          const corrected = scratch.getInt32(0, true) + delta;
          if (corrected < -0x80000000 || corrected > 0x7fffffff) return;
          scratch.setInt32(0, corrected, true);
          if (!Number.isFinite(scratch.getFloat32(0, true))) return;
        }
      }
    }
  }
  return { data, count, headerBytes, quadStart, quadBytes, appearanceOffset, correctionsStart, correctionOffsets, dense, offsets, geometry };
}

export function ponderParticleQuadCount(bytes: Uint8Array, version = 1) {
  return readParticleBatch(bytes, version)?.count;
}

/** Recreates the original particle vertex layout in submission order. */
export function buildPonderParticleVertices(bytes: Uint8Array, version = 1) {
  const batch = readParticleBatch(bytes, version);
  if (!batch) return;
  const { data: source, count, headerBytes, quadStart, quadBytes, appearanceOffset,
    correctionsStart, correctionOffsets, dense, offsets, geometry } = batch;
  const result = new ArrayBuffer(count * 4 * vertexBytes);
  const vertices = new DataView(result);
  for (let quad = 0; quad < count; quad++) {
    const start = quadStart + quad * quadBytes;
    const appearance = headerBytes + source.getUint16(start + appearanceOffset, true) * appearanceBytes;
    const correctionOffset = dense ? correctionsStart + quad * correctionBytes : correctionOffsets.get(quad);
    const shape = geometry(start)!;
    const axes = [0, 1, 2].map(axis => offsets(shape, start, axis));
    for (let corner = 0; corner < 4; corner++) {
      const target = (quad * 4 + corner) * vertexBytes;
      const sign = corner < 2 ? 1 : -1;
      for (let axis = 0; axis < 3; axis++) {
        const lane = axis * 4;
        const center = source.getFloat32(start + lane, true);
        const offset = axes[axis][corner % 2];
        vertices.setFloat32(target + lane, center + sign * offset, true);
        if (correctionOffset !== undefined) {
          const delta = correction(source, correctionOffset, corner * 3 + axis);
          vertices.setInt32(target + lane, vertices.getInt32(target + lane, true) + delta, true);
        }
      }
      vertices.setUint32(target + 12, source.getUint32(appearance + (corner < 2 ? 0 : 8), true), true);
      vertices.setUint32(target + 16, source.getUint32(appearance + (corner === 0 || corner === 3 ? 4 : 12), true), true);
      vertices.setUint32(target + 20, source.getUint32(appearance + 16, true), true);
      vertices.setUint32(target + 24, source.getUint32(appearance + 20, true), true);
    }
  }
  return result;
}
