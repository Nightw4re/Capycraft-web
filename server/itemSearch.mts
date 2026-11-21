import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import layout from '../src/items/catalogLayout.json' with { type: 'json' };
import { catalogModMatches, catalogSearchTerms } from '../src/items/catalogIndex.mjs';
import { defaultAlias } from '../src/minecraftServers.mjs';
import { readCatalogAsset } from './catalogAssets.mts';

export const itemSearchPath = '/api/item-search';
const hash = /^[a-f0-9]{64}$/;

export function createServerItemSearch(directories: ReadonlyMap<string, string>) {
  const handlers = new Map(Array.from(directories, ([alias, directory]) => [alias, createItemSearch(directory)]));
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const handler = handlers.get(url.searchParams.get('server') ?? defaultAlias);
    if (handler) return handler(request, response, url);
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ error: 'server_not_found' }));
  };
}

type SearchIndex = {
  items: { id: string; name: string; icon?: string; detail?: string; search: string; searchTooltip?: string; searchTags?: string[] }[];
  order: Record<'cs' | 'en', number[]>;
};

export function createItemSearch(directory: string) {
  const cache = new Map<string, Promise<SearchIndex>>();

  function loadIndex(revision: string, hash: string) {
    const key = `${revision}:${hash}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const index = readCatalogAsset(join(directory, 'revisions', revision), 'search', `${hash}.json`)
      .then(data => JSON.parse(data.toString('utf8')) as SearchIndex)
      .catch((error: unknown) => {
        if (cache.get(key) === index) cache.delete(key);
        throw error;
      });
    cache.set(key, index);
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
    return index;
  }

  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const revision = url.searchParams.get('revision') ?? '';
    const indexHash = url.searchParams.get('index') ?? '';
    const language = url.searchParams.get('language');
    const page = url.searchParams.get('page') ?? '';
    const query = url.searchParams.get('q') ?? '';
    const mod = url.searchParams.get('mod') ?? '';
    if (!hash.test(revision) || !hash.test(indexHash) || (language !== 'cs' && language !== 'en')
      || !/^\d{1,8}$/.test(page) || query.length > 256 || (mod && !/^[a-z0-9_.-]+$/.test(mod))) {
      response.writeHead(400).end(JSON.stringify({ error: 'invalid_catalog_search' }));
      return;
    }

    try {
      const index = await loadIndex(revision, indexHash);
      const terms = catalogSearchTerms(query);
      const first = Number(page) * layout.pageSize;
      const prefix = mod ? `${mod}:` : '';
      const items = [];
      let total = 0;
      for (const position of index.order[language]) {
        const record = index.items[position];
        if ((prefix && !record.id.startsWith(prefix)) || !terms.items.every(term => record.search.includes(term))) continue;
        if (terms.mods.length && !terms.mods.every(term => catalogModMatches(record.id.split(':', 1)[0], term))) continue;
        if (!terms.tags.every(term => record.searchTags?.some(tag => tag.includes(term)))
          || !terms.tooltips.every(term => record.searchTooltip?.includes(term))) continue;
        if (total >= first && items.length < layout.pageSize) {
          const { search, searchTooltip, searchTags, ...item } = record;
          items.push(item);
        }
        total++;
      }
      response.setHeader('Cache-Control', 'public, max-age=300');
      response.end(JSON.stringify({ items, total }));
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      response.writeHead(missing ? 404 : 500).end(JSON.stringify({ error: 'catalog_search_unavailable' }));
    }
  };
}
