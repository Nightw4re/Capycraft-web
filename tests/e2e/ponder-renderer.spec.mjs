import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { build } from 'vite';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('Ponder WebGL preserves sprite interpolation, atlas crops, depth, cutouts, outlines and liquid blending', async ({ page }) => {
  const entry = resolve('ponder-renderer-test.js');
  const bundle = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    build: { write: false, lib: { entry, formats: ['iife'], name: 'PonderRendererTest' } },
    plugins: [{
      name: 'ponder-renderer-test',
      resolveId(id) { if (id.endsWith('ponder-renderer-test.js')) return '\0' + entry; },
      load(id) {
        if (id === '\0' + entry) return `
          import { createPonderRenderer } from '/src/ponder/renderer.ts';
          import { compactPonderDraws } from '/src/ponder/compact.mts';
          window.createPonderRenderer = createPonderRenderer;
          window.compactPonderDraws = compactPonderDraws;
        `;
      },
    }],
  });
  const png = async (rgba, width = 1, height = 1) =>
    [...await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer()];
  const [first, next, cutout, red, blue] = await Promise.all([
    png([30, 80, 200, 128]), png([120, 200, 100, 255]), png([120, 200, 100, 16]),
    png([255, 0, 0, 128]), png([0, 0, 255, 128]),
  ]);
  const atlas = Array.from({ length: 16 }, (_, i) => [i * 13, 255 - i * 13, i * 7, 255]);
  const [atlasImage, cropImage] = await Promise.all([png(atlas.flat(), 4, 4), png([5, 6, 9, 10].flatMap(i => atlas[i]), 2, 2)]);
  await page.setContent('<canvas width="4" height="4" style="width:4px;height:4px"></canvas>');
  await page.addScriptTag({ content: bundle[0].output.find(output => output.type === 'chunk').code });
  const result = await page.evaluate(async ([firstBytes, nextBytes, cutoutBytes, redBytes, blueBytes, atlasBytes, cropBytes]) => {
    const canvas = document.querySelector('canvas');
    const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    const manifest = { width: 4, height: 4, blockModels: 'ponder/block-models.json',
      diffuseLights: [Float32Array.of(0, 1, 0), Float32Array.of(0, -1, 0)] };
    const vertices = Float32Array.of(-1, 1, 0, 0, 0, -1, -1, 0, 0, 1, 1, -1, 0, 1, 1, 1, 1, 0, 1, 0);
    const line = new DataView(new ArrayBuffer(4 * 20));
    for (let vertex = 0; vertex < 4; vertex++) {
      line.setFloat32(vertex * 20, vertex < 2 ? -.8 : .8, true);
      line.setUint32(vertex * 20 + 12, 0xff0000ff, true);
      line.setInt8(vertex * 20 + 16, 127);
    }
    const assets = { mesh: vertices.buffer, first: Uint8Array.from(firstBytes).buffer, next: Uint8Array.from(nextBytes).buffer,
      cutout: Uint8Array.from(cutoutBytes).buffer, line: line.buffer };
    const renderer = window.createPonderRenderer(canvas, manifest, async path => assets[path]);
    const draw = {
      mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 20, vertices: 'mesh',
      attributes: [{ name: 'Position', count: 3, offset: 0, type: 'FLOAT' }, { name: 'UV0', count: 2, offset: 12, type: 'FLOAT' }],
      shader: 'position_tex_color', textures: { 0: { image: 'first', transition: { image: 'next', weight: .5 },
        minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } },
      projection: identity, modelView: identity, textureMatrix: identity, color: Float32Array.of(1, 1, 1, 1),
      depthTest: true, depthFunction: 515, depthWrite: true, cull: true, blend: false,
    };
    try {
      const painted = await renderer.render({ draws: [draw], captions: [], omitted: 0, sceneToGui: identity }, () => true);
      const pixel = new Uint8Array(4);
      const gl = canvas.getContext('webgl2');
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const sprite = [...pixel];
      const pass = (z, color) => {
        const modelView = new Float32Array(identity);
        modelView[14] = z;
        return { ...draw, shader: 'position_color', textures: {}, modelView, color: Float32Array.from(color) };
      };
      await renderer.render({ draws: [pass(-.5, [1, 0, 0, 1]), pass(.25, [0, 1, 0, 1]), pass(.5, [0, 0, 1, 1])],
        captions: [], omitted: 0, sceneToGui: identity, overlayStart: 1 }, () => true);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const overlay = [...pixel];
      const unlit = async image => {
        const texture = { ...draw.textures[0], image, transition: undefined };
        const tinted = { ...draw, shader: 'neoforge:rendertype_entity_unlit_translucent',
          color: Float32Array.of(1, 1, 1, .125), textures: { 0: texture } };
        const frame = await renderer.render({ draws: [tinted], captions: [], omitted: 0, sceneToGui: identity }, () => true);
        gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return { pixel: [...pixel], omitted: frame.omitted };
      };
      const outlines = [];
      for (const mode of ['LINES', 'LINE_STRIP']) {
        const native = { ...draw, shader: 'rendertype_lines', textures: {}, vertices: 'line', lineWidth: 2, mode,
          indexCount: mode === 'LINES' ? 6 : 4, attributes: [draw.attributes[0],
            { name: 'Color', count: 4, offset: 12, type: 'UBYTE' }, { name: 'Normal', count: 3, offset: 16, type: 'BYTE' }] };
        const frame = await renderer.render({ draws: [native], captions: [], omitted: 0, sceneToGui: identity }, () => true);
        const column = new Uint8Array(16);
        gl.readPixels(1, 0, 1, 4, gl.RGBA, gl.UNSIGNED_BYTE, column);
        outlines.push({ reds: [column[0], column[4], column[8], column[12]], omitted: frame.omitted });
      }
      const liquidModel = (image, bytes, z) => {
        const geometry = new DataView(new ArrayBuffer(8 * 24));
        const points = [[0, 0], [0, 1], [1, 1], [1, 0]];
        [0, 1, 2, 3, 0, 3, 2, 1].forEach((corner, vertex) => {
          const at = vertex * 24;
          geometry.setFloat32(at, points[corner][0], true);
          geometry.setFloat32(at + 4, points[corner][1], true);
          geometry.setFloat32(at + 8, z, true);
          geometry.setUint32(at + 12, 0xffffffff, true);
        });
        assets[image] = Uint8Array.from(bytes).buffer;
        assets[image + 'Mesh'] = geometry.buffer;
        return { image, vertices: image + 'Mesh', shader: 'rendertype_translucent', liquid: true,
          liquidCenter: [.5, .5, z], vertexCount: 8 };
      };
      const models = [[liquidModel('red', redBytes, .75), liquidModel('blue', blueBytes, .25)]];
      const layout = [{ transform: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], blocks: [[0, 0, 0, 0]] }];
      const liquids = [];
      const opposite = Float32Array.of(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 4, 0, 1, 1);
      for (const sceneToGui of [identity, opposite]) {
        const frame = window.compactPonderDraws({ draws: [], captions: [], omitted: 0, sceneToGui }, layout, models, 4, 4);
        const output = await renderer.render(frame, () => true);
        gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        liquids.push({ pixel: [...pixel], omitted: output.omitted });
      }
      const atlasVertices = new Float32Array(vertices);
      for (let offset = 0; offset < atlasVertices.length; offset += 5) {
        atlasVertices[offset + 3] = atlasVertices[offset + 3] * .5 + .25;
        atlasVertices[offset + 4] = atlasVertices[offset + 4] * .5 + .25;
      }
      assets.atlasMesh = atlasVertices.buffer;
      assets.atlas = Uint8Array.from(atlasBytes).buffer;
      assets.crop = Uint8Array.from(cropBytes).buffer;
      const cropMatrix = Float32Array.of(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -.5, -.5, 0, 1);
      const renderedAtlas = [];
      for (const [image, textureMatrix] of [['atlas', identity], ['crop', cropMatrix]]) {
        const texture = { ...draw.textures[0], image, transition: undefined };
        const result = await renderer.render({ draws: [{ ...draw, vertices: 'atlasMesh', textureMatrix, textures: { 0: texture } }],
          captions: [], omitted: 0, sceneToGui: identity }, () => true);
        const pixels = new Uint8Array(4 * 4 * 4);
        gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        renderedAtlas.push({ pixels, omitted: result.omitted });
      }
      const regionMatrix = new Float32Array(identity);
      regionMatrix[12] = .125;
      const regional = { ...draw, textureMatrix: regionMatrix, textures: { 0: {
        ...draw.textures[0], image: 'atlas', transition: undefined,
        atlasRegions: [[.25, 0, .5, .75, 1, 1, .5, .25], [.875, 0, 1, .75, 1, 1, -.875, .25]],
      } } };
      const regionalFrame = await renderer.render({ draws: [regional], captions: [], omitted: 0, sceneToGui: identity }, () => true);
      const regionalPixels = [];
      for (const [x, y] of [[0, 3], [1, 3], [2, 3], [3, 3], [0, 0]]) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        regionalPixels.push([...pixel]);
      }
      return {
        sprite, overlay, omitted: painted.omitted, tinted: await unlit('first'), cutout: await unlit('cutout'), outlines, liquids,
        regionalAtlas: { pixels: regionalPixels, omitted: regionalFrame.omitted },
        atlasCrop: { samePixels: renderedAtlas[0].pixels.every((value, i) => value === renderedAtlas[1].pixels[i]),
          distinctRedValues: new Set(renderedAtlas[0].pixels.filter((_, i) => i % 4 === 0)).size,
          omitted: renderedAtlas.map(result => result.omitted) },
      };
    } finally {
      renderer.dispose();
    }
  }, [first, next, cutout, red, blue, atlasImage, cropImage]);
  expect(result).toEqual({ sprite: [75, 140, 150, 128], overlay: [0, 255, 0, 255], omitted: 0,
    tinted: { pixel: [30, 80, 200, 16], omitted: 0 }, cutout: { pixel: [0, 0, 0, 0], omitted: 0 },
    outlines: [{ reds: [0, 255, 255, 0], omitted: 0 }, { reds: [0, 255, 255, 0], omitted: 0 }],
    liquids: [{ pixel: [128, 0, 64, 192], omitted: 0 }, { pixel: [64, 0, 128, 192], omitted: 0 }],
    regionalAtlas: { pixels: [[91, 164, 49, 255], [91, 164, 49, 255], [0, 0, 0, 0], [52, 203, 28, 255], [0, 0, 0, 0]], omitted: 0 },
    atlasCrop: { samePixels: true, distinctRedValues: 4, omitted: [0, 0] } });
});
