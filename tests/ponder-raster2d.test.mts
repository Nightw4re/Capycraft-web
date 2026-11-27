import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ponderUnlitEntityShader } from '../src/ponder/format.mts';
import type { PonderDraw } from '../src/ponder/format.mts';
import { compactPonderDraws } from '../src/ponder/compact.mts';
import { buildPonderFluidMesh, ponderFluidMesh, type FluidFace } from '../src/ponder/fluidFaces.mts';
import { drawPonder2d, supportsPonderDraw2d, type PonderSurface } from '../src/ponder/raster2d.mts';

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const lights: [Float32Array, Float32Array] = [Float32Array.of(0, 1, 0), Float32Array.of(0, -1, 0)];
const draw: PonderDraw = {
  mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 20, vertices: 'mesh',
  attributes: [{ name: 'Position', count: 3, offset: 0, type: 'FLOAT' }, { name: 'UV0', count: 2, offset: 12, type: 'FLOAT' }],
  shader: 'position', textures: {}, projection: identity, modelView: identity, textureMatrix: identity,
  color: Float32Array.of(1, 1, 1, 1), depthTest: true, depthFunction: 515, depthWrite: true, cull: true, blend: false,
};
const budget = () => ({ vertices: 100, primitives: 100, samples: 1000 });
const pixels = () => ({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4), depth: new Float32Array(4 * 4).fill(1) });
const sample = (surface: PonderSurface, x: number, y: number) =>
  [...surface.data.slice((y * surface.width + x) * 4, (y * surface.width + x) * 4 + 4)];

function quad(z: number, reverse = false) {
  const corners = [
    [-1, 1, z, 0, 0], [-1, -1, z, 0, 1], [1, -1, z, 1, 1], [1, 1, z, 1, 0],
  ];
  return new Float32Array((reverse ? corners.reverse() : corners).flat()).buffer;
}

test('Ponder Canvas uses native filtered block light and exact particle texels at the vertices', () => {
  const source = new Uint8Array(quad(0));
  const vertices = new Uint8Array(4 * 24);
  const layout = new DataView(vertices.buffer);
  for (let i = 0; i < 4; i++) {
    vertices.set(source.subarray(i * 20, i * 20 + 20), i * 24);
    layout.setInt16(i * 24 + 20, 16, true);
  }
  const base = { width: 1, height: 1, data: Uint8ClampedArray.of(255, 255, 255, 255) };
  const lightmap = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
  lightmap.data.set([0, 0, 0, 255, 200, 100, 40, 255]);
  const sampler = { image: 'atlas', minFilter: 9729, magFilter: 9729, wrapS: 33071, wrapT: 33071 };
  const model: PonderDraw = { ...draw, stride: 24,
    attributes: [...draw.attributes, { name: 'UV2', offset: 20, type: 'SHORT', count: 2 }],
    textures: { 0: sampler, 2: sampler } };
  for (const [shader, color] of Object.entries({ rendertype_solid: [100, 50, 20, 255], particle: [200, 100, 40, 255] })) {
    const surface = pixels();
    assert.ok(drawPonder2d(surface, { ...model, shader }, vertices.buffer, undefined, [base, undefined, lightmap], lights, budget()));
    assert.deepEqual(sample(surface, 1, 1), color);
  }
});

test('Ponder Canvas depth, atlas orientation, alpha cutouts and blending match legacy quad draws', () => {
  const surface = pixels();
  const back = { ...draw, color: Float32Array.of(0, 0, 1, 1) };
  assert.equal(supportsPonderDraw2d(back), true);
  assert.equal(drawPonder2d(surface, back, quad(0.5), undefined, [], lights, budget()), true);
  const atlas = {
    width: 2, height: 2,
    data: Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 128, 255, 255, 0, 0, 255, 255, 255, 255),
  };
  const mixed: PonderDraw = { ...draw, shader: 'position_tex_color',
    textures: { 0: { image: 'png', minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } },
    blend: true, blendFactors: [770, 771, 1, 771] };
  assert.equal(supportsPonderDraw2d(mixed), true);
  assert.equal(drawPonder2d(surface, mixed, quad(0), undefined, [atlas], lights, budget()), true);
  assert.deepEqual(sample(surface, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(sample(surface, 3, 0), [0, 128, 127, 255]);
  assert.deepEqual(sample(surface, 0, 3), [0, 0, 255, 255]);
  assert.deepEqual(sample(surface, 3, 3), [255, 255, 255, 255]);
  assert.equal(drawPonder2d(surface, back, quad(0.25), undefined, [], lights, budget()), true);
  assert.deepEqual(sample(surface, 0, 0), [255, 0, 0, 255]);
  assert.equal(surface.depth[3 * surface.width], 0.625);
});

test('Ponder Canvas maps separate atlas regions after the texture matrix and skips uncovered fragments', () => {
  const surface = pixels();
  const atlas = { width: 4, height: 4, data: Uint8ClampedArray.from(
    Array.from({ length: 16 }, (_, i) => [i * 13, 255 - i * 13, i * 7, 255]).flat()) };
  const textureMatrix = new Float32Array(identity);
  textureMatrix[12] = .125;
  const regional: PonderDraw = { ...draw, shader: 'position_tex_color', textureMatrix,
    textures: { 0: { image: 'atlas', minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071,
      atlasRegions: [[.25, 0, .5, .75, 1, 1, .5, .25], [.875, 0, 1, .75, 1, 1, -.875, .25]] } } };
  assert.equal(drawPonder2d(surface, regional, quad(0), undefined, [atlas], lights, budget()), true);
  assert.deepEqual(sample(surface, 0, 0), [91, 164, 49, 255]);
  assert.deepEqual(sample(surface, 1, 0), [91, 164, 49, 255]);
  assert.deepEqual(sample(surface, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(sample(surface, 3, 0), [52, 203, 28, 255]);
  assert.deepEqual(sample(surface, 0, 3), [0, 0, 0, 0]);
  assert.equal(surface.depth[2], 1);
});

test('Ponder Canvas applies the model view and projection matrices and culls back faces', () => {
  const surface = pixels();
  const modelView = Float32Array.from(identity);
  modelView[0] = 0.5;
  modelView[12] = 1;
  const projection = Float32Array.from(identity);
  projection[0] = 0.5;
  const positioned = { ...draw, modelView, projection };
  assert.equal(drawPonder2d(surface, positioned, quad(0.2, true), undefined, [], lights, budget()), true);
  assert.deepEqual(sample(surface, 2, 1), [0, 0, 0, 0]);
  assert.equal(drawPonder2d(surface, positioned, quad(0.2), undefined, [], lights, budget()), true);
  assert.deepEqual(sample(surface, 2, 1), [255, 255, 255, 255]);
  assert.deepEqual(sample(surface, 0, 1), [0, 0, 0, 0]);
});

test('Ponder blends a standalone liquid behind a foreground procedural liquid face', () => {
  const surface = pixels();
  const face: FluidFace = { geometry: [2, 0, 0, 1, 1, 1, 1, 0, 0xf000f0],
    transform: Array.from(identity), tint: -1, image: 'foreground', lightmap: 'lightmap' };
  const sheet = new DataView(buildPonderFluidMesh([2, 0, 0, 1, 1, 0, 1, 0, 0xf000f0]));
  const background = new ArrayBuffer(4 * 24);
  const block = new DataView(background);
  for (let at = 0; at < background.byteLength; at += 24) {
    for (const lane of [0, 4, 8]) block.setUint32(at + lane, sheet.getUint32(at + lane, true), true);
    block.setUint32(at + 12, 0xffffffff, true);
    block.setUint32(at + 16, sheet.getUint32(at + 12, true), true);
    block.setUint32(at + 20, sheet.getUint32(at + 16, true), true);
  }
  const frame = compactPonderDraws({ sceneToGui: identity, captions: [], draws: [], omitted: 0 },
    [{ transform: Array.from(identity), blocks: [[0, 0, 0, 0]] }],
    [[{ shader: 'rendertype_translucent', image: 'background', vertices: 'water', vertexCount: 4, liquid: true }]],
    1, 1, [face]);
  assert.deepEqual(frame.draws.map(layer => layer.textures[0].image), ['background', 'foreground']);
  for (const layer of frame.draws) {
    const geometry = ponderFluidMesh(layer.vertices);
    const color = geometry ? [255, 0, 0, 128] : [0, 0, 255, 128];
    const texture = { width: 1, height: 1, data: Uint8ClampedArray.from(color) };
    const lightmap = { width: 1, height: 1, data: Uint8ClampedArray.of(255, 255, 255, 255) };
    assert.ok(drawPonder2d(surface, layer, geometry ? buildPonderFluidMesh(geometry) : background,
      undefined, [texture, undefined, lightmap], lights, budget()));
  }
  assert.deepEqual(sample(surface, 1, 1), [128, 0, 64, 192]);
});

test('Ponder sorts the individual liquid faces as the camera rotates', () => {
  const transform = Array.from(identity);
  const far = { shader: 'rendertype_translucent', image: 'far', vertices: 'mesh1', vertexCount: 4, liquid: true as const,
    liquidCenter: [0.5, 0.5, 0.1] as [number, number, number] };
  const near = { ...far, image: 'near', vertices: 'mesh2', liquidCenter: [0.5, 0.5, 0.9] as [number, number, number] };
  const legacy = { ...far, image: 'legacy', liquidCenter: undefined };
  const glass = { ...legacy, image: 'glass', liquid: undefined };
  const models = [[near, legacy, far], [glass]];
  const layout = [{ transform, blocks: [[0, 0, 0, 0], [0, 0, 0, 1]] as [number, number, number, number][] }];
  const frame = { sceneToGui: identity, captions: [], draws: [], omitted: 0 };
  const order = (sceneToGui: Float32Array) => compactPonderDraws({ ...frame, sceneToGui }, layout, models, 1, 1)
    .draws.map(draw => draw.textures[0].image);
  assert.deepEqual(order(identity), ['far', 'legacy', 'near', 'glass']);
  const rotated = Float32Array.of(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0, 1, 1);
  assert.deepEqual(order(rotated), ['near', 'legacy', 'far', 'glass']);
});

test('Ponder Canvas expands the Minecraft line and strip indices into two-pixel strokes', () => {
  const bytes = new ArrayBuffer(4 * 20);
  const vertices = new DataView(bytes);
  for (let vertex = 0; vertex < 4; vertex++) {
    vertices.setFloat32(vertex * 20, vertex < 2 ? -.8 : .8, true);
    vertices.setUint32(vertex * 20 + 12, 0xff0000ff, true);
    vertices.setInt8(vertex * 20 + 16, 127);
  }
  const attributes: PonderDraw['attributes'] = [draw.attributes[0], { name: 'Color', count: 4, offset: 12, type: 'UBYTE' },
    { name: 'Normal', count: 3, offset: 16, type: 'BYTE' }];
  for (const mode of ['LINES', 'LINE_STRIP']) {
    const line = { ...draw, mode, shader: 'rendertype_lines', indexCount: mode === 'LINES' ? 6 : 4, attributes, lineWidth: 2 };
    const surface = pixels();
    assert.ok(supportsPonderDraw2d(line));
    assert.ok(drawPonder2d(surface, line, bytes, undefined, [], lights, budget()));
    for (let x = 0; x < 4; x++) {
      assert.deepEqual(sample(surface, x, 0), [0, 0, 0, 0]);
      assert.deepEqual(sample(surface, x, 1), [255, 0, 0, 255]);
      assert.deepEqual(sample(surface, x, 2), [255, 0, 0, 255]);
      assert.deepEqual(sample(surface, x, 3), [0, 0, 0, 0]);
    }
  }
});

test('Ponder Canvas renders additive eyes and entity passes without an outline', () => {
  const surface = pixels();
  const atlas = { width: 1, height: 1, data: Uint8ClampedArray.of(120, 20, 40, 64) };
  const textures = { 0: { image: 'png', minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } };
  const eyes: PonderDraw = { ...draw, shader: 'rendertype_eyes', textures, blend: true, blendFactors: [1, 1, 1, 1] };
  assert.equal(drawPonder2d(surface, eyes, quad(0), undefined, [atlas], lights, budget()), true);
  assert.deepEqual(sample(surface, 0, 0), [120, 20, 40, 64]);
  const outlineFree = { ...eyes, shader: 'rendertype_entity_no_outline', blend: false };
  assert.equal(drawPonder2d(surface, outlineFree, quad(-0.5), undefined, [atlas], lights, budget()), true);
  assert.equal(sample(surface, 0, 0)[3], 64);
});

test('Ponder Canvas interpolates sprite RGB and keeps the current sprite alpha', () => {
  const surface = pixels();
  const first = { width: 1, height: 1, data: Uint8ClampedArray.of(1, 80, 200, 128) };
  const next = { width: 1, height: 1, data: Uint8ClampedArray.of(120, 200, 100, 255) };
  const animated: PonderDraw = { ...draw, shader: 'position_tex_color',
    textures: { 0: { image: 'first', transition: { image: 'next', weight: .5 },
      minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } } };
  assert.equal(drawPonder2d(surface, animated, quad(0), undefined, [first, undefined, undefined, next], lights, budget()), true);
  assert.deepEqual(sample(surface, 0, 0), [60, 140, 150, 128]);
});

test('Ponder Canvas keeps the glint and breaking texture alpha thresholds', () => {
  const surface = pixels();
  const atlas = { width: 1, height: 1, data: Uint8ClampedArray.of(120, 20, 40, 16) };
  const textures = { 0: { image: 'png', minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } };
  const glint: PonderDraw = { ...draw, shader: 'rendertype_glint', textures };
  assert.ok(supportsPonderDraw2d(glint));
  drawPonder2d(surface, glint, quad(0), undefined, [atlas], lights, budget());
  assert.deepEqual(sample(surface, 0, 0), [0, 0, 0, 0]);
  atlas.data[3] = 32;
  const crumbling = { ...glint, shader: 'rendertype_crumbling', color: Float32Array.of(1, 1, 1, .5) };
  drawPonder2d(surface, crumbling, quad(0), undefined, [atlas], lights, budget());
  assert.deepEqual(sample(surface, 0, 0), [120, 20, 40, 16]);
});

test('Ponder Canvas tests the unlit entity texture before applying scene tint', () => {
  const surface = pixels();
  const atlas = { width: 2, height: 1, data: Uint8ClampedArray.of(120, 20, 40, 16, 120, 20, 40, 64) };
  const unlit = { ...draw, shader: ponderUnlitEntityShader, color: Float32Array.of(1, 1, 1, .25),
    textures: { 0: { image: 'png', minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } } };
  assert.ok(supportsPonderDraw2d(unlit));
  assert.ok(drawPonder2d(surface, unlit, quad(0), undefined, [atlas], lights, budget()));
  assert.deepEqual(sample(surface, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(sample(surface, 3, 0), [120, 20, 40, 16]);
});

test('Ponder Canvas validates legacy indexed meshes and caps fragment work', () => {
  const surface = pixels();
  const indexed: PonderDraw = { ...draw, mode: 'TRIANGLES', indices: 'index', indexType: 'SHORT' };
  const bad = Uint16Array.of(0, 1, 2, 2, 3, 999).buffer;
  const good = Uint16Array.of(0, 1, 2, 2, 3, 0).buffer;
  assert.equal(drawPonder2d(surface, indexed, quad(0), bad, [], lights, budget()), false);
  assert.equal(drawPonder2d(surface, indexed, quad(0), good, [], lights, { ...budget(), samples: 1 }), false);
  assert.deepEqual(sample(surface, 1, 1), [0, 0, 0, 0]);
  assert.equal(drawPonder2d(surface, indexed, quad(0), good, [], lights, budget()), true);
  assert.deepEqual(sample(surface, 1, 1), [255, 255, 255, 255]);
  assert.equal(supportsPonderDraw2d({ ...draw, shader: 'unsupported' }), false);
});
