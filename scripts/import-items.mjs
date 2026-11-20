import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants, cpus, setPriority } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import yauzl from 'yauzl';
import layout from '../src/items/catalogLayout.json' with { type: 'json' };
import { lookupSlot, readItemBar, searchText } from '../src/items/catalogIndex.mjs';
import { defaultAlias } from '../src/minecraftServers.mjs';
import { catalogDatabasePath, catalogStorage, createCatalogDatabase, hasCatalogDatabase } from '../server/catalogAssets.mts';
import { instanceDirectory, itemCatalogDirectory, loadInstances } from '../server/instances.mts';
import { addRecipeUses, createRecipeUsesIndex, recipeUsesIndexFile } from '../server/recipeUsesIndex.mjs';
import { recipeUsesDatabasePath, writeStoredRecipeUses } from '../server/recipeUsesStore.mts';

const root = join(import.meta.dirname, '..');
const itemId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const previewPath = /^previews\/[a-f0-9]{64}\.(?:png|webp)$/;
const revisionId = /^[a-f0-9]{64}$/;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const atlasRows = layout.pageSize / layout.atlasColumns;
const webpOptions = { lossless: true, effort: 4 };
const folders = ['icons', 'details', 'atlases', 'pages', 'lookup', 'search', 'payloads'];
const manifestName = 'catalog.json';
const recipeDataVersion = 4;
const fluidRecipePath = /^catalog-data\/machine-recipes\/fluids\/([a-z0-9_.-]+)\/([a-z0-9_./-]+)\.json$/;

function digest(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function createFileStore(destination) {
  for (const folder of folders) await mkdir(join(destination, folder));
  return {
    read: (folder, name) => readFile(join(destination, folder, name)),
    write: (folder, name, data, options) => writeFile(join(destination, folder, name), data, options),
  };
}

async function writeJson(store, folder, data, written) {
  const json = JSON.stringify(data);
  const hash = digest(json);
  if (!written?.has(hash)) {
    await store.write(folder, `${hash}.json`, json);
    written?.add(hash);
  }
  return hash;
}

function catalogOrder(items, language) {
  const collator = new Intl.Collator(language, { numeric: true });
  return items.map((_, index) => index).sort((a, b) =>
    collator.compare(items[a].name, items[b].name) || collator.compare(items[a].id, items[b].id));
}

async function writeCatalog(store, items, atlases, metadata, publishedFiles) {
  const order = { cs: catalogOrder(items, 'cs'), en: catalogOrder(items, 'en') };
  const pages = { cs: [], en: [] };
  for (const language of Object.keys(pages)) {
    for (let first = 0; first < items.length; first += layout.pageSize) {
      const page = order[language].slice(first, first + layout.pageSize).map(index => items[index]);
      pages[language].push(await writeJson(store, 'pages', page, publishedFiles.pages));
    }
  }
  const buckets = Array.from({ length: 256 }, () => []);
  for (const item of items) buckets[lookupSlot(item.id)].push(item);
  const lookup = [];
  for (const bucket of buckets) lookup.push(bucket.length ? await writeJson(store, 'lookup', bucket, publishedFiles.lookup) : null);

  const searchItems = items.map(({ sprite, ...item }) => ({
    ...item, search: searchText(`${item.name} ${item.fluidId ?? item.id}`),
  }));
  const search = await writeJson(store, 'search', { items: searchItems, order }, publishedFiles.search);
  const mods = [...new Set(items.map(item => item.id.split(':')[0]))].sort();
  return { version: layout.version, ...metadata, total: items.length, atlases, pages, lookup, mods, search };
}

async function hashArchive(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function isAnimatedPng(png) {
  for (let offset = pngSignature.length; offset + 12 <= png.length; offset += png.readUInt32BE(offset) + 12) {
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
  }
  return false;
}

async function writeAtlas(items, store, atlasIndex, animatedIcons, pace) {
  const page = items.filter(item => item.icon && !animatedIcons.has(item.icon));
  if (!page.length) return undefined;
  const width = layout.tileSize * layout.atlasColumns;
  const height = layout.tileSize * atlasRows;
  const tileStride = layout.tileSize * 4;
  const pixels = Buffer.alloc(width * height * 4);
  const tiles = new Map();
  for (const item of page) {
    let position = tiles.get(item.icon);
    if (position === undefined) {
      await pace();
      position = tiles.size;
      // Buffer input lets publication move or remove the directory on Windows.
      const tile = await sharp(await store.read('icons', item.icon))
        .resize(layout.tileSize, layout.tileSize, {
          fit: 'contain', kernel: 'nearest', background: { r: 0, g: 0, b: 0, alpha: 0 },
        }).ensureAlpha().raw().toBuffer();
      const x = (position % layout.atlasColumns) * layout.tileSize;
      const y = Math.floor(position / layout.atlasColumns) * layout.tileSize;
      for (let row = 0; row < layout.tileSize; row++) {
        tile.copy(pixels, ((y + row) * width + x) * 4, row * tileStride, (row + 1) * tileStride);
      }
      tiles.set(item.icon, position);
    }
    item.sprite = atlasIndex * layout.pageSize + position;
  }
  const image = await sharp(pixels, { raw: { width, height, channels: 4 } }).webp(webpOptions).toBuffer();
  const name = digest(image);
  try {
    await store.write('atlases', `${name}.webp`, image, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return name;
}

async function moveFile(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (attempt === 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      await setTimeout(100 * (attempt + 1));
    }
  }
}

function processorTime() {
  let total = 0;
  let idle = 0;
  for (const { times } of cpus()) {
    total += times.user + times.nice + times.sys + times.idle + times.irq;
    idle += times.idle;
  }
  return { total, idle, at: Date.now() };
}

function createPacer() {
  sharp.concurrency(1);
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* The deployment can set process priority. */ }
  let sample = processorTime();
  let pause = 0;
  return async () => {
    if (Date.now() - sample.at >= 1000) {
      const next = processorTime();
      const elapsed = next.total - sample.total;
      const busy = elapsed > 0 ? 1 - (next.idle - sample.idle) / elapsed : 0;
      pause = busy > 0.9 ? 100 : busy > 0.75 ? 25 : 0;
      sample = next;
    }
    if (pause) await setTimeout(pause);
  };
}

async function readArchive(path, store, publish, pace, report, useAtlases, indexedRecipeUses = false) {
  const zipStarted = performance.now();
  const zip = await yauzl.openPromise(path, { autoClose: false, strictFileNames: true });
  const entries = new Map();
  const fluidRecipePaths = [];
  const recipeUses = createRecipeUsesIndex();
  const archiveStats = { entries: zip.entryCount, zipReadMs: 0, dataReads: 0, dataBytes: 0, imageReads: 0, imageBytes: 0 };

  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const fluid = fluidRecipePath.exec(name);
      if (name !== 'format.txt' && name !== 'catalog.json' && !previewPath.test(name)
        && !fluid && !/^catalog-data\/(?:tooltips|stacks|recipes|machine-recipes\/(?:items|groups))\/.+\.json$/.test(name)) continue;
      if (entries.has(name)) throw new Error(`Duplicate export entry: ${name}`);
      entries.set(name, entry);
      if (fluid) fluidRecipePaths.push(fluid.slice(1));
    }
    archiveStats.zipReadMs = performance.now() - zipStarted;

    async function read(entry, image = false) {
      const started = performance.now();
      const contents = await buffer(await zip.openReadStreamPromise(entry));
      archiveStats.zipReadMs += performance.now() - started;
      if (image) {
        archiveStats.imageReads++;
        archiveStats.imageBytes += contents.byteLength;
      } else {
        archiveStats.dataReads++;
        archiveStats.dataBytes += contents.byteLength;
      }
      return contents;
    }

    const format = entries.get('format.txt');
    if (!format || !/^webcraft-previews-v1\/[\d.]+$/.test((await read(format)).toString().trim())) {
      throw new Error('Expected a WebCraft previews v1 archive.');
    }
    const index = entries.get('catalog.json');
    if (!index) throw new Error('The archive has no catalog. Choose “Export item catalog and inventory” in WebCraft.');
    const rows = JSON.parse((await read(index)).toString());
    if (!Array.isArray(rows)) throw new Error('Expected an array in catalog.json.');

    const imported = new Map();
    const written = new Set();
    const animatedIcons = new Set();
    const writtenPayloads = new Set();
    async function importIcon(key) {
      if (typeof key !== 'string') return undefined;
      if (imported.has(key)) return imported.get(key);
      const path = `previews/${key}`;
      const entry = entries.get(`${path}.webp`) ?? entries.get(`${path}.png`);
      if (!entry) return undefined;

      const image = await read(entry, true);
      const webp = entry.fileName.endsWith('.webp');
      const filename = `${digest(image)}.${webp ? 'webp' : 'png'}`;
      if (!written.has(filename)) {
        if (useAtlases) await pace();
        if (webp) {
          const { format, pages = 1 } = await sharp(image).metadata().catch(cause => {
            throw new Error(`Invalid WebP in ${entry.fileName}`, { cause });
          });
          if (format !== 'webp') throw new Error(`Invalid WebP in ${entry.fileName}`);
          if (useAtlases && pages > 1) animatedIcons.add(filename);
        } else {
          if (!image.subarray(0, pngSignature.length).equals(pngSignature)) {
            throw new Error(`Invalid PNG in ${entry.fileName}`);
          }
          if (useAtlases && isAnimatedPng(image)) animatedIcons.add(filename);
        }
        await store.write('icons', filename, image);
        written.add(filename);
      }
      imported.set(key, filename);
      return filename;
    }

    async function readPayload(group, filename, valid, versions = [1]) {
      const entry = entries.get(`catalog-data/${group}/${filename}.json`);
      if (!entry) return undefined;
      const bytes = await read(entry);
      const payload = JSON.parse(bytes.toString('utf8'));
      if (!versions.includes(payload?.version) || !valid(payload)) return undefined;
      return { bytes, payload };
    }

    const machineGroups = new Map();
    async function readMachineRecipes(kind, path, id) {
      const idField = kind === 'fluids' ? 'fluidId' : 'itemId';
      const data = await readPayload(`machine-recipes/${kind}`, path, payload => payload[idField] === id, [1, 2]);
      if (!data) return undefined;
      const { groups, ...payload } = data.payload;
      if (payload.version === 1) return Array.isArray(payload.recipes) ? payload : undefined;
      if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return undefined;

      const recipes = [];
      for (const [groupId, ordinals] of Object.entries(groups)) {
        if (!/^(?:0|[1-9][0-9]{0,8})$/.test(groupId) || !Array.isArray(ordinals)) continue;
        if (!machineGroups.has(groupId)) {
          const group = await readPayload('machine-recipes/groups', groupId, value =>
            Array.isArray(value.template?.layout?.slots) && Array.isArray(value.variants));
          machineGroups.set(groupId, group?.payload);
        }
        const group = machineGroups.get(groupId);
        if (!group) continue;
        const { template, variants } = group;
        for (const ordinal of ordinals) {
          if (!Number.isSafeInteger(ordinal) || ordinal < 0) continue;
          const variant = variants[ordinal];
          if (typeof variant?.id !== 'string' || !itemId.test(variant.id)) continue;
          const slots = template.layout.slots.map((slot, index) => {
            const alternatives = variant.slots?.[index];
            return Array.isArray(alternatives) ? { ...slot, alternatives } : slot;
          });
          recipes.push({ ...template, id: variant.id, layout: { ...template.layout, slots } });
        }
      }
      return recipes.length ? { ...payload, version: 1, recipes } : undefined;
    }

    async function writePayload(bytes) {
      const hash = digest(bytes);
      if (!writtenPayloads.has(hash)) {
        await store.write('payloads', `${hash}.json`, bytes);
        writtenPayloads.add(hash);
      }
      return hash;
    }

    async function importPayload(group, filename, valid) {
      const data = await readPayload(group, filename, valid);
      return data && writePayload(data.bytes);
    }

    async function importRecipes(id, path) {
      const forItem = data => data.itemId === id && Array.isArray(data.recipes);
      const world = await readPayload('recipes', path, forItem);
      const machine = await readMachineRecipes('items', path, id);
      if (world) addRecipeUses(recipeUses, world.payload.recipes);
      if (machine) {
        const feed = world?.payload ?? { version: 1, itemId: id, recipes: [] };
        return writePayload(Buffer.from(JSON.stringify({ ...feed, machineRecipes: machine })));
      }
      return world && writePayload(world.bytes);
    }

    async function importStackData(path, variant = '') {
      const filename = `${path}@${variant.replaceAll(':', '%3A').replaceAll('/', '%2F')}`;
      const tooltip = await importPayload('tooltips', filename, data => Array.isArray(data.lines));
      const stack = await importPayload('stacks', filename, data => Number.isInteger(data.count) && 'nbt' in data && 'components' in data);
      return tooltip || stack ? { tooltip, stack } : undefined;
    }

    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !itemId.test(row.id) || seen.has(row.id)) {
        throw new Error(`Invalid or duplicate catalog item ID: ${row?.id}`);
      }
      seen.add(row.id);
      row.name = typeof row.name === 'string' && row.name.trim() ? row.name : row.id;
    }
    const fluids = new Map();
    for (const [namespace, resource] of fluidRecipePaths) {
      const fluidId = `${namespace}:${resource}`;
      const machine = await readMachineRecipes('fluids', `${namespace}/${resource}`, fluidId);
      if (!machine?.recipes.length) continue;
      let id = fluidId;
      if (seen.has(id)) {
        let prefix = '/fluids/';
        while (seen.has(`${namespace}:${prefix}${resource}`)) prefix = '/' + prefix;
        id = `${namespace}:${prefix}${resource}`;
      }
      seen.add(id);
      const name = typeof machine.name === 'string' && machine.name.trim()
        ? machine.name.trim()
        : resource.replace(/[_.\/-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase()).trim() || fluidId;
      fluids.set(id, machine);
      rows.push({ id, name, previewKey: machine.previewKey });
    }
    await report.setPhase('processing', { loaded: 0, expected: rows.length });
    const items = [];
    const atlases = [];
    let atlasMs = 0;
    const appendAtlas = async size => {
      const start = performance.now();
      const atlas = await writeAtlas(items.slice(-size), store, atlases.length, animatedIcons, pace);
      atlasMs += performance.now() - start;
      if (atlas) atlases.push(atlas);
    };
    let checkpoint = { count: 0, at: Date.now() };
    if (publish) await publish(items, atlases, rows.length);
    for (const position of catalogOrder(rows, 'cs')) {
      const row = rows[position];
      const itemPath = row.id.replace(':', '/');
      const fluid = fluids.get(row.id);
      const icon = await importIcon(row.previewKey);
      const payloads = fluid ? undefined : await importStackData(itemPath);
      const recipeFeed = fluid
        ? await writePayload(Buffer.from(JSON.stringify({ version: 1, fluidId: fluid.fluidId, recipes: [], machineRecipes: fluid })))
        : await importRecipes(row.id, itemPath);
      const variants = [];
      const variantIds = new Set();
      for (const variant of Array.isArray(row.variants) ? row.variants : []) {
        if (!variant || typeof variant.id !== 'string' || !variant.id || variantIds.has(variant.id)) continue;
        const labels = Array.isArray(variant.options)
          ? variant.options.map(option => option?.label).filter(label => typeof label === 'string' && label.trim())
          : [];
        const icon = await importIcon(variant.previewKey);
        const payloads = await importStackData(itemPath, variant.id);
        if (!icon && !payloads) continue;
        variantIds.add(variant.id);
        variants.push({ id: variant.id, name: labels.join(' / ') || variant.id, icon, payloads, bar: readItemBar(variant.bar) });
      }

      let detail;
      if (variants.length || payloads || recipeFeed) {
        detail = await writeJson(store, 'details', { version: layout.detailVersion, id: row.id, variants, payloads, recipeFeed });
      }
      items.push({ id: row.id, name: row.name, icon, detail, bar: readItemBar(row.bar), fluidId: fluid?.fluidId });
      if (items.length % layout.pageSize === 0) {
        if (useAtlases) await appendAtlas(layout.pageSize);
        else await pace();
      }
      report.setLoaded(items.length);
      const sinceCheckpoint = Date.now() - checkpoint.at;
      if (publish && (items.length === 1 || (items.length - checkpoint.count >= 500 && sinceCheckpoint >= 5000)
        || sinceCheckpoint >= 30000)) {
        await publish(items, atlases, rows.length);
        checkpoint = { count: items.length, at: Date.now() };
      }
    }

    const remaining = items.length % layout.pageSize;
    if (useAtlases && remaining) await appendAtlas(remaining);
    if (indexedRecipeUses) await writeStoredRecipeUses(store, recipeUses);
    else await store.write('search', recipeUsesIndexFile, JSON.stringify(recipeUses));
    return { items, atlases, images: written.size, atlasMs, archiveStats };
  } finally {
    zip.close();
  }
}

async function activeManifest(output) {
  try {
    return JSON.parse(await readFile(join(output, manifestName), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function replaceCatalogJson(output, filename, data) {
  const temporary = join(output, `.${filename}-${data.revision}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(data));
    await moveFile(temporary, join(output, filename));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function publishImportStatus(output, revision, state, activity) {
  try {
    await replaceCatalogJson(output, layout.statusFile, { state, revision, updatedAt: Date.now(), ...activity });
  } catch (error) {
    console.warn(`Could not publish item import status: ${error.message}`);
  }
}

function reportImport(output, revision) {
  let phase = 'preparing';
  let progress;
  const write = state => publishImportStatus(output, revision, state, state === 'running' ? { phase, progress } : undefined);
  let pending = write('running');
  function queue(state) {
    pending = pending.then(() => write(state));
    return pending;
  }
  const timer = setInterval(() => { void queue('running'); }, layout.statusHeartbeatMs);
  return {
    started: pending,
    setPhase(next, counts = progress) {
      phase = next;
      progress = counts;
      return queue('running');
    },
    setLoaded(loaded) {
      progress.loaded = loaded;
    },
    async finish(state) {
      clearInterval(timer);
      await queue(state);
    },
  };
}

async function rotateBackups(output, current) {
  const revisions = join(output, 'revisions');
  const retained = new Set([current.revision, current.previousRevision]);
  for (const entry of await readdir(revisions, { withFileTypes: true })) {
    if (!entry.isDirectory() || retained.has(entry.name) || !(revisionId.test(entry.name) || /^\.import-[a-z0-9]{6}$/i.test(entry.name))) continue;
    await removeRevision(join(revisions, entry.name));
  }
  if (!current.legacyBackup) {
    const legacy = join(output, 'legacy-backup.json');
    try { await access(legacy); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const folder of folders) await rm(join(output, folder), { recursive: true, force: true, maxRetries: 5 });
    await rm(legacy, { force: true });
  }
}

async function removeRevision(directory) {
  const database = catalogDatabasePath(directory);
  if (dirname(database) !== directory) {
    for (const path of [database, recipeUsesDatabasePath(directory)]) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        await rm(`${path}${suffix}`, { force: true });
      }
    }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}

async function cleanPreviousImports(output, current) {
  try { await rotateBackups(output, current); } catch (error) {
    console.warn(`The catalog is live, but previous import files could not be removed: ${error.message}`);
  }
}

async function importRevision(output, archive, sourceHash, active, revision, report, useSqlite) {
  const previousRevision = active?.state === 'ready' && revisionId.test(active.revision) ? active.revision : undefined;
  const legacyBackup = active?.version === 1 || active?.version === 2;
  const progressive = !previousRevision && !legacyBackup;
  const revisions = join(output, 'revisions');
  const published = join(revisions, revision);
  await mkdir(revisions, { recursive: true });
  const staging = progressive ? published : await mkdtemp(join(revisions, '.import-'));
  if (progressive) await mkdir(staging);
  const publishedFiles = { pages: new Set(), lookup: new Set(), search: new Set() };
  const started = performance.now();
  let store;
  let partial;
  let committed = false;
  const storage = useSqlite ? catalogStorage : undefined;
  try {
    store = useSqlite ? await createCatalogDatabase(staging, progressive) : await createFileStore(staging);
    const publish = progressive ? async (items, atlases, expected) => {
      const manifest = await writeCatalog(store, items, [...atlases], {
        sourceHash, revision, storage, state: 'importing', expected,
      }, publishedFiles);
      store.checkpoint?.();
      await replaceCatalogJson(output, manifestName, manifest);
      partial = manifest;
    } : undefined;
    const result = await readArchive(archive, store, publish, createPacer(), report, !useSqlite, useSqlite);
    await report.setPhase('publishing');
    if (await hashArchive(archive) !== sourceHash) throw new Error('The WebCraft archive changed during import. Run the import again.');
    const current = await writeCatalog(store, result.items, result.atlases, {
      sourceHash, revision, previousRevision, legacyBackup, recipeDataVersion, storage,
      state: 'ready', expected: result.items.length,
    }, publishedFiles);
    store.finish?.();
    const metrics = { ...result.archiveStats, ...store.stats?.(), durationMs: Math.round(performance.now() - started) };
    store.close?.();
    store = undefined;
    const json = JSON.stringify(current);
    await writeFile(join(staging, manifestName), json);
    await writeFile(join(staging, 'import-metrics.json'), JSON.stringify(metrics));
    if (!progressive) {
      const database = catalogDatabasePath(staging);
      if (useSqlite && dirname(database) !== staging) await moveFile(database, catalogDatabasePath(published));
      await moveFile(staging, published);
    }
    if (legacyBackup) await writeFile(join(output, 'legacy-backup.json'), JSON.stringify(active));
    await replaceCatalogJson(output, manifestName, current);
    committed = true;
    await cleanPreviousImports(output, current);
    console.log(`Imported ${result.items.length} items and ${result.images} previews. ${JSON.stringify(metrics)}`);
  } catch (error) {
    if (partial && !committed) await replaceCatalogJson(output, manifestName, { ...partial, state: 'failed' });
    throw error;
  } finally {
    store?.close?.();
    if (!committed && !partial) {
      await removeRevision(staging);
      if (staging !== published) await removeRevision(published);
    }
  }
}

async function inboxArchive(inbox) {
  const processing = join(inbox, '.processing.zip');
  async function hasFile(path) {
    try {
      if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file at ${path}.`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  if (await hasFile(processing)) return processing;
  const incoming = join(inbox, 'previews.zip');
  if (!(await hasFile(incoming))) return;
  await moveFile(incoming, processing);
  return processing;
}

async function importArchive(output, source, skipCurrent, useSqlite) {
  const sourceHash = await hashArchive(source);
  const active = await activeManifest(output);
  const storage = useSqlite ? catalogStorage : undefined;
  if (skipCurrent && active?.version === layout.version && active.recipeDataVersion === recipeDataVersion && active.storage === storage
    && active.state === 'ready' && active.sourceHash === sourceHash
    && revisionId.test(active.revision) && (!useSqlite || hasCatalogDatabase(join(output, 'revisions', active.revision)))) {
    await cleanPreviousImports(output, active);
    await publishImportStatus(output, active.revision, 'succeeded');
    console.log('Item catalog is up to date.');
    return;
  }
  const revision = randomBytes(32).toString('hex');
  const status = reportImport(output, revision);
  await status.started;
  try {
    await importRevision(output, source, sourceHash, active, revision, status, useSqlite);
    await status.finish('succeeded');
  } catch (error) {
    await status.finish('failed');
    throw error;
  }
}

async function run(archive, inbox, useSqlite = true) {
  const { DatabaseSync } = await import('node:sqlite');
  const server = process.env.CAPYCRAFT_ITEM_SERVER?.trim() || defaultAlias;
  const instance = loadInstances(instanceDirectory(process.env.CAPYCRAFT_INSTANCE_DIR, root)).get(server);
  if (!instance) {
    throw new Error('CAPYCRAFT_ITEM_SERVER must match a configured server alias.');
  }
  const output = itemCatalogDirectory(instance, resolve(root, process.env.CAPYCRAFT_ITEM_CATALOG_DIR || 'public/item-catalog'));
  await mkdir(output, { recursive: true });
  const lock = new DatabaseSync(join(output, '.import-lock.sqlite'));
  try {
    try { lock.exec('BEGIN IMMEDIATE'); } catch (error) {
      if (error.errcode !== 5) throw error;
      if (inbox) return;
      throw new Error('An item catalog import is already running.');
    }
    const source = inbox ? await inboxArchive(inbox) : archive;
    if (!source) return;
    const failedArchive = inbox && join(inbox, '.failed.zip');
    try {
      await importArchive(output, source, Boolean(inbox), useSqlite);
    } catch (error) {
      if (failedArchive) {
        try { await moveFile(source, failedArchive); } catch (moveError) {
          console.warn(`Could not move the failed item archive: ${moveError.message}`);
        }
      }
      throw error;
    }
    if (failedArchive) {
      await rm(source, { force: true });
      await rm(failedArchive, { force: true });
    }
  } finally {
    lock.close();
  }
}

async function main([argument, ...extra]) {
  if (!argument || extra.length) throw new Error('Usage: npm run import:items -- <path-to-previews.zip>');
  try {
    process.loadEnvFile(join(root, '.env.local'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (argument !== '--inbox' && argument !== '--inbox-sqlite') return run(resolve(argument));
  const inbox = resolve(root, process.env.CAPYCRAFT_ITEM_IMPORT_DIR?.trim() || 'data/item-imports');
  await mkdir(inbox, { recursive: true });
  if (!(await readdir(inbox)).some(name => name === 'previews.zip' || name === '.processing.zip')) return;
  // A running API from before the SQLite reader still invokes --inbox.
  return run(undefined, inbox, argument === '--inbox-sqlite');
}

export async function benchmarkCatalogImport(archive, store, useAtlases) {
  sharp.concurrency(1);
  const started = performance.now();
  const result = await readArchive(archive, store, undefined, () => {}, {
    setPhase() {}, setLoaded() {},
  }, useAtlases);
  const indexedAt = performance.now();
  const manifest = await writeCatalog(store, result.items, result.atlases, {}, {
    pages: new Set(), lookup: new Set(), search: new Set(),
  });
  return {
    manifest, items: result.items, atlasMs: result.atlasMs, zipReadMs: result.archiveStats.zipReadMs,
    processingMs: indexedAt - started, indexingMs: performance.now() - indexedAt,
  };
}

export { createFileStore };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
