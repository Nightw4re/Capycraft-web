import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { defaultAlias } from '../src/minecraftServers.mjs';
import { catalogPublishedAt, catalogPublishedAtHeader, hasCatalogDatabase, readCatalogAsset } from './catalogAssets.mts';
import { indexFluidRecipeUses } from './fluidRecipeUses.mts';
import { addRecipeUses, createRecipeUsesIndex, recipeUsesIndexFile, type RecipeUsesIndex } from './recipeUsesIndex.mjs';
import { readStoredRecipeUses, type StoredRecipeUses } from './recipeUsesStore.mts';

export const itemRecipeUsesPath = '/api/item-recipe-uses';

const hash = /^[a-f0-9]{64}$/;
const itemId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const responseCacheBytes = 8 * 1024 * 1024;
const responseCacheEntries = 64;
const decompress = promisify(gunzip);
const recipeCacheControl = 'public, max-age=1800, s-maxage=1800';

type Manifest = { revision: string; previousRevision?: string; publishedAt?: number; state: string; search: string };

function acceptsGzip(header = '') {
  let wildcard = false;
  for (const encoding of header.toLowerCase().split(',')) {
    const [name, ...parameters] = encoding.trim().split(';');
    const quality = parameters.map(value => value.trim()).find(value => value.startsWith('q='));
    const accepted = quality === undefined || Number(quality.slice(2)) > 0;
    if (name.trim() === 'gzip') return accepted;
    if (name.trim() === '*') wildcard = accepted;
  }
  return wildcard;
}

function readJson<T>(path: string): Promise<T> {
  return readFile(path, 'utf8').then(text => JSON.parse(text) as T);
}

async function readAssetJson<T>(root: string, folder: string, name: string): Promise<T> {
  return JSON.parse((await readCatalogAsset(root, folder, name)).toString('utf8')) as T;
}

async function buildIndex(root: string, search: string) {
  const { items } = await readAssetJson<{ items: { detail?: string }[] }>(root, 'search', `${search}.json`);
  const details = [...new Set(items.flatMap(item => item.detail && hash.test(item.detail) ? [item.detail] : []))];
  const feeds = new Set<string>();
  const uses = createRecipeUsesIndex();
  let next = 0;

  async function indexDetails() {
    while (next < details.length) {
      const detail = details[next++];
      const { recipeFeed } = await readAssetJson<{ recipeFeed?: string }>(root, 'details', `${detail}.json`);
      if (!recipeFeed || !hash.test(recipeFeed) || feeds.has(recipeFeed)) continue;
      feeds.add(recipeFeed);
      const { recipes } = await readAssetJson<{ recipes: unknown[] }>(root, 'payloads', `${recipeFeed}.json`);
      addRecipeUses(uses, recipes);
    }
  }

  await Promise.all(Array.from({ length: 12 }, indexDetails));
  return uses;
}

async function loadIndex(root: string, search: string) {
  const path = join(root, 'search', recipeUsesIndexFile);
  const saved = await readAssetJson<RecipeUsesIndex>(root, 'search', recipeUsesIndexFile).catch(() => undefined);
  if (saved && Array.isArray(saved.recipes) && saved.ingredients && typeof saved.ingredients === 'object') return saved;

  const index = await buildIndex(root, search);
  if (hasCatalogDatabase(root)) return index;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(index));
    await rename(temporary, path);
  } catch {
    // A read-only catalog can still use the index in memory.
    await unlink(temporary).catch(() => undefined);
  }
  return index;
}

export function createServerItemRecipeUses(directories: ReadonlyMap<string, string>) {
  const cache = new Map<string, Promise<RecipeUsesIndex>>();
  const fluids = new Map<string, ReturnType<typeof indexFluidRecipeUses>>();
  let fluidBuildQueue = Promise.resolve();
  const responses = new Map<string, StoredRecipeUses>();
  let cachedBytes = 0;

  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    const server = url.searchParams.get('server') ?? defaultAlias;
    const root = directories.get(server);
    const revision = url.searchParams.get('revision') ?? '';
    const id = url.searchParams.get('id') ?? '';
    if (!root || !hash.test(revision) || id.length > 256 || !itemId.test(id)) {
      response.writeHead(400).end(JSON.stringify({ error: 'invalid_recipe_uses_request' }));
      return;
    }

    try {
      const active = await readJson<Manifest>(join(root, 'catalog.json'));
      const revisionRoot = join(root, 'revisions', revision);
      const manifest = active.revision === revision ? active : active.previousRevision === revision
        ? await readJson<Manifest>(join(revisionRoot, 'catalog.json')) : undefined;
      if (!manifest || manifest.state !== 'ready' || !hash.test(manifest.search)) {
        response.writeHead(404).end(JSON.stringify({ error: 'recipe_uses_unavailable' }));
        return;
      }
      const publishedAt = await catalogPublishedAt(root, manifest);
      if (publishedAt) response.setHeader(catalogPublishedAtHeader, publishedAt);

      const key = `${server}:${revision}:${manifest.search}`;
      if (url.searchParams.get('kind') === 'fluid') {
        let index = fluids.get(key);
        if (!index) {
          const pending = fluidBuildQueue.then(() => indexFluidRecipeUses(revisionRoot)).catch(error => {
            if (fluids.get(key) === pending) fluids.delete(key);
            throw error;
          });
          fluidBuildQueue = pending.then(() => undefined, () => undefined);
          index = pending;
        }
        fluids.delete(key);
        fluids.set(key, index);
        if (fluids.size > directories.size * 2) fluids.delete(fluids.keys().next().value!);
        const recipes = [...((await index).get(id)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id));
        response.setHeader('Cache-Control', recipeCacheControl);
        response.end(JSON.stringify({ fluidUses: { fluidId: id, recipes } }));
        return;
      }
      const responseKey = `${key}:${id}`;
      const cached = responses.get(responseKey);
      const stored = cached ?? await readStoredRecipeUses(revisionRoot, id);
      if (stored !== undefined) {
        if (stored.bytes.length <= responseCacheBytes) {
          const previous = responses.get(responseKey);
          if (previous) {
            cachedBytes -= previous.bytes.length;
            responses.delete(responseKey);
          }
          responses.set(responseKey, stored);
          cachedBytes += stored.bytes.length;
          while (cachedBytes > responseCacheBytes || responses.size > responseCacheEntries) {
            const oldest = responses.keys().next().value!;
            cachedBytes -= responses.get(oldest)!.bytes.length;
            responses.delete(oldest);
          }
        }
        const gzip = stored.gzip && acceptsGzip(request.headers['accept-encoding']);
        const bytes = stored.gzip && !gzip ? await decompress(stored.bytes) : stored.bytes;
        response.setHeader('Cache-Control', recipeCacheControl);
        response.setHeader('Vary', 'Accept-Encoding');
        if (gzip) response.setHeader('Content-Encoding', 'gzip');
        response.end(bytes);
        return;
      }

      let index = cache.get(key);
      if (!index) {
        const pending = loadIndex(revisionRoot, manifest.search).catch(error => {
          if (cache.get(key) === pending) cache.delete(key);
          throw error;
        });
        index = pending;
      }
      cache.delete(key);
      cache.set(key, index);
      if (cache.size > directories.size * 2) cache.delete(cache.keys().next().value!);
      const uses = await index;
      const recipes = (uses.ingredients[id] ?? []).map(position => uses.recipes[position]).filter(Boolean)
        .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
      response.setHeader('Cache-Control', recipeCacheControl);
      response.end(JSON.stringify({ recipes }));
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      response.writeHead(missing ? 404 : 500).end(JSON.stringify({ error: 'recipe_uses_unavailable' }));
    }
  };
}
