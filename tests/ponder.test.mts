import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import type { Instance } from '../server/instances.mts';
import { createPonder } from '../server/ponder.mts';
import { routeFromUrl } from '../src/navigation.ts';
import { ponderFramePath, ponderResource, readPonderFrame, readPonderIndex, readPonderManifest } from '../src/ponder/format.mts';

const prefix = '/api/v1/modules/webcraft_ponder/ponder/';
const id = 'a'.repeat(64);
const manifest = `ponder/scenes/${id}/scene.json`;
const vertexBytes = Buffer.alloc(48);
const mesh = `ponder/meshes/${createHash('sha256').update(vertexBytes).digest('hex')}.bin`;
const scene = { id: 'create:demo', title: 'Demo', schematic: 'create:demo', items: [], manifest };
const index = { version: 1, locale: 'en_us', scenes: [scene] };
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('Ponder decodes the v1 catalog, captured layout and numbered timeline', () => {
  assert.equal(routeFromUrl('/server/demo/ponder').page, 'ponder');
  assert.deepEqual(readPonderIndex(index), index);
  assert.equal(readPonderIndex({ ...index, version: 2 }), undefined);
  assert.equal(readPonderIndex({ ...index, scenes: [{ ...scene, manifest: '../scene.json' }] }), undefined);
  assert.equal(ponderFramePath(scene, 0), `ponder/scenes/${id}/frames/0.json`);
  assert.equal(ponderResource(`ponder/scenes/${id}/frames/00.json`), undefined);
  assert.deepEqual(readPonderManifest({
    width: 480, height: 320, frameCount: 100, ticksPerSecond: 20, keyframes: [40, 40, 100],
    diffuseLights: [[0, 1, 0], [0, -1, 0]],
  })?.keyframes, [40, 99]);
  const draw = {
    mode: 'QUADS', vertexCount: 4, indexCount: 6, stride: 12, vertices: mesh,
    attributes: [{ name: 'Position', offset: 0, type: 'FLOAT', count: 3 }],
    shader: 'position', textures: {}, projection: matrix, modelView: matrix, textureMatrix: matrix,
    color: [1, 1, 1, 1], depthTest: true, depthFunction: 515, depthWrite: true, cull: false, blend: false,
  };
  const frame = readPonderFrame({
    sceneToGui: matrix, scene: [draw, { ...draw, vertices: '/etc/passwd' }], overlay: [draw],
    captions: [{ text: 'Use a pump.', color: -1, opacity: 1, anchor: [1, 2, 3] }],
  });
  assert.equal(frame?.draws.length, 2);
  assert.equal(frame?.omitted, 1);
  assert.equal(frame?.captions[0].text, 'Use a pump.');
  assert.deepEqual(frame?.captions[0].anchor, Float32Array.of(1, 2, 3));
});

test('the same-origin Ponder endpoint enforces instance opt-in, asset paths, MIME and size/hash checks', async t => {
  const calls: string[] = [];
  let mode: 'valid' | 'mime' | 'digest' | 'large' | 'redirect' = 'valid';
  const upstream = createServer((request, response) => {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    const url = new URL(request.url ?? '', 'http://localhost');
    calls.push(url.pathname);
    if (mode === 'redirect') return response.writeHead(302, { Location: '/unrelated' }).end();
    if (url.pathname === prefix + 'index') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(index));
      return;
    }
    assert.equal(url.pathname, prefix + 'asset');
    const resource = url.searchParams.get('path');
    if (resource === mesh) {
      response.writeHead(200, { 'Content-Type': mode === 'mime' ? 'text/html' : 'application/octet-stream' })
        .end(mode === 'digest' ? Buffer.alloc(48, 12) : vertexBytes);
    } else {
      assert.equal(resource, manifest);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write(Buffer.alloc(128 * 1024, 97));
      response.end('overflow');
    }
  });
  const origin = await listen(upstream);
  const instance: Instance = {
    alias: 'demo', tabs: ['ponder'], webcraft: {
      origin, info: 'public', status: 'public', directoryTransport: 'http', playerHistory: false, ponder: true,
    },
  };
  const api = createServer(createPonder(new Map([['demo', instance], ['off', { ...instance, tabs: [] }]])));
  const base = await listen(api);
  t.after(() => { api.close(); upstream.close(); });
  const get = (query: string) => fetch(`${base}/api/ponder?${query}`);
  assert.equal((await get('server=off')).status, 404);
  assert.equal((await get('server=demo&server=off')).status, 400);
  assert.equal((await get('server=demo&path=ponder%2F..%2Fserver-info')).status, 400);
  assert.equal((await get('server=demo&path=https%3A%2F%2Funrelated.example')).status, 400);
  assert.equal(calls.length, 0);
  const catalog = await get('server=demo');
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await catalog.json(), index);
  const entry = await fetch(`${base}/api/ponder?server=demo&path=${encodeURIComponent(mesh)}`, {
    headers: { Authorization: 'Bearer do-not-forward', Cookie: 'sensitive=1' },
  });
  assert.equal(entry.headers.get('x-content-type-options'), 'nosniff');
  assert.match(entry.headers.get('cache-control') ?? '', /immutable/);
  assert.deepEqual(Buffer.from(await entry.arrayBuffer()), vertexBytes);
  mode = 'mime';
  assert.equal((await get(`server=demo&path=${encodeURIComponent(mesh)}`)).status, 502);
  mode = 'digest';
  assert.equal((await get(`server=demo&path=${encodeURIComponent(mesh)}`)).status, 502);
  mode = 'large';
  assert.equal((await get(`server=demo&path=${encodeURIComponent(manifest)}`)).status, 502);
  mode = 'redirect';
  assert.equal((await get('server=demo')).status, 503);
  assert.ok(calls.every(path => path === prefix + 'index' || path === prefix + 'asset'));
});
