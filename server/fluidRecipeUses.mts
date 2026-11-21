import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { catalogDatabasePath, hasCatalogDatabase, readCatalogAsset } from './catalogAssets.mts';

const hash = /^[a-f0-9]{64}$/;
const fluidId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const scanSliceMs = 12;
const scanPauseMs = 4;

type MachineRecipe = {
  id: string;
  layout?: { slots?: { role?: string; alternatives?: { kind?: string; id?: string }[] }[] };
};

type RecipeFeed = { machineRecipes?: { recipes?: MachineRecipe[] } };

async function* readRecipeFeeds(root: string): AsyncGenerator<RecipeFeed> {
  if (hasCatalogDatabase(root)) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(catalogDatabasePath(root), { readOnly: true });
    try {
      let sliceStarted = performance.now();
      function pauseIfNeeded() {
        if (performance.now() - sliceStarted < scanSliceMs) return;
        return setTimeout(scanPauseMs).then(() => { sliceStarted = performance.now(); });
      }
      const names = new Set<string>();
      const details = db.prepare("SELECT json_extract(CAST(data AS TEXT), '$.recipeFeed') AS name FROM assets WHERE folder = 'details'");
      for (const { name } of details.iterate()) {
        if (typeof name === 'string' && hash.test(name)) names.add(name);
        const pause = pauseIfNeeded();
        if (pause) await pause;
      }

      const payload = db.prepare("SELECT data FROM assets WHERE folder = 'payloads' AND name = ?");
      for (const name of [...names].sort()) {
        const data = payload.get(`${name}.json`)?.data;
        if (data instanceof Uint8Array) {
          const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          if (bytes.includes('"machineRecipes"')) yield JSON.parse(bytes.toString('utf8')) as RecipeFeed;
        }
        const pause = pauseIfNeeded();
        if (pause) await pause;
      }
    } finally {
      db.close();
    }
    return;
  }

  const seen = new Set<string>();
  const files = await readdir(join(root, 'details')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of files) {
    if (!file.endsWith('.json') || !hash.test(file.slice(0, -5))) continue;
    const { recipeFeed } = JSON.parse((await readCatalogAsset(root, 'details', file)).toString('utf8'));
    if (typeof recipeFeed !== 'string' || !hash.test(recipeFeed) || seen.has(recipeFeed)) continue;
    seen.add(recipeFeed);
    yield JSON.parse((await readCatalogAsset(root, 'payloads', `${recipeFeed}.json`)).toString('utf8')) as RecipeFeed;
  }
}

export async function indexFluidRecipeUses(root: string) {
  const uses = new Map<string, Map<string, MachineRecipe>>();
  for await (const feed of readRecipeFeeds(root)) {
    const recipes = feed?.machineRecipes?.recipes;
    if (!Array.isArray(recipes)) continue;
    for (const recipe of recipes) {
      if (!recipe || typeof recipe.id !== 'string' || !fluidId.test(recipe.id) || !Array.isArray(recipe.layout?.slots)) continue;
      for (const slot of recipe.layout.slots) {
        if ((slot?.role !== 'input' && slot?.role !== 'catalyst') || !Array.isArray(slot.alternatives)) continue;
        for (const option of slot.alternatives) {
          if (option?.kind !== 'fluid' || typeof option.id !== 'string' || !fluidId.test(option.id)) continue;
          let matches = uses.get(option.id);
          if (!matches) uses.set(option.id, matches = new Map());
          matches.set(recipe.id, recipe);
        }
      }
    }
  }
  return uses;
}
