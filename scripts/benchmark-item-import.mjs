import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCatalogDatabase } from '../server/catalogAssets.mts';
import { benchmarkCatalogImport, createFileStore } from './import-items.mjs';

const [archive, repeat = '5'] = process.argv.slice(2);
const repetitions = Number(repeat);
if (!archive || !Number.isSafeInteger(repetitions) || repetitions < 1) {
  throw new Error('Usage: node scripts/benchmark-item-import.mjs <archive.zip> [repetitions]');
}

const modes = [
  { name: 'File storage with atlases', useAtlases: true, createStore: createFileStore },
  { name: 'File storage with direct icons', useAtlases: false, createStore: createFileStore },
  { name: 'SQLite with atlases', useAtlases: true, createStore: createCatalogDatabase },
  { name: 'SQLite with direct icons', useAtlases: false, createStore: createCatalogDatabase },
];
const measurements = modes.map(() => []);
let expectedItems;
const expectedManifests = new Map();

for (let run = 0; run < repetitions; run++) {
  // Rotate the run order so the same mode isn't always first on a warming filesystem cache.
  for (let offset = 0; offset < modes.length; offset++) {
    const index = (run + offset) % modes.length;
    const mode = modes[index];
    const directory = await mkdtemp(join(tmpdir(), 'capycraft-import-benchmark-'));
    let store;
    try {
      const started = performance.now();
      store = await mode.createStore(directory);
      let writeMs = 0;
      let entries = 0;
      const timedStore = {
        read: store.read,
        async write(...args) {
          const start = performance.now();
          await store.write(...args);
          writeMs += performance.now() - start;
          entries++;
        },
      };
      const result = await benchmarkCatalogImport(resolve(archive), timedStore, mode.useAtlases);
      const commitStarted = performance.now();
      store.finish?.();
      const finished = performance.now();
      const items = result.items.map(({ sprite, ...item }) => item);
      expectedItems ??= items;
      assert.deepEqual(items, expectedItems);
      if (!expectedManifests.has(mode.useAtlases)) expectedManifests.set(mode.useAtlases, result.manifest);
      assert.deepEqual(result.manifest, expectedManifests.get(mode.useAtlases));
      measurements[index].push({
        totalMs: finished - started,
        atlasMs: result.atlasMs,
        zipReadMs: result.zipReadMs,
        processingMs: result.processingMs,
        indexingMs: result.indexingMs,
        storageWriteMs: writeMs + finished - commitStarted,
        entries,
        atlases: result.manifest.atlases.length,
      });
    } finally {
      store?.close?.();
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function median(values) {
  const ordered = values.toSorted((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

console.log(JSON.stringify({
  items: expectedItems.length,
  repetitions,
  modes: modes.map(({ name }, index) => {
    const runs = measurements[index];
    const medians = Object.fromEntries(Object.keys(runs[0]).map(key => [key, Math.round(median(runs.map(run => run[key])))]));
    return { name, medians, runsMs: runs.map(run => Math.round(run.totalMs)) };
  }),
}, null, 2));
