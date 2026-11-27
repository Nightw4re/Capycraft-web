import { isPonderRigidAttributeLayout, transformPonderVertex } from './rigidParts.mts';

const recordBytes = 121;
const maxCuboids = 1024;
const stride = 36;
export const outlineCuboidVertices = 24;
export const maxOutlineVertexBytes = maxCuboids * outlineCuboidVertices * stride;

const faces = [
  [1, 0, 4, 5], [2, 3, 7, 6], [6, 4, 0, 2], [3, 1, 5, 7], [2, 0, 1, 3], [7, 5, 4, 6],
];
const normals = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

export function isPonderOutlineDraw(draw: Record<string, unknown>) {
  const { shader, mode, stride: vertexBytes, indices, vertexCount, indexCount, attributes } = draw;
  return shader === 'rendertype_entity_solid' && mode === 'QUADS' && vertexBytes === stride && indices === undefined
    && typeof vertexCount === 'number' && Number.isSafeInteger(vertexCount) && vertexCount > 0
    && vertexCount % outlineCuboidVertices === 0 && vertexCount <= maxCuboids * outlineCuboidVertices
    && indexCount === vertexCount / 4 * 6 && isPonderRigidAttributeLayout(attributes);
}

export function ponderOutlineCuboidCount(bytes: Uint8Array) {
  if (bytes.byteLength < 2) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = data.getUint16(0, true);
  if (!count || count > maxCuboids || bytes.byteLength !== 2 + recordBytes * count) return;
  for (let at = 2; at < bytes.byteLength; at += recordBytes) {
    for (let offset = 0; offset < 108; offset += 4) {
      if (!(Math.abs(data.getFloat32(at + offset, true)) <= 1e6)) return;
    }
    for (let axis = 0; axis < 3; axis++) {
      if (data.getFloat32(at + axis * 4, true) > data.getFloat32(at + (axis + 3) * 4, true)) return;
    }
    if (data.getUint8(at + 120) > 1) return;
  }
  return count;
}

/** Reconstructs Catnip's six ordered faces from local bounds and a pose. */
export function buildPonderOutlineVertices(bytes: Uint8Array) {
  const count = ponderOutlineCuboidCount(bytes);
  if (!count) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices = new ArrayBuffer(count * outlineCuboidVertices * stride);
  const output = new DataView(vertices);
  let vertex = 0;
  for (let at = 2; at < bytes.byteLength; at += recordBytes) {
    const bounds = Float32Array.from({ length: 6 }, (_, i) => data.getFloat32(at + i * 4, true));
    const matrix = Float32Array.from({ length: 21 }, (_, i) => data.getFloat32(at + 24 + i * 4, true));
    const color = data.getUint32(at + 108, true), overlay = data.getUint32(at + 112, true);
    const light = data.getUint32(at + 116, true), noDiffuse = data.getUint8(at + 120) === 1;
    for (const [face, corners] of faces.entries()) {
      const [nx, ny, nz] = normals[noDiffuse ? 1 : face];
      for (const [index, corner] of corners.entries()) {
        const x = bounds[corner & 4 ? 3 : 0], y = bounds[corner & 2 ? 4 : 1], z = bounds[corner & 1 ? 5 : 2];
        for (let axis = 0; axis < 3; axis++) {
          const position = transformPonderVertex(matrix, axis, x, y, z, matrix[axis + 9]);
          const normal = transformPonderVertex(matrix, axis + 12, nx, ny, nz, 0);
          output.setFloat32(vertex + 4 * axis, position, true);
          output.setInt8(vertex + 32 + axis, Math.fround(Math.min(1, Math.max(-1, normal)) * 127));
        }
        output.setUint32(vertex + 12, color, true);
        output.setFloat32(vertex + 16, index < 2 ? 0 : 1, true);
        output.setFloat32(vertex + 20, index === 1 || index === 2 ? 1 : 0, true);
        output.setUint32(vertex + 24, overlay, true);
        output.setUint32(vertex + 28, light, true);
        vertex += stride;
      }
    }
  }
  return vertices;
}
