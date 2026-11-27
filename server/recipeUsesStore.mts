import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { catalogDatabasePath, createAssetDatabase } from './catalogAssets.mts';
import type { RecipeUsesIndex } from './recipeUsesIndex.mjs';

const groups = 'recipe-uses-ingredients';
const recipes = 'recipe-uses-recipes';
const legacyMarker = 'indexed-v2';
const responseGroups = 'recipe-uses-response-groups';
const payloads = 'recipe-uses-responses';
const marker = 'gzip-v3';
const responseStart = Buffer.from('{"recipes":[');
const responseEnd = Buffer.from(']}');
const comma = Buffer.from(',');
const emptyResponse = Buffer.concat([responseStart, responseEnd]);
const largeResponseBytes = 128 * 1024;
const indexWorkSliceMs = 100;

export type StoredRecipeUses = { bytes: Buffer; gzip?: true };

export function recipeUsesDatabasePath(revisionRoot: string) {
  return catalogDatabasePath(revisionRoot).replace(/\.sqlite$/, '.recipe-uses.sqlite');
}

export async function writeStoredRecipeUses(
  store: { write: (folder: string, name: string, data: string | Uint8Array) => unknown },
  index: RecipeUsesIndex,
  onProgress?: (progress: {
    preparedRecipes: number; totalRecipes: number; indexedIngredients: number; totalIngredients: number;
    compressedResponses: number; compressedBytes: number; elapsedMs: number;
  }) => void,
) {
  const ingredients = Object.entries(index.ingredients);
  const started = performance.now();
  let yieldAt = started + indexWorkSliceMs;
  let indexedIngredients = 0;
  let compressedBytes = 0;
  const ids: string[] = [];
  const encoded: Buffer[] = [];
  const written = new Set<string>();

  function report() {
    onProgress?.({
      preparedRecipes: encoded.length, totalRecipes: index.recipes.length,
      indexedIngredients, totalIngredients: ingredients.length, compressedResponses: written.size,
      compressedBytes, elapsedMs: Math.round(performance.now() - started),
    });
  }

  async function yieldIfNeeded() {
    if (performance.now() < yieldAt) return;
    report();
    // SQLite writes and compression are synchronous. Let timers and pending I/O run between batches.
    await setImmediate();
    yieldAt = performance.now() + indexWorkSliceMs;
  }

  report();
  for (const recipe of index.recipes) {
    ids.push(String(recipe?.id ?? ''));
    encoded.push(Buffer.from(JSON.stringify(recipe)));
    await yieldIfNeeded();
  }
  for (const [ingredient, positions] of ingredients) {
    await yieldIfNeeded();
    const ordered = positions.filter(position => index.recipes[position])
      .sort((a, b) => ids[a].localeCompare(ids[b]));
    if (ordered.length) {
      const key = createHash('sha256').update(ordered.join(',')).digest('hex');
      if (!written.has(key)) {
        const response = recipeResponse(ordered.map(position => encoded[position]));
        const level = response.length >= largeResponseBytes ? 6 : 1;
        const compressed = gzipSync(response, { level });
        await store.write(payloads, key, compressed);
        compressedBytes += compressed.length;
        written.add(key);
      }
      await store.write(responseGroups, ingredient, key);
    }
    indexedIngredients++;
  }
  await store.write(responseGroups, marker, '1');
  report();
}

export async function publishRecipeUsesDatabase(revisionRoot: string, index: RecipeUsesIndex) {
  const output = recipeUsesDatabasePath(revisionRoot);
  const temporary = `${output}-${randomUUID()}.tmp`;
  try {
    const store = await createAssetDatabase(temporary);
    try {
      await writeStoredRecipeUses(store, index);
      store.finish();
    } finally {
      store.close();
    }
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

function recipeResponse(ordered: Uint8Array[]) {
  const parts: Uint8Array[] = [responseStart];
  for (const data of ordered) {
    if (!data) continue;
    if (parts.length > 1) parts.push(comma);
    parts.push(data);
  }
  parts.push(responseEnd);
  return Buffer.concat(parts);
}

export async function readStoredRecipeUses(revisionRoot: string, ingredient: string, gzipOnly = false): Promise<StoredRecipeUses | undefined> {
  const { DatabaseSync } = await import('node:sqlite');
  for (const path of [recipeUsesDatabasePath(revisionRoot), catalogDatabasePath(revisionRoot)]) {
    if (!existsSync(path)) continue;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const compressed = db.prepare(`
        SELECT payload.data, requested.name AS ingredient
        FROM assets AS ready
        LEFT JOIN assets AS requested ON requested.folder = ready.folder AND requested.name = ?
        LEFT JOIN assets AS payload ON payload.folder = ? AND payload.name = CAST(requested.data AS TEXT)
        WHERE ready.folder = ? AND ready.name = ?
      `).get(ingredient, payloads, responseGroups, marker);
      if (compressed) {
        if (typeof compressed.ingredient !== 'string') return { bytes: emptyResponse };
        const { data } = compressed;
        if (!(data instanceof Uint8Array)) throw new Error('Missing compressed recipe response');
        return { bytes: Buffer.from(data.buffer, data.byteOffset, data.byteLength), gzip: true };
      }
      const lookup = db.prepare('SELECT data FROM assets WHERE folder = ? AND name = ?');
      if (gzipOnly || !lookup.get(groups, legacyMarker)) continue;
      const positions = lookup.get(groups, ingredient)?.data;
      if (!(positions instanceof Uint8Array)) return { bytes: emptyResponse };
      // Drive the join from the requested positions to avoid scanning all recipe assets.
      const rows = db.prepare(`
        SELECT position.key AS ordinal, assets.data
        FROM json_each(CAST(? AS TEXT)) AS position
        CROSS JOIN assets ON assets.folder = ? AND assets.name = CAST(position.value AS TEXT)
      `).all(positions, recipes);
      const ordered: Uint8Array[] = [];
      for (const { ordinal, data } of rows) {
        if (typeof ordinal === 'number' && data instanceof Uint8Array) ordered[ordinal] = data;
      }
      return { bytes: recipeResponse(ordered) };
    } finally {
      db.close();
    }
  }
  return undefined;
}

export async function readLegacyStoredRecipeUsesIndex(revisionRoot: string): Promise<RecipeUsesIndex | undefined> {
  const { DatabaseSync } = await import('node:sqlite');
  for (const path of [recipeUsesDatabasePath(revisionRoot), catalogDatabasePath(revisionRoot)]) {
    if (!existsSync(path)) continue;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const lookup = db.prepare('SELECT data FROM assets WHERE folder = ? AND name = ?');
      if (!lookup.get(groups, legacyMarker)) continue;
      const rows = db.prepare('SELECT name, data FROM assets WHERE folder = ?');
      const index: RecipeUsesIndex = { recipes: [], ingredients: Object.create(null) };
      for (const row of rows.iterate(recipes)) {
        if (row.data instanceof Uint8Array) index.recipes[Number(row.name)] = JSON.parse(Buffer.from(row.data).toString('utf8'));
      }
      for (const row of rows.iterate(groups)) {
        if (typeof row.name === 'string' && row.name !== legacyMarker && row.data instanceof Uint8Array) {
          index.ingredients[row.name] = JSON.parse(Buffer.from(row.data).toString('utf8'));
        }
      }
      return index;
    } finally {
      db.close();
    }
  }
  return undefined;
}
