import { expect, test } from '@playwright/test';
import { rolldown } from 'rolldown';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

test('Ponder renders and seeks a shared animated atlas in WebGL and Canvas', async ({ page }) => {
  const sourceRoot = fileURLToPath(new URL('../../src/ponder/', import.meta.url)).replaceAll('\\', '/');
  const bundle = await rolldown({ input: 'ponder-atlas-test', plugins: [{
    name: 'ponder-atlas-test',
    resolveId(id) { if (id === 'ponder-atlas-test') return '\0ponder-atlas-test'; },
    load(id) {
      if (id === '\0ponder-atlas-test') return `
        import { createPonderRenderer } from ${JSON.stringify(sourceRoot + 'renderer.ts')};
        import { createPonderRenderer2d } from ${JSON.stringify(sourceRoot + 'renderer2d.ts')};
        import { compactPonderDraws, readPonderBlockModels } from ${JSON.stringify(sourceRoot + 'compact.mts')};
        import { createPonderAtlasPlayback } from ${JSON.stringify(sourceRoot + 'atlasPlayback.ts')};
        window.ponderTest = { renderers: [createPonderRenderer, createPonderRenderer2d], compactPonderDraws, readPonderBlockModels,
          createPonderAtlasPlayback };`;
    },
  }] });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();

  const atlas = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#003300' } }).png().toBuffer();
  const sheet = await sharp(Buffer.from([200, 0, 0, 255, 0, 0, 200, 255]),
    { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const transparentSheet = await sharp(Buffer.from([200, 0, 0, 255, 0, 0, 200, 0]),
    { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const white = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const lightPixels = Buffer.alloc(16 * 16 * 4, 255);
  lightPixels.set([0, 0, 0, 255, 200, 100, 40, 255]);
  const lightmap = await sharp(lightPixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
  await page.setContent('<!doctype html><title>Ponder atlas test</title>');
  await page.addScriptTag({ content: output[0].code });

  const { results, transparentSamples } = await page.evaluate(async ({ atlas, sheet, transparentSheet, white, lightmap }) => {
    const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    const mesh = Float32Array.of(-1, -1, 0, 0, 0, 1, -1, 0, .25, 0, 1, 1, 0, .25, 1, -1, 1, 0, 0, 1);
    const image = `ponder/textures/${'a'.repeat(64)}.png`;
    const imageSheet = `ponder/textures/${'b'.repeat(64)}.png`;
    const animation = `ponder/textures/${'c'.repeat(64)}.json`;
    const model = `ponder/meshes/${'d'.repeat(64)}.bin`;
    const sharedModel = `ponder/meshes/${'e'.repeat(64)}.bin`;
    const litModel = `ponder/meshes/${'f'.repeat(64)}.bin`;
    const whiteImage = `ponder/textures/${'1'.repeat(64)}.png`;
    const lightmapImage = `ponder/textures/${'2'.repeat(64)}.png`;
    const sampler = { image, atlasAnimation: animation, atlasRegions: [[0, 0, .25, 1, 4, 1, 0, 0]],
      minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 };
    const draw = {
      mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 20, vertices: model,
      attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }, { name: 'UV0', offset: 12, type: 'FLOAT', count: 2 }],
      shader: 'position_tex', textures: { 0: sampler }, projection: identity, modelView: identity, textureMatrix: identity,
      color: Float32Array.of(1, 1, 1, 1), depthTest: false, depthFunction: 519, depthWrite: false, cull: false, blend: false,
    };
    const frame = { draws: [draw], captions: [], omitted: 0, sceneToGui: identity };
    const manifest = { width: 64, height: 64, diffuseLights: [Float32Array.of(0, 1, 0), Float32Array.of(1, 0, 0)] };
    const rows = [{ image: imageSheet, rect: [0, 0, 1, 1], source: [0, 0, 1, 1], frames: [[0, 2], [1, 2]], interpolate: true }];
    const sharedMesh = new DataView(new ArrayBuffer(4 * 24));
    for (const [index, [x, y, u, v]] of [[0, 64, 0, 0], [64, 64, 1, 0], [64, 0, 1, 1], [0, 0, 0, 1]].entries()) {
      const offset = index * 24;
      sharedMesh.setFloat32(offset, x, true);
      sharedMesh.setFloat32(offset + 4, y, true);
      sharedMesh.setUint32(offset + 12, 0xffffffff, true);
      sharedMesh.setFloat32(offset + 16, u, true);
      sharedMesh.setFloat32(offset + 20, v, true);
    }
    const { renderers, compactPonderDraws, readPonderBlockModels, createPonderAtlasPlayback } = window.ponderTest;
    const { models } = readPonderBlockModels({ version: 1, models: [[{
      shader: 'rendertype_solid', vertices: sharedModel, image, vertexCount: 4, atlasAnimation: animation,
    }]] });
    const sharedFrame = compactPonderDraws({ ...frame, draws: [] }, [{ transform: [...identity], blocks: [[0, 0, 0, 0]] }],
      models, manifest.width, manifest.height);
    const litMesh = new DataView(new ArrayBuffer(4 * 24));
    const quadBytes = new Uint8Array(mesh.buffer);
    for (let index = 0; index < 4; index++) {
      new Uint8Array(litMesh.buffer, index * 24, 20).set(quadBytes.subarray(index * 20, (index + 1) * 20));
      litMesh.setInt16(index * 24 + 20, 16, true);
    }
    const lightSampler = { minFilter: 9729, magFilter: 9729, wrapS: 33071, wrapT: 33071 };
    const litFrame = { ...frame, draws: [{ ...draw, shader: 'rendertype_solid', stride: 24, vertices: litModel,
      attributes: [...draw.attributes, { name: 'UV2', offset: 20, type: 'SHORT', count: 2 }],
      textures: { 0: { ...lightSampler, image: whiteImage }, 2: { ...lightSampler, image: lightmapImage } } }] };
    const bytes = new Map([[image, Uint8Array.from(atlas).buffer], [imageSheet, Uint8Array.from(sheet).buffer],
      [animation, new TextEncoder().encode(JSON.stringify(rows)).buffer], [model, mesh.buffer], [sharedModel, sharedMesh.buffer],
      [litModel, litMesh.buffer], [whiteImage, Uint8Array.from(white).buffer], [lightmapImage, Uint8Array.from(lightmap).buffer]]);
    const results = [];
    for (const [index, factory] of renderers.entries()) {
      const canvas = document.createElement('canvas');
      const requested = [];
      const renderer = factory(canvas, manifest, async path => { requested.push(path); return bytes.get(path); });
      const colors = [];
      const notices = [];
      for (const [selected, tick] of [[frame, 0], [frame, 1], [frame, 2], [frame, 0], [sharedFrame, 1], [sharedFrame, 0], [litFrame, 0]]) {
        notices.push(await renderer.render(selected, () => true, tick));
        const values = [16, 48].map(x => {
          if (index === 1) return Array.from(canvas.getContext('2d').getImageData(x, 32, 1, 1).data);
          const gl = canvas.getContext('webgl2');
          const pixel = new Uint8Array(4);
          gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        });
        colors.push(values);
      }
      renderer.dispose();
      results.push({ colors, notices, sheetRequests: requested.filter(path => path === imageSheet).length });
    }
    bytes.set(imageSheet, Uint8Array.from(transparentSheet).buffer);
    const gl = document.createElement('canvas').getContext('webgl2');
    const transparentSamples = [];
    for (const context of [gl, undefined]) {
      const playback = createPonderAtlasPlayback(async path => bytes.get(path), context);
      const [copy] = await playback.sample(animation, 2, 1, 1);
      playback.dispose();
      transparentSamples.push([...copy.pixels]);
    }
    return { results, transparentSamples };
  }, { atlas: [...atlas], sheet: [...sheet], transparentSheet: [...transparentSheet], white: [...white], lightmap: [...lightmap] });
  const still = [0, 51, 0, 255];
  const red = [200, 0, 0, 255], mixed = [100, 0, 100, 255], blue = [0, 0, 200, 255];
  expect(transparentSamples).toEqual([mixed, mixed]);
  const colors = [red, mixed, blue, red, mixed, red].map(color => [color, still]);
  const lit = [100, 50, 20, 255];
  colors.push([lit, lit]);
  for (const result of results) {
    expect(result.colors).toEqual(colors);
    expect(result.notices).toEqual(Array.from({ length: 7 }, () => ({ omitted: 0, staticTextures: false })));
    expect(result.sheetRequests).toBe(1);
  }
});
