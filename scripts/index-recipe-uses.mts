import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readCatalogAsset } from '../server/catalogAssets.mts';
import { recipeUsesIndexFile, type RecipeUsesIndex } from '../server/recipeUsesIndex.mjs';
import { publishRecipeUsesDatabase, readLegacyStoredRecipeUsesIndex, readStoredRecipeUses } from '../server/recipeUsesStore.mts';

const [argument, ...extra] = process.argv.slice(2);
if (!argument || extra.length) throw new Error('Usage: node scripts/index-recipe-uses.mts <catalog directory>');
const root = resolve(argument);
const manifest = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
if (manifest.state !== 'ready' || typeof manifest.revision !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.revision)) {
  throw new Error('The catalog must have a published revision.');
}
const revision = join(root, 'revisions', manifest.revision);
if (await readStoredRecipeUses(revision, 'minecraft:air', true) !== undefined) {
  console.log('The published catalog already has compressed recipe responses.');
} else {
  const bytes = await readCatalogAsset(revision, 'search', recipeUsesIndexFile).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  const index = bytes ? JSON.parse(bytes.toString('utf8')) as RecipeUsesIndex : await readLegacyStoredRecipeUsesIndex(revision);
  if (!index || !Array.isArray(index.recipes) || !index.ingredients || typeof index.ingredients !== 'object') {
    throw new Error('The catalog does not have a valid legacy recipe-uses index.');
  }
  await publishRecipeUsesDatabase(revision, index);
  console.log(`Indexed ${index.recipes.length} recipes and ${Object.keys(index.ingredients).length} ingredients.`);
}
