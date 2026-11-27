import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { importRevision } from '../scripts/import-items.mjs';
import { readCatalogResource, serveCatalog } from '../server/itemCatalog.mts';
import { createItemPages } from '../server/itemPages.mts';
import { createItemSearch } from '../server/itemSearch.mts';
import { defaultAlias } from '../src/minecraftServers.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const previewKey = '1'.repeat(64);
const variantKey = '2'.repeat(64);
const animationKey = '3'.repeat(64);
const atlasPath = 'previews/atlas-index.json';
const firstRevision = 'a'.repeat(64);
const secondRevision = 'b'.repeat(64);
const report = {
  setStage() {}, setStep() {}, setItem() {}, setLoaded() {}, setRecipeUses() {},
};

function square(size, background) {
  return sharp({ create: { width: size, height: size, channels: 4, background } });
}

async function fixture() {
  const red = await square(64, '#ff0000').png().toBuffer();
  const blue = await square(64, '#0000ff').png().toBuffer();
  const atlas = await square(640, 'transparent').composite([
    { input: red, left: 128, top: 64 },
    { input: blue, left: 576, top: 576 },
  ]).webp({ lossless: true }).toBuffer();
  const hash = digest(atlas);
  const animation = await sharp([red, blue], { join: { animated: true } }).webp({ lossless: true }).toBuffer();
  const entries = {
    'format.txt': Buffer.from('webcraft-previews-v1/1.21.1'),
    'catalog.json': json([
      { id: 'test:gem', name: 'Gem', previewKey, variants: [{ id: 'blue', previewKey: variantKey }] },
      { id: 'test:animated', name: 'Animated', previewKey: animationKey },
    ]),
    'catalog-data/recipe-item-previews.json': json({ 'test:external': variantKey }),
    'catalog-data/advancement-previews.json': json({ 'test:advancement': previewKey }),
    [`previews/${animationKey}.png`]: red,
    [`animations/${animationKey}.webp`]: animation,
  };
  const index = {
    version: 1, tileSize: 64, columns: 10, rows: 10, atlases: [hash],
    sprites: { [previewKey]: [0, 12], [variantKey]: [0, 99] },
  };
  return { atlas, hash, index, red, blue, animation, entries };
}

async function importFixture(directory, revision, entries, active, useSqlite) {
  const archive = join(directory, 'previews.zip');
  const bytes = zipSync(entries);
  await writeFile(archive, bytes);
  await importRevision(directory, archive, digest(bytes), active, revision, report, useSqlite);
  return JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8'));
}

function request(handler, url = '/', method = 'GET') {
  return new Promise((resolve, reject) => {
    const headers = {};
    let status = 200;
    const response = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code, additional = {}) {
        status = code;
        for (const [name, value] of Object.entries(additional)) this.setHeader(name, value);
        return this;
      },
      end(body) { resolve({ status, headers, body }); },
    };
    Promise.resolve(handler({ method, url, headers: { host: 'example.test' } }, response)).catch(reject);
  });
}

async function checkIcon(bytes, width, rgba) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, width);
  assert.deepEqual([...data.subarray(0, 4)], rgba);
}

for (const useSqlite of [false, true]) {
  test(`exported atlases, standalone animations and legacy updates with ${useSqlite ? 'SQLite' : 'file'} storage`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'capycraft-atlas-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { atlas, hash, index, red, blue, animation, entries } = await fixture();
    assert.equal((await sharp(animation).metadata()).pages, 2);
    const atlasEntries = { ...entries, [atlasPath]: json(index), [`previews/atlases/${hash}.webp`]: atlas };
    const manifest = await importFixture(directory, firstRevision, atlasEntries, undefined, useSqlite);
    assert.deepEqual(manifest.atlases, [hash]);
    assert.equal(manifest.state, 'ready');
    const root = `revisions/${firstRevision}`;
    const read = path => readCatalogResource(directory, path);
    const readJson = async path => JSON.parse(await read(`${root}/${path}`));
    const page = await readJson(`pages/${manifest.pages.en[0]}.json`);
    const gem = page.find(item => item.id === 'test:gem');
    const gemIcon = `${hash}-12.webp`;
    const variantIcon = `${hash}-99.webp`;
    assert.equal(gem.icon, gemIcon);
    const details = await readJson(`details/${gem.detail}.json`);
    assert.equal(details.variants[0].icon, variantIcon);
    assert.deepEqual(await readJson(`payloads/${manifest.recipeItemIcons}.json`), { 'test:external': variantIcon });
    assert.deepEqual(await readJson(`payloads/${manifest.advancementIcons}.json`), { 'test:advancement': gemIcon });
    const search = new URL(`https://example.test/api/item-search?revision=${firstRevision}&index=${manifest.search}&language=en&page=0&q=gem`);
    const searchResult = await request((req, res) => createItemSearch(directory)(req, res, search));
    assert.deepEqual(JSON.parse(searchResult.body).items, [gem]);

    assert.deepEqual(await read(`${root}/atlases/${hash}.webp`), atlas);
    await assert.rejects(read(`${root}/icons/${digest(red)}.png`), { code: 'ENOENT' });
    const animatedItem = page.find(item => item.id === 'test:animated');
    assert.deepEqual(await read(`${root}/icons/${animatedItem.icon}`), animation);
    const directories = new Map([[defaultAlias, directory]]);
    const get = (asset, method) => request((req, res) => serveCatalog(directories, asset, req, res), '/', method);
    const direct = await get(`${root}/icons/${gemIcon}`);
    assert.equal(direct.status, 200);
    assert.equal(direct.headers['content-type'], 'image/webp');
    assert.match(direct.headers['cache-control'], /immutable/);
    await checkIcon(direct.body, 64, [255, 0, 0, 255]);
    await checkIcon((await get(`${root}/icons/${variantIcon}`)).body, 64, [0, 0, 255, 255]);
    const head = await get(`${root}/icons/${gemIcon}`, 'HEAD');
    assert.equal(head.headers['content-length'], direct.body.length);
    assert.equal(head.body, undefined);
    assert.equal((await get(`${root}/icons/${hash}-100.webp`)).status, 404);

    const pages = createItemPages([defaultAlias], (_, path) => read(path), async () => '<title>Capycraft</title>');
    const itemPath = `/server/${defaultAlias}/items/test%3Agem`;
    const social = await request((req, res) => pages(req, res, req.url), `${itemPath}/icon.png`);
    assert.equal(social.status, 200);
    await checkIcon(social.body, 256, [255, 0, 0, 255]);
    const itemPage = await request((req, res) => pages(req, res, req.url), itemPath);
    assert.ok(itemPage.body.includes(`/icon.png?v=${hash}-12`));

    const invalidEntries = {
      ...atlasEntries,
      [atlasPath]: json({ ...index, sprites: { [previewKey]: [0, 100] } }),
    };
    await assert.rejects(importFixture(directory, secondRevision, invalidEntries, manifest, useSqlite), /Invalid preview atlas tile/);
    assert.deepEqual(JSON.parse(await read('catalog.json')), manifest);

    const legacyEntries = { ...entries, [`previews/${previewKey}.png`]: red, [`previews/${variantKey}.png`]: blue };
    const legacy = await importFixture(directory, secondRevision, legacyEntries, manifest, useSqlite);
    assert.deepEqual(legacy.atlases, []);
    assert.equal(legacy.previousRevision, firstRevision);
    assert.deepEqual(await read(`${root}/atlases/${hash}.webp`), atlas);
    await checkIcon(await read(`revisions/${secondRevision}/icons/${digest(red)}.png`), 64, [255, 0, 0, 255]);
  });
}

test('the atlas contract rejects unsafe paths, bad digests and incompatible images before publication', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'capycraft-atlas-invalid-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { index, entries, atlas, hash, red } = await fixture();
  const small = await sharp(red).webp({ lossless: true }).toBuffer();
  const lossy = await square(640, 'red').webp().toBuffer();
  const cases = [
    ['path', { ...index }, { 'previews/atlases/NOT-A-HASH.webp': atlas }, /Invalid preview atlas path/],
    ['missing', index, {}, /Missing or oversized preview atlas/],
    ['digest', index, { [`previews/atlases/${hash}.webp`]: small }, /Invalid preview atlas/],
    ['dimensions', { ...index, atlases: [digest(small)] },
      { [`previews/atlases/${digest(small)}.webp`]: small }, /Invalid preview atlas dimensions/],
    ['lossy', { ...index, atlases: [digest(lossy)] },
      { [`previews/atlases/${digest(lossy)}.webp`]: lossy }, /Invalid preview atlas/],
  ];
  for (const [name, atlasIndex, images, error] of cases) {
    const directory = join(parent, name);
    await mkdir(directory);
    await assert.rejects(importFixture(directory, firstRevision, {
      ...entries, ...images, [atlasPath]: json(atlasIndex),
    }, undefined, false), error);
    await assert.rejects(readFile(join(directory, 'catalog.json')), { code: 'ENOENT' });
  }
});
