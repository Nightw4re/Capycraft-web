import assert from 'node:assert/strict';
import { readPonderAtlasAnimation, samplePonderAtlasCopy } from '../src/ponder/atlasAnimation.mts';
import { readPonderRgbaPixels } from '../src/ponder/atlasPixels.mts';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { preparePonderImport } from '../scripts/import-ponder.mjs';
import { test } from 'node:test';
import { createPonder } from '../server/ponder.mts';
import { activePonder } from '../server/ponderStorage.mts';
import { ponderGuides, readPonderDefinitions } from '../server/ponderDefinitions.mts';
import { applyPonderSceneOffset, applyPonderSceneTransform } from '../server/ponderEvents.mts';
import { itemUrl, routeFromUrl } from '../src/navigation.ts';
import { itemPonderLocation, readItemPonderLocation, selectItemPonderScene } from '../src/ponder/itemPonderLocation.mts';
import { assemblePonderMesh, ponderMeshStreams } from '../src/ponder/meshStreams.mts';
import { placeCaption, projectCaptionAnchor } from '../src/ponder/captionLayout.mts';
import { ponderBlockModelsPath, ponderFramePath, ponderFrameTick, ponderMeshBundlePath, ponderMeshSlice, ponderPickingChunkPath, ponderPlaybackPath, ponderResource, readPonderFrame, readPonderIndex,
  readPonderManifest } from '../src/ponder/format.mts';
import { compressPonderBundleRef, expandPonderBundleRef } from '../src/ponder/bundleRefs.mts';
import { createPonderSource } from '../src/ponder/source.ts';
import { compactPonderDraws, readPonderBlockModels, readPonderCompactLayout } from '../src/ponder/compact.mts';
import { encodePonderTimelinePatches, readPonderTimelinePatches } from '../src/ponder/timeline.mts';
import { buildPonderFluidMesh, ponderFluidMesh, readPonderFluidFaces } from '../src/ponder/fluidFaces.mts';
import { buildPonderParticleVertices, ponderParticleQuadCount, ponderParticleVersion } from '../src/ponder/particleQuads.mts';
import { buildPonderRigidVertices, ponderRigidPartVertexCount, readPonderRigidBatch } from '../src/ponder/rigidParts.mts';
import { buildPonderOutlineVertices, ponderOutlineCuboidCount } from '../src/ponder/outlineCuboids.mts';
import { assemblePonderMixedBoxFaces, buildPonderBoxFaceVertices, ponderBoxFaceVertexCount, readPonderMixedBoxFaces } from '../src/ponder/boxFaces.mts';
import { buildPonderGlintVertices, readPonderGlintBatch } from '../src/ponder/glintParts.mts';
import { buildPonderLightningVertices } from '../src/ponder/lightning.mts';
import { indexItemPonderChoices, readPonderGuideIndex } from '../src/ponder/guides.mts';
import { ponderPartFilter } from '../src/ponder/parts.ts';
import { pickPonderBlock, readPonderPicking } from '../src/ponder/picking.mts';
import { createPonderPickingChunk, readPonderPickingChunk, validatePonderPickingChunk } from '../src/ponder/pickingChunks.mts';

const id = 'a'.repeat(64);
const manifest = `ponder/scenes/${id}/scene.json`;
const vertexBytes = Buffer.alloc(48);
const mesh = `ponder/meshes/${createHash('sha256').update(vertexBytes).digest('hex')}.bin`;
const scene = { id: 'create:demo', title: 'Demo', schematic: 'create:demo', items: [], manifest };
const index = { version: 1, locale: 'en_us', scenes: [scene] };
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const quarterTurn = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 0, 0, 1];

test('Ponder picking import validates each intermediate snapshot of the chunk', () => {
  const first = [{ transform: Float32Array.from(matrix), blocks: [{
    position: [1, 0, 2] as [number, number, number], block: 'create:shaft',
    boxes: [[0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number]],
  }] }];
  const moved = [{ ...first[0], transform: Float32Array.from(quarterTurn) }];
  const chunk = createPonderPickingChunk();
  chunk.append(0, first);
  chunk.append(5, moved);
  chunk.append(8, first);
  const document = chunk.document();
  assert.equal(validatePonderPickingChunk(document, 8), true);
  assert.deepEqual(readPonderPickingChunk(document, 7), moved);
  assert.deepEqual(readPonderPickingChunk(document, 8), first);
  assert.equal(validatePonderPickingChunk(document, 7), false);

  const singular = structuredClone(document);
  singular.frames[1][2][0][1].transform![3] = 1;
  assert.deepEqual(readPonderPickingChunk(singular, 8), first);
  assert.equal(validatePonderPickingChunk(singular, 8), false);

  const missingPlacement = structuredClone(document);
  missingPlacement.frames[1][2][0][1].length = 2;
  missingPlacement.frames[2][2][0][1].length = 1;
  assert.deepEqual(readPonderPickingChunk(missingPlacement, 8), first);
  assert.equal(validatePonderPickingChunk(missingPlacement, 8), false);
});

function particleFixture(count = 1) {
  const encoded = Buffer.alloc(28 + count * 38);
  encoded.writeUInt16LE(count);
  encoded.writeUInt16LE(1, 2);
  [.75, .875, .125, .25].forEach((value, i) => encoded.writeFloatLE(value, 4 + i * 4));
  encoded.writeUInt32LE(0xa1f480cc, 20);
  encoded.writeUInt32LE(0xf00070, 24);
  const fields = [4, 5, 6, .5, -.25, .125, .25, .5, .375];
  for (let quad = 0; quad < count; quad++) {
    fields.forEach((value, i) => encoded.writeFloatLE(value, 28 + quad * 38 + i * 4));
  }
  const vertices = Buffer.alloc(112);
  const originalPositions = [[4.5, 4.75, 6.125], [4.25, 5.5, 6.375], [3.5, 5.25, 5.875], [3.75, 4.5, 5.625]];
  originalPositions.forEach((position, corner) => {
    const offset = corner * 28;
    position.forEach((value, axis) => vertices.writeFloatLE(value, offset + axis * 4));
    vertices.writeFloatLE(corner < 2 ? .75 : .125, offset + 12);
    vertices.writeFloatLE(corner === 0 || corner === 3 ? .875 : .25, offset + 16);
    vertices.writeUInt32LE(0xa1f480cc, offset + 20);
    vertices.writeUInt32LE(0xf00070, offset + 24);
  });
  return { encoded, vertices: Buffer.concat(Array.from({ length: count }, () => vertices)) };
}

test('Ponder rebuilds the original ordered particle vertices byte for byte', () => {
  const { encoded, vertices } = particleFixture(2);
  const padded = Buffer.concat([Buffer.alloc(3), encoded]);
  assert.deepEqual(Buffer.from(buildPonderParticleVertices(padded.subarray(3))!), vertices);
  assert.equal(buildPonderParticleVertices(encoded.subarray(0, encoded.length - 1)), undefined);
  encoded.writeUInt16LE(1, 28 + 38 + 36);
  assert.equal(buildPonderParticleVertices(encoded), undefined);
  encoded.writeUInt16LE(0, 28 + 38 + 36);
  encoded.writeFloatLE(Infinity, 28 + 16);
  assert.equal(buildPonderParticleVertices(encoded), undefined);
});

function correctedParticleFixture() {
  const { encoded, vertices } = particleFixture();
  const corrections = Buffer.from([0xd4, 0, 0, 0, 0, 0]);
  vertices.writeInt32LE(vertices.readInt32LE(0) + 4, 0);
  vertices.writeInt32LE(vertices.readInt32LE(4) - 3, 4);
  return { encoded: Buffer.concat([encoded, corrections]), vertices };
}

test('Ponder validates exact position palettes and still assembles v1 vertex streams', () => {
  const mesh = (character: string) => `ponder/meshes/${character.repeat(64)}.bin`;
  const digest = (character: string) => character.repeat(64);
  const count = 512;
  const palette = Buffer.alloc(3 + 260 * 12 + count * 2);
  palette[0] = 12;
  palette.writeUInt16LE(260, 1);
  for (let row = 0; row < 260; row++) palette.writeUInt32LE(row, 3 + row * 12);
  for (let vertex = 0; vertex < count; vertex++) palette.writeUInt16LE(vertex % 260, 3 + 260 * 12 + vertex * 2);
  const shared = [digest('c'), digest('d'), digest('e')].join(':');
  const reference = `${mesh('a')}#v2:28:${count}:e:${digest('b')}:${palette.length}:${shared}`;
  const streams = ponderMeshStreams(reference);
  assert.ok(streams);
  const attributes = [4, 8, 4].map(width => Buffer.alloc(count * width, 0xff));
  const expected = Buffer.alloc(count * 28, 0xff);
  for (let vertex = 0; vertex < count; vertex++) {
    expected.fill(0, vertex * 28, vertex * 28 + 12);
    expected.writeUInt32LE(vertex % 260, vertex * 28);
  }
  assert.deepEqual(Buffer.from(assemblePonderMesh(streams, [...attributes, palette])!), expected);
  palette.writeUInt16LE(260, 3 + 260 * 12);
  assert.equal(assemblePonderMesh(streams, [...attributes, palette]), undefined);
  assert.equal(ponderMeshStreams(reference.replace(':e:', ':d:')), undefined);

  const raw = Buffer.from(Array.from({ length: count * 12 }, (_, byte) =>
    expected[(byte % count) * 28 + Math.floor(byte / count)]));
  const legacy = ponderMeshStreams(`${mesh('a')}#v1:28:${count}:e:${digest('b')}:${shared}`);
  assert.ok(legacy);
  assert.deepEqual(Buffer.from(assemblePonderMesh(legacy, [...attributes, raw])!), expected);
});

test('Ponder rebuilds particle positions with small signed corrections', () => {
  const { encoded, vertices } = correctedParticleFixture();
  assert.deepEqual(Buffer.from(buildPonderParticleVertices(encoded, 2)!), vertices);
  assert.equal(buildPonderParticleVertices(encoded), undefined);
  encoded[66] = 0x08;
  assert.equal(buildPonderParticleVertices(encoded, 2), undefined);
});

function sparseParticleFixture(count = 1, correctedQuads = [0], mask = 0b101) {
  const { encoded: original } = particleFixture(count);
  const explicitAxes = [0, 1, 2].filter(axis => !(mask & (1 << axis)));
  const quadBytes = 26 + explicitAxes.length * 4;
  const encoded = Buffer.alloc(32 + count * quadBytes + correctedQuads.length * 8);
  const denseCorrections = Buffer.alloc(count * 6);
  original.copy(encoded, 0, 0, 4);
  encoded.writeUInt16LE(mask, 4);
  encoded.writeUInt16LE(correctedQuads.length, 6);
  original.copy(encoded, 8, 4, 28);
  for (let quad = 0; quad < count; quad++) {
    const start = 28 + quad * 38;
    const next = 32 + quad * quadBytes;
    original.copy(encoded, next, start, start + 24);
    let output = next + 24;
    for (let axis = 0; axis < 3; axis++) {
      const lane = axis * 4;
      if (mask & (1 << axis)) original.writeFloatLE(-original.readFloatLE(start + 12 + lane), start + 24 + lane);
      else {
        original.copy(encoded, output, start + 24 + lane, start + 28 + lane);
        output += 4;
      }
    }
    original.copy(encoded, output, start + 36, start + 38);
  }
  const correctionsOffset = 32 + count * quadBytes;
  for (let record = 0; record < correctedQuads.length; record++) {
    const quad = correctedQuads[record];
    const start = correctionsOffset + record * 8;
    encoded.writeUInt16LE(quad, start);
    encoded[start + 2] = 0xd4;
    denseCorrections[quad * 6] = 0xd4;
  }
  const vertices = Buffer.from(buildPonderParticleVertices(Buffer.concat([original, denseCorrections]), 2)!);
  return { encoded, vertices, correctionsOffset };
}

test('Ponder reads v3 sparse particle corrections and opposite offsets without changing vertex data', () => {
  const { encoded, vertices, correctionsOffset } = sparseParticleFixture(3, [0, 2]);
  const padded = Buffer.concat([Buffer.alloc(5), encoded]);
  assert.equal(ponderParticleQuadCount(padded.subarray(5), 3), 3);
  assert.deepEqual(Buffer.from(buildPonderParticleVertices(padded.subarray(5), 3)!), vertices);
  for (let mask = 0; mask < 8; mask++) {
    const uncorrected = sparseParticleFixture(2, [], mask);
    assert.deepEqual(Buffer.from(buildPonderParticleVertices(uncorrected.encoded, 3)!), uncorrected.vertices);
  }
  assert.equal(ponderParticleQuadCount(encoded.subarray(0, -1), 3), undefined);
  for (const [offset, value] of [[0, 0], [2, 4], [4, 8], [6, 4], [32 + 28, 1], [correctionsOffset, 3],
    [correctionsOffset + 8, 0], [correctionsOffset + 2, 8]]) {
    const invalid = Buffer.from(encoded);
    invalid.writeUInt16LE(value, offset);
    assert.equal(ponderParticleQuadCount(invalid, 3), undefined);
  }
  const reversed = Buffer.from(encoded);
  reversed.writeUInt16LE(2, correctionsOffset);
  reversed.writeUInt16LE(1, correctionsOffset + 8);
  assert.equal(ponderParticleQuadCount(reversed, 3), undefined);
  const overflow = Buffer.from(encoded);
  overflow.writeUInt32LE(0x7f7fffff, 32);
  assert.equal(ponderParticleQuadCount(overflow, 3), undefined);

  const hash = createHash('sha256').update(encoded).digest('hex');
  const standalone = `ponder/particle-quads/v3/${hash}.bin`;
  const bundle = `ponder/scenes/${id}/meshes/0.bin`;
  const slice = `${bundle}#0:${encoded.length}:${hash}:particle-quads/v3`;
  assert.equal(ponderResource(standalone)?.kind, 'particle-quads');
  assert.equal(ponderParticleVersion(ponderMeshSlice(slice)?.geometry ?? ''), 3);
  const compact = compressPonderBundleRef(slice, bundle);
  assert.match(compact, /^~d:/);
  assert.equal(expandPonderBundleRef(compact, bundle), slice);
});

function scaledParticleFixture() {
  const encoded = Buffer.alloc(124);
  [3, 1, 1, 1].forEach((value, index) => encoded.writeUInt16LE(value, index * 2));
  [.75, .875, .125, .25].forEach((value, index) => encoded.writeFloatLE(value, 8 + index * 4));
  encoded.writeUInt32LE(0xa1f480cc, 24);
  encoded.writeUInt32LE(0xf00070, 28);
  [1, -.5, .25, .5, 1, .75].forEach((value, index) => encoded.writeFloatLE(value, 32 + index * 4));
  [[4, 5, 6, .5], [5, 5, 6, .25], [4, 5, 6, .5]].forEach((placement, quad) =>
    placement.forEach((value, index) => encoded.writeFloatLE(value, 56 + quad * 20 + index * 4)));
  encoded.writeUInt16LE(1, 116);
  encoded[118] = 12;
  const diagonalVertices = [
    [4.5, 4.75, 6.125, 4.25, 5.5, 6.375, 3.5, 5.25, 5.875, 3.75, 4.5, 5.625],
    [5.25, 4.875, 6.0625, 5.125, 5.25, 6.1875, 4.75, 5.125, 5.9375, 4.875, 4.75, 5.8125],
  ];
  const vertices = Buffer.alloc(336);
  for (const quad of [0, 1, 2]) {
    for (let corner = 0; corner < 4; corner++) {
      const at = (quad * 4 + corner) * 28;
      for (let axis = 0; axis < 3; axis++) {
        vertices.writeFloatLE(diagonalVertices[quad % 2][corner * 3 + axis], at + axis * 4);
      }
      vertices.writeFloatLE(corner < 2 ? .75 : .125, at + 12);
      vertices.writeFloatLE(corner === 0 || corner === 3 ? .875 : .25, at + 16);
      vertices.writeUInt32LE(0xa1f480cc, at + 20);
      vertices.writeUInt32LE(0xf00070, at + 24);
    }
  }
  vertices.writeUInt32LE(vertices.readUInt32LE(112) - 4, 112);
  return { encoded, vertices };
}

test('Ponder rebuilds scaled particles from a shared orientation before applying exact corrections', () => {
  const { encoded, vertices } = scaledParticleFixture();
  assert.equal(ponderParticleQuadCount(encoded, 4), 3);
  assert.deepEqual(Buffer.from(buildPonderParticleVertices(encoded, 4)!), vertices);
  for (const [offset, value] of [[4, 0], [16 + 56, 1], [116, 3], [118, 8]]) {
    const malformed = Buffer.from(encoded);
    malformed.writeUInt16LE(value, offset);
    assert.equal(ponderParticleQuadCount(malformed, 4), undefined);
  }
  const malformed = Buffer.from(encoded);
  malformed.writeFloatLE(Infinity, 32);
  assert.equal(ponderParticleQuadCount(malformed, 4), undefined);
  const bundle = `ponder/scenes/${id}/meshes/0.bin`;
  const hash = createHash('sha256').update(encoded).digest('hex');
  const slice = `${bundle}#0:${encoded.length}:${hash}:particle-quads/v4`;
  const compact = compressPonderBundleRef(slice, bundle);
  assert.match(compact, /^~e:/);
  assert.equal(expandPonderBundleRef(compact, bundle), slice);
  assert.equal(ponderParticleVersion(ponderMeshSlice(slice)?.geometry ?? ''), 4);
});

function rigidFixture() {
  const part = Buffer.alloc(96);
  const vertices = Buffer.alloc(288);
  for (let vertex = 0; vertex < 4; vertex++) {
    const x = vertex === 0 || vertex === 3 ? 1 : 2;
    const y = vertex < 2 ? 2 : 3;
    [x, y, 3, x / 4, y / 4].forEach((value, axis) => part.writeFloatLE(value, vertex * 24 + axis * 4));
    part.writeInt8(127, vertex * 24 + 22);
    for (let copy = 0; copy < 2; copy++) {
      const at = (copy * 4 + vertex) * 36;
      [13 + copy * 10, y + 20, 30 - x].forEach((value, axis) => vertices.writeFloatLE(value, at + axis * 4));
      vertices.writeUInt32LE(0x7f554433, at + 12);
      vertices.writeFloatLE(x / 4, at + 16);
      vertices.writeFloatLE(y / 4, at + 20);
      vertices.writeUInt32LE(0x000a0000, at + 24);
      vertices.writeUInt32LE(0x00f00080, at + 28);
      vertices.writeInt8(127, at + 32);
    }
  }
  const digest = createHash('sha256').update(part).digest();
  const batch = Buffer.alloc(262);
  batch.writeUInt16LE(2, 0);
  for (let pose = 0; pose < 2; pose++) {
    const at = 2 + pose * 130;
    digest.copy(batch, at);
    batch.writeUInt16LE(4, at + 32);
    [0, 0, -1, 0, 1, 0, 1, 0, 0, 10 + pose * 10, 20, 30, 0, 0, -1, 0, 1, 0, 1, 0, 0]
      .forEach((value, axis) => batch.writeFloatLE(value, at + 34 + axis * 4));
    batch.writeUInt32LE(0x7f554433, at + 118);
    batch.writeUInt32LE(0x000a0000, at + 122);
    batch.writeUInt32LE(0x00f00080, at + 126);
  }
  return { vertices, batch, part, partPath: `ponder/rigid-parts/v1/${digest.toString('hex')}.bin` };
}

function sparseRigidFixture(batch: Buffer) {
  const firstMask = Buffer.alloc(4);
  firstMask.writeUInt32LE(0x01ffffff);
  const secondMask = Buffer.alloc(4);
  secondMask.writeUInt32LE(0x80000400);
  return Buffer.concat([Buffer.of(1, 2, 0), firstMask, batch.subarray(2, 132), secondMask, batch.subarray(202, 206)]);
}

test('Ponder rebuilds ordered entity vertices from one local part and two poses', () => {
  const { vertices, batch, part, partPath } = rigidFixture();
  const data = readPonderRigidBatch(batch);
  assert.ok(data);
  assert.equal(data.vertices, 8);
  assert.deepEqual(data.parts.map(entry => entry.path), [partPath, partPath]);
  assert.equal(ponderRigidPartVertexCount(part), 4);
  assert.deepEqual(Buffer.from(buildPonderRigidVertices(data, [part, part])!), vertices);
  const sparse = sparseRigidFixture(batch);
  assert.deepEqual(readPonderRigidBatch(sparse, 5), data);
  assert.equal(readPonderRigidBatch(sparse.subarray(0, -1), 5), undefined);
  const invalid = Buffer.from(sparse);
  invalid[6] |= 0x80;
  assert.equal(readPonderRigidBatch(invalid, 5), undefined);
  assert.equal(buildPonderRigidVertices(data, [part]), undefined);
  assert.equal(readPonderRigidBatch(batch.subarray(0, batch.length - 1)), undefined);
  batch.writeFloatLE(NaN, 2 + 34);
  assert.equal(readPonderRigidBatch(batch), undefined);
});

function variedRigidFixture() {
  const fixture = rigidFixture();
  const batch = Buffer.alloc(2 + 2 * 162);
  fixture.batch.copy(batch, 0, 0, 132);
  fixture.batch.copy(batch, 164, 132, 132 + 118);
  const attributes = Buffer.alloc(4 * 12);
  for (let vertex = 0; vertex < 4; vertex++) {
    const values = [0x80442801 + vertex, vertex << 16, 0xf00040 + vertex * 16];
    for (const [field, value] of values.entries()) attributes.writeUInt32LE(value, vertex * 12 + field * 4);
    const offset = (vertex + 4) * 36;
    values.forEach((value, field) => fixture.vertices.writeUInt32LE(value, offset + [12, 24, 28][field]));
  }
  const digest = createHash('sha256').update(attributes).digest();
  digest.copy(batch, 164 + 130);
  return { ...fixture, batch, attributes, attributePath: `ponder/rigid-attributes/v1/${digest.toString('hex')}.bin` };
}

function outlineFixture() {
  const outline = Buffer.alloc(123);
  outline.writeUInt16LE(1);
  [1, 2, 3, 4, 5, 6, 1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30, 1, 0, 0, 0, 1, 0, 0, 0, 1]
    .forEach((value, index) => outline.writeFloatLE(value, 2 + index * 4));
  outline.writeUInt32LE(0x7f554433, 110);
  outline.writeUInt32LE(0x000a0000, 114);
  outline.writeUInt32LE(0x00f00080, 118);
  return outline;
}

function boxFaceFixture() {
  const faces = Buffer.alloc(2 + 50 + 2 * 59);
  faces.writeUInt16LE(1);
  faces.writeUInt16LE(2, 2);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 8, 5].forEach((lane, i) => faces.writeFloatLE(lane, 4 + i * 4));
  const expected = Buffer.alloc(8 * 36);
  for (let face = 0; face < 2; face++) {
    const at = 52 + 59 * face;
    const height = face ? .75 : .25;
    [0, 1, height, height, 1, 2].forEach((lane, i) => faces.writeFloatLE(lane, at + 4 * i));
    faces.writeUInt16LE(4 | 5 << 3 | 1 << 6, at + 24);
    faces.writeUInt8(180, at + 26);
    [.125, .25, .375, .5].forEach((lane, i) => faces.writeFloatLE(lane, at + 27 + 4 * i));
    const attributes = [0xa482e211, 0x000a0000, 0x00c00090, 0x00007f00];
    attributes.forEach((value, i) => faces.writeUInt32LE(value, at + 43 + 4 * i));
    const points = [[3, 8 + height, 7, .125, .375], [4, 8 + height, 7, .25, .375],
      [4, 8 + height, 6, .25, .5], [3, 8 + height, 6, .125, .5]];
    for (const [i, [x, y, z, u, v]] of points.entries()) {
      const cursor = (face * 4 + i) * 36;
      [x, y, z, 0, u, v].forEach((lane, j) => expected.writeFloatLE(lane, cursor + 4 * j));
      attributes.forEach((value, j) => expected.writeUInt32LE(value, cursor + [12, 24, 28, 32][j]));
    }
  }
  return { faces, expected };
}

function chainFaceFixture() {
  const { faces, expected } = boxFaceFixture();
  const vertices = Buffer.alloc(8 * 32);
  for (let face = 0; face < 2; face++) {
    const at = 52 + 59 * face;
    const selectors = 5 << 12;
    faces.writeUInt16LE(faces.readUInt16LE(at + 24) | selectors, at + 24);
    faces.writeUInt32LE(0x00600070, at + 47);
    for (let point = 0; point < 4; point++) {
      const start = (face * 4 + point) * 36, next = (face * 4 + point) * 32;
      expected.copy(vertices, next, start, start + 24);
      vertices.writeUInt32LE(point % 2 ? 0x00c00090 : 0x00600070, next + 24);
      vertices.writeUInt32LE(expected.readUInt32LE(start + 32), next + 28);
    }
  }
  return { faces, vertices };
}

function mixedBoxFaceFixture() {
  const { faces, expected } = boxFaceFixture();
  const raw = Buffer.from(expected.subarray(0, 4 * 36));
  raw.writeFloatLE(-0);
  raw[35] = 0x5a;
  const header = Buffer.alloc(14);
  header.writeUInt16LE(2);
  header.writeUInt16LE(1, 2);
  header.writeUInt32LE(raw.length, 4);
  header.writeUInt16LE(0x8002, 8);
  header.writeUInt32LE(faces.length, 10);
  const encodedStart = 8 + raw.length;
  return { mixed: Buffer.concat([header.subarray(0, 8), raw, header.subarray(8), faces]),
    expected: Buffer.concat([raw, expected]), encodedStart };
}

function mixedRigidBoxFixture(batch: Buffer, version: number, vertices: Buffer) {
  const { mixed, expected, encodedStart } = mixedBoxFaceFixture();
  mixed.writeUInt16LE(3);
  const rigid = Buffer.alloc(7);
  rigid.writeUInt16LE(0x4000 | (vertices.length / (4 * 36)));
  rigid.writeUInt32LE(batch.length + 1, 2);
  rigid[6] = version;
  return { mixed: Buffer.concat([mixed.subarray(0, encodedStart), rigid, batch, mixed.subarray(encodedStart)]),
    expected: Buffer.concat([expected.subarray(0, 4 * 36), vertices, expected.subarray(4 * 36)]), rigidStart: encodedStart };
}

test('Ponder reconstructs both levels of a box face batch in submitted vertex order', () => {
  const { faces, expected } = boxFaceFixture();
  assert.equal(ponderBoxFaceVertexCount(faces), 8);
  assert.deepEqual(Buffer.from(buildPonderBoxFaceVertices(faces)!), expected);
  assert.equal(buildPonderBoxFaceVertices(faces.subarray(0, -1)), undefined);
  faces.writeUInt16LE(4096, 52 + 24);
  assert.equal(ponderBoxFaceVertexCount(faces), undefined);
});

test('Ponder preserves ordered raw and encoded entity faces and rejects invalid mixed runs', () => {
  const { mixed, expected, encodedStart } = mixedBoxFaceFixture();
  assert.equal(ponderBoxFaceVertexCount(mixed, 3), 12);
  assert.deepEqual(Buffer.from(buildPonderBoxFaceVertices(mixed, 3)!), expected);
  for (const bad of [mixed.subarray(0, 1), mixed.subarray(0, encodedStart - 1), mixed.subarray(0, -1),
    Buffer.concat([mixed, Buffer.alloc(1)])]) {
    assert.equal(ponderBoxFaceVertexCount(bad, 3), undefined);
  }
  const invalid = [
    (data: Buffer) => data.writeUInt16LE(0),
    (data: Buffer) => data.writeUInt16LE(4097),
    (data: Buffer) => data.writeUInt16LE(0, 2),
    (data: Buffer) => data.writeUInt32LE(0xffffffff, 4),
    (data: Buffer) => data.writeUInt16LE(0x8000, encodedStart),
    (data: Buffer) => data.writeUInt16LE(0x8001, encodedStart),
    (data: Buffer) => data.writeUInt16LE(0x9000, encodedStart),
    (data: Buffer) => data.writeFloatLE(Infinity, 8),
    (data: Buffer) => data.writeFloatLE(NaN, 8 + 16),
    (data: Buffer) => data.writeFloatLE(Infinity, encodedStart + 6 + 4),
    (data: Buffer) => data.writeFloatLE(NaN, encodedStart + 6 + 52 + 27),
  ];
  for (const mutate of invalid) {
    const bytes = Buffer.from(mixed);
    mutate(bytes);
    assert.equal(ponderBoxFaceVertexCount(bytes, 3), undefined);
    assert.equal(buildPonderBoxFaceVertices(bytes, 3), undefined);
  }
});

test('Ponder preserves alternating endpoint lights in Create chain faces', () => {
  const { faces, vertices } = chainFaceFixture();
  assert.equal(ponderBoxFaceVertexCount(faces, 2), 8);
  assert.deepEqual(Buffer.from(buildPonderBoxFaceVertices(faces, 2)!), vertices);
  assert.equal(ponderBoxFaceVertexCount(faces, 1), undefined);
});

function sodiumRigidFixture() {
  const part = Buffer.alloc(4 * 24);
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]].forEach((corner, index) => {
    const start = index * 24;
    [...corner, index / 4, .5].forEach((value, field) => part.writeFloatLE(value, start + 4 * field));
    part[start + 22] = 127;
  });
  const partDigest = createHash('sha256').update(part).digest();
  const batch = Buffer.alloc(114);
  batch.writeUInt16LE(1);
  partDigest.copy(batch, 2);
  batch.writeUInt16LE(4, 34);
  [524288, 20, 30, .03, 2, 3, .03, 4, 5, .125, 6, 7]
    .forEach((value, index) => batch.writeFloatLE(value, 36 + index * 4));
  batch.set([1, 126, 254], 99);
  batch.writeUInt32LE(0x7f554433, 102);
  batch.writeUInt32LE(0x000a0000, 106);
  batch.writeUInt32LE(0x00f00080, 110);
  return { batch, part, partPath: `ponder/rigid-parts/v1/${partDigest.toString('hex')}.bin` };
}

function variedNormalFixture() {
  const { batch: original, part, vertices } = rigidFixture();
  const normals = Buffer.from([127, 0, 0, 0, 90, 166]);
  for (let i = 0; i < 4; i++) {
    part.set(i < 2 ? [90, 90, 0] : [90, 0, 90], i * 24 + 20);
    for (let copy = 0; copy < 2; copy++) normals.copy(vertices, (copy * 4 + i) * 36 + 32, i < 2 ? 0 : 3, i < 2 ? 3 : 6);
  }
  const partDigest = createHash('sha256').update(part).digest();
  const normalDigest = createHash('sha256').update(normals).digest();
  const batch = Buffer.alloc(2 + 194 * 2);
  batch.writeUInt16LE(2);
  for (let i = 0; i < 2; i++) {
    const start = 2 + 194 * i;
    original.copy(batch, start, 2 + 130 * i, 2 + 130 * (i + 1));
    partDigest.copy(batch, start);
    normalDigest.copy(batch, start + 162);
  }
  return { batch, part, vertices, normals, partPath: `ponder/rigid-parts/v1/${partDigest.toString('hex')}.bin`,
    normalPath: `ponder/rigid-normals/v1/${normalDigest.toString('hex')}.bin` };
}

function glintFixture() {
  const { batch: base, part, partPath, vertices } = rigidFixture();
  const batch = Buffer.concat([base.subarray(0, 84), base.subarray(132, 214)]);
  const visible = Buffer.alloc(vertices.length / 36 * 20);
  for (let vertex = 0; vertex < vertices.length / 36; vertex++) {
    const from = vertex * 36, to = vertex * 20;
    vertices.copy(visible, to, from, from + 12);
    vertices.copy(visible, to + 12, from + 16, from + 24);
  }
  return { batch, part, partPath, visible };
}

test('Ponder shares entity positions and UVs with its foil pass', () => {
  const { batch, part, visible } = glintFixture();
  const decoded = readPonderGlintBatch(batch);
  assert.ok(decoded);
  assert.deepEqual(Buffer.from(buildPonderGlintVertices(decoded, [part, part])!), visible);
  assert.equal(buildPonderGlintVertices(decoded, [part]), undefined);
  batch.writeFloatLE(Infinity, 36);
  assert.equal(readPonderGlintBatch(batch), undefined);
});

test('Ponder retains the submitted normals for shared non-axis model parts', () => {
  const { batch, part, vertices, normals, normalPath } = variedNormalFixture();
  const data = readPonderRigidBatch(batch, 4);
  assert.ok(data);
  assert.deepEqual(data.parts.map(row => row.normals), [normalPath, normalPath]);
  assert.deepEqual(Buffer.from(buildPonderRigidVertices(data, [part, part], [], [normals, normals])!), vertices);
  assert.equal(buildPonderRigidVertices(data, [part, part], [], [normals, normals.subarray(0, 3)]), undefined);
  assert.equal(readPonderRigidBatch(batch.subarray(0, -1), 4), undefined);
});

test('Ponder mixes original faces with shared rigid batches and rejects invalid nested geometry', () => {
  const rigid = rigidFixture();
  const varied = variedRigidFixture();
  const extraNormals = variedNormalFixture();
  for (const [version, fixture] of [[1, rigid], [2, varied], [4, extraNormals],
    [5, { ...rigid, batch: sparseRigidFixture(rigid.batch) }]] as const) {
    const { mixed, expected } = mixedRigidBoxFixture(fixture.batch, version, fixture.vertices);
    const parsed = readPonderMixedBoxFaces(mixed, 4);
    assert.ok(parsed);
    assert.equal(ponderBoxFaceVertexCount(mixed, 4), 20);
    assert.equal(ponderBoxFaceVertexCount(mixed, 3), undefined);
    assert.deepEqual(parsed.runs.map(run => run.kind), ['raw', 'rigid', 'boxes']);
    const assembled = assemblePonderMixedBoxFaces(parsed, [Uint8Array.from(fixture.vertices).buffer]);
    assert.deepEqual(Buffer.from(assembled!), expected);
    assert.equal(assemblePonderMixedBoxFaces(parsed, [new ArrayBuffer(36)]), undefined);
    assert.equal(assemblePonderMixedBoxFaces(parsed), undefined);
  }
  const { mixed, rigidStart } = mixedRigidBoxFixture(rigid.batch, 1, rigid.vertices);
  for (const mutate of [
    (data: Buffer) => data.writeUInt16LE(0xc002, rigidStart),
    (data: Buffer) => data.writeUInt16LE(0x4000, rigidStart),
    (data: Buffer) => data.writeUInt16LE(0x4001, rigidStart),
    (data: Buffer) => data.writeUInt32LE(data.length, rigidStart + 2),
    (data: Buffer) => data.writeUInt8(3, rigidStart + 6),
    (data: Buffer) => data.writeFloatLE(Infinity, rigidStart + 7 + 36),
  ]) {
    const bytes = Buffer.from(mixed);
    mutate(bytes);
    assert.equal(readPonderMixedBoxFaces(bytes, 4), undefined);
  }
});

test('Ponder applies Sodium corner deltas in float32 order and preserves packed face normals', () => {
  const { batch, part } = sodiumRigidFixture();
  const decoded = readPonderRigidBatch(batch, 3);
  assert.ok(decoded);
  const buffer = buildPonderRigidVertices(decoded, [part]);
  assert.ok(buffer);
  const view = new DataView(buffer);
  assert.deepEqual(Array.from({ length: 4 }, (_, vertex) => [0, 4, 8].map(axis => view.getFloat32(vertex * 36 + axis, true))),
    [[524288, 20, 30], [524288, 22, 33], [524288, 26, 38], [524288.125, 32, 45]]);
  for (let offset = 0; offset < view.byteLength; offset += 36) {
    assert.deepEqual([32, 33, 34].map(axis => view.getInt8(offset + axis)), [1, 126, -2]);
    assert.equal(view.getUint32(offset + 12, true), 0x7f554433);
  }
  part.writeFloatLE(.25, 0);
  assert.equal(buildPonderRigidVertices(decoded, [part]), undefined);
  batch[99] = 128;
  assert.equal(readPonderRigidBatch(batch, 3), undefined);
});

test('Ponder builds ordered cuboid faces and keeps flat outline lighting', () => {
  const outline = outlineFixture();
  const buffer = buildPonderOutlineVertices(outline);
  assert.ok(buffer);
  assert.equal(buffer.byteLength, 24 * 36);
  const vertices = new DataView(buffer);
  assert.deepEqual(Array.from({ length: 4 }, (_, vertex) =>
    [0, 4, 8, 16, 20].map(offset => vertices.getFloat32(vertex * 36 + offset, true))),
  [[11, 22, 36, 0, 0], [11, 22, 33, 0, 1], [14, 22, 33, 1, 1], [14, 22, 36, 1, 0]]);
  assert.deepEqual([vertices.getUint32(12, true), vertices.getUint32(24, true), vertices.getUint32(28, true)],
    [0x7f554433, 0x000a0000, 0x00f00080]);
  assert.deepEqual([32, 33, 34].map(offset => vertices.getInt8(offset)), [0, -127, 0]);
  outline[122] = 1;
  const flat = new DataView(buildPonderOutlineVertices(outline)!);
  for (let i = 33; i < flat.byteLength; i += 36) assert.equal(flat.getInt8(i), 127);
  assert.equal(ponderOutlineCuboidCount(outline.subarray(0, 122)), undefined);
  outline.writeFloatLE(5, 2);
  assert.equal(buildPonderOutlineVertices(outline), undefined);
  outline.writeFloatLE(NaN, 2);
  assert.equal(buildPonderOutlineVertices(outline), undefined);
});

test('Ponder rebuilds individual vertex colors and lighting on the same rigid geometry', () => {
  const { part, batch, attributes, attributePath, vertices } = variedRigidFixture();
  const data = readPonderRigidBatch(batch, 2);
  assert.ok(data);
  assert.deepEqual(data.parts.map(entry => entry.attributes), [undefined, attributePath]);
  assert.deepEqual(Buffer.from(buildPonderRigidVertices(data, [part, part], [undefined, attributes])!), vertices);
  assert.equal(buildPonderRigidVertices(data, [part, part], [undefined, attributes.subarray(0, 36)]), undefined);
  assert.equal(readPonderRigidBatch(batch), undefined);
  batch[164 + 118] = 1;
  assert.equal(readPonderRigidBatch(batch, 2), undefined);
});

test('Ponder tiles fluid faces with outward winding, cropped UVs and packed light', () => {
  const image = `ponder/textures/${'b'.repeat(64)}.png`;
  const face = { geometry: [0, -0.5, 0.25, 1.5, 0.75, 0.5, 1, 0, 0xf00080],
    transform: matrix, tint: -1, image, lightmap: image };
  const normals = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  for (const [direction, normal] of normals.entries()) {
    const geometry = [direction, ...face.geometry.slice(1)];
    const accepted = readPonderFluidFaces([{ ...face, geometry }]);
    assert.ok(accepted);
    const buffer = new DataView(buildPonderFluidMesh(accepted[0].geometry));
    assert.equal(buffer.byteLength, 3 * 4 * 24);
    const point = (vertex: number) => Array.from({ length: 3 }, (_, axis) => buffer.getFloat32(vertex * 24 + axis * 4, true));
    const [a, b, c] = [point(0), point(1), point(2)];
    const u = b.map((value, i) => value - a[i]);
    const v = c.map((value, i) => value - a[i]);
    const cross = u.map((_, i) => u[(i + 1) % 3] * v[(i + 2) % 3] - u[(i + 2) % 3] * v[(i + 1) % 3]);
    assert.ok(cross.reduce((sum, value, i) => sum + value * normal[i], 0) > 0);
    assert.equal(buffer.getFloat32(12, true), direction === 2 || direction === 5 ? 0 : 0.5);
    assert.equal(buffer.getFloat32(16, true), 0.25);
    assert.equal(buffer.getUint16(20, true), 0x80);
    assert.equal(buffer.getUint16(22, true), 0xf0);
  }
  assert.equal(readPonderFluidFaces([{ ...face, geometry: [1, 0, 0, 200, 100, 0, 1, 0, 0] }]), undefined);
  assert.equal(readPonderFluidFaces([{ ...face, image: 'elsewhere.png' }]), undefined);
});

test('Ponder restores exact chunk patches including removals, insertion and shrinking', () => {
  const part = { blocks: Array.from({ length: 32 }, (_, x) => [x, 0, 0, 1]), transform: matrix, textureOffsets: [[0, 0]] };
  const moved = { blocks: part.blocks, transform: quarterTurn };
  const draw = { vertices: mesh, attributes: [{ name: 'Position', count: 3 }], modelView: matrix };
  const patches = [
    { movingLayout: [part], scene: [draw], captions: [{ text: 'Copper pipes' }] },
    {},
    { movingLayout: [moved], scene: [{ ...draw, modelView: quarterTurn }] },
    { movingLayout: [moved, part], scene: [] },
    { movingLayout: [] },
  ];
  const encoded = JSON.parse(encodePonderTimelinePatches(patches));
  assert.equal(encoded.version, 10);
  assert.deepEqual(encoded.layoutValues.blocks, [part.blocks]);
  assert.deepEqual(encoded.patches[2].movingLayout,
    [1, [0, [{ d: [5381, 0, -1, 1, 0, 3] }], ['textureOffsets']]]);
  assert.deepEqual(readPonderTimelinePatches(encoded, patches.length), patches);
  assert.deepEqual(readPonderTimelinePatches(patches, patches.length), patches);
  const first = { movingLayout: [part] };
  const patch = (length: number, edits: unknown[]) => ({ movingLayout: { length, edits } });
  for (const malformed of [patch(4, [[3, part]]), patch(1, [[0, {}, ['unknown']]]), patch(9000, [])]) {
    assert.equal(readPonderTimelinePatches({ version: 1, patches: [first, malformed] }, 2), undefined);
  }
  assert.equal(readPonderTimelinePatches({ version: 1, patches: [patch(1, [[0, part]])] }, 1), undefined);
  const translated = { ...part, transform: [...matrix.slice(0, 12), 2, ...matrix.slice(13)] };
  const pythonChunk = { version: 2, patches: [first, {}, patch(1, [[0, { transform: { d: [4096, 2] } }]])] };
  assert.deepEqual(readPonderTimelinePatches(pythonChunk, 3), [first, {}, { movingLayout: [translated] }]);
  for (const d of [[0], [65536, 2], [4096], [4096, 2, 3], [4096, '2']]) {
    assert.equal(readPonderTimelinePatches({ version: 2, patches: [
      first, patch(1, [[0, { transform: { d } }]]),
    ] }, 2), undefined);
  }
  const shared = { version: 3, transforms: [matrix, { d: [4096, 2] }], patches: [
    { movingLayout: [{ ...part, transform: 0 }] },
    patch(1, [[0, { transform: 1 }]]),
  ] };
  assert.deepEqual(readPonderTimelinePatches(shared, 2), [first, { movingLayout: [translated] }]);
  assert.equal(readPonderTimelinePatches({ ...shared, transforms: [matrix] }, 2), undefined);
  assert.equal(readPonderTimelinePatches({ ...shared, transforms: [{ d: [4096, 2] }] }, 2), undefined);

  const absolute = { version: 4, transforms: [{ a: [8, -0] }], patches: [
    { movingLayout: [[0, part.blocks, part.textureOffsets]] },
    patch(1, [[0, [{ a: [4096, 2] }]]]),
  ] };
  const signed = matrix.map((value, index) => index === 3 ? -0 : value);
  assert.deepEqual(readPonderTimelinePatches(absolute, 2), [
    { movingLayout: [{ ...part, transform: signed }] }, { movingLayout: [translated] },
  ]);
  for (const malformed of [[{ a: [65536, 1] }], [{ a: [4096] }], [0, null], [0, [], [], 123], [1]]) {
    assert.equal(readPonderTimelinePatches({ ...absolute, patches: [{ movingLayout: [malformed] }] }, 1), undefined);
  }
  assert.equal(readPonderTimelinePatches({ ...absolute, transforms: [{ a: [0, 2] }] }, 2), undefined);
  const sharedLayouts = { version: 6, layoutValues: { blocks: [part.blocks], textureOffsets: [part.textureOffsets] },
    patches: [{ movingLayout: [[{ a: [0] }, 0, 0]] }, patch(1, [[0, [{ d: [4096, 2] }]]])] };
  assert.deepEqual(readPonderTimelinePatches(sharedLayouts, 2),
    [first, { movingLayout: [{ ...part, transform: translated.transform }] }]);
  for (const ref of [-1, 0.5, 1]) {
    assert.equal(readPonderTimelinePatches({ ...sharedLayouts, patches: [
      { movingLayout: [[{ a: [0] }, ref, 0]] },
    ] }, 1), undefined);
  }
});

test('Ponder shares draw values across layers and resolves them before vector changes', () => {
  const attributes = [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }];
  const projection = [...matrix.slice(0, 12), 2, 0, 0, 1];
  const first = { attributes, projection, modelView: matrix, vertices: mesh };
  const second = { ...first, vertices: `ponder/meshes/${'f'.repeat(64)}.bin` };
  const moved = { ...first, modelView: projection };
  const patches = [{ scene: [first, second], overlay: [second] }, { scene: [moved, second] }, {}];
  const packed = JSON.parse(encodePonderTimelinePatches(patches));
  assert.equal(packed.version, 8);
  assert.deepEqual(packed.drawValues.attributes, [attributes]);
  assert.deepEqual(readPonderTimelinePatches(packed, patches.length), patches);
  assert.equal(readPonderTimelinePatches({ ...packed,
    drawValues: { ...packed.drawValues, attributes: [[attributes], 'invalid'] },
  }, patches.length), undefined);
  packed.patches[0].scene[0].attributes = 999;
  assert.equal(readPonderTimelinePatches(packed, patches.length), undefined);
});

test('Ponder preserves legacy offsets and rejects motion with unsafe geometry or invalid matrices', () => {
  const draw = { shader: 'rendertype_solid', blend: false, modelView: [...matrix] };
  assert.equal(applyPonderSceneOffset([draw], [3, 2, 1]), true);
  assert.deepEqual(draw.modelView.slice(12, 15), [3, 2, 1]);
  assert.equal(applyPonderSceneTransform([{ ...draw, shader: 'rendertype_translucent', blend: true }], {
    blocks: quarterTurn, shadow: matrix,
  }), false);
  assert.equal(applyPonderSceneTransform([draw], { blocks: new Array(16).fill(0), shadow: matrix }), false);
});

test('Ponder stores exact compact matrix edits and preserves higher precision when needed', () => {
  const placement = { blocks: [[0, 0, 0, 1]], transform: [...matrix] };
  placement.transform.splice(12, 3, -2.345678, 3.123456, 4.111111);
  const moved = { ...placement, transform: [...placement.transform] };
  moved.transform.splice(12, 3, -2.111111, 3.333333, 4.222222);
  const precise = { ...moved, transform: [...moved.transform] };
  precise.transform[12] = -2.1111119;
  const patches = [placement, moved, precise].map(part => ({ movingLayout: [part] }));
  const chunk = JSON.parse(encodePonderTimelinePatches(patches));
  assert.equal(chunk.version, 10);
  assert.deepEqual(readPonderTimelinePatches(chunk, patches.length), patches);
  for (const invalid of ['!', 'gA', 'AXCA', 'AHCAAA', 'AAAA']) {
    assert.equal(readPonderTimelinePatches({ version: 7, patches: [
      { movingLayout: [[{ a: invalid }, placement.blocks]] },
    ] }, 1), undefined);
  }
});

test('Ponder reconstructs the shared coefficients of each planar rotation exactly', () => {
  for (const [plane, [x, y, opposite, diagonal]] of [[0, 1, 4, 5], [0, 2, 8, 10], [5, 6, 9, 10]].entries()) {
    const blocks = [[0, 0, 0, 1]];
    const patches = [[0.866025, 0.5, -2.345678], [0.5, 0.866025, -2.111111]].map(([cos, sin, offset]) => {
      const transform = [...matrix];
      transform[x] = transform[diagonal] = cos;
      transform[y] = sin;
      transform[opposite] = -sin;
      transform[12] = offset;
      return { movingLayout: [{ transform, blocks }] };
    });
    const chunk = JSON.parse(encodePonderTimelinePatches(patches));
    assert.equal(chunk.version, 10);
    assert.ok(chunk.patches[0].movingLayout[0][0].a.startsWith(`.${plane}`));
    assert.ok(chunk.patches[1].movingLayout[1][1].startsWith(`.${plane}`));
    assert.deepEqual(readPonderTimelinePatches(chunk, 2), patches);
    assert.equal(readPonderTimelinePatches({ ...chunk, version: 7 }, 2), undefined);
    for (const invalid of ['.3AwADBg', '.0AAAA', '.0', '.0MwADBg']) {
      assert.equal(readPonderTimelinePatches({ version: 9, patches: [
        { movingLayout: [[{ a: invalid }, blocks]] },
      ] }, 1), undefined);
    }
  }
});

test('Ponder v10 reads short moving edits without confusing pose indices and texture offsets', () => {
  const blocks = [[0, 0, 0, 0]], offsets = [[.25, .5]];
  const translated = [...matrix];
  translated[12] = 2;
  const packed = { version: 10, transforms: [matrix, translated], layoutValues: { textureOffsets: [offsets] },
    patches: [{ movingLayout: [[0, blocks], [1, blocks]] }, { movingLayout: [2, [0, 1], [1, -1]] },
      { movingLayout: [1, [0, [{ d: [4096, 3] }]]] }] };
  const final = [...translated];
  final[12] = 3;
  assert.deepEqual(readPonderTimelinePatches(packed, 3), [
    { movingLayout: [{ transform: matrix, blocks }, { transform: translated, blocks }] },
    { movingLayout: [{ transform: translated, blocks }, { transform: translated, blocks, textureOffsets: offsets }] },
    { movingLayout: [{ transform: final, blocks }] },
  ]);
  for (const movingLayout of [[8193], [1.25], [1, [0, -2]], [1, [0, 'invalid!']], [1, [0, 0], [0, 1]], [1, [1, 0]]]) {
    assert.equal(readPonderTimelinePatches({ ...packed, patches: [packed.patches[0], { movingLayout }] }, 2), undefined);
  }
});

test('Ponder shortens geometry references only in their own section', () => {
  const bundle = `ponder/scenes/${id}/meshes/16.bin`;
  const digest = 'ab'.repeat(32);
  const encodedDigest = Buffer.from(digest, 'hex').toString('base64url');
  const vertices = `${bundle}#42:1024:${digest}:rigid-batches/v4`;
  const indices = `${bundle.replace('16.bin', '0.bin')}#0:64:${digest}`;
  const expected = [{ scene: [{ vertices, indices }], captions: [{ text: 'Mesh bundle' }] },
    { scene: [{ vertices, indices, vertexCount: 20 }] }];
  const packed = JSON.parse(encodePonderTimelinePatches(expected, bundle));
  assert.equal(packed.version, 5);
  assert.equal(packed.patches[0].scene[0].vertices, `~8:42:1024:${encodedDigest}`);
  assert.equal(packed.patches[0].scene[0].indices, indices);
  assert.deepEqual(readPonderTimelinePatches(packed, 2, bundle), expected);
  assert.equal(readPonderTimelinePatches(packed, 2), undefined);
  const edited = readPonderTimelinePatches({ version: 5, patches: [
    { scene: [packed.patches[0].scene[0], { vertices, vertexCount: 4 }] },
    { scene: { length: 2, edits: [[1, { vertexCount: 8 }]] } },
  ] }, 2, bundle)!;
  const [firstDraws, nextDraws] = edited.map(frame => frame.scene as Record<string, unknown>[]);
  assert.equal(nextDraws[0], firstDraws[0]);
  assert.equal(nextDraws[0].vertices, vertices);
  assert.equal(firstDraws[1].vertexCount, 4);
  assert.equal(nextDraws[1].vertexCount, 8);
  const consecutive = edited.map((frame, i) => ({ ...frame, layout: [
    { transform: [...matrix.slice(0, 12), i, ...matrix.slice(13)], blocks: [[0, 0, 0, 1]] },
  ] }));
  assert.equal(encodePonderTimelinePatches(consecutive, bundle),
    encodePonderTimelinePatches(consecutive.map(frame => structuredClone(frame)), bundle));
  const withSharedLayout = [{ ...expected[0], movingLayout: Array.from({ length: 6 }, (_, x) => ({
    transform: [...matrix.slice(0, 12), x, ...matrix.slice(13)],
    blocks: [[0, 0, 0, 1]], textureOffsets: [[0.12345678, -0.98765432]],
  })) }, expected[1]];
  const combined = JSON.parse(encodePonderTimelinePatches(withSharedLayout, bundle));
  assert.equal(combined.version, 6);
  assert.equal(combined.patches[0].scene[0].vertices, packed.patches[0].scene[0].vertices);
  assert.deepEqual(readPonderTimelinePatches(combined, 2, bundle), withSharedLayout);
  for (const value of [`~8:0:1025:${encodedDigest}`, `~8:4194304:1:${encodedDigest}`,
    `~8:0:64:${encodedDigest.slice(0, -1)}B`, `~8:0:64:${encodedDigest.slice(1)}`]) {
    assert.equal(readPonderTimelinePatches({ version: 5, patches: [{ scene: [{ vertices: value }] }] }, 1, bundle), undefined);
  }
});

test('Ponder captions track the exported anchor as the viewport narrows', () => {
  const camera = Float32Array.from(matrix);
  camera[4] = 10;
  camera[8] = 8;
  camera[9] = -12;
  camera[12] = 194;
  camera[13] = 140;
  const frame = { width: 480, height: 320 };
  const target = projectCaptionAnchor(Float32Array.of(2, 2, 3), camera, frame);
  assert.deepEqual(target, { x: 0.5, y: 106 / 320 });
  assert.equal(projectCaptionAnchor(Float32Array.of(-1000, 0, 0), camera, frame), undefined);

  const bubble = { width: 224, height: 50 };
  const wide = placeCaption({ width: 672, height: 448 }, bubble, target);
  const narrow = placeCaption({ width: 294, height: 196 }, bubble, target);
  assert.deepEqual(wide.tip, { x: 336, y: 148.4 });
  assert.equal(wide.tail?.x, wide.left);
  assert.deepEqual(narrow.tip, { x: 147, y: 64.925 });
  assert.equal(narrow.tail?.y, narrow.top + bubble.height);
  assert.ok(narrow.left >= 8 && narrow.top >= 8 && narrow.top + bubble.height <= 188);
});

test('Ponder has no standalone page and old recipe links open over Items', () => {
  const pump = { id: 'create:mechanical_pump', view: 'recipes' } as const;
  for (const url of ['/ponder', '/ponder/', '/server/atm10/ponder', '/server/atm10/ponder/']) {
    assert.deepEqual(routeFromUrl(url), { page: 'notFound' });
  }

  for (const from of ['ponder', 'ponder-demo']) {
    const link = '/server/atm10/items/create%3Amechanical_pump?from=' + from;
    assert.equal(routeFromUrl(link).page, 'items');
    const route = routeFromUrl(link);
    assert.equal('item' in route && route.item?.id, pump.id);
    assert.equal(itemUrl(link), '/server/atm10/items');
    assert.equal(itemUrl(link, { ...pump, view: 'uses' }), '/server/atm10/items/create%3Amechanical_pump?view=uses');
  }
});

test('Ponder preserves the open item and selected scene in a reloadable URL', () => {
  const page = '/server/atm10/items?q=fluid+pipe&page=2';
  const ponder = { itemId: 'create:fluid_pipe', sceneId: 'create:fluid_pipe_flow' };
  const link = itemPonderLocation(page, ponder);
  assert.equal(routeFromUrl(link).page, 'items');
  assert.deepEqual(readItemPonderLocation(link), ponder);
  assert.equal(itemPonderLocation(link), page);
  assert.equal(readItemPonderLocation(page + '&ponder=invalid'), undefined);

  const encasing = { ...scene, id: 'create:encased_fluid_pipe', items: ['create:copper_casing', ponder.itemId] };
  const flow = { ...scene, id: 'create:fluid_pipe_flow', items: [ponder.itemId] };
  assert.equal(selectItemPonderScene([encasing, flow], { itemId: ponder.itemId }), flow);
  assert.equal(selectItemPonderScene([encasing, flow], { itemId: ponder.itemId, sceneId: encasing.id }), encasing);
  assert.equal(selectItemPonderScene([encasing], { itemId: 'create:copper_casing' }), encasing);
  assert.equal(selectItemPonderScene([encasing], { itemId: ponder.itemId }), encasing);
});

test('Ponder keeps separate schematics when an item shares a scene id', () => {
  const itemId = 'iceandfire:dragonforge_fire_core';
  const first = { ...scene, id: 'iceandfire:dragon_forge', schematic: 'iceandfire:fire_dragon_forge', items: [itemId] };
  const second = { ...first, schematic: 'iceandfire:ice_dragon_forge' };
  const guide = { ...second, steps: ['Build the forge'] };
  const choices = indexItemPonderChoices([first, second], [guide]).get(itemId) ?? [];
  assert.deepEqual(choices, [first, second]);
  const selection = { itemId, sceneId: second.id, schematic: second.schematic };
  const page = '/items?search=forge';
  const link = itemPonderLocation(page, selection);
  assert.deepEqual(readItemPonderLocation(link), selection);
  assert.equal(itemPonderLocation(link), page);
  assert.equal(selectItemPonderScene(choices, selection), second);
  assert.equal(selectItemPonderScene(choices, { itemId, sceneId: second.id }), first);
});

test('Ponder honors the registration order independently for each item', () => {
  const pipe = 'create:fluid_pipe';
  const casing = 'create:copper_casing';
  const base = { ...scene, items: [pipe, casing] };
  const flow = { ...base, id: 'create:fluid_pipe_flow', itemOrder: [0, 1] };
  const encasing = { ...base, id: 'create:encased_fluid_pipe', itemOrder: [1, 0] };
  const parsed = readPonderIndex({ ...index, scenes: [
    encasing, { ...flow, manifest: flow.manifest.replace(/a{64}/, 'b'.repeat(64)) },
  ] });
  assert.deepEqual(parsed?.scenes.map(entry => entry.itemOrder), [[1, 0], [0, 1]]);
  assert.equal(readPonderIndex({ ...index, scenes: [{ ...encasing, itemOrder: [0] }] }), undefined);
  const choices = indexItemPonderChoices([encasing, flow], []);
  assert.deepEqual(choices.get(pipe), [flow, encasing]);
  assert.deepEqual(choices.get(casing), [encasing, flow]);
  const overriddenOrder = indexItemPonderChoices([
    { ...flow, itemOrder: [1, 1] }, { ...encasing, itemOrder: [0, 0] },
  ], []).get(pipe) ?? [];
  assert.equal(selectItemPonderScene(overriddenOrder, { itemId: pipe })?.id, encasing.id);
});

test('Ponder decodes the v1 catalog, captured layout and numbered timeline', () => {
  assert.deepEqual(readPonderIndex(index), index);
  assert.equal(readPonderIndex({ ...index, version: 2 }), undefined);
  assert.equal(readPonderIndex({ ...index, scenes: [{ ...scene, manifest: '../scene.json' }] }), undefined);
  assert.equal(ponderFramePath(scene, 0), `ponder/scenes/${id}/frames/0.json`);
  assert.equal(ponderResource(`ponder/scenes/${id}/frames/00.json`), undefined);
  assert.deepEqual(readPonderManifest({
    width: 480, height: 320, frameCount: 100, ticksPerSecond: 20, keyframes: [40, 40, 100],
    diffuseLights: [[0, 1, 0], [0, -1, 0]],
  })?.keyframes, [40, 99]);
  const draw = {
    mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 12, vertices: mesh,
    attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }],
    shader: 'position', textures: {}, projection: matrix, modelView: matrix, textureMatrix: matrix,
    color: [1, 1, 1, 1], depthTest: true, depthFunction: 515, depthWrite: true, cull: false, blend: false,
  };
  const frame = readPonderFrame({
    sceneToGui: matrix, scene: [draw, { ...draw, vertices: '/etc/passwd' }], overlay: [draw],
    captions: [{ text: 'Use a pump.', color: -1, opacity: 1, anchor: [1, 2, 3] }],
    picking: `ponder/picking/${id}.json`,
  });
  assert.equal(frame?.draws.length, 2);
  assert.equal(frame?.omitted, 1);
  assert.equal(frame?.captions[0].text, 'Use a pump.');
  assert.deepEqual(frame?.captions[0].anchor, Float32Array.of(1, 2, 3));

  const line = { ...draw, mode: 'LINES', shader: 'rendertype_lines', stride: 20, lineWidth: 2.5,
    attributes: [...draw.attributes, { name: 'Normal', type: 'BYTE', count: 3, offset: 16 }] };
  const lines = readPonderFrame({ sceneToGui: matrix, scene: [line, { ...line, lineWidth: -1 },
    { ...line, mode: 'LINE_STRIP', indexCount: 4 }, { ...line, attributes: draw.attributes }], overlay: [], captions: [] });
  assert.deepEqual(lines?.draws.map(draw => [draw.mode, draw.lineWidth]), [['LINES', 2.5], ['LINE_STRIP', 2.5]]);
  assert.equal(lines?.omitted, 2);

  for (const shader of ['rendertype_cutout_mipped', 'rendertype_translucent']) {
    const frames = [false, true].map(cull =>
      readPonderFrame({ sceneToGui: matrix, scene: [{ ...draw, shader, cull }, draw], overlay: [], captions: [] }));
    assert.deepEqual(frames.map(frame => frame?.draws.map(draw => draw.cull)), [[true, false], [true, false]]);
  }

  const bubble = [
    { ...draw, shader: 'position_color', vertexCount: 20, indexCount: 30 },
    { ...draw, shader: 'position_color', vertexCount: 16, indexCount: 24 },
    { ...draw, shader: 'rendertype_gui' },
    { ...draw, shader: 'rendertype_gui' },
    { ...draw, shader: 'rendertype_text' },
  ];
  const withCaption = { sceneToGui: matrix, scene: [draw], overlay: bubble,
    captions: [{ text: 'Use a pump.', color: -1, opacity: 1 }] };
  assert.equal(readPonderFrame(withCaption)?.draws.length, 1);
  assert.equal(readPonderFrame({ ...withCaption, captions: [] })?.draws.length, 6);
  const tool = { ...draw, shader: 'position_tex' };
  for (const overlay of [[...bubble, tool], [tool, ...bubble]]) {
    assert.deepEqual(readPonderFrame({ ...withCaption, overlay })?.draws.map(draw => draw.shader), ['position', 'position_tex']);
  }
  const borderOnlyCaption = [...bubble.slice(0, 2), bubble[4], bubble[4], tool];
  assert.deepEqual(readPonderFrame({ ...withCaption, overlay: borderOnlyCaption })?.draws.map(draw => draw.shader),
    ['position', 'position_tex']);
  assert.equal(readPonderFrame({ ...withCaption, overlay: borderOnlyCaption, captions: [] })?.draws.length, 6);
  assert.equal(frame?.picking, `ponder/picking/${id}.json`);
  for (const picking of ['../picking.json', mesh, 'https://example.invalid/picking.json']) {
    assert.equal(readPonderFrame({ sceneToGui: matrix, scene: [draw], overlay: [], captions: [], picking })?.picking, undefined);
  }
});

test('Compact Ponder draws moving parts and tank contents before shared glass', () => {
  const draw = {
    mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 12, vertices: mesh,
    attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }],
    textures: {}, projection: matrix, modelView: matrix, textureMatrix: matrix, color: [1, 1, 1, 1],
    depthTest: true, depthFunction: 515, depthWrite: true, cull: false, blend: false,
  };
  const frame = readPonderFrame({ sceneToGui: matrix, captions: [],
    scene: [{ ...draw, shader: 'rendertype_entity_solid' },
      { ...draw, shader: 'rendertype_entity_translucent_cull', blend: true, blendFactors: [770, 771, 1, 771] }],
    overlay: [{ ...draw, shader: 'position_tex' }],
  });
  assert.ok(frame);
  const asset = { vertices: mesh, image: `ponder/textures/${id}.png`, vertexCount: 4 };
  const models = [[{ ...asset, shader: 'rendertype_solid' }, { ...asset, shader: 'rendertype_translucent' }]];
  const composed = compactPonderDraws(frame, [{ transform: matrix, blocks: [[0, 0, 0, 0]] }], models, 480, 320);
  assert.deepEqual(composed.draws.map(draw => draw.shader), [
    'rendertype_solid', 'rendertype_entity_solid', 'rendertype_entity_translucent_cull', 'rendertype_translucent', 'position_tex',
  ]);
  assert.equal(composed.overlayStart, 4);
});

test('Ponder applies a shared block model offset in section coordinates', () => {
  const model = { shader: 'rendertype_cutout', vertices: mesh, image: `ponder/textures/${id}.png`, vertexCount: 4 };
  const groups = readPonderCompactLayout([{ transform: quarterTurn, blocks: [[1, 2, 3, 0, .125, .25, -.5]] }], [[model]]);
  assert.ok(groups);
  const frame = readPonderFrame({ sceneToGui: matrix, captions: [], scene: [], overlay: [] });
  assert.ok(frame);
  const composed = compactPonderDraws(frame, groups, [[model]], 480, 320);
  assert.deepEqual(Array.from(composed.draws[0].modelView.slice(12, 15)), [5.5, 2.25, -1.125]);
  for (const invalid of [[1, 2, 3, 0, 0], [1, 2, 3, 0, 0, 0, Infinity], [1, 2, 3, 0, 0, 0, 17]]) {
    assert.equal(readPonderCompactLayout([{ transform: matrix, blocks: [invalid] }], [[model]]), undefined);
  }
});

test('Ponder picking validates affine groups, block references and outline boxes', () => {
  const block = { position: [0, 1, 2], block: 'create:mechanical_pump', item: 'create:mechanical_pump',
    boxes: [[0, 0.125, 0.125, 1, 0.875, 0.875]] };
  const group = { transform: matrix, blocks: [block] };
  const parsed = readPonderPicking([group]);
  assert.ok(parsed);
  assert.deepEqual(parsed[0].blocks[0], block);
  const perspective = [...matrix];
  perspective[3] = 1;
  assert.equal(readPonderPicking([{ ...group, transform: perspective }]), undefined);
  assert.equal(readPonderPicking([{ ...group, transform: Array(16) }]), undefined);
  assert.equal(readPonderPicking([{ ...group, blocks: [{ ...block, item: 'https://wrong' }] }]), undefined);
  assert.equal(readPonderPicking([{ ...group, blocks: [{ ...block, boxes: [[0, 0, 0, 1, 1, -1]] }] }]), undefined);
  assert.deepEqual(readPonderPicking([]), []);
});

test('Ponder picks the first visible outline surface with the captured section transform', () => {
  const camera = [0, 0, -2, 0, 0, -2, 0, 0, 2, 0, 0, 0, 20, 30, 100, 1];
  const transform = [...matrix];
  transform[12] = 3;
  transform[14] = 5;
  const boxes = [[0, 0, 0, 1, 1, 1]];
  const group = { transform, blocks: [
    { position: [2, 2, 3], block: 'create:fluid_tank', item: 'create:fluid_tank', boxes },
    { position: [1, 2, 3], block: 'create:mechanical_pump', item: 'create:mechanical_pump', boxes },
  ] };
  const parsed = readPonderPicking([group]);
  assert.ok(parsed);
  assert.deepEqual(pickPonderBlock(camera, parsed, 37, 25), {
    block: 'create:mechanical_pump', item: 'create:mechanical_pump', position: [1, 2, 3],
    depth: 92, outline: [[36, 24], [38, 24], [38, 26], [36, 26]],
  });
  assert.equal(pickPonderBlock(camera, parsed, 41, 25), undefined);
  const occluding = readPonderPicking([group, { transform: matrix, blocks: [
    { position: [3, 2, 8], block: 'demo:no_item', boxes },
  ] }]);
  assert.ok(occluding);
  assert.equal(pickPonderBlock(camera, occluding, 37, 25)?.block, 'demo:no_item');
  assert.equal(pickPonderBlock(camera, occluding, 37, 25)?.item, undefined);
});

test('Ponder picks through gaps between boxes and keeps capture order on equal depth', () => {
  const groups = readPonderPicking([{ transform: matrix, blocks: [
    { position: [0, 0, 4], block: 'demo:frame', boxes: [[0, 0, 0, 0.25, 1, 1], [0.75, 0, 0, 1, 1, 1]] },
    { position: [0, 0, 2], block: 'demo:back', boxes: [[0, 0, 0, 1, 1, 1]] },
    { position: [0, 0, 2], block: 'demo:tie', boxes: [[0, 0, 0, 1, 1, 1]] },
    { position: [0, 0, 1001], block: 'demo:outside_camera', boxes: [[0, 0, 0, 1, 1, 1]] },
  ] }]);
  assert.ok(groups);
  assert.equal(pickPonderBlock(matrix, groups, 0.15, 0.5)?.block, 'demo:frame');
  assert.equal(pickPonderBlock(matrix, groups, 0.5, 0.5)?.block, 'demo:back');
});

test('Ponder scenery hides parts behind it and cannot be selected', () => {
  const isPart = ponderPartFilter({ schematic: 'create:mechanical_pump/speed', items: ['create:mechanical_pump'] });
  const boxes = [[0, 0, 0, 1, 1, 1]];
  const groups = readPonderPicking([{ transform: matrix, blocks: [
    { position: [0, 0, 4], block: 'minecraft:snow_block', item: 'minecraft:snow_block', boxes },
    { position: [0, 0, 2], block: 'create:mechanical_pump', boxes },
    { position: [1, 0, 4], block: 'minecraft:white_concrete', item: 'minecraft:white_concrete', boxes },
    { position: [2, 0, 2], block: 'create:glass_fluid_pipe', boxes },
    { position: [3, 0, 2], block: 'create:mechanical_pump', boxes },
  ] }]);
  assert.ok(groups);
  assert.deepEqual(groups[0].blocks.filter(isPart).map(block => block.block),
    ['create:mechanical_pump', 'create:glass_fluid_pipe', 'create:mechanical_pump']);
  assert.equal(pickPonderBlock(matrix, groups, 0.5, 0.5, isPart), undefined);
  assert.equal(pickPonderBlock(matrix, groups, 1.5, 0.5, isPart), undefined);
  assert.equal(pickPonderBlock(matrix, groups, 2.5, 0.5, isPart)?.block, 'create:glass_fluid_pipe');
  assert.equal(pickPonderBlock(matrix, groups, 3.5, 0.5, isPart)?.block, 'create:mechanical_pump');

  const otherScene = ponderPartFilter({ schematic: 'example:demo', items: ['example:component'] });
  assert.equal(otherScene({ block: 'example:state', item: 'example:component' }), true);
  assert.equal(otherScene({ block: 'minecraft:snow_block', item: 'minecraft:snow_block' }), false);

  const pipeScene = ponderPartFilter({ schematic: 'create:fluid_pipe/flow', items: ['create:fluid_pipe'] });
  assert.equal(pipeScene({ block: 'create:fluid_tank' }), true);
  assert.equal(pipeScene({ block: 'create:glass_fluid_pipe' }), true);
  assert.equal(pipeScene({ block: 'minecraft:white_concrete' }), false);
});

test('Ponder decodes exported RGBA sheets with all five PNG filters without losing transparent RGB', async () => {
  const chunk = (type: string, data: Buffer) => {
    const contents = Buffer.concat([Buffer.from(type), data]);
    const frame = Buffer.alloc(contents.length + 8);
    frame.writeUInt32BE(data.length);
    contents.copy(frame, 4);
    frame.writeUInt32BE(crc32(contents), frame.length - 4);
    return frame;
  };
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const info = Buffer.from('00000002000000050806000000', 'hex');
  const rows = Buffer.from([
    0, 5, 20, 250, 0, 40, 80, 120, 128,
    1, 6, 22, 253, 1, 39, 63, 128, 128,
    2, 3, 3, 5, 255, 3, 3, 3, 3,
    3, 4, 0, 3, 15, 1, 16, 11, 227,
    4, 2, 252, 3, 3, 1, 1, 2, 6,
  ]);
  const png = (data: Buffer) => {
    const payload = deflateSync(data);
    return Uint8Array.from(Buffer.concat([signature, chunk('IHDR', info), chunk('IDAT', payload.subarray(0, 11)),
      chunk('IDAT', payload.subarray(11)), chunk('IEND', Buffer.alloc(0))])).buffer;
  };
  assert.deepEqual(await readPonderRgbaPixels(png(rows), 2, 5), Uint8ClampedArray.of(
    5, 20, 250, 0, 40, 80, 120, 128,
    6, 22, 253, 1, 45, 85, 125, 129,
    9, 25, 2, 0, 48, 88, 128, 132,
    8, 12, 4, 15, 29, 66, 77, 44,
    10, 8, 7, 18, 30, 67, 79, 50,
  ));
  assert.equal(await readPonderRgbaPixels(png(rows.subarray(0, -1)), 2, 5), undefined);
  assert.equal(await readPonderRgbaPixels(png(Buffer.concat([rows, Buffer.alloc(1)])), 2, 5), undefined);
  rows[0] = 5;
  assert.equal(await readPonderRgbaPixels(png(rows), 2, 5), undefined);
});

test('Ponder samples clipped atlas frames, preserving alpha and following seeks', () => {
  const image = `ponder/textures/${'b'.repeat(64)}.png`;
  const [copy] = readPonderAtlasAnimation([{
    image, rect: [3, 2, 1, 1], source: [1, 0, 2, 1], frames: [[1, 2], [0, 3]], interpolate: true,
  }])!;
  const pixels = (tick: number) => Array.from(samplePonderAtlasCopy(copy, { width: 4, height: 1,
    data: Uint8ClampedArray.of(0, 0, 0, 0, 4, 20, 40, 101, 0, 0, 0, 0, 21, 51, 71, 202),
  }, tick).pixels);
  assert.deepEqual([0, 1, 2, 5, 1, 0].map(pixels), [
    [21, 51, 71, 202], [12, 35, 55, 202], [4, 20, 40, 101], [21, 51, 71, 202], [12, 35, 55, 202], [21, 51, 71, 202],
  ]);
  const third = { ...copy, frames: [[0, 3], [1, 3]] as typeof copy.frames };
  const lowValues = { width: 4, height: 1, data: Uint8ClampedArray.of(0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 3, 6, 9, 255) };
  assert.deepEqual(Array.from(samplePonderAtlasCopy(third, lowValues, 1).pixels), [0, 1, 2, 255]);
});

test('Ponder validates regional atlas coordinates on the base sampler only', () => {
  const image = `ponder/textures/${'b'.repeat(64)}.png`;
  const animation = `ponder/textures/${'c'.repeat(64)}.json`;
  const sampler = { image, minFilter: 9986, magFilter: 9728, wrapS: 33071, wrapT: 33071 };
  const left = [0, 0, .25, 1, 1, 1, .5, 0];
  const right = [.25, 0, .5, 1, 1, 1, -.25, 0];
  const atlasRegions = [left, right];
  const read = (textures: unknown) => readPonderFrame({ sceneToGui: matrix, overlay: [], captions: [], scene: [{
    mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 12, vertices: mesh, shader: 'rendertype_solid', textures,
    attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }], projection: matrix, modelView: matrix,
    textureMatrix: matrix, color: [1, 1, 1, 1], depthTest: true, depthFunction: 515, depthWrite: true, cull: false, blend: false,
  }] });
  const regional = { ...sampler, atlasRegions, animated: true };
  assert.deepEqual(read({ 0: regional })?.draws[0].textures[0], { ...regional, animation: undefined });
  for (const texture of [
    { ...regional, animation }, { ...regional, transition: { image, weight: .5 } }, { ...regional, atlasRegions: [] },
    { ...regional, atlasRegions: Array.from({ length: 17 }, () => left) }, { ...regional, atlasRegions: [left, left] },
    { ...regional, atlasRegions: [[0, 0, .1, 1, 0, 1, .5, 0]] },
    { ...regional, atlasRegions: [[0, 0, .1, 1, NaN, 1, .5, 0]] },
    { ...regional, atlasRegions: [[0, 0, .5, 1, 2, 1, .5, 0]] },
    { ...regional, atlasRegions: [[-.1, 0, .25, 1, 1, 1, .5, 0]] },
  ]) assert.equal(read({ 0: texture })?.omitted, 1);
  assert.equal(read({ 0: sampler, 1: regional })?.omitted, 1);
});

test('Ponder derives independent item scene order from the registered storyboards', () => {
  const tank = 'create:fluid_tank';
  const pipe = 'create:fluid_pipe';
  const storage = { ...scene, items: [tank, pipe], schematic: 'create:fluid_tank/storage' };
  const sizes = { ...scene, items: [tank, pipe], schematic: 'create:fluid_tank/sizes',
    manifest: `ponder/scenes/${'b'.repeat(64)}/scene.json` };
  const story = { id: scene.id, title: 'Demo', scale: 1, yOffset: 0, basePlateSize: 1,
    basePlateOffsetX: 0, basePlateOffsetZ: 0, hidePlatformShadow: false, text: {}, instructions: [] };
  const registration = (item: string, schematic: string) => ({ namespace: 'create', item, schematic,
    tags: [], ordering: [], scene: 0 });
  const definitions = {
    version: 1, locale: 'en_us', ticksPerSecond: 20, sceneDefinitions: [story],
    registrations: [registration(tank, storage.schematic), registration(pipe, sizes.schematic),
      registration(tank, storage.schematic), registration(tank, sizes.schematic), registration(pipe, storage.schematic)],
    playback: { ...index, scenes: [sizes, storage] },
  };
  assert.deepEqual(readPonderDefinitions(definitions)?.playback?.scenes, [
    { ...sizes, itemOrder: [1, 0] }, { ...storage, itemOrder: [0, 1] },
  ]);
});

test('Ponder publishes validated ZIP resources independently of WebCraft and preserves the previous revision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'capycraft-ponder-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = join(directory, 'storage');
  const archive = join(directory, 'previews.zip');
  const first = 'b'.repeat(64);
  const second = 'c'.repeat(64);
  const frame = ponderFramePath(scene, 0);
  const bytes = (data: unknown) => Buffer.from(JSON.stringify(data));
  const draw = {
    mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 12, vertices: mesh,
    attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }],
    shader: 'position', textures: {}, projection: matrix, modelView: matrix, textureMatrix: matrix,
    color: [1, 1, 1, 1], depthTest: true, depthFunction: 515, depthWrite: true, cull: false, blend: false,
  };
  const captured = { sceneToGui: matrix, scene: [draw], overlay: [], captions: [] };
  const files = {
    'format.txt': Buffer.from('webcraft-previews-v1/1.21.1'),
    'ponder/index.json': bytes(index),
    [manifest]: bytes({ width: 480, height: 320, ticksPerSecond: 20, frameCount: 1, keyframes: [],
      diffuseLights: [[0, 1, 0], [0, -1, 0]] }),
    [frame]: bytes(captured),
    [mesh]: vertexBytes,
  };
  await writeFile(archive, zipSync(files));
  const prepared = await preparePonderImport(archive, storage, first, first);
  assert.equal(prepared.hasCatalog, false);
  assert.equal(prepared.scenes, 1);

  const directories = new Map([['demo', storage], ['off', join(directory, 'off')]]);
  let handler = createPonder(directories);
  async function request(query: string, headers = {}) {
    let status = 200;
    let body: string | Buffer | undefined;
    const outgoing = new Headers();
    await handler({ url: '/api/ponder?' + query, method: 'GET', headers } as IncomingMessage, {
      setHeader(name: string, value: string | number) { outgoing.set(name, String(value)); },
      writeHead(code: number, headers: Record<string, string> = {}) {
        status = code;
        for (const [name, value] of Object.entries(headers)) outgoing.set(name, value);
        return this;
      },
      end(value?: string | Buffer) { body = value; },
    } as unknown as ServerResponse);
    return { status, body, headers: outgoing };
  }

  assert.equal((await request('server=demo')).status, 404);
  await prepared.publish();
  const catalog = await request('server=demo');
  assert.equal(catalog.headers.get('x-ponder-revision'), first);
  assert.equal(catalog.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(JSON.parse(String(catalog.body)), index);
  assert.equal((await request('server=demo', { 'if-none-match': catalog.headers.get('etag') })).status, 304);
  const resource = await request('server=demo&revision=' + first + '&path=' + encodeURIComponent(mesh));
  assert.deepEqual(resource.body, vertexBytes);
  assert.match(resource.headers.get('cache-control') ?? '', /immutable/);
  assert.equal((await request('server=off&revision=' + first + '&path=' + encodeURIComponent(mesh))).status, 404);
  assert.equal((await request('server=demo&revision=' + first + '&path=ponder%2F..%2Fsecret')).status, 400);

  await writeFile(archive, zipSync({ ...files, [mesh]: Buffer.alloc(48, 1) }));
  await assert.rejects(preparePonderImport(archive, storage, second, second), /checksum/);
  assert.equal((await request('server=demo')).headers.get('x-ponder-revision'), first);
  await writeFile(archive, zipSync({ ...files, [frame]: bytes({
    ...captured, scene: [{ ...draw, textureMatrix: undefined }],
  }) }));
  await assert.rejects(preparePonderImport(archive, storage, second, second), /Invalid Ponder frame/);
  assert.equal((await request('server=demo')).headers.get('x-ponder-revision'), first);
  await writeFile(archive, zipSync(files));
  const next = await preparePonderImport(archive, storage, second, second);
  await next.publish();
  assert.equal((await request('server=demo')).headers.get('x-ponder-revision'), second);
  assert.equal((await request('server=demo&revision=' + first + '&path=' + encodeURIComponent(frame))).status, 200);
  assert.equal((await request('server=demo&mode=guides')).status, 404);

  const definitionRevision = 'd'.repeat(64);
  const schematic = gzipSync(Buffer.from([10, 0, 0, 0]));
  const schematicFile = `ponder/schematics/${createHash('sha256').update(schematic).digest('hex')}.nbt`;
  const definitions = {
    version: 1, locale: 'en_us', ticksPerSecond: 20, registrations: [{
      namespace: 'create', item: 'create:demo', schematic: 'create:demo', tags: [], ordering: [], schematicFile,
      scene: {
        id: 'create:demo', title: 'Demo', scale: 1, yOffset: 0, basePlateSize: 1,
        basePlateOffsetX: 0, basePlateOffsetZ: 0, hidePlatformShadow: false, text: { text_1: 'A caption' },
        instructions: [{ type: 'TextInstruction', durationTicks: 20, blocking: false,
          caption: { text: 'A caption', color: -1, y: 0, nearTarget: false } }],
      },
    }],
  };
  const definitionFiles = {
    'format.txt': files['format.txt'],
    'ponder/definitions.json': bytes(definitions),
    [schematicFile]: schematic,
  };
  await writeFile(archive, zipSync({ ...definitionFiles, [schematicFile]: Buffer.from('invalid') }));
  await assert.rejects(preparePonderImport(archive, storage, definitionRevision, definitionRevision), /checksum/);
  assert.equal((await activePonder(storage))?.definitions, undefined);
  await writeFile(archive, zipSync(definitionFiles));
  const imported = await preparePonderImport(archive, storage, definitionRevision, definitionRevision);
  assert.equal(imported.hasCatalog, false);
  assert.equal(imported.definitions, 1);
  await imported.publish();
  assert.equal((await activePonder(storage))?.definitions?.revision, definitionRevision);
  assert.equal((await request('server=demo')).headers.get('x-ponder-revision'), second);
  const guideResponse = await request('server=demo&mode=guides');
  assert.equal(guideResponse.status, 200);
  assert.equal(guideResponse.headers.get('x-ponder-revision'), definitionRevision);
  assert.equal((await request('server=demo&mode=guides', { 'if-none-match': guideResponse.headers.get('etag') })).status, 304);
  const guides = readPonderGuideIndex(JSON.parse(String(guideResponse.body)));
  assert.ok(guides);
  assert.deepEqual(guides, [{ id: scene.id, title: 'Demo', schematic: scene.schematic, items: ['create:demo'], steps: ['A caption'] }]);
  assert.deepEqual(indexItemPonderChoices([], guides).get('create:demo'), guides);
  const rendered = { ...scene, items: ['create:demo'] };
  assert.deepEqual(indexItemPonderChoices([rendered], guides).get('create:demo'), [rendered]);
  assert.equal((await request('server=demo&mode=guides&mode=guides')).status, 400);
  assert.equal((await request('server=demo&revision=' + definitionRevision + '&path=' + encodeURIComponent(schematicFile))).status, 400);
  const duplicate = await preparePonderImport(archive, storage, definitionRevision, 'e'.repeat(64));
  assert.equal(duplicate.current, definitionRevision);
  await writeFile(archive, zipSync(files));
  const scenesAgain = await preparePonderImport(archive, storage, 'f'.repeat(64), 'f'.repeat(64));
  await scenesAgain.publish();
  assert.equal((await activePonder(storage))?.definitions?.revision, definitionRevision);

  const timelineRevision = '1'.repeat(64);
  const customItem = 'kubejs:custom_component';
  const customScene = { ...rendered, items: ['create:demo', customItem] };
  const customDefinition = { ...definitions.registrations[0], item: customItem, namespace: 'kubejs' };
  const timelineDefinitions = {
    ...definitions, registrations: [...definitions.registrations, customDefinition],
    playback: { ...index, scenes: [customScene] },
  };
  const sharedDefinitions = {
    ...timelineDefinitions,
    sceneDefinitions: [customDefinition.scene],
    registrations: timelineDefinitions.registrations.map(entry => ({ ...entry, scene: 0 })),
  };
  assert.deepEqual(readPonderDefinitions(sharedDefinitions), readPonderDefinitions(timelineDefinitions));
  assert.deepEqual(ponderGuides(sharedDefinitions), ponderGuides(timelineDefinitions));
  assert.equal(readPonderDefinitions({ ...sharedDefinitions, sceneDefinitions: [] }), undefined);
  const timelineDir = `ponder/scenes/${id}/timeline`;
  const blockDraw = { ...draw, shader: 'rendertype_solid' };
  const shadeDraw = { ...draw, shader: 'rendertype_gui' };
  const initialEvents = {
    blocks: [[0, 0, 0, 'minecraft:stone']],
    sections: { 0: { positions: [[0, 0, 0]], transform: matrix, fade: 1 } },
    effects: { 0: { kind: 'particle', type: 'example.Spark', bounds: [0, 0, 0, 1, 1, 1] },
      1: { kind: 'block_entity', type: 'create:shaft', position: [0, 0, 0], data: '{Speed:32f}' } },
  };
  const nextEvents = {
    sections: { 0: { transform: quarterTurn } }, effects: { 0: null, 1: { data: null, dataError: 'size_limit' } },
  };
  const timelineFiles = {
    ...definitionFiles, [mesh]: vertexBytes,
    'ponder/definitions.json': bytes(timelineDefinitions),
    [manifest]: bytes({ width: 480, height: 320, ticksPerSecond: 20, frameCount: 18, keyframes: [16],
      diffuseLights: [[0, 1, 0], [0, -1, 0]] }),
    [`${timelineDir}/0.json`]: bytes([
      { ...captured, scene: [blockDraw, shadeDraw], sceneTransform: null, events: initialEvents },
      { events: { blocks: [[3, 0, 0, 'minecraft:oak_log[axis=y]']], effects: { 0: { bounds: [1, 1, 1, 2, 2, 2] } } } },
      ...Array.from({ length: 14 }, () => ({})),
    ]),
    [`${timelineDir}/16.json`]: bytes([
      { sceneTransform: { blocks: quarterTurn, shadow: matrix }, events: nextEvents,
        captions: [{ text: 'KubeJS caption', color: -1, opacity: 1 }] },
      { sceneTransform: { blocks: quarterTurn, shadow: quarterTurn } },
    ]),
  };
  await writeFile(archive, zipSync({ ...timelineFiles, 'ponder/definitions.json': bytes({
    ...timelineDefinitions, playback: { ...index, scenes: [rendered] },
  }) }));
  await assert.rejects(preparePonderImport(archive, storage, timelineRevision, timelineRevision), /definitions index/);
  await writeFile(archive, zipSync({ ...timelineFiles, [`${timelineDir}/16.json`]: bytes([{ invalid: true }, {}]) }));
  await assert.rejects(preparePonderImport(archive, storage, timelineRevision, timelineRevision), /timeline patch/);
  await writeFile(archive, zipSync({ ...timelineFiles, [`${timelineDir}/16.json`]: bytes([{ events: {
    sections: { 10: { transform: matrix } },
  } }, {}]) }));
  await assert.rejects(preparePonderImport(archive, storage, timelineRevision, timelineRevision), /Invalid Ponder events/);
  assert.equal((await activePonder(storage))?.revision, 'f'.repeat(64));
  assert.equal((await activePonder(storage))?.definitions?.revision, definitionRevision);

  await writeFile(archive, zipSync(timelineFiles));
  const progressEvents: unknown[] = [];
  const converted = await preparePonderImport(archive, storage, timelineRevision, timelineRevision, undefined, {
    plan(plan: unknown) { progressEvents.push(plan); },
    start(stage: string, total: number) { progressEvents.push({ stage, total }); },
    advance(completed: number) { progressEvents.push({ completed }); },
  });
  assert.deepEqual(progressEvents, [
    { hasCatalog: false, writeScenes: true, writeDefinitions: true },
    { stage: 'ponder-scenes', total: 1 },
    { completed: 1 },
    { stage: 'ponder-definitions', total: 1 },
    { completed: 1 },
  ]);
  assert.equal(converted.scenes, 1);
  assert.equal(converted.definitions, 2);
  await converted.publish();
  const timelineIndex = await request('server=demo');
  const orderedScene = { ...customScene, itemOrder: [0, 0] };
  assert.deepEqual(readPonderIndex(JSON.parse(String(timelineIndex.body)))?.scenes, [orderedScene]);
  // Simulate an existing playback revision written before item order was published.
  await writeFile(join(storage, 'revisions', timelineRevision, 'ponder/index.json'), bytes(timelineDefinitions.playback));
  handler = createPonder(directories);
  const existingTimelineIndex = await request('server=demo', { 'if-none-match': `"${timelineRevision}"` });
  assert.equal(existingTimelineIndex.status, 200);
  assert.deepEqual(readPonderIndex(JSON.parse(String(existingTimelineIndex.body)))?.scenes, [orderedScene]);
  assert.equal((await request('server=demo', { 'if-none-match': existingTimelineIndex.headers.get('etag') })).status, 304);
  const publishedDefinitionsPath = join(storage, 'revisions', timelineRevision, 'ponder/definitions.json');
  await writeFile(publishedDefinitionsPath, '{');
  handler = createPonder(directories);
  const withoutOrdering = await request('server=demo');
  assert.equal(withoutOrdering.status, 200);
  assert.deepEqual(readPonderIndex(JSON.parse(String(withoutOrdering.body)))?.scenes, [customScene]);
  await writeFile(publishedDefinitionsPath, bytes(timelineDefinitions));
  handler = createPonder(directories);
  const path = (path: string) => 'server=demo&revision=' + timelineRevision + '&path=' + encodeURIComponent(path);
  const playback = readPonderManifest(JSON.parse(String((await request(path(manifest))).body)));
  assert.deepEqual(playback?.frameTicks, [0, 16, 17]);
  assert.deepEqual(playback?.keyframes, [16]);
  assert.deepEqual([0, 10, 15, 16, 17, 1].map(tick => ponderFrameTick(tick, playback?.frameTicks)), [0, 0, 0, 16, 17, 0]);
  const secondFrame = JSON.parse(String((await request(path(ponderFramePath(customScene, 16)))).body));
  assert.deepEqual(secondFrame.scene, [{ ...blockDraw, modelView: quarterTurn }, shadeDraw]);
  assert.equal(secondFrame.sceneTransform, undefined);
  assert.deepEqual(secondFrame.captions.map((caption: { text: string }) => caption.text), ['KubeJS caption']);
  const following = JSON.parse(String((await request(path(ponderFramePath(customScene, 17)))).body));
  assert.deepEqual(following.scene, [{ ...blockDraw, modelView: quarterTurn }, { ...shadeDraw, modelView: quarterTurn }]);
  assert.equal((await request(path(`${timelineDir}/0.json`))).status, 400);
  const eventPath = `ponder/scenes/${id}/events/16.json`;
  assert.deepEqual(JSON.parse(await readFile(join(storage, 'revisions', timelineRevision, eventPath), 'utf8')), [[16, nextEvents]]);
  assert.equal((await request(path(eventPath))).status, 400);
  assert.equal((await activePonder(storage))?.definitions?.revision, timelineRevision);

  const compactRevision = '2'.repeat(64);
  const vertices = Buffer.alloc(4 * 24);
  const sharedMesh = `ponder/meshes/${createHash('sha256').update(vertices).digest('hex')}.bin`;
  const pixels = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
  const image = `ponder/textures/${createHash('sha256').update(pixels).digest('hex')}.png`;
  const model = { shader: 'rendertype_solid', vertices: sharedMesh, vertexCount: 4, image };
  const onLeft = { transform: matrix, blocks: [[0, 0, 0, 0], [1, 0, 0, 0]] };
  const onRight = { transform: [...matrix.slice(0, 12), 2, ...matrix.slice(13)],
    blocks: [[1, 0, 0, 0], [2, 0, 0, 0, .125, .25, -.5]] };
  const caption = { text: 'Reusable blocks', color: -1, opacity: 1 };
  const outline = { position: [0, 0, 0], block: 'minecraft:stone', boxes: [[0, 0, 0, 1, 1, 1]] };
  const outlineA = bytes([{ transform: matrix, blocks: [outline, { ...outline, position: [1, 0, 0] }] }]);
  const outlineB = bytes([{ transform: onRight.transform, blocks: [{ ...outline, position: [2, 0, 0] }] }]);
  const pickingA = `ponder/picking/${createHash('sha256').update(outlineA).digest('hex')}.json`;
  const pickingB = `ponder/picking/${createHash('sha256').update(outlineB).digest('hex')}.json`;
  const movingPipe = { transform: quarterTurn, blocks: [[0, 0, 0, 0]], textureOffsets: [[0.25, 0.5]] };
  const compactFiles = {
    ...definitionFiles, [sharedMesh]: vertices, [image]: pixels, [pickingA]: outlineA, [pickingB]: outlineB,
    'ponder/definitions.json': bytes(sharedDefinitions),
    [ponderBlockModelsPath]: bytes({ version: 1, models: [[model]] }),
    [manifest]: bytes({ width: 480, height: 320, ticksPerSecond: 20, frameCount: 66, keyframes: [],
      blockModels: ponderBlockModelsPath, diffuseLights: [[0, 1, 0], [0, -1, 0]] }),
    [`${timelineDir}/0.json`]: bytes({ version: 4, transforms: [{ a: [0] }], patches: [
      { ...captured, scene: [], layout: [[0, onLeft.blocks]], captions: [caption], picking: pickingA },
      { layout: { length: 1, edits: [[0, [{ d: [4096, 2] }, onRight.blocks]]] },
        movingLayout: [[movingPipe.transform, movingPipe.blocks, movingPipe.textureOffsets]], picking: pickingB },
      ...Array.from({ length: 14 }, () => ({})),
    ] }),
    [`${timelineDir}/16.json`]: bytes([{}, { captions: [] }, ...Array.from({ length: 14 }, () => ({}))]),
    [`${timelineDir}/32.json`]: bytes(Array.from({ length: 16 }, () => ({}))),
    [`${timelineDir}/48.json`]: bytes(Array.from({ length: 16 }, () => ({}))),
    [`${timelineDir}/64.json`]: bytes([{}, {}]),
  };
  await writeFile(archive, zipSync({ ...compactFiles, [`${timelineDir}/64.json`]: bytes([
    { movingLayout: [{ transform: matrix, blocks: [[0, 0, 0, 1]] }] }, {},
  ]) }));
  await assert.rejects(preparePonderImport(archive, storage, compactRevision, compactRevision), /Invalid Ponder moving layout/);
  await writeFile(archive, zipSync(compactFiles));
  const compact = await preparePonderImport(archive, storage, compactRevision, compactRevision);
  assert.equal(compact.scenes, 1);
  await compact.publish();
  const readCompact = async (path: string) => {
    const result = await request('server=demo&revision=' + compactRevision + '&path=' + encodeURIComponent(path));
    assert.equal(result.status, 200);
    return JSON.parse(String(result.body));
  };
  assert.equal((await readCompact(manifest)).blockModels, ponderBlockModelsPath);
  assert.equal((await readCompact(manifest)).layoutChunks, true);
  const firstChunk = readPonderTimelinePatches(await readCompact(ponderPlaybackPath(customScene, 0)), 16)!;
  assert.deepEqual(firstChunk[1], { layout: [onRight], movingLayout: [movingPipe] });
  assert.deepEqual(firstChunk[15], {});
  assert.deepEqual(readPonderTimelinePatches(await readCompact(ponderPlaybackPath(customScene, 16)), 16)?.[0].layout, [onRight]);
  assert.equal((await request('server=demo&revision=' + compactRevision + '&path=' +
    encodeURIComponent(ponderFramePath(customScene, 0)))).status, 404);
  assert.equal(ponderResource(ponderPlaybackPath(customScene, 1)), undefined);
  const palette = readPonderBlockModels(await readCompact(ponderBlockModelsPath));
  assert.ok(palette);
  const fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const query = new URL(url, 'http://localhost').searchParams;
    fetched.push(query.get('path')!);
    const { body, headers, status } = await request(query.toString());
    assert.equal(headers.get('cache-control'), 'public, max-age=31536000, immutable');
    return new Response(Buffer.isBuffer(body) ? new Uint8Array(body) : body, { headers: Object.fromEntries(headers), status });
  });
  const source = createPonderSource('demo', customScene, new AbortController().signal, compactRevision);
  assert.equal((await source.manifest()).layoutChunks, true);
  for (const tick of [16, 17, 0, 1, 15, 16]) {
    const composed = await source.frame(tick);
    const x = tick === 0 ? 0 : 3;
    assert.deepEqual(composed.draws.map(draw => draw.vertices), tick === 0 ? [sharedMesh, sharedMesh] : [sharedMesh, sharedMesh, sharedMesh]);
    assert.deepEqual(composed.draws.map(draw => draw.modelView[12]), tick === 0 ? [x, x + 1] : [x, x + 1.125, 3]);
    if (tick !== 0) assert.deepEqual(composed.draws[2].textureMatrix.slice(12, 14), Float32Array.of(0.25, 0.5));
    assert.equal(composed.captions[0]?.text, tick === 17 ? undefined : caption.text);
  }
  assert.equal(await source.frame(1), await source.frame(15));
  assert.deepEqual(fetched, [manifest, ponderBlockModelsPath, ponderPlaybackPath(customScene, 16), ponderPlaybackPath(customScene, 0)]);
  const pickingChunk = ponderPickingChunkPath(customScene, 0);
  const nextPickingChunk = ponderPickingChunkPath(customScene, 64);
  assert.equal((await source.frame(0)).picking, pickingChunk);
  assert.equal((await source.frame(64)).picking, nextPickingChunk);
  const initialPicking = await source.picking(pickingChunk, 0);
  const movedPicking = await source.picking(pickingChunk, 15);
  assert.deepEqual(initialPicking, readPonderPicking(JSON.parse(outlineA.toString())));
  assert.deepEqual(movedPicking, readPonderPicking(JSON.parse(outlineB.toString())));
  assert.ok(initialPicking && movedPicking);
  const initialCamera = (await source.frame(0)).sceneToGui;
  const movedCamera = (await source.frame(15)).sceneToGui;
  assert.deepEqual(pickPonderBlock(initialCamera, initialPicking, 0.5, 0.5)?.position, [0, 0, 0]);
  assert.equal(pickPonderBlock(movedCamera, movedPicking, 0.5, 0.5), undefined);
  assert.deepEqual(pickPonderBlock(movedCamera, movedPicking, 4.5, 0.5)?.position, [2, 0, 0]);
  assert.deepEqual(await source.picking(nextPickingChunk, 65), readPonderPicking(JSON.parse(outlineB.toString())));
  assert.deepEqual(fetched.filter(path => ponderResource(path)?.kind === 'picking-chunk'), [pickingChunk, nextPickingChunk]);
  const pickingDocument = await readCompact(pickingChunk);
  assert.equal(pickingDocument.shapes.length, 1);
  assert.deepEqual(pickingDocument.frames.map((entry: unknown[]) => entry[0]), [0, 1]);
  assert.equal((await request('server=demo&revision=' + compactRevision + '&path=' + encodeURIComponent(pickingA))).status, 404);
  const nextRevision = '3'.repeat(64);
  assert.equal((await preparePonderImport(archive, storage, compactRevision, nextRevision)).current, compactRevision);
  const activeFile = join(storage, 'active.json');
  const oldPointer = JSON.parse(await readFile(activeFile, 'utf8'));
  delete oldPointer.pickingChunks;
  await writeFile(activeFile, JSON.stringify(oldPointer));
  const convertedCompact = await preparePonderImport(archive, storage, compactRevision, nextRevision);
  assert.equal(convertedCompact.scenes, 1);
  assert.equal(convertedCompact.definitions, undefined);
  await convertedCompact.publish();
  assert.equal((await activePonder(storage))?.previous, compactRevision);
  assert.equal((await activePonder(storage))?.pickingChunks, true);
  assert.equal(readPonderCompactLayout([{ ...onLeft, blocks: [[0, 0, 0, 1]] }], palette.models), undefined);
  assert.equal(readPonderCompactLayout([{ ...movingPipe, textureOffsets: [] }], palette.models), undefined);

  const bundlePath = `ponder/scenes/${id}/meshes/0.bin`;
  const anotherMesh = Buffer.alloc(vertexBytes.length, 0xfe);
  const slicePath = `${bundlePath}#0:${vertexBytes.length}:${createHash('sha256').update(vertexBytes).digest('hex')}`;
  const secondSlice = `${bundlePath}#${vertexBytes.length}:${anotherMesh.length}:${createHash('sha256').update(anotherMesh).digest('hex')}`;
  const hash = (input: Uint8Array) => createHash('sha256').update(input).digest('hex');
  const streamed = Buffer.from(Array.from({ length: 28 * 4 }, (_, i) => i));
  const words = [0, 0x80000000, 0x3f800000];
  const indices = [0, 1, 2, 1, 2, 1, 0, 2, 0, 2, 2, 1];
  indices.forEach((word, index) => streamed.writeUInt32LE(words[word], Math.floor(index / 3) * 28 + index % 3 * 4));
  const planes = (from: number, to: number) => Buffer.from(Array.from({ length: (to - from) * 4 },
    (_, i) => streamed[(i % 4) * 28 + from + Math.floor(i / 4)]));
  const positions = Buffer.from([4, 3, 0, ...words.flatMap(word => [word & 255, word >>> 8 & 255, word >>> 16 & 255, word >>> 24]), ...indices]);
  const otherAttributes = [planes(12, 16), planes(16, 24), planes(24, 28)];
  const streamRef = `ponder/meshes/${hash(streamed)}.bin#v2:28:4:e:${hash(positions)}:${positions.length}:${otherAttributes.map(hash).join(':')}`;
  const streamedDraw = { ...draw, stride: 28, vertices: streamRef };
  const particles = scaledParticleFixture();
  const particleOffset = vertexBytes.length + anotherMesh.length;
  const particlePath = `${bundlePath}#${particleOffset}:${particles.encoded.length}:${hash(particles.encoded)}:particle-quads/v4`;
  const particleDraw = { ...draw, shader: 'particle', stride: 28, vertices: particlePath, vertexCount: 12, indexCount: 18,
    textures: { 0: { image, minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } },
    attributes: [
      { name: 'Position', offset: 0, type: 'FLOAT', count: 3 },
      { name: 'UV0', offset: 12, type: 'FLOAT', count: 2 },
      { name: 'Color', offset: 20, type: 'UBYTE', count: 4 },
      { name: 'UV2', offset: 24, type: 'SHORT', count: 2 },
    ] };
  const rigid = rigidFixture();
  const rigidPath = `${bundlePath}#${particleOffset + particles.encoded.length}:${rigid.batch.length}:${hash(rigid.batch)}:rigid-batches/v1`;
  const bundle = Buffer.concat([vertexBytes, anotherMesh, particles.encoded, rigid.batch]);
  const variedRigid = variedRigidFixture();
  const variedRigidPath = `ponder/rigid-batches/v2/${hash(variedRigid.batch)}.bin`;
  const sparseRigid = sparseRigidFixture(rigid.batch);
  const sparseRigidPath = `ponder/rigid-batches/v5/${hash(sparseRigid)}.bin`;
  const outlineBytes = outlineFixture();
  const outlinePath = `ponder/outline-cuboids/v1/${hash(outlineBytes)}.bin`;
  const box = boxFaceFixture();
  const boxPath = `ponder/box-faces/v1/${hash(box.faces)}.bin`;
  const chain = chainFaceFixture();
  const chainOffset = bundle.length;
  const chainPath = `${bundlePath}#${chainOffset}:${chain.faces.length}:${hash(chain.faces)}:box-faces/v2`;
  const lightning = Buffer.alloc(58);
  lightning.writeUInt16LE(1);
  lightning.writeBigUInt64LE(0x923456789n, 2);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 4, 5].forEach((value, lane) => lightning.writeFloatLE(value, 10 + lane * 4));
  const lightningPath = `ponder/lightning/v1/${hash(lightning)}.bin`;
  const lightningSlice = `${bundlePath}#${chainOffset + chain.faces.length}:${lightning.length}:${hash(lightning)}:lightning/v1`;
  const mixedBox = mixedBoxFaceFixture();
  const mixedBoxPath = `ponder/box-faces/v3/${hash(mixedBox.mixed)}.bin`;
  const mixedBoxOffset = chainOffset + chain.faces.length + lightning.length;
  const mixedBoxSlice = `${bundlePath}#${mixedBoxOffset}:${mixedBox.mixed.length}:${hash(mixedBox.mixed)}:box-faces/v3`;
  assert.match(compressPonderBundleRef(mixedBoxSlice, bundlePath), /^~f:/);
  const mixedBoxIndices = Buffer.alloc(18 * 2);
  [4, 5, 6, 6, 7, 4, 0, 1, 2, 2, 3, 0, 8, 9, 10, 10, 11, 8]
    .forEach((value, index) => mixedBoxIndices.writeUInt16LE(value, index * 2));
  const mixedBoxOrder = `ponder/meshes/${hash(mixedBoxIndices)}.bin`;
  const lightningIndices = Buffer.alloc(1344 * 2);
  for (let quad = 0; quad < 224; quad++) {
    [0, 1, 2, 2, 3, 0].forEach((lane, index) => lightningIndices.writeUInt16LE((223 - quad) * 4 + lane, (quad * 6 + index) * 2));
  }
  const lightningOrder = `ponder/meshes/${hash(lightningIndices)}.bin`;
  const sodium = sodiumRigidFixture();
  const sodiumPath = `ponder/rigid-batches/v3/${hash(sodium.batch)}.bin`;
  const normalPalette = variedNormalFixture();
  const normalPalettePath = `ponder/rigid-batches/v4/${hash(normalPalette.batch)}.bin`;
  const mixedRigid = mixedRigidBoxFixture(normalPalette.batch, 4, normalPalette.vertices);
  const mixedRigidPath = `ponder/box-faces/v4/${hash(mixedRigid.mixed)}.bin`;
  const mixedRigidOffset = mixedBoxOffset + mixedBox.mixed.length;
  const mixedRigidSlice = `${bundlePath}#${mixedRigidOffset}:${mixedRigid.mixed.length}:${hash(mixedRigid.mixed)}:box-faces/v4`;
  assert.match(compressPonderBundleRef(mixedRigidSlice, bundlePath), /^~g:/);
  const mixedRigidIndices = Buffer.alloc(30 * 2);
  for (const [index, quad] of [1, 0, 3, 2, 4].entries()) {
    [0, 1, 2, 2, 3, 0].forEach((lane, vertex) => mixedRigidIndices.writeUInt16LE(quad * 4 + lane, (index * 6 + vertex) * 2));
  }
  const mixedRigidOrder = `ponder/meshes/${hash(mixedRigidIndices)}.bin`;
  const foil = glintFixture();
  const foilPath = `ponder/rigid-glint/v1/${hash(foil.batch)}.bin`;
  const order = Buffer.from([4, 0, 5, 0, 6, 0, 6, 0, 7, 0, 4, 0, 0, 0, 1, 0, 2, 0, 2, 0, 3, 0, 0, 0]);
  const orderPath = `ponder/meshes/${hash(order)}.bin`;
  const rigidDraw = {
    ...draw, shader: 'rendertype_entity_translucent_cull', stride: 36, vertices: rigidPath,
    vertexCount: 8, indexCount: 12, indices: orderPath, indexType: 'SHORT',
    textures: particleDraw.textures,
    attributes: [
      { name: 'Position', offset: 0, type: 'FLOAT', count: 3 },
      { name: 'Color', offset: 12, type: 'UBYTE', count: 4 },
      { name: 'UV0', offset: 16, type: 'FLOAT', count: 2 },
      { name: 'UV1', offset: 24, type: 'SHORT', count: 2 },
      { name: 'UV2', offset: 28, type: 'SHORT', count: 2 },
      { name: 'Normal', offset: 32, type: 'BYTE', count: 3 },
    ],
  };
  const outlineDraw = { ...rigidDraw, shader: 'rendertype_entity_solid', vertices: outlinePath,
    vertexCount: 24, indexCount: 36, indices: undefined, indexType: undefined };
  const shadowDraw = { ...rigidDraw, shader: 'rendertype_entity_no_outline', vertices: boxPath };
  const mixedBoxDraw = { ...rigidDraw, vertices: mixedBoxPath, vertexCount: 12, indexCount: 18, indices: mixedBoxOrder };
  const mixedRigidDraw = { ...rigidDraw, vertices: mixedRigidPath, vertexCount: 20, indexCount: 30, indices: mixedRigidOrder };
  const chainDraw = { ...rigidDraw, shader: 'rendertype_cutout_mipped', stride: 32, vertices: chainPath,
    attributes: rigidDraw.attributes.filter(attribute => attribute.name !== 'UV1')
      .map(attribute => attribute.offset >= 28 ? { ...attribute, offset: attribute.offset - 4 } : attribute) };
  const lightningDraw = { ...draw, shader: 'rendertype_lightning', stride: 16, vertices: lightningPath,
    vertexCount: 896, indexCount: 1344, indices: lightningOrder, indexType: 'SHORT', attributes: [draw.attributes[0],
      { name: 'Color', offset: 12, type: 'UBYTE', count: 4 }] };
  const sodiumDraw = { ...outlineDraw, vertices: sodiumPath, vertexCount: 4, indexCount: 6 };
  const largePixels = await sharp({ create: { width: 2050, height: 2, channels: 4, background: '#3791ac' } }).png().toBuffer();
  const largeImage = `ponder/textures/${hash(largePixels)}.png`;
  const atlasRegions = [[.125, .125, .25, .5, 1, 1, .125, 0]];
  const foilDraw = { ...rigidDraw, shader: 'rendertype_glint', vertices: foilPath, stride: 20,
    textures: { 0: { ...particleDraw.textures[0], image: largeImage, atlasRegions } },
    indices: undefined, indexType: undefined, attributes: [
      { name: 'Position', offset: 0, type: 'FLOAT', count: 3 },
      { name: 'UV0', offset: 12, type: 'FLOAT', count: 2 },
    ] };
  const animatedPixels = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ab5309' } }).png().toBuffer();
  const animatedImage = `ponder/textures/${hash(animatedPixels)}.png`;
  const sheetPixels = await sharp({ create: { width: 2, height: 4, channels: 4, background: '#bd632c' } }).png().toBuffer();
  const sheetImage = `ponder/textures/${hash(sheetPixels)}.png`;
  const atlasRows = bytes([{ image: sheetImage, frames: [[1, 2], [0, 4]], rect: [1, 0, 1, 2], source: [1, 0, 2, 2], interpolate: true }]);
  const atlasAnimation = `ponder/textures/${hash(atlasRows)}.json`;
  const animatedParticle = { ...particleDraw, textures: { ...particleDraw.textures,
    0: { ...particleDraw.textures[0], atlasAnimation } } };
  const fluidFace = { geometry: [1, 0, 0, 1, 1, 0.72, 1, 0.01, 0xf000f0],
    tint: -1, transform: matrix, image, lightmap: image, spriteAnimation: 0 };
  const sprite = { frames: [[image, 2], [animatedImage, 3]], interpolate: true };
  assert.equal(readPonderFluidFaces([fluidFace]), undefined);
  assert.ok(readPonderFluidFaces([{ ...fluidFace, spriteAnimation: undefined, ...sprite }]));
  const animatedModel = { ...model, spriteAnimation: 0, liquid: true };
  const sortedFace = { ...animatedModel, shader: 'rendertype_translucent', liquidCenter: [0.5, 0.25, 0.001] };
  const atlasModel = { ...model, atlasAnimation };
  assert.ok(readPonderBlockModels({ version: 1, models: [[{ ...model, ...sprite }]] }));
  assert.equal(readPonderBlockModels({ version: 1, models: [[animatedModel]] }), undefined);
  assert.equal(readPonderBlockModels({ version: 1, models: [[{ ...animatedModel, ...sprite }]],
    spriteAnimations: [sprite] }), undefined);
  assert.equal(readPonderBlockModels({ version: 1, models: [[{ ...animatedModel, atlasAnimation }]],
    spriteAnimations: [sprite] }), undefined);
  assert.equal(readPonderBlockModels({ version: 1, models: [[{ ...model, atlasAnimation: image }]] }), undefined);
  for (const invalid of [{ ...sortedFace, liquidCenter: [0, 0, -1] }, { ...sortedFace, liquid: undefined }]) {
    assert.equal(readPonderBlockModels({ version: 1, models: [[invalid]], spriteAnimations: [sprite] }), undefined);
  }
  const rotatedLayout = { ...onLeft,
    transform: [0.866025, 0.5, 0, 0, -0.5, 0.866025, 0, 0, 0, 0, 1, 0, -2.345678, 0, 0, 1] };
  const movingAtlas = { ...rotatedLayout, blocks: [[1, 0, 0, 2]] };
  const movedAtlas = { ...movingAtlas, transform: [...movingAtlas.transform.slice(0, 12), -1.234567, 0, 0, 1] };
  const rotatedChunk = encodePonderTimelinePatches([
    { layout: [rotatedLayout], movingLayout: [movingAtlas] },
    { captions: [caption], movingLayout: [movedAtlas] },
    ...Array.from({ length: 14 }, () => ({})),
  ]);
  assert.equal(JSON.parse(rotatedChunk).version, 10);
  const packedFiles: Record<string, Uint8Array> = {
    ...compactFiles,
    [ponderBlockModelsPath]: bytes({ version: 1, models: [[animatedModel], [sortedFace], [atlasModel]], spriteAnimations: [sprite] }),
    [bundlePath]: Buffer.concat([bundle, chain.faces, lightning, mixedBox.mixed, mixedRigid.mixed]),
    [`ponder/meshes/${hash(positions)}.bin`]: positions,
    ...Object.fromEntries(otherAttributes.map(value => [`ponder/meshes/${hash(value)}.bin`, value])),
    [rigid.partPath]: rigid.part,
    [variedRigidPath]: variedRigid.batch,
    [sparseRigidPath]: sparseRigid,
    [variedRigid.attributePath]: variedRigid.attributes,
    [outlinePath]: outlineBytes,
    [boxPath]: box.faces,
    [mixedBoxPath]: mixedBox.mixed,
    [mixedBoxOrder]: mixedBoxIndices,
    [mixedRigidPath]: mixedRigid.mixed,
    [mixedRigidOrder]: mixedRigidIndices,
    [sodiumPath]: sodium.batch,
    [sodium.partPath]: sodium.part,
    [normalPalettePath]: normalPalette.batch,
    [normalPalette.partPath]: normalPalette.part,
    [normalPalette.normalPath]: normalPalette.normals,
    [foilPath]: foil.batch,
    [orderPath]: order,
    [lightningPath]: lightning,
    [lightningOrder]: lightningIndices,
    [animatedImage]: animatedPixels,
    [atlasAnimation]: atlasRows,
    [sheetImage]: sheetPixels,
    [largeImage]: largePixels,
    [pickingChunk]: bytes(pickingDocument),
    [nextPickingChunk]: bytes(await readCompact(nextPickingChunk)),
    [`${timelineDir}/0.json`]: Buffer.from(encodePonderTimelinePatches([
      { ...captured, scene: [{ ...draw, vertices: slicePath }, { ...draw, vertices: secondSlice }, streamedDraw, animatedParticle,
        rigidDraw, { ...rigidDraw, vertices: variedRigidPath }, { ...rigidDraw, vertices: sparseRigidPath },
        outlineDraw, sodiumDraw, { ...rigidDraw, vertices: normalPalettePath },
        foilDraw, { ...rigidDraw, vertices: boxPath }, shadowDraw, chainDraw, lightningDraw, { ...lightningDraw, vertices: lightningSlice },
        mixedBoxDraw, { ...mixedBoxDraw, vertices: mixedBoxSlice }, mixedRigidDraw, { ...mixedRigidDraw, vertices: mixedRigidSlice }],
        layout: [onLeft, { transform: matrix, blocks: [[2, 0, 0, 2]] }], picking: pickingChunk, fluidFaces: [fluidFace] },
      ...Array.from({ length: 15 }, () => ({})),
    ], bundlePath)),
    [`${timelineDir}/16.json`]: Buffer.from(rotatedChunk),
    [`${timelineDir}/64.json`]: bytes([{ picking: nextPickingChunk }, {}]),
  };
  delete packedFiles[pickingA];
  delete packedFiles[pickingB];
  const latestRevision = '4'.repeat(64);
  for (const [rect, frames, error] of [
    [[2, 0, 1, 2], [[1, 2], [0, 4]], /extends outside its texture/],
    [[1, 0, 1, 2], [[2, 2], [0, 4]], /Invalid Ponder atlas animation sheet/],
  ] as const) {
    const invalidRows = bytes([{ image: sheetImage, frames, rect, source: [1, 0, 2, 2] }]);
    const invalidAtlas = `ponder/textures/${hash(invalidRows)}.json`;
    await writeFile(archive, zipSync({ ...packedFiles, [invalidAtlas]: invalidRows, [`${timelineDir}/0.json`]: bytes([
      { ...captured, scene: [{ ...animatedParticle, textures: { 0: { ...animatedParticle.textures[0], atlasAnimation: invalidAtlas } } }],
        layout: [onLeft], picking: pickingChunk }, ...Array.from({ length: 15 }, () => ({})),
    ]) }));
    await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), error);
  }
  await writeFile(archive, zipSync({ ...packedFiles, [bundlePath]: Buffer.alloc(bundle.length, 0xfa) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /invalid checksum or range/);
  const crossSceneRigid = rigidPath.replace(`/scenes/${id}/`, `/scenes/${'b'.repeat(64)}/`);
  await writeFile(archive, zipSync({ ...packedFiles, [`${timelineDir}/0.json`]: bytes([
    { ...captured, scene: [{ ...rigidDraw, vertices: crossSceneRigid }], layout: [onLeft], picking: pickingChunk },
    ...Array.from({ length: 15 }, () => ({})),
  ]) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /belongs to another scene/);
  const invalidStreamRef = streamRef.replace(hash(streamed), 'f'.repeat(64));
  await writeFile(archive, zipSync({ ...packedFiles, [`${timelineDir}/0.json`]: bytes([
    { ...captured, scene: [{ ...streamedDraw, vertices: invalidStreamRef }], layout: [onLeft], picking: pickingChunk },
    ...Array.from({ length: 15 }, () => ({})),
  ]) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /mesh stream checksum/);
  await writeFile(archive, zipSync({ ...packedFiles, [`${timelineDir}/64.json`]: bytes([{ picking: pickingChunk }, {}]) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /Invalid Ponder picking chunk reference/);
  await writeFile(archive, zipSync({ ...packedFiles, [`${timelineDir}/16.json`]: bytes([
    {}, { scene: [{ ...lightningDraw, vertexCount: 1792, indexCount: 2688 }] }, ...Array.from({ length: 14 }, () => ({})),
  ]) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /Invalid Ponder lightning draw/);
  const missingMixedPart = Buffer.from(mixedRigid.mixed);
  missingMixedPart.fill(0xfa, mixedRigid.rigidStart + 9, mixedRigid.rigidStart + 41);
  const missingMixedPath = `ponder/box-faces/v4/${hash(missingMixedPart)}.bin`;
  await writeFile(archive, zipSync({ ...packedFiles, [missingMixedPath]: missingMixedPart,
    [`${timelineDir}/0.json`]: bytes([
      { ...captured, scene: [{ ...mixedRigidDraw, vertices: missingMixedPath }], layout: [onLeft], picking: pickingChunk },
      ...Array.from({ length: 15 }, () => ({})),
    ]) }));
  await assert.rejects(preparePonderImport(archive, storage, latestRevision, latestRevision), /rigid-parts\/v1\/fa/);
  assert.equal((await activePonder(storage))?.revision, nextRevision);
  await writeFile(archive, zipSync(packedFiles));
  const streamParts = [positions, ...otherAttributes].map(data => `ponder/meshes/${hash(data)}.bin`);
  const zipReads = t.mock.method(yauzl.ZipFile.prototype, 'openReadStreamPromise');
  await (await preparePonderImport(archive, storage, latestRevision, latestRevision)).publish();
  const openedEntries = zipReads.mock.calls.map(call => call.arguments[0].fileName);
  zipReads.mock.restore();
  for (const path of streamParts) assert.equal(openedEntries.filter(name => name === path).length, 1);
  const bodyOfBundle = await request('server=demo&revision=' + latestRevision + '&path=' + encodeURIComponent(bundlePath));
  assert.equal(bodyOfBundle.status, 200);
  assert.deepEqual(bodyOfBundle.body, Buffer.concat([bundle, chain.faces, lightning, mixedBox.mixed, mixedRigid.mixed]));
  assert.equal((await request('server=demo&revision=' + latestRevision + '&path=' + encodeURIComponent(slicePath))).status, 400);
  assert.equal((await request('server=demo&revision=' + latestRevision + '&path=' + encodeURIComponent(rigidPath))).status, 400);
  const packedSource = createPonderSource('demo', customScene, new AbortController().signal, latestRevision);
  await packedSource.manifest();
  const publishedModels = readPonderBlockModels(JSON.parse(new TextDecoder().decode(
    await packedSource.asset(ponderBlockModelsPath))));
  assert.equal(publishedModels?.models[0][0].liquid, true);
  assert.deepEqual(publishedModels?.models[1][0].liquidCenter, sortedFace.liquidCenter);
  const withSlices = await packedSource.frame(0);
  assert.ok(withSlices.draws.some(draw => draw.vertices === sharedMesh && draw.textures[0].atlasAnimation === atlasAnimation));
  assert.equal(withSlices.draws.find(draw => draw.vertices === particlePath)?.textures[0].atlasAnimation, atlasAnimation);
  assert.deepEqual(Buffer.from(await packedSource.asset(atlasAnimation)), atlasRows);
  assert.deepEqual(Buffer.from(await packedSource.asset(sheetImage)), sheetPixels);
  assert.deepEqual(withSlices.draws.slice(-21, -1).map(draw => draw.vertices),
    [slicePath, secondSlice, streamRef, particlePath, rigidPath, variedRigidPath, sparseRigidPath, outlinePath, sodiumPath,
      normalPalettePath, foilPath, boxPath, boxPath, chainPath, lightningPath, lightningSlice, mixedBoxPath, mixedBoxSlice,
      mixedRigidPath, mixedRigidSlice]);
  const regionTexture = withSlices.draws.find(draw => draw.vertices === foilPath)!.textures[0];
  const normalizedImage = regionTexture.image;
  assert.notEqual(normalizedImage, largeImage);
  assert.deepEqual(regionTexture.atlasRegions, atlasRegions);
  assert.equal((await sharp(Buffer.from(await packedSource.asset(normalizedImage))).metadata()).width, 2048);
  for (const tick of [17, 16, 65]) {
    const restored = await packedSource.frame(tick);
    assert.equal(restored.draws.find(draw => draw.vertices === foilPath)?.textures[0].image, normalizedImage);
    assert.equal(restored.captions[0]?.text, tick === 16 ? undefined : caption.text);
  }
  assert.notDeepEqual((await packedSource.frame(16)).draws.find(draw => draw.vertices === sharedMesh && draw.textures[0].atlasAnimation)?.modelView,
    (await packedSource.frame(17)).draws.find(draw => draw.vertices === sharedMesh && draw.textures[0].atlasAnimation)?.modelView);
  const secondChunk = await request('server=demo&revision=' + latestRevision + '&path=' + encodeURIComponent(ponderPlaybackPath(customScene, 16)));
  assert.equal(secondChunk.status, 200);
  const secondChunkPatches = readPonderTimelinePatches(JSON.parse(String(secondChunk.body)), 16, ponderMeshBundlePath(customScene, 16));
  assert.deepEqual(secondChunkPatches?.[0].layout, [rotatedLayout]);
  assert.deepEqual(secondChunkPatches?.[1], { captions: [caption], movingLayout: [movedAtlas] });
  const fluidDraw = withSlices.draws.at(-1)!;
  assert.ok(ponderFluidMesh(fluidDraw.vertices));
  assert.equal(fluidDraw.textures[0].image, image);
  const between = await packedSource.frame(1);
  assert.deepEqual(between.draws.at(-1)?.textures[0].transition, { image: animatedImage, weight: .5 });
  assert.deepEqual(between.draws.find(draw => draw.vertices === sharedMesh)?.textures[0].transition,
    { image: animatedImage, weight: .5 });
  const animatedFrame = await packedSource.frame(2);
  const nextFluidDraw = animatedFrame.draws.at(-1)!;
  assert.equal(nextFluidDraw.textures[0].image, animatedImage);
  assert.equal(nextFluidDraw.textures[0].transition, undefined);
  assert.equal(animatedFrame.draws.find(draw => draw.vertices === sharedMesh)?.textures[0].image, animatedImage);
  assert.equal(nextFluidDraw.vertices, fluidDraw.vertices);
  assert.deepEqual(Buffer.from(await packedSource.asset(animatedImage)), animatedPixels);
  assert.equal((await packedSource.frame(5)).draws.at(-1)?.textures[0].image, image);
  assert.equal((await packedSource.frame(0)).draws.at(-1)?.textures[0].image, image);
  assert.equal((await packedSource.asset(fluidDraw.vertices)).byteLength, 4 * 24);
  assert.equal(fetched.includes(fluidDraw.vertices), false);
  assert.deepEqual(Buffer.from(await packedSource.asset(particlePath)), particles.vertices);
  assert.equal(withSlices.draws.find(draw => draw.vertices === rigidPath)?.indices, orderPath);
  assert.deepEqual(Buffer.from(await packedSource.asset(rigidPath)), rigid.vertices);
  assert.deepEqual(Buffer.from(await packedSource.asset(variedRigidPath)), variedRigid.vertices);
  assert.deepEqual(Buffer.from(await packedSource.asset(sparseRigidPath)), rigid.vertices);
  assert.deepEqual(await packedSource.asset(outlinePath), buildPonderOutlineVertices(outlineBytes));
  assert.equal(withSlices.draws.find(draw => draw.vertices === boxPath)?.indices, orderPath);
  assert.equal(withSlices.draws.find(draw => draw.shader === shadowDraw.shader)?.indices, orderPath);
  assert.deepEqual(Buffer.from(await packedSource.asset(boxPath)), box.expected);
  for (const path of [mixedBoxPath, mixedBoxSlice]) {
    assert.equal(withSlices.draws.find(draw => draw.vertices === path)?.indices, mixedBoxOrder);
    assert.deepEqual(Buffer.from(await packedSource.asset(path)), mixedBox.expected);
  }
  assert.deepEqual(Buffer.from(await packedSource.asset(mixedBoxOrder)), mixedBoxIndices);
  for (const path of [mixedRigidPath, mixedRigidSlice]) {
    assert.equal(withSlices.draws.find(draw => draw.vertices === path)?.indices, mixedRigidOrder);
    assert.deepEqual(Buffer.from(await packedSource.asset(path)), mixedRigid.expected);
  }
  assert.deepEqual(Buffer.from(await packedSource.asset(mixedRigidOrder)), mixedRigidIndices);
  assert.equal(withSlices.draws.find(draw => draw.vertices === chainPath)?.indices, orderPath);
  assert.deepEqual(Buffer.from(await packedSource.asset(chainPath)), chain.vertices);
  assert.deepEqual(await packedSource.asset(sodiumPath), buildPonderRigidVertices(readPonderRigidBatch(sodium.batch, 3)!, [sodium.part]));
  assert.deepEqual(Buffer.from(await packedSource.asset(normalPalettePath)), normalPalette.vertices);
  assert.deepEqual(Buffer.from(await packedSource.asset(foilPath)), foil.visible);
  const boltVertices = buildPonderLightningVertices(lightning)!;
  assert.equal(boltVertices.byteLength, 896 * 16);
  for (const path of [lightningPath, lightningSlice]) {
    assert.equal(withSlices.draws.find(draw => draw.vertices === path)?.indices, lightningOrder);
    assert.deepEqual(await packedSource.asset(path), boltVertices);
  }
  assert.deepEqual(Buffer.from(await packedSource.asset(lightningOrder)), lightningIndices);
  assert.equal(fetched.filter(path => path === rigid.partPath).length, 1);
  assert.deepEqual(Buffer.from(await packedSource.asset(orderPath)), order);
  assert.equal(fetched.filter(path => path === rigid.partPath).length, 1);
  const [one, two] = await Promise.all([packedSource.asset(slicePath), packedSource.asset(secondSlice)]);
  assert.deepEqual(Buffer.from(one), vertexBytes);
  assert.deepEqual(Buffer.from(two), anotherMesh);
  assert.equal(fetched.filter(path => path === bundlePath).length, 1);
  assert.deepEqual(Buffer.from(await packedSource.asset(streamRef)), streamed);
  assert.deepEqual(Buffer.from(await packedSource.asset(streamRef)), streamed);
  for (const asset of streamParts) assert.equal(fetched.filter(path => path === asset).length, 1);
  assert.deepEqual(await packedSource.picking(pickingChunk, 0), readPonderPicking(JSON.parse(outlineA.toString())));
  assert.deepEqual(await packedSource.picking(nextPickingChunk, 65), readPonderPicking(JSON.parse(outlineB.toString())));
});
