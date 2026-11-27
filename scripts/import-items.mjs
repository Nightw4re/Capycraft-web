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
import { lookupSlot, readItemBar, readTooltipAlternatives, searchText } from '../src/items/catalogIndex.mjs';
import { atlasIconName, atlasRows } from '../src/items/previewAtlas.mts';
import { readCatalogImportDurations } from '../src/liveUpdates.mts';
import { defaultAlias } from '../src/minecraftServers.mjs';
import { catalogDatabasePath, catalogStorage, createCatalogDatabase, hasCatalogDatabase } from '../server/catalogAssets.mts';
import { instanceDirectory, itemCatalogDirectory, loadInstances } from '../server/instances.mts';
import { ponderStorage } from '../server/ponderStorage.mts';
import { preparePonderImport } from './import-ponder.mjs';
import { addRecipeUses, createRecipeUsesIndex, recipeUsesIndexFile } from '../server/recipeUsesIndex.mjs';
import { recipeUsesDatabasePath, writeStoredRecipeUses } from '../server/recipeUsesStore.mts';

const root = join(import.meta.dirname, '..');
const itemId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const previewPath = /^(?:previews|animations)\/[a-f0-9]{64}\.(?:png|webp)$/;
const revisionId = /^[a-f0-9]{64}$/;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const atlasIndexPath = 'previews/atlas-index.json';
const atlasDirectory = 'previews/atlases/';
const atlasPath = /^previews\/atlases\/[a-f0-9]{64}\.webp$/;
const maxAtlasIndexBytes = 32 * 1024 * 1024;
const maxAtlasBytes = 4 * 1024 * 1024;
const folders = ['icons', 'details', 'atlases', 'pages', 'lookup', 'search', 'payloads'];
const manifestName = 'catalog.json';
const recipeItemPreviewPath = 'catalog-data/recipe-item-previews.json';
const advancementPreviewPath = 'catalog-data/advancement-previews.json';
const maxPreviewIndexBytes = 16 * 1024 * 1024;
const recipeDataVersion = 7;
const previewDataVersion = 4;
const searchDataVersion = 1;
const fluidRecipePath = /^catalog-data\/machine-recipes\/fluids\/([a-z0-9_.-]+)\/([a-z0-9_./-]+)\.json$/;
const catalogDocumentPath = /^catalog-data\/(?:tooltips|stacks|recipes|recipe-tags|machine-recipes\/(?:items|fluids|groups))\/.+\.json$/;
const bundleRoot = 'catalog-data/bundles/v1/';
const bundlePath = /^catalog-data\/bundles\/v1\/(?:index\/)?\d+\.json$/;
const fluidTextureFolder = 'catalog-data/machine-recipes/textures';
const fluidTexturePath = /^catalog-data\/machine-recipes\/textures\/[a-f0-9]{64}\.(?:png|webp)$/;

function digest(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function createFileStore(destination) {
  for (const folder of folders) await mkdir(join(destination, folder));
  return {
    write: (folder, name, data) => writeFile(join(destination, folder, name), data),
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
  const records = items.map(({ searchTooltip, searchTags, ...item }) => item);
  const pages = { cs: [], en: [] };
  for (const language of Object.keys(pages)) {
    for (let first = 0; first < items.length; first += layout.pageSize) {
      const page = order[language].slice(first, first + layout.pageSize).map(index => records[index]);
      pages[language].push(await writeJson(store, 'pages', page, publishedFiles.pages));
    }
  }
  const buckets = Array.from({ length: 256 }, () => []);
  for (const item of records) buckets[lookupSlot(item.id)].push(item);
  const lookup = [];
  for (const bucket of buckets) lookup.push(bucket.length ? await writeJson(store, 'lookup', bucket, publishedFiles.lookup) : null);

  const searchItems = items.map(item => ({
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

function isLosslessWebp(image) {
  if (image.length < 20 || image.toString('ascii', 0, 4) !== 'RIFF'
    || image.readUInt32LE(4) !== image.length - 8 || image.toString('ascii', 8, 12) !== 'WEBP') return false;
  let lossless = false;
  let offset = 12;
  while (offset + 8 <= image.length) {
    const chunk = image.toString('ascii', offset, offset + 4);
    const length = image.readUInt32LE(offset + 4);
    if (chunk === 'VP8 ' || chunk === 'ANIM' || chunk === 'ANMF' || (chunk === 'VP8L' && lossless)) return false;
    if (chunk === 'VP8L') lossless = true;
    offset += 8 + length + (length % 2);
  }
  return lossless && offset === image.length;
}

async function importPreviewAtlases(entries, read, store, pace) {
  const entry = entries.get(atlasIndexPath);
  const icons = new Map();
  if (!entry) return { atlases: [], icons };
  if (entry.uncompressedSize > maxAtlasIndexBytes) throw new Error('Preview atlas index is too large.');
  const { version, tileSize, columns, rows, atlases, sprites } = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await read(entry)),
  ) ?? {};
  if (version !== 1 || tileSize !== layout.tileSize || columns !== layout.atlasColumns || rows !== atlasRows
    || !Array.isArray(atlases) || atlases.some(hash => typeof hash !== 'string' || !revisionId.test(hash))
    || !sprites || typeof sprites !== 'object' || Array.isArray(sprites)) {
    throw new Error('Invalid preview atlas index.');
  }
  for (const [key, tile] of Object.entries(sprites)) {
    const [index, position] = Array.isArray(tile) && tile.length === 2 ? tile : [];
    if (!revisionId.test(key) || !Number.isSafeInteger(index) || index < 0 || index >= atlases.length
      || !Number.isSafeInteger(position) || position < 0 || position >= layout.pageSize) {
      throw new Error(`Invalid preview atlas tile for ${key}.`);
    }
    icons.set(key, atlasIconName(atlases[index], position));
  }
  for (const hash of new Set(atlases)) {
    const path = `${atlasDirectory}${hash}.webp`;
    const imageEntry = entries.get(path);
    if (!imageEntry || imageEntry.uncompressedSize > maxAtlasBytes) {
      throw new Error(`Missing or oversized preview atlas: ${path}`);
    }
    await pace();
    const image = await read(imageEntry, true);
    if (digest(image) !== hash || !isLosslessWebp(image)) throw new Error(`Invalid preview atlas: ${path}`);
    const metadata = await sharp(image).metadata().catch(cause => {
      throw new Error(`Invalid preview atlas: ${path}`, { cause });
    });
    if (metadata.format !== 'webp' || metadata.width !== columns * tileSize || metadata.height !== rows * tileSize) {
      throw new Error(`Invalid preview atlas dimensions: ${path}`);
    }
    await store.write('atlases', `${hash}.webp`, image);
  }
  return { atlases, icons };
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

async function readArchive(path, store, publish, pace, report, indexedRecipeUses = false) {
  const zipStarted = performance.now();
  const zip = await yauzl.openPromise(path, { autoClose: false, strictFileNames: true });
  const entries = new Map();
  const fluidRecipePaths = new Set();
  const recipeUses = createRecipeUsesIndex();
  const archiveStats = { entries: zip.entryCount, zipReadMs: 0, dataReads: 0, dataBytes: 0, imageReads: 0, imageBytes: 0 };

  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (name.startsWith(atlasDirectory) && name !== atlasDirectory && !atlasPath.test(name)) {
        throw new Error(`Invalid preview atlas path: ${name}`);
      }
      if (name !== 'format.txt' && name !== 'catalog.json' && name !== recipeItemPreviewPath && name !== advancementPreviewPath
        && name !== atlasIndexPath && !atlasPath.test(name)
        && !previewPath.test(name) && !fluidTexturePath.test(name)
        && !catalogDocumentPath.test(name) && !bundlePath.test(name)) continue;
      if (entries.has(name)) throw new Error(`Duplicate export entry: ${name}`);
      entries.set(name, entry);
      if (fluidRecipePath.test(name)) fluidRecipePaths.add(name);
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

    const atlasStarted = performance.now();
    const { atlases, icons: atlasIcons } = await importPreviewAtlases(entries, read, store, pace);
    const atlasMs = entries.has(atlasIndexPath) ? performance.now() - atlasStarted : 0;
    const imported = new Map();
    const written = new Set();
    const writtenPayloads = new Set();
    const tooltipShortcuts = new Map();
    const bundledDocuments = new Map();
    const bundleBytes = new Map();
    for (const [name, entry] of entries) {
      if (!name.startsWith(`${bundleRoot}index/`)) continue;
      const index = JSON.parse((await read(entry)).toString('utf8'));
      for (const [logicalPath, range] of Object.entries(index)) {
        if (!catalogDocumentPath.test(logicalPath) || entries.has(logicalPath)) continue;
        const [bundle, offset, length] = Array.isArray(range) ? range : [];
        const bundleEntry = entries.get(`${bundleRoot}${bundle}.json`);
        if (bundledDocuments.has(logicalPath) || !Number.isSafeInteger(bundle) || bundle < 0 || !bundleEntry
          || !Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(length) || length < 1
          || length > bundleEntry.uncompressedSize - offset) {
          throw new Error(`Invalid catalog bundle reference for ${logicalPath}`);
        }
        bundledDocuments.set(logicalPath, { bundleEntry, offset, length });
        if (fluidRecipePath.test(logicalPath)) fluidRecipePaths.add(logicalPath);
      }
    }

    async function readDocument(path) {
      const entry = entries.get(path);
      if (entry) return read(entry);
      const range = bundledDocuments.get(path);
      if (!range) return undefined;
      const { bundleEntry, offset, length } = range;
      if (!bundleBytes.has(bundleEntry)) bundleBytes.set(bundleEntry, await read(bundleEntry));
      return bundleBytes.get(bundleEntry).subarray(offset, offset + length);
    }
    async function importIcon(key, folder = 'previews') {
      if (typeof key !== 'string') return undefined;
      const animated = folder === 'previews' ? entries.get(`animations/${key}.webp`) ?? entries.get(`animations/${key}.png`) : undefined;
      if (!animated && folder === 'previews' && atlasIcons.has(key)) return atlasIcons.get(key);
      const entry = animated ?? entries.get(`${folder}/${key}.webp`) ?? entries.get(`${folder}/${key}.png`);
      if (!entry) return undefined;
      if (imported.has(entry.fileName)) return imported.get(entry.fileName);

      const image = await read(entry, true);
      const webp = entry.fileName.endsWith('.webp');
      const filename = `${digest(image)}.${webp ? 'webp' : 'png'}`;
      if (!written.has(filename)) {
        if (webp) {
          const { format } = await sharp(image).metadata().catch(cause => {
            throw new Error(`Invalid WebP in ${entry.fileName}`, { cause });
          });
          if (format !== 'webp') throw new Error(`Invalid WebP in ${entry.fileName}`);
        } else if (!image.subarray(0, pngSignature.length).equals(pngSignature)) {
          throw new Error(`Invalid PNG in ${entry.fileName}`);
        }
        await store.write('icons', filename, image);
        written.add(filename);
      }
      imported.set(entry.fileName, filename);
      return filename;
    }

    async function readPayload(group, filename, valid, versions = [1]) {
      const bytes = await readDocument(`catalog-data/${group}/${filename}.json`);
      if (!bytes) return undefined;
      const payload = JSON.parse(bytes.toString('utf8'));
      if (!versions.includes(payload?.version) || !valid(payload)) return undefined;
      return { bytes, payload };
    }

    const machineGroups = new Map();
    const fluidIcons = new Map();
    async function addFluidIcons(recipe) {
      const slots = recipe?.layout?.slots;
      if (!Array.isArray(slots)) return recipe;
      const decorated = [];
      let changed = false;
      for (const slot of slots) {
        if (!Array.isArray(slot?.alternatives)
          || !slot.alternatives.some(value => value?.kind === 'fluid' && typeof value.texture === 'string')) {
          decorated.push(slot);
          continue;
        }
        const alternatives = [];
        let updated = false;
        for (const value of slot.alternatives) {
          if (value?.kind === 'fluid' && typeof value.texture === 'string') {
            if (!fluidIcons.has(value.texture)) fluidIcons.set(value.texture, await importIcon(value.texture, fluidTextureFolder));
            const icon = fluidIcons.get(value.texture);
            if (icon) {
              alternatives.push({ ...value, icon });
              updated = true;
              continue;
            }
          }
          alternatives.push(value);
        }
        decorated.push(updated ? { ...slot, alternatives } : slot);
        changed ||= updated;
      }
      return changed ? { ...recipe, layout: { ...recipe.layout, slots: decorated } } : recipe;
    }
    async function readMachineRecipes(kind, path, id) {
      const idField = kind === 'fluids' ? 'fluidId' : 'itemId';
      const data = await readPayload(`machine-recipes/${kind}`, path, payload => payload[idField] === id, [1, 2]);
      if (!data) return undefined;
      const { groups, ...payload } = data.payload;
      if (payload.version === 1) {
        if (!Array.isArray(payload.recipes)) return undefined;
        const recipes = [];
        for (const recipe of payload.recipes) recipes.push(await addFluidIcons(recipe));
        return { ...payload, recipes };
      }
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
          recipes.push(await addFluidIcons({ ...template, id: variant.id, layout: { ...template.layout, slots } }));
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

    const recipeTags = new Map();
    async function readRecipeTag(tag) {
      if (!recipeTags.has(tag)) {
        const data = await readPayload('recipe-tags', tag.replace(':', '/'), value => value.id === tag && Array.isArray(value.items));
        recipeTags.set(tag, data?.payload.items);
      }
      return recipeTags.get(tag);
    }

    const tagPaths = new Set([...entries.keys(), ...bundledDocuments.keys()].filter(path => path.startsWith('catalog-data/recipe-tags/')));
    const tagsByItem = new Map();
    for (const path of tagPaths) {
      const tag = path.slice('catalog-data/recipe-tags/'.length, -'.json'.length).replace('/', ':');
      if (!itemId.test(tag)) continue;
      const searchTag = searchText(tag);
      for (const item of (await readRecipeTag(tag)) ?? []) {
        if (!tagsByItem.has(item)) tagsByItem.set(item, []);
        tagsByItem.get(item).push(searchTag);
      }
    }

    async function expandRecipe(recipe) {
      if (!Array.isArray(recipe?.inputs)) return recipe;
      const inputs = [];
      for (const input of recipe.inputs) {
        if (!input || (!Array.isArray(input.tags) && !Array.isArray(input.items))) {
          inputs.push(input);
          continue;
        }
        const examples = Array.isArray(input.exampleItems) ? input.exampleItems : undefined;
        const explicit = Array.isArray(input.items) ? input.items : [];
        const items = new Set([...(examples ?? []), ...explicit]);
        let examplesTruncated = input.examplesTruncated === true;
        for (const tag of Array.isArray(input.tags) ? input.tags : []) {
          const members = typeof tag === 'string' && itemId.test(tag) ? await readRecipeTag(tag) : undefined;
          if (!members && !examples) examplesTruncated = true;
          for (const item of members ?? []) items.add(item);
        }
        inputs.push({ ...input, exampleItems: [...items], examplesTruncated });
      }
      return { ...recipe, inputs };
    }

    async function importRecipes(id, path) {
      const forItem = data => data.itemId === id && Array.isArray(data.recipes);
      const world = await readPayload('recipes', path, forItem, [1, 2]);
      const machine = await readMachineRecipes('items', path, id);
      const feed = world?.payload ?? { version: 1, itemId: id, recipes: [] };
      if (feed.version === 2) {
        const recipes = [];
        for (const recipe of feed.recipes) recipes.push(await expandRecipe(recipe));
        feed.recipes = recipes;
      }
      if (world) addRecipeUses(recipeUses, feed.recipes);
      if (machine) {
        return writePayload(Buffer.from(JSON.stringify({ ...feed, machineRecipes: machine })));
      }
      return world && writePayload(feed.version === 2 ? Buffer.from(JSON.stringify(feed)) : world.bytes);
    }

    async function importStackData(path, variant = '', search = undefined) {
      const filename = `${path}@${variant.replaceAll(':', '%3A').replaceAll('/', '%2F')}`;
      const tooltipExport = await readPayload('tooltips', filename, data => Array.isArray(data.lines));
      const tooltip = tooltipExport && await writePayload(tooltipExport.bytes);
      const alternatives = readTooltipAlternatives(tooltipExport?.payload);
      for (const { id, label } of alternatives) {
        if (!tooltipShortcuts.has(id)) tooltipShortcuts.set(id, { id, label });
      }
      if (tooltipExport && search) {
        const lines = tooltipExport.payload.lines.filter(Array.isArray).map(line => line.map(span =>
          typeof span?.text === 'string' ? span.text : '').join(''));
        const normalized = searchText(lines.join('\n'));
        if (normalized.trim()) search.searchTooltip = normalized;
      }
      const stack = await importPayload('stacks', filename, data => Number.isInteger(data.count) && 'nbt' in data && 'components' in data);
      return {
        payloads: tooltip || stack ? { tooltip, stack } : undefined,
        tooltipShortcutIds: alternatives.length ? alternatives.map(({ id }) => id) : undefined,
      };
    }

    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !itemId.test(row.id) || seen.has(row.id)) {
        throw new Error(`Invalid or duplicate catalog item ID: ${row?.id}`);
      }
      seen.add(row.id);
      row.name = typeof row.name === 'string' && row.name.trim() ? row.name : row.id;
    }
    async function importPreviewIndex(path, exclude) {
      const entry = entries.get(path);
      if (!entry) return;
      if (entry.uncompressedSize > maxPreviewIndexBytes) {
        throw new Error(`Preview index is too large: ${path}`);
      }
      const keys = JSON.parse((await read(entry)).toString('utf8'));
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error(`Invalid preview index: ${path}`);
      const icons = Object.create(null);
      for (const [id, key] of Object.entries(keys)) {
        if (exclude?.has(id) || !itemId.test(id) || typeof key !== 'string' || !revisionId.test(key)) continue;
        const icon = await importIcon(key);
        if (icon) icons[id] = icon;
      }
      if (Object.keys(icons).length) return writeJson(store, 'payloads', icons);
    }
    const previewIndexes = {
      recipeItemIcons: await importPreviewIndex(recipeItemPreviewPath, seen),
      advancementIcons: await importPreviewIndex(advancementPreviewPath),
    };
    const fluids = new Map();
    for (const path of fluidRecipePaths) {
      const [, namespace, resource] = fluidRecipePath.exec(path);
      const fluidId = `${namespace}:${resource}`;
      const machine = await readMachineRecipes('fluids', `${namespace}/${resource}`, fluidId);
      if (!machine?.recipes.length) continue;
      const outputs = machine.recipes.flatMap(recipe => {
        const slots = recipe?.layout?.slots;
        return Array.isArray(slots) ? slots.filter(slot => slot?.role === 'output' && Array.isArray(slot.alternatives))
          .flatMap(slot => slot.alternatives).filter(value => value?.kind === 'fluid' && value.id === fluidId) : [];
      });
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
      rows.push({ id, name, previewKey: machine.previewKey, fluidIcon: outputs.find(output => output.icon)?.icon });
    }
    await report.setStage('items', 'processing', 'Import item previews and data', { loaded: 0, expected: rows.length });
    const items = [];
    let checkpoint = { count: 0, at: Date.now() };
    if (publish) await publish(items, atlases, rows.length, [], previewIndexes);
    for (const position of catalogOrder(rows, 'cs')) {
      const row = rows[position];
      report.setItem(row.id);
      const itemPath = row.id.replace(':', '/');
      const fluid = fluids.get(row.id);
      const icon = await importIcon(row.previewKey) ?? (fluid ? row.fluidIcon : undefined);
      const search = { searchTags: tagsByItem.get(row.id) };
      const { payloads, tooltipShortcutIds } = fluid ? {} : await importStackData(itemPath, '', search);
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
        const { payloads } = await importStackData(itemPath, variant.id);
        if (!icon && !payloads) continue;
        variantIds.add(variant.id);
        variants.push({ id: variant.id, name: labels.join(' / ') || variant.id, icon, payloads, bar: readItemBar(variant.bar) });
      }

      let detail;
      if (variants.length || payloads || recipeFeed) {
        detail = await writeJson(store, 'details', { version: layout.detailVersion, id: row.id, variants, payloads, recipeFeed });
      }
      items.push({
        id: row.id, name: row.name, icon, detail, bar: readItemBar(row.bar), fluidId: fluid?.fluidId, tooltipShortcutIds, ...search,
      });
      if (items.length % layout.pageSize === 0) await pace();
      report.setLoaded(items.length);
      const sinceCheckpoint = Date.now() - checkpoint.at;
      if (publish && (items.length === 1 || (items.length - checkpoint.count >= 500 && sinceCheckpoint >= 5000)
        || sinceCheckpoint >= 30000)) {
        await publish(items, atlases, rows.length, [...tooltipShortcuts.values()], previewIndexes);
        checkpoint = { count: items.length, at: Date.now() };
      }
    }

    await report.setStage('recipe-index', 'processing', 'Write recipe uses index');
    if (indexedRecipeUses) await writeStoredRecipeUses(store, recipeUses, report.setRecipeUses);
    else await store.write('search', recipeUsesIndexFile, JSON.stringify(recipeUses));
    return { items, atlases, tooltipShortcuts: [...tooltipShortcuts.values()], previewIndexes,
      images: written.size, atlasMs, archiveStats };
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

function reportImport(output, revision, server, source, lastStageDurations) {
  const logDirectory = join(root, 'data', 'item-import-logs', server);
  const logPath = join(logDirectory, 'latest.log');
  const startedAt = performance.now();
  let logging = true;
  function warnLog(error) {
    logging = false;
    console.warn(`Could not write item import log: ${error.message}`);
  }
  async function append(entry) {
    if (!logging) return;
    await writeFile(logPath, `${JSON.stringify(entry)}\n`, {
      mode: 0o600, flag: entry.event === 'started' ? 'w' : 'a',
    }).catch(warnLog);
  }

  let phase = 'preparing';
  let stage = 'preparing';
  let stagePlan;
  let stageStartedAt = startedAt;
  const stageDurations = {};
  let step = 'Hash source archive';
  let progress;
  let item;
  let recipeUses;
  let lastProgressWrite = performance.now();
  let progressWritePending = false;
  let pending = mkdir(logDirectory, { recursive: true, mode: 0o700 }).then(async () => {
    const entries = await readdir(logDirectory, { withFileTypes: true });
    await Promise.all(entries.filter(entry => entry.isFile()
      && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9]{12}\.log$/.test(entry.name))
      .map(entry => rm(join(logDirectory, entry.name), { force: true })));
  }).catch(error => console.warn(`Could not prepare item import logs: ${error.message}`));
  function queue(event, state = 'running', statusRevision = revision, details) {
    const stageElapsedMs = Math.round(performance.now() - stageStartedAt);
    const activity = { phase, stage, stagePlan, stageElapsedMs, progress: progress && { ...progress } };
    const historicalDurations = lastStageDurations;
    const recipeIndexProgress = stage === 'recipe-index' && recipeUses?.totalIngredients > 0
      ? { indexed: recipeUses.indexedIngredients, total: recipeUses.totalIngredients }
      : undefined;
    const entry = {
      time: new Date().toISOString(), elapsedMs: Math.round(performance.now() - startedAt),
      event, state, revision: statusRevision, ...activity, step, item, recipeUses, ...details,
    };
    pending = pending.then(async () => {
      if (event !== 'progress') await append(entry);
      if (event === 'step') return;
      const status = {
        state, revision: statusRevision, updatedAt: Date.now(), lastStageDurations: historicalDurations,
        ...(state === 'running' && { ...activity, recipeIndexProgress }),
      };
      try {
        await replaceCatalogJson(output, layout.statusFile, status);
      } catch (error) {
        console.warn(`Could not publish item import status: ${error.message}`);
        await append({ ...entry, event: 'status-write-failed', error: error.message });
      }
    });
    return pending;
  }
  const started = queue('started', 'running', revision, { server, archive: source }).then(() => {
    if (logging) console.log(`Item import log: ${logPath}`);
  });
  const timer = setInterval(() => { void queue('heartbeat'); }, layout.statusHeartbeatMs);
  function publishProgress() {
    const now = performance.now();
    if (progressWritePending || now - lastProgressWrite < 2000) return;
    lastProgressWrite = now;
    progressWritePending = true;
    void queue('progress').finally(() => { progressWritePending = false; });
  }
  function finishStage(now) {
    stageDurations[stage] = Math.max(1, Math.round(now - stageStartedAt));
  }
  return {
    started,
    setPlan(plan) {
      stagePlan = plan;
      return queue('plan');
    },
    setStage(nextStage, nextPhase, nextStep, counts) {
      if (nextStage !== stage) {
        const now = performance.now();
        finishStage(now);
        stageStartedAt = now;
      }
      stage = nextStage;
      phase = nextPhase;
      step = nextStep;
      progress = counts;
      item = undefined;
      lastProgressWrite = performance.now();
      return queue('phase');
    },
    setStep(next) {
      step = next;
      item = undefined;
      return queue('step');
    },
    setItem(id) {
      item = id;
    },
    setLoaded(loaded) {
      progress.loaded = loaded;
      publishProgress();
    },
    setRecipeUses(details) {
      recipeUses = details;
      publishProgress();
    },
    async finish(state, statusRevision, error) {
      clearInterval(timer);
      if (state === 'succeeded') {
        finishStage(performance.now());
        lastStageDurations = { ...lastStageDurations, ...stageDurations };
      }
      await queue('finished', state, statusRevision, error && { error: error.stack ?? String(error) });
      if (state === 'succeeded' && logging) await rm(logPath, { force: true }).catch(warnLog);
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

export async function importRevision(output, archive, sourceHash, active, revision, report, useSqlite) {
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
    const publish = progressive ? async (items, atlases, expected, tooltipShortcuts, previewIndexes) => {
      const manifest = await writeCatalog(store, items, [...atlases], {
        sourceHash, revision, storage, state: 'importing', expected, tooltipShortcuts, ...previewIndexes,
      }, publishedFiles);
      store.checkpoint?.();
      await replaceCatalogJson(output, manifestName, manifest);
      partial = manifest;
    } : undefined;
    const result = await readArchive(archive, store, publish, createPacer(), report, useSqlite);
    await report.setStage('publishing', 'publishing', 'Verify source archive');
    if (await hashArchive(archive) !== sourceHash) throw new Error('The WebCraft archive changed during import. Run the import again.');
    await report.setStep('Write catalog indexes and publish revision');
    const current = await writeCatalog(store, result.items, result.atlases, {
      sourceHash, revision, previousRevision, legacyBackup, recipeDataVersion, previewDataVersion, searchDataVersion, storage,
      state: 'ready', expected: result.items.length, tooltipShortcuts: result.tooltipShortcuts, ...result.previewIndexes,
    }, publishedFiles);
    store.finish?.();
    const metrics = { ...result.archiveStats, ...store.stats?.(), durationMs: Math.round(performance.now() - started) };
    store.close?.();
    store = undefined;
    current.publishedAt = Date.now();
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
    console.log(`Imported ${result.items.length} items, ${result.images} standalone previews and ${result.atlases.length} atlases. ${JSON.stringify(metrics)}`);
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

async function importArchive(output, source, skipCurrent, useSqlite, server) {
  const revision = randomBytes(32).toString('hex');
  const lastStageDurations = await readFile(join(output, layout.statusFile), 'utf8')
    .then(contents => readCatalogImportDurations(JSON.parse(contents)?.lastStageDurations))
    .catch(() => undefined);
  const status = reportImport(output, revision, server, source, lastStageDurations);
  await status.started;
  let ponder;
  let statusRevision = revision;
  let active;
  let catalogUnchanged = false;
  try {
    const sourceHash = await hashArchive(source);
    await status.setStage('reading', 'preparing', 'Read export and validate Ponder data');
    ponder = await preparePonderImport(source, ponderStorage(root, server), sourceHash, revision, createPacer(), {
      async plan({ hasCatalog, writeScenes, writeDefinitions }) {
        const plan = ['preparing', 'reading'];
        if (writeScenes) plan.push('ponder-scenes');
        if (writeDefinitions) plan.push('ponder-definitions');
        if (hasCatalog) {
          active = await activeManifest(output);
          const storage = useSqlite ? catalogStorage : undefined;
          catalogUnchanged = skipCurrent && active?.version === layout.version && active.recipeDataVersion === recipeDataVersion
            && active.previewDataVersion === previewDataVersion && active.searchDataVersion === searchDataVersion && active.storage === storage
            && active.state === 'ready' && active.sourceHash === sourceHash && Array.isArray(active.tooltipShortcuts)
            && revisionId.test(active.revision) && (!useSqlite || hasCatalogDatabase(join(output, 'revisions', active.revision)));
          if (!catalogUnchanged) plan.push('items', 'recipe-index');
        }
        if (plan.length > 2) plan.push('publishing');
        await status.setPlan(plan);
      },
      start(stage, expected) {
        const step = stage === 'ponder-scenes' ? 'Process Ponder scenes' : 'Validate and store Ponder definitions';
        return status.setStage(stage, 'processing', step, { loaded: 0, expected });
      },
      advance: status.setLoaded,
    });
    if (!ponder.hasCatalog && !ponder.publish && !ponder.current) {
      throw new Error('The archive contains no item catalog, Ponder scenes, or Ponder definitions.');
    }
    if (ponder.hasCatalog) {
      if (catalogUnchanged) {
        await cleanPreviousImports(output, active);
        statusRevision = active.revision;
        console.log('Item catalog is up to date.');
      } else {
        await status.setStage('items', 'processing', 'Read archive and prepare item data');
        await importRevision(output, source, sourceHash, active, revision, status, useSqlite);
      }
    }
    if (ponder.publish) {
      await status.setStage('publishing', 'publishing', 'Publish Ponder data');
      if (await hashArchive(source) !== sourceHash) throw new Error('The WebCraft archive changed during import. Run the import again.');
      await ponder.publish();
      if (ponder.scenes !== undefined) console.log('Published ' + ponder.scenes + ' Ponder scenes.');
      if (ponder.definitions !== undefined) console.log('Imported ' + ponder.definitions + ' Ponder definitions.');
    }
    await status.finish('succeeded', ponder.current && !ponder.hasCatalog ? ponder.current : statusRevision);
  } catch (error) {
    await status.finish('failed', revision, error);
    throw error;
  } finally {
    await ponder?.discard?.();
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
      await importArchive(output, source, Boolean(inbox), useSqlite, server);
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

export async function benchmarkCatalogImport(archive, store, indexedRecipeUses = false) {
  sharp.concurrency(1);
  const started = performance.now();
  const result = await readArchive(archive, store, undefined, () => {}, {
    setStage() {}, setStep() {}, setItem() {}, setLoaded() {}, setRecipeUses() {},
  }, indexedRecipeUses);
  const indexedAt = performance.now();
  const manifest = await writeCatalog(store, result.items, result.atlases, {
    tooltipShortcuts: result.tooltipShortcuts, ...result.previewIndexes,
  }, {
    pages: new Set(), lookup: new Set(), search: new Set(),
  });
  return {
    manifest, atlasMs: result.atlasMs, zipReadMs: result.archiveStats.zipReadMs,
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
