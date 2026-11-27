import type { PonderDraw, PonderManifest } from './format.mts';

export const ponderPlatformShadowAsset = 'platform-shadow:unit';
const stride = 16;
const vertexCount = 16;
export const ponderPlatformShadowBytes = vertexCount * stride;
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

export function ponderPlatformShadowMesh() {
  const bytes = new ArrayBuffer(ponderPlatformShadowBytes);
  const vertices = new DataView(bytes);
  const corners = [[0, 0], [0, 1], [1, 1], [1, 0]];
  let offset = 0;
  for (let side = 0; side < corners.length; side++) {
    const [x0, z0] = corners[side];
    const [x1, z1] = corners[(side + 1) % corners.length];
    for (const [x, y, z] of [[x0, 0, z0], [x0, -4, z0], [x1, -4, z1], [x1, 0, z1]]) {
      vertices.setFloat32(offset, x, true);
      vertices.setFloat32(offset + 4, y, true);
      vertices.setFloat32(offset + 8, z, true);
      vertices.setUint8(offset + 15, y === 0 ? 102 : 0);
      offset += stride;
    }
  }
  return bytes;
}

export function ponderPlatformShadowDraw(shadow: NonNullable<PonderManifest['platformShadow']>,
  sceneToGui: Float32Array, projection: Float32Array): PonderDraw {
  const [x, z, size] = shadow;
  const modelView = new Float32Array(sceneToGui);
  const inset = 1 / 1024;
  for (let row = 0; row < 4; row++) {
    modelView[12 + row] += sceneToGui[row] * (x + inset) + sceneToGui[8 + row] * (z + inset);
    modelView[row] *= size - 2 * inset;
    modelView[8 + row] *= size - 2 * inset;
  }
  return {
    shader: 'position_color', mode: 'QUADS', vertices: ponderPlatformShadowAsset, stride,
    vertexCount, indexCount: vertexCount / 4 * 6,
    attributes: [
      { name: 'Position', offset: 0, type: 'FLOAT', count: 3 },
      { name: 'Color', offset: 12, type: 'UBYTE', count: 4 },
    ],
    textures: {}, projection, modelView, textureMatrix: identity, color: Float32Array.of(1, 1, 1, 1),
    depthTest: true, depthFunction: 515, depthWrite: false, cull: true, blend: true, blendFactors: [770, 771, 1, 771],
  };
}
