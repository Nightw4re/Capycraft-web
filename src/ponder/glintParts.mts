import { isRecord } from '../objectPatch.mts';
import { transformPonderVertex } from './rigidParts.mts';

const poseBytes = 82;
const vertexStride = 20;
const partStride = 24;
export const maxPonderGlintVertexBytes = 16 * 1024 ** 2;

export function isPonderGlintDraw(draw: Record<string, unknown>) {
  const { shader, mode, stride, indices, vertexCount, indexCount, attributes } = draw;
  if (shader !== 'rendertype_glint' || mode !== 'QUADS' || stride !== vertexStride || indices !== undefined
    || typeof vertexCount !== 'number' || !Number.isSafeInteger(vertexCount) || vertexCount < 4 || vertexCount % 4
    || vertexCount * vertexStride > maxPonderGlintVertexBytes || indexCount !== vertexCount / 4 * 6
    || !Array.isArray(attributes) || attributes.length !== 2) return false;
  const position = attributes.find(attribute => isRecord(attribute) && attribute.name === 'Position');
  const uv = attributes.find(attribute => isRecord(attribute) && attribute.name === 'UV0');
  return isRecord(position) && position.type === 'FLOAT' && position.offset === 0 && position.count === 3
    && isRecord(uv) && uv.type === 'FLOAT' && uv.offset === 12 && uv.count === 2;
}

export function readPonderGlintBatch(bytes: Uint8Array) {
  if (bytes.byteLength < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  if (!count || count > 512 || bytes.byteLength !== 2 + count * poseBytes) return;
  const parts: { path: string; count: number; matrix: Float32Array }[] = [];
  let vertices = 0;
  for (let start = 2; start < bytes.byteLength; start += poseBytes) {
    const length = data.getUint16(start + 32, true);
    if (length < 4 || length > 4096 || length % 4) return;
    vertices += length;
    if (vertices * vertexStride > maxPonderGlintVertexBytes) return;
    const matrix = Float32Array.from({ length: 12 }, (_, i) => data.getFloat32(start + 34 + i * 4, true));
    if (!matrix.every(value => Math.abs(value) <= 1e6)) return;
    const digest = Array.from(bytes.subarray(start, start + 32), value => value.toString(16).padStart(2, '0')).join('');
    parts.push({ path: `ponder/rigid-parts/v1/${digest}.bin`, count: length, matrix });
  }
  return { parts, vertices };
}

/** Foil draws reuse the base part's local positions and UVs without its lighting attributes. */
export function buildPonderGlintVertices(batch: NonNullable<ReturnType<typeof readPonderGlintBatch>>, parts: readonly Uint8Array[]) {
  if (parts.length !== batch.parts.length) return;
  const vertices = new ArrayBuffer(batch.vertices * vertexStride);
  const output = new DataView(vertices);
  let cursor = 0;
  for (const [index, part] of batch.parts.entries()) {
    const bytes = parts[index];
    if (bytes.byteLength !== part.count * partStride) return;
    const local = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 0; at < bytes.byteLength; at += partStride, cursor += vertexStride) {
      const x = local.getFloat32(at, true), y = local.getFloat32(at + 4, true), z = local.getFloat32(at + 8, true);
      for (let axis = 0; axis < 3; axis++) {
        const position = transformPonderVertex(part.matrix, axis, x, y, z, part.matrix[axis + 9]);
        if (!Number.isFinite(position)) return;
        output.setFloat32(cursor + axis * 4, position, true);
      }
      output.setUint32(cursor + 12, local.getUint32(at + 12, true), true);
      output.setUint32(cursor + 16, local.getUint32(at + 16, true), true);
    }
  }
  return vertices;
}
