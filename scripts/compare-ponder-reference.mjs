import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { rolldown } from 'rolldown';
import sharp from 'sharp';
import { ponderResource, readPonderIndex } from '../src/ponder/format.mts';
import { ponderIndexPath } from '../server/ponderStorage.mts';
import { preparePonderImport } from './import-ponder.mjs';

const [archive, outputDirectory] = process.argv.slice(2);
assert.ok(archive && outputDirectory, 'Usage: node scripts/compare-ponder-reference.mjs <previews.zip> <report-directory>');
const output = resolve(outputDirectory);
const reference = join(dirname(resolve(archive)), 'ponder-reference');
const references = (await readdir(reference)).filter(name => /^[a-f0-9]{64}-\d{1,5}\.png$/.test(name)).sort();
assert.ok(references.length, 'No native Ponder reference frames next to the ZIP');

const hash = createHash('sha256');
for await (const bytes of createReadStream(archive)) hash.update(bytes);
const revision = hash.digest('hex');
const storage = await mkdtemp(join(tmpdir(), 'capycraft-ponder-reference-'));
const assets = join(storage, 'revisions', revision);
let browser;
try {
  const imported = await preparePonderImport(archive, storage, revision, revision);
  assert.ok(imported.scenes, 'No playable Ponder scenes in this ZIP');
  await imported.publish();
  const index = readPonderIndex(JSON.parse(await readFile(join(assets, ponderIndexPath), 'utf8')));
  assert.ok(index, 'Invalid published Ponder index');
  const scenes = new Map(index.scenes.map(scene => [scene.manifest.split('/')[2], scene]));
  const samples = references.map(name => ({ name, tick: Number(name.slice(65, -4)), scene: scenes.get(name.slice(0, 64)) }));
  assert.ok(samples.every(({ scene }) => scene), 'A native reference frame does not match a scene in this ZIP');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 320 }, deviceScaleFactor: 1 });
  await page.route('http://ponder.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Ponder reference comparison</title>' });
    const path = url.searchParams.get('path');
    const resource = path && ponderResource(path);
    if (url.pathname !== '/api/ponder' || !resource || url.searchParams.get('revision') !== revision) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: resource.mime, path: join(assets, path) });
  });
  await page.goto('http://ponder.test/');
  await page.addScriptTag({ content: await browserCode() });
  await mkdir(output, { recursive: true });
  const report = [];
  for (const { name, scene, tick } of samples) {
    const { image, ...rendered } = await page.evaluate(({ scene, tick, revision }) => window.renderPonderReference(scene, tick, revision),
      { scene, tick, revision });
    const web = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
    const native = await readFile(join(reference, name));
    const comparison = await comparePixels(native, web);
    const base = `${scene.id.replaceAll(/[^a-z0-9_.-]/gi, '-')}-${tick}`;
    await Promise.all([writeFile(join(output, `${base}-minecraft.png`), native), writeFile(join(output, `${base}-web.png`), web)]);
    report.push({ scene: scene.id, schematic: scene.schematic, tick, ...rendered, ...comparison });
  }
  await writeFile(join(output, 'comparison.json'), JSON.stringify({ revision, scenes: index.scenes.length, frames: report }, null, 2) + '\n');
  console.log(`Compared ${report.length} frames from ${new Set(report.map(frame => frame.scene)).size} scenes. Report: ${join(output, 'comparison.json')}`);
  if (report.some(frame => frame.omitted || frame.assetErrors.length || !frame.nativeForeground || !frame.webForeground)) process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { await rm(storage, { recursive: true, force: true }); }
}

async function browserCode() {
  const sourcePath = file => fileURLToPath(new URL(`../src/ponder/${file}`, import.meta.url)).replaceAll('\\', '/');
  const bundle = await rolldown({ input: 'ponder-native-reference', plugins: [{
    name: 'ponder-native-reference',
    resolveId(id) { if (id === 'ponder-native-reference') return '\0ponder-native-reference'; },
    load(id) {
      if (id !== '\0ponder-native-reference') return;
      return `
        import { createPonderSource } from ${JSON.stringify(sourcePath('source.ts'))};
        import { createPonderRenderer } from ${JSON.stringify(sourcePath('renderer.ts'))};
        window.renderPonderReference = async (scene, tick, revision) => {
          const abort = new AbortController();
          const source = createPonderSource('reference', scene, abort.signal, revision);
          const manifest = await source.manifest();
          if (tick >= manifest.frameCount) throw new Error('Ponder reference tick exceeds playback duration');
          const canvas = document.createElement('canvas');
          const errors = [];
          const renderer = createPonderRenderer(canvas, manifest, async path => {
            try { return await source.asset(path); }
            catch (error) { errors.push({ path, error: String(error) }); throw error; }
          });
          try {
            const frame = await source.frame(tick);
            const draws = frame.overlayStart === undefined ? frame.draws : frame.draws.slice(0, frame.overlayStart);
            const result = await renderer.render({ ...frame, draws }, () => true, tick);
            return { image: canvas.toDataURL(), ...result, assetErrors: errors, draws: draws.length,
              atlasAnimations: new Set(draws.flatMap(draw => Object.values(draw.textures)
                .map(texture => texture.atlasAnimation).filter(Boolean))).size };
          } finally { renderer.dispose(); abort.abort(); }
        };`;
    },
  }] });
  try { return (await bundle.generate({ format: 'iife' })).output[0].code; }
  finally { await bundle.close(); }
}

async function comparePixels(native, web) {
  const decode = png => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([decode(native), decode(web)]);
  assert.deepEqual([a.info.width, a.info.height], [b.info.width, b.info.height], 'Reference and web image dimensions differ');
  let nativeForeground = 0, webForeground = 0, shared = 0, colorError = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const hasNative = a.data[i + 3] > 32, hasWeb = b.data[i + 3] > 32;
    nativeForeground += Number(hasNative);
    webForeground += Number(hasWeb);
    if (!hasNative || !hasWeb) continue;
    shared++;
    for (let channel = 0; channel < 3; channel++) colorError += Math.abs(a.data[i + channel] - b.data[i + channel]);
  }
  const union = nativeForeground + webForeground - shared;
  return { nativeForeground, webForeground, foregroundOverlap: union ? shared / union : 0,
    meanSharedColorError: shared ? colorError / (3 * shared) : null };
}
