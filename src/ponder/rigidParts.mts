import { isRecord } from '../objectPatch.mts';

const poseBytes = 130;
const sodiumPoseBytes = 112;
const attributeDigestBytes = 32;
const partVertexBytes = 24;
const drawVertexBytes = 36;
export const rigidAttributeBytes = 12;
const maxParts = 512;
const maxPartVertices = 4096;
export const maxRigidVertexBytes = 16 * 1024 ** 2;

const attributes = [
  ['Position', 0, 'FLOAT', 3],
  ['Color', 12, 'UBYTE', 4],
  ['UV0', 16, 'FLOAT', 2],
  ['UV1', 24, 'SHORT', 2],
  ['UV2', 28, 'SHORT', 2],
  ['Normal', 32, 'BYTE', 3],
] as const;

export function isPonderRigidAttributeLayout(value: unknown) {
  return Array.isArray(value) && value.length === attributes.length && attributes.every(([name, offset, type, count], i) => {
    const attribute = value[i];
    return isRecord(attribute) && attribute.name === name && attribute.offset === offset
      && attribute.type === type && attribute.count === count;
  });
}

type Placement = {
  path: string; count: number;
  attributes?: string;
  normals?: string;
  faceNormals?: Int8Array;
  matrix: Float32Array;
  color: number; overlay: number; light: number;
};

export function ponderRigidBatchVersion(path: string) {
  if (path.startsWith('ponder/rigid-batches/v5/')) return 5;
  if (path.startsWith('ponder/rigid-batches/v4/')) return 4;
  if (path.startsWith('ponder/rigid-batches/v3/')) return 3;
  return path.startsWith('ponder/rigid-batches/v2/') ? 2 : 1;
}

function readSparsePoses(bytes: Uint8Array) {
  if (bytes.length < 7) return;
  const version = bytes[0];
  if (version !== 1 && version !== 2 && version !== 4) return;
  const stride = poseBytes + (version === 4 ? 2 * attributeDigestBytes : version === 2 ? attributeDigestBytes : 0);
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = source.getUint16(1, true);
  if (!count || count > maxParts || bytes.length >= 2 + count * stride) return;
  const output = new Uint8Array(2 + count * stride);
  output.set(bytes.subarray(1, 3));
  const defaults = new Uint8Array(stride);
  const identity = new DataView(defaults.buffer);
  for (const lane of [34, 50, 66, 82, 98, 114]) identity.setFloat32(lane, 1, true);
  const lanes = 25 + (stride - poseBytes) / attributeDigestBytes;
  const boundary = (lane: number) => lane === 0 ? 0 : lane <= 25 ? 34 + (lane - 1) * 4
    : poseBytes + (lane - 25) * attributeDigestBytes;
  const valid = 0x80000000 | ((1 << lanes) - 1);
  let cursor = 3;
  for (let row = 0; row < count; row++) {
    if (cursor + 4 > bytes.length) return;
    const mask = source.getUint32(cursor, true);
    cursor += 4;
    const previous = mask >>> 31;
    if ((previous && !row) || (mask & ~valid)) return;
    const start = 2 + row * stride;
    output.set(previous ? output.subarray(start - stride, start) : defaults, start);
    for (let lane = 0; lane < lanes; lane++) {
      if (!(mask & (1 << lane))) continue;
      const from = boundary(lane), size = boundary(lane + 1) - from;
      if (cursor + size > bytes.length) return;
      output.set(bytes.subarray(cursor, cursor + size), start + from);
      cursor += size;
    }
  }
  if (cursor === bytes.length) return { version, output };
}

function readDigest(data: DataView, start: number) {
  let digest = '';
  for (let i = start; i < start + attributeDigestBytes; i++) digest += data.getUint8(i).toString(16).padStart(2, '0');
  return digest;
}

export function readPonderRigidBatch(bytes: Uint8Array, version = 1): { parts: Placement[]; vertices: number } | undefined {
  if (version === 5) {
    const packed = readSparsePoses(bytes);
    return packed && readPonderRigidBatch(packed.output, packed.version);
  }
  if (version < 1 || version > 4 || !Number.isInteger(version)) return;
  if (bytes.byteLength < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  const stride = version === 3 ? sodiumPoseBytes
    : version === 4 ? poseBytes + 2 * attributeDigestBytes
      : version === 2 ? poseBytes + attributeDigestBytes : poseBytes;
  if (count < 1 || count > maxParts || bytes.byteLength !== 2 + count * stride) return;
  let vertices = 0;
  const parts: Placement[] = [];
  for (let part = 0; part < count; part++) {
    const start = 2 + part * stride;
    const length = data.getUint16(start + 32, true);
    if (length < 4 || length > (version === 3 ? 24 : maxPartVertices) || length % 4) return;
    vertices += length;
    if (vertices * drawVertexBytes > maxRigidVertexBytes) return;
    const matrix = Float32Array.from({ length: version === 3 ? 12 : 21 }, (_, i) => data.getFloat32(start + 34 + 4 * i, true));
    if (!matrix.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return;
    const digest = readDigest(data, start);
    const path = `ponder/rigid-parts/v1/${digest}.bin`;
    if (version === 3) {
      const faceNormals = Int8Array.from({ length: 18 }, (_, i) => data.getInt8(start + 82 + i));
      if (faceNormals.includes(-128)) return;
      parts.push({ path, count: length, matrix, faceNormals, color: data.getUint32(start + 100, true),
        overlay: data.getUint32(start + 104, true), light: data.getUint32(start + 108, true) });
      continue;
    }
    const attrDigest = version === 2 || version === 4 ? readDigest(data, start + poseBytes) : '';
    const normalDigest = version === 4 ? readDigest(data, start + poseBytes + attributeDigestBytes) : '';
    const external = /[1-9a-f]/.test(attrDigest);
    const color = data.getUint32(start + 118, true);
    const overlay = data.getUint32(start + 122, true);
    const light = data.getUint32(start + 126, true);
    if (external && (color || overlay || light)) return;
    parts.push({
      path, count: length, matrix,
      ...(external && { attributes: `ponder/rigid-attributes/v1/${attrDigest}.bin` }),
      ...(/[1-9a-f]/.test(normalDigest) && { normals: `ponder/rigid-normals/v1/${normalDigest}.bin` }),
      color, overlay, light,
    });
  }
  return { parts, vertices };
}

export function ponderRigidAttributeCount(bytes: Uint8Array) {
  const count = bytes.byteLength / rigidAttributeBytes;
  if (count >= 4 && count <= maxPartVertices && count % 4 === 0) return count;
}

export function ponderRigidPartVertexCount(bytes: Uint8Array, requireCorners = false) {
  const count = bytes.byteLength / partVertexBytes;
  if (!Number.isInteger(count) || count < 4 || count > (requireCorners ? 24 : maxPartVertices) || count % 4) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < data.byteLength; offset += partVertexBytes) {
    for (let field = 0; field < 20; field += 4) if (!Number.isFinite(data.getFloat32(offset + field, true))) return;
    if (requireCorners) {
      for (let field = 0; field < 12; field += 4) {
        const selector = data.getFloat32(offset + field, true);
        if (selector !== 0 && selector !== 1) return;
      }
    }
    let sum = 0;
    for (let field = 20; field < 23; field++) {
      const absolute = Math.abs(data.getInt8(offset + field));
      if (absolute > 127 || (requireCorners && absolute !== 0 && absolute !== 127)) return;
      sum += absolute;
    }
    if (requireCorners && sum !== 127) return;
  }
  return count;
}

export function ponderRigidNormalPaletteCount(bytes: Uint8Array) {
  const count = bytes.byteLength / 3;
  if (Number.isInteger(count) && count >= 1 && count <= maxPartVertices && !bytes.includes(128)) return count;
}

export function ponderRigidNormalLayout(bytes: Uint8Array) {
  const indices = new Uint16Array(bytes.byteLength / partVertexBytes);
  const keys = new Map<number, number>();
  let axisAligned = true;
  for (let i = 0; i < indices.length; i++) {
    const offset = i * partVertexBytes + 20;
    const x = bytes[offset], y = bytes[offset + 1], z = bytes[offset + 2];
    if (x === 128 || y === 128 || z === 128) return;
    const key = x | y << 8 | z << 16;
    let index = keys.get(key);
    if (index === undefined) {
      const axes = [x, y, z].filter(value => value !== 0);
      axisAligned &&= axes.length === 1 && (axes[0] === 127 || axes[0] === 129);
      index = keys.size;
      keys.set(key, index);
    }
    indices[i] = index;
  }
  return { indices, count: keys.size, axisAligned };
}

export function transformPonderVertex(matrix: Float32Array, axis: number, x: number, y: number, z: number, t: number) {
  const f = Math.fround;
  return f(f(matrix[axis] * x) + f(f(matrix[axis + 3] * y) + f(f(matrix[axis + 6] * z) + t)));
}

/** Rebuilds an entity batch in its original order so any original index buffer remains usable. */
export function buildPonderRigidVertices(batch: NonNullable<ReturnType<typeof readPonderRigidBatch>>,
  geometry: readonly Uint8Array[], attributes: readonly (Uint8Array | undefined)[] = [],
  normalPalettes: readonly (Uint8Array | undefined)[] = []) {
  if (geometry.length !== batch.parts.length) return;
  const result = new ArrayBuffer(batch.vertices * drawVertexBytes);
  const target = new DataView(result);
  let cursor = 0;
  for (const [index, placement] of batch.parts.entries()) {
    const bytes = geometry[index];
    if (bytes.byteLength !== partVertexBytes * placement.count) return;
    const base = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const { matrix, faceNormals, color, overlay, light } = placement;
    if (faceNormals && !ponderRigidPartVertexCount(bytes, true)) return;
    const data = attributes[index];
    if (placement.attributes && (!data || ponderRigidAttributeCount(data) !== placement.count)) return;
    const values = data && placement.attributes ? new DataView(data.buffer, data.byteOffset, data.byteLength) : undefined;
    const palette = normalPalettes[index];
    const normals = placement.normals ? ponderRigidNormalLayout(bytes) : undefined;
    if (placement.normals && (!palette || !normals || ponderRigidNormalPaletteCount(palette) !== normals.count)) return;
    for (let vertex = 0; vertex < placement.count; vertex++, cursor += drawVertexBytes) {
      const at = vertex * partVertexBytes;
      const attribute = vertex * rigidAttributeBytes;
      const x = base.getFloat32(at, true), y = base.getFloat32(at + 4, true), z = base.getFloat32(at + 8, true);
      const nx = base.getInt8(at + 20) / 127, ny = base.getInt8(at + 21) / 127, nz = base.getInt8(at + 22) / 127;
      if (faceNormals) {
        const face = nx < 0 ? 4 : nx > 0 ? 2 : ny < 0 ? 0 : ny > 0 ? 1 : nz < 0 ? 3 : 5;
        for (let axis = 0; axis < 3; axis++) {
          // Sodium adds only the selected deltas and rounds after each addition.
          let position = matrix[axis];
          if (x) position = Math.fround(position + matrix[axis + 3]);
          if (y) position = Math.fround(position + matrix[axis + 6]);
          if (z) position = Math.fround(position + matrix[axis + 9]);
          target.setFloat32(cursor + axis * 4, position, true);
          target.setInt8(cursor + 32 + axis, faceNormals[face * 3 + axis]);
        }
      } else {
        for (let axis = 0; axis < 3; axis++) {
          const position = transformPonderVertex(matrix, axis, x, y, z, matrix[axis + 9]);
          if (!Number.isFinite(position)) return;
          target.setFloat32(cursor + axis * 4, position, true);
          if (normals && palette) {
            target.setUint8(cursor + 32 + axis, palette[normals.indices[vertex] * 3 + axis]);
          } else {
            const normal = transformPonderVertex(matrix, axis + 12, nx, ny, nz, 0);
            if (!Number.isFinite(normal)) return;
            target.setInt8(cursor + 32 + axis, Math.fround(Math.min(1, Math.max(-1, normal)) * 127));
          }
        }
      }
      target.setUint32(cursor + 12, values?.getUint32(attribute, true) ?? color, true);
      target.setUint32(cursor + 16, base.getUint32(at + 12, true), true);
      target.setUint32(cursor + 20, base.getUint32(at + 16, true), true);
      target.setUint32(cursor + 24, values?.getUint32(attribute + 4, true) ?? overlay, true);
      target.setUint32(cursor + 28, values?.getUint32(attribute + 8, true) ?? light, true);
    }
  }
  return result;
}
