import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isServerAlias } from '../src/minecraftServers.mjs';
import { maxTextureSide, ponderResource } from '../src/ponder/format.mts';
import type { Instance } from './instances.mts';

const upstreamPath = '/api/v1/modules/webcraft_ponder/ponder/';
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const indexResource = { kind: 'index', mime: 'application/json', limit: 2 * 1024 ** 2 };

async function readBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => {});
      return;
    }
    chunks.push(chunk.value);
  }
  if (bytes) return Buffer.concat(chunks, bytes);
}

function isPng(body: Buffer) {
  if (body.length < 33 || !body.subarray(0, 8).equals(pngSignature) || body.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = body.readUInt32BE(16);
  const height = body.readUInt32BE(20);
  return width > 0 && width <= maxTextureSide && height > 0 && height <= maxTextureSide;
}

export function createPonder(instances: ReadonlyMap<string, Instance>) {
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
    if (!isServerAlias(alias) || params.getAll('server').length !== 1 || params.getAll('path').length > 1
      || [...params.keys()].some(key => key !== 'server' && key !== 'path')) return fail(400, 'invalid_request');
    const resource = path === null ? indexResource : ponderResource(path);
    if (!resource) return fail(400, 'invalid_ponder_path');
    const instance = instances.get(alias);
    if (!instance?.webcraft?.ponder || !instance.tabs.includes('ponder')) return fail(404, 'ponder_disabled');

    const cancellation = new AbortController();
    response.once('close', () => cancellation.abort());
    const url = new URL(upstreamPath + (path === null ? 'index' : 'asset'), instance.webcraft.origin);
    if (path !== null) url.searchParams.set('path', path);
    try {
      const upstream = await fetch(url, {
        headers: { Accept: resource.mime }, redirect: 'error',
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(12_000)]),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => {});
        return upstream.status === 404 ? fail(404, 'ponder_not_found') : fail(503, 'ponder_unavailable');
      }
      const mime = upstream.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (mime !== resource.mime || Number(upstream.headers.get('content-length')) > resource.limit) {
        await upstream.body?.cancel().catch(() => {});
        return fail(502, 'invalid_ponder_asset');
      }
      const body = await readBody(upstream, resource.limit);
      const digest = 'digest' in resource ? resource.digest : undefined;
      if (!body || (resource.kind === 'image' && !isPng(body))
        || (digest && createHash('sha256').update(body).digest('hex') !== digest)) return fail(502, 'invalid_ponder_asset');
      response.setHeader('Content-Type', resource.mime);
      response.setHeader('Content-Length', body.length);
      if (digest) response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return response.end(body);
    } catch {
      if (!cancellation.signal.aborted) return fail(503, 'ponder_unavailable');
    }
  };
}
