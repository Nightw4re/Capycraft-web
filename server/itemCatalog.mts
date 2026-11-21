import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import layout from '../src/items/catalogLayout.json' with { type: 'json' };
import { defaultAlias } from '../src/minecraftServers.mjs';
import { catalogPublishedAt, catalogPublishedAtHeader, readCatalogAsset } from './catalogAssets.mts';

export const catalogPrefix = '/item-catalog/';
const catalogAsset = /^(?:revisions\/[a-f0-9]{64}\/)?(?:(?:icons|atlases)\/[a-f0-9]{64}\.(?:png|webp)|(?:details|pages|lookup|payloads)\/[a-f0-9]{64}\.json)$/;

export function readCatalogResource(directory: string, path: string) {
  const resource = resolve(directory, path);
  if (path === 'catalog.json' || path === layout.statusFile) return readFile(resource);
  const folder = dirname(resource);
  return readCatalogAsset(dirname(folder), basename(folder), basename(resource));
}

export async function serveCatalog(directories: ReadonlyMap<string, string>, path: string, request: IncomingMessage, response: ServerResponse) {
  const scoped = /^servers\/([a-z0-9-]+)\/(.*)$/.exec(path);
  const alias = scoped?.[1] ?? defaultAlias;
  const directory = directories.get(alias);
  path = scoped?.[2] ?? path;
  const manifest = path === 'catalog.json';
  const status = path === layout.statusFile;
  if (!directory || (scoped && alias === defaultAlias) || (!manifest && !status && !catalogAsset.test(path))) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const data = await readCatalogResource(directory, path);
    response.setHeader('Cache-Control', manifest || status ? 'no-cache' : 'public, max-age=31536000, immutable');
    response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'image/webp');
    if (manifest) {
      const metadata = JSON.parse(data.toString('utf8'));
      if (metadata?.state === 'ready' || (metadata && metadata.state === undefined)) {
        const publishedAt = await catalogPublishedAt(directory, metadata);
        if (publishedAt) response.setHeader(catalogPublishedAtHeader, publishedAt);
      }
    }
    if (manifest || status) {
      const tag = `"${createHash('sha256').update(data).digest('hex')}"`;
      response.setHeader('ETag', tag);
      if (request.headers['if-none-match']?.split(',').some(value => ['*', tag, `W/${tag}`].includes(value.trim()))) {
        response.writeHead(304).end();
        return;
      }
    }
    response.setHeader('Content-Length', data.length);
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    response.writeHead(missing ? 404 : 500, { 'Cache-Control': 'no-store' }).end();
  }
}
