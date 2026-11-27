import { isRecord } from '../objectPatch.mts';
import { isPonderRigidAttributeLayout, readPonderRigidBatch, transformPonderVertex } from './rigidParts.mts';

export const maxPonderBoxFaces = 4096;
const stride = 36;
const faceBytes = 59;
const groupBytes = 50;
const entityFloatFields = [0, 4, 8, 16, 20];
export const maxPonderBoxFaceVertexBytes = maxPonderBoxFaces * 4 * stride;

export function ponderBoxFaceVersion(path: string) {
  if (path.startsWith('ponder/box-faces/v4/')) return 4;
  if (path.startsWith('ponder/box-faces/v3/')) return 3;
  return path.startsWith('ponder/box-faces/v2/') ? 2 : 1;
}

const blockAttributes = [
  ['Position', 0, 'FLOAT', 3], ['Color', 12, 'UBYTE', 4], ['UV0', 16, 'FLOAT', 2],
  ['UV2', 24, 'SHORT', 2], ['Normal', 28, 'BYTE', 3],
] as const;

export function isPonderBoxFaceDraw(draw: Record<string, unknown>, version: number) {
  const { shader, vertexCount, stride, indexCount, mode, attributes } = draw;
  if (mode !== 'QUADS' || typeof vertexCount !== 'number' || !Number.isSafeInteger(vertexCount) || vertexCount < 4
    || vertexCount > maxPonderBoxFaces * 4 || vertexCount % 4 || indexCount !== vertexCount / 4 * 6) return false;
  if (version === 1 || version === 3 || version === 4) return (shader === 'rendertype_entity_translucent_cull' || shader === 'rendertype_entity_no_outline')
    && stride === 36 && isPonderRigidAttributeLayout(attributes);
  return version === 2 && shader === 'rendertype_cutout_mipped' && stride === 32 && Array.isArray(attributes)
    && attributes.length === blockAttributes.length && blockAttributes.every(([name, offset, type, count]) =>
      attributes.some(attribute => isRecord(attribute) && attribute.name === name && attribute.offset === offset
        && attribute.type === type && attribute.count === count));
}

function visitFaces(bytes: Uint8Array, version: number,
  face?: (data: DataView, offset: number, pose: Float32Array) => void): number | undefined {
  if ((version !== 1 && version !== 2) || bytes.byteLength < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const groups = data.getUint16(0, true);
  if (!groups || groups > maxPonderBoxFaces) return;
  let at = 2, total = 0;
  for (let group = 0; group < groups; group++) {
    if (at + groupBytes > bytes.byteLength) return;
    const count = data.getUint16(at, true);
    total += count;
    if (!count || total > maxPonderBoxFaces || at + groupBytes + count * faceBytes > bytes.byteLength) return;
    const pose = Float32Array.from({ length: 12 }, (_, lane) => data.getFloat32(at + 2 + lane * 4, true));
    if (!pose.every(value => Math.abs(value) <= 1e6)) return;
    at += groupBytes;
    for (let i = 0; i < count; i++, at += faceBytes) {
      for (let lane = 0; lane < 24; lane += 4) if (!(Math.abs(data.getFloat32(at + lane, true)) <= 4096)) return;
      if ((version === 1 && data.getUint16(at + 24, true) >= 4096) || data.getUint8(at + 58) !== 0) return;
      for (let lane = 27; lane < 43; lane += 4) if (!Number.isFinite(data.getFloat32(at + lane, true))) return;
      face?.(data, at, pose);
    }
  }
  if (at === bytes.byteLength) return total * 4;
}

type MixedRun = { kind: 'boxes' | 'raw'; payload: Uint8Array; vertices: number }
  | { kind: 'rigid'; batch: NonNullable<ReturnType<typeof readPonderRigidBatch>>; vertices: number };
type MixedBoxFaces = { runs: MixedRun[]; vertices: number };

export function readPonderMixedBoxFaces(bytes: Uint8Array, version: number): MixedBoxFaces | undefined {
  if ((version !== 3 && version !== 4) || bytes.byteLength < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  if (!count || count > maxPonderBoxFaces) return;
  const runs: MixedRun[] = [];
  let at = 2, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 6 > data.byteLength) return;
    const header = data.getUint16(at, true);
    const quads = header & (version === 4 ? 0x3fff : 0x7fff);
    const boxes = Boolean(header & 0x8000);
    const rigid = version === 4 && Boolean(header & 0x4000);
    const size = data.getUint32(at + 2, true);
    const vertices = quads * 4;
    at += 6;
    total += quads;
    if (!quads || total > maxPonderBoxFaces || at + size > data.byteLength || (boxes && rigid)) return;
    const payload = bytes.subarray(at, at + size);
    if (rigid) {
      const rigidVersion = payload[0];
      if (rigidVersion !== 1 && rigidVersion !== 2 && rigidVersion !== 4 && rigidVersion !== 5) return;
      const batch = readPonderRigidBatch(payload.subarray(1), rigidVersion);
      if (batch?.vertices !== vertices) return;
      runs.push({ kind: 'rigid', batch, vertices });
    } else if (boxes) {
      // The v1 bounds and pose limits also bound the generated float32 positions.
      if (visitFaces(payload, 1) !== vertices) return;
      runs.push({ kind: 'boxes', payload, vertices });
    } else {
      if (size !== vertices * stride) return;
      for (let vertex = at; vertex < at + size; vertex += stride) {
        for (const field of entityFloatFields) {
          if (!Number.isFinite(data.getFloat32(vertex + field, true))) return;
        }
      }
      runs.push({ kind: 'raw', payload, vertices });
    }
    at += size;
  }
  if (at === bytes.byteLength) return { runs, vertices: total * 4 };
}

export function ponderBoxFaceVertexCount(bytes: Uint8Array, version = 1) {
  return version === 3 || version === 4 ? readPonderMixedBoxFaces(bytes, version)?.vertices : visitFaces(bytes, version);
}

export function assemblePonderMixedBoxFaces(mixed: MixedBoxFaces, rigidVertices: readonly ArrayBuffer[] = []) {
  const buffer = new ArrayBuffer(mixed.vertices * stride);
  const target = new DataView(buffer);
  const output = new Uint8Array(buffer);
  let cursor = 0, rigid = 0;
  for (const run of mixed.runs) {
    const length = run.vertices * stride;
    if (run.kind === 'boxes') writeBoxFaceVertices(run.payload, 1, target, cursor);
    else if (run.kind === 'raw') output.set(run.payload, cursor);
    else {
      const vertices = rigidVertices[rigid++];
      if (vertices?.byteLength !== length) return;
      output.set(new Uint8Array(vertices), cursor);
    }
    cursor += length;
  }
  if (rigid === rigidVertices.length) return buffer;
}

export function buildPonderBoxFaceVertices(bytes: Uint8Array, version = 1) {
  if (version === 3 || version === 4) {
    const mixed = readPonderMixedBoxFaces(bytes, version);
    return mixed && assemblePonderMixedBoxFaces(mixed);
  }
  const vertices = visitFaces(bytes, version);
  if (!vertices) return;
  const vertexStride = version === 2 ? 32 : stride;
  const buffer = new ArrayBuffer(vertices * vertexStride);
  writeBoxFaceVertices(bytes, version, new DataView(buffer), 0);
  return buffer;
}

function writeBoxFaceVertices(bytes: Uint8Array, version: number, target: DataView, cursor: number) {
  const block = version === 2;
  const vertexStride = block ? 32 : stride;
  visitFaces(bytes, version, (data, at, pose) => {
    const order = data.getUint16(at + 24, true);
    const uv = data.getUint8(at + 26);
    for (let point = 0; point < 4; point++, cursor += vertexStride) {
      const corner = order >>> (point * 3);
      const x = data.getFloat32(at + 4 * (corner & 1), true);
      const y = data.getFloat32(at + 8 + 4 * (corner >>> 1 & 1), true);
      const z = data.getFloat32(at + 16 + 4 * (corner >>> 2 & 1), true);
      for (let axis = 0; axis < 3; axis++) {
        target.setFloat32(cursor + axis * 4, transformPonderVertex(pose, axis, x, y, z, pose[axis + 9]), true);
      }
      target.setUint32(cursor + 12, data.getUint32(at + 43, true), true);
      target.setUint32(cursor + 16, data.getUint32(at + 27 + 4 * (uv >>> (2 * point) & 1), true), true);
      target.setUint32(cursor + 20, data.getUint32(at + 35 + 4 * (uv >>> (2 * point + 1) & 1), true), true);
      const light = at + (block && (order & (1 << (12 + point))) ? 47 : 51);
      if (!block) target.setUint32(cursor + 24, data.getUint32(at + 47, true), true);
      target.setUint32(cursor + vertexStride - 8, data.getUint32(light, true), true);
      target.setUint32(cursor + vertexStride - 4, data.getUint32(at + 55, true), true);
    }
  });
}
