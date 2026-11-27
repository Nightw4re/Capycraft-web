import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isServerAlias } from '../src/minecraftServers.mjs';
import { ponderResource, readPonderIndex } from '../src/ponder/format.mts';
import { ponderGuideIndexLimit } from '../src/ponder/guides.mts';
import { ponderDefinitionsLimit, ponderDefinitionsPath, ponderGuides, readPonderDefinitions } from './ponderDefinitions.mts';
import { activePonder, ponderIndexLimit, ponderIndexPath, ponderRevision } from './ponderStorage.mts';

export function createPonder(directories: ReadonlyMap<string, string>) {
  const indexes = new Map<string, { revision: string; body: Promise<Buffer> }>();
  const playbackIndexes = new Map<string, { key: string; body: Promise<Buffer> }>();
  function guideIndex(directory: string, revision: string) {
    const current = indexes.get(directory);
    if (current?.revision === revision) return current.body;
    const body = readFile(join(directory, 'revisions', revision, ponderDefinitionsPath)).then(bytes => {
      if (!bytes.length || bytes.length > ponderDefinitionsLimit) throw new Error('Invalid Ponder definitions size');
      const guides = ponderGuides(JSON.parse(bytes.toString('utf8')));
      if (!guides) throw new Error('Invalid Ponder definitions');
      return Buffer.from(JSON.stringify(guides));
    }).catch(error => {
      if (indexes.get(directory)?.body === body) indexes.delete(directory);
      throw error;
    });
    indexes.set(directory, { revision, body });
    return body;
  }

  function playbackIndex(directory: string, revision: string, definitionsRevision: string) {
    const key = `${revision}/${definitionsRevision}`;
    const current = playbackIndexes.get(directory);
    if (current?.key === key) return current.body;
    const body = readFile(join(directory, 'revisions', revision, ponderIndexPath)).then(async bytes => {
      if (bytes.length > ponderIndexLimit) return bytes;
      try {
        const index = readPonderIndex(JSON.parse(bytes.toString('utf8')));
        if (!index || index.scenes.every(scene => scene.itemOrder !== undefined)) return bytes;
        const definitions = await readFile(join(directory, 'revisions', definitionsRevision, ponderDefinitionsPath));
        if (definitions.length > ponderDefinitionsLimit) return bytes;
        const playback = readPonderDefinitions(JSON.parse(definitions.toString('utf8')))?.playback;
        if (!playback || playback.scenes.length !== index.scenes.length || playback.locale !== index.locale) return bytes;
        const scenes = new Map(playback.scenes.map(scene => [scene.manifest, scene]));
        for (const scene of index.scenes) {
          const match = scenes.get(scene.manifest);
          if (!match || match.id !== scene.id || match.schematic !== scene.schematic
            || match.items.length !== scene.items.length || !match.items.every((item, index) => item === scene.items[index])) return bytes;
          scene.itemOrder = match.itemOrder;
        }
        const ordered = Buffer.from(JSON.stringify(index));
        return ordered.length <= ponderIndexLimit ? ordered : bytes;
      } catch {
        return bytes;
      }
    }).catch(error => {
      if (playbackIndexes.get(directory)?.body === body) playbackIndexes.delete(directory);
      throw error;
    });
    playbackIndexes.set(directory, { key, body });
    return body;
  }

  return async function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status: number, error: string) => response.writeHead(status,
      { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error }));
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return fail(405, 'method_not_allowed');
    }
    const params = new URL(request.url ?? '', 'http://localhost').searchParams;
    const alias = params.get('server');
    const path = params.get('path');
    const revision = params.get('revision');
    const mode = params.get('mode');
    if (!isServerAlias(alias) || params.getAll('server').length !== 1 || params.getAll('path').length > 1
      || params.getAll('revision').length > 1 || params.getAll('mode').length > 1
      || [...params.keys()].some(key => !['server', 'path', 'revision', 'mode'].includes(key))
      || (mode !== null && (mode !== 'guides' || path !== null))
      || (path === null ? revision !== null : !revision || !ponderRevision.test(revision))) return fail(400, 'invalid_request');
    const resource = path === null
      ? { mime: 'application/json', limit: mode === 'guides' ? ponderGuideIndexLimit : ponderIndexLimit } : ponderResource(path);
    if (!resource) return fail(400, 'invalid_ponder_path');
    const directory = directories.get(alias);
    if (!directory) return fail(404, 'ponder_not_found');

    try {
      const active = await activePonder(directory);
      const section = mode === 'guides' ? active?.definitions : active;
      const version = revision ?? section?.revision;
      if (!version || (version !== section?.revision && version !== section?.previous)) return fail(404, 'ponder_not_found');
      const definitions = active?.definitions;
      const definitionsRevision = active?.sourceHash && definitions?.sourceHash === active.sourceHash ? definitions.revision : version;
      const etag = mode === 'guides' ? `"${version}"` : `"${version}-scene-order-v1-${definitionsRevision}"`;
      if (path === null && request.headers['if-none-match'] === etag) {
        return response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', 'X-Ponder-Revision': version }).end();
      }
      const body = mode === 'guides' ? await guideIndex(directory, version)
        : path === null ? await playbackIndex(directory, version, definitionsRevision)
          : await readFile(join(directory, 'revisions', version, path));
      if (!body.length || body.length > resource.limit) return fail(500, 'invalid_ponder_asset');
      response.setHeader('Content-Type', resource.mime);
      response.setHeader('Content-Length', body.length);
      response.setHeader('X-Ponder-Revision', version);
      response.setHeader('Cache-Control', path === null ? 'no-cache' : 'public, max-age=31536000, immutable');
      if (path === null) response.setHeader('ETag', etag);
      return response.end(body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail(404, 'ponder_not_found');
      return fail(503, 'ponder_unavailable');
    }
  };
}
