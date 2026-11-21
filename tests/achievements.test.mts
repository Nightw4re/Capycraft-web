import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createAchievements } from '../server/achievements.mts';
import type { Instance } from '../server/instances.mts';
import { createPlayerRoster } from '../server/playerRoster.mts';
import { routeFromUrl, serverPath } from '../src/navigation.ts';

const tokenEnv = 'CAPYCRAFT_ACHIEVEMENTS_FIXTURE_TOKEN';
const token = 'capycraft_fixture_'.repeat(3);
process.env[tokenEnv] = token;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('persistent roster merges dated history and deduplicates names without publishing private identifiers', async t => {
  const path = await mkdtemp(join(tmpdir(), 'capycraft-achievements-'));
  const databasePath = join(path, 'roster.sqlite');
  const fixture = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.url, '/api/v1/internal/players/all');
    response.end(JSON.stringify({ players: [
      { uuid: id(1), name: 'OldName' }, { uuid: id(2), name: 'SharedName' },
      { uuid: id(3), name: null }, { uuid: id(4), name: 'sharedname' },
      ...Array.from({ length: 15 }, (_, i) => ({ uuid: id(i + 10), name: `Past${i}` })),
    ] }));
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const address = fixture.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const alpha: Instance = { alias: 'alpha', tabs: ['achievements'], webcraft: {
    origin, tokenEnv, playerRoster: true, achievements: true,
    directoryTransport: 'http', info: 'public', status: 'public', playerHistory: false,
  } };
  const beta: Instance = { ...alpha, alias: 'beta' };
  const instances = new Map([['alpha', alpha], ['beta', beta]]);
  let db = new DatabaseSync(databasePath);
  t.after(async () => {
    db.close();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    await rm(path, { recursive: true, force: true });
  });
  db.exec(`
    CREATE TABLE players (uuid TEXT PRIMARY KEY, name TEXT, last_seen_at INTEGER);
    CREATE TABLE server_players (server TEXT, uuid TEXT, name TEXT, last_seen_at INTEGER);
  `);
  db.prepare('INSERT INTO players VALUES (?, ?, ?)').run(id(1), 'NewName', 42);
  db.prepare('INSERT INTO server_players VALUES (?, ?, ?, ?)').run('alpha', id(1), 'NewName', 42);
  const roster = createPlayerRoster(db, instances);
  const refresh = roster.sync();
  assert.equal((await roster.getNames('beta')).length, 17);
  await refresh;
  assert.equal(roster.names().length, 17);
  assert.ok(roster.names().includes('NewName') && !roster.names().includes('OldName'));
  assert.ok(roster.names('alpha').includes('NewName'));
  assert.ok(roster.names('beta').includes('OldName'));
  assert.equal(roster.names().filter(name => name.toLowerCase() === 'sharedname').length, 1);
  assert.ok(roster.knowsSkin('past14'));
  const previous = roster.names();
  db.close();
  db = new DatabaseSync(databasePath);
  assert.deepEqual(createPlayerRoster(db, instances).names(), previous);
  assert.deepEqual(createPlayerRoster(db, new Map()).names(), ['NewName']);
});

test('Achievements proxies only opted-in catalogs and listed player progress, and strips private fields', async t => {
  const item = { id: 'minecraft:story/stone', title: 'Stone Age', description: 'Mine stone', frame: 'task' };
  let requests = 0;
  let upstreamStatus = 200;
  let upstreamError = 'advancement_progress_unavailable';
  const upstream = createServer((request, response) => {
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers.origin, undefined);
    const url = new URL(request.url ?? '', 'http://localhost');
    assert.equal(url.pathname, '/api/v1/internal/advancements');
    const player = url.searchParams.get('player');
    if (player !== null) assert.equal(player, 'Visitor');
    if (upstreamStatus !== 200) {
      response.writeHead(upstreamStatus).end(JSON.stringify({ error: upstreamError }));
      return;
    }
    response.end(JSON.stringify({
      total: 1, advancements: [{ ...item, uuid: id(1) }], internalToken: token,
      ...(player ? { player, completed: 1, completedIds: [item.id], lastSeenAt: 42 } : {}),
    }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  const instance: Instance = { alias: 'alpha', tabs: ['achievements'], webcraft: {
    origin: `http://127.0.0.1:${address.port}`, tokenEnv, achievements: true,
    directoryTransport: 'http', info: 'public', status: 'public', playerHistory: false,
  } };
  const serve = createAchievements(new Map([['alpha', instance], ['beta', { ...instance, tabs: ['players'] }]]), async () => ['Visitor']);
  const api = createServer(serve);
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => { api.close(); upstream.close(); });
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  const endpoint = `http://127.0.0.1:${apiAddress.port}/api/achievements`;

  assert.equal(routeFromUrl(serverPath('alpha', 'achievements')).page, 'achievements');
  assert.equal((await fetch(`${endpoint}?server=beta`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=alpha&player=Nobody`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=alpha&player=foo/bar`)).status, 400);
  assert.equal(requests, 0);
  const catalog = await fetch(`${endpoint}?server=alpha`);
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await catalog.json(), { total: 1, advancements: [item] });
  assert.deepEqual(await fetch(`${endpoint}?server=alpha&player=visitor`).then(response => response.json()), {
    total: 1, advancements: [item], player: 'Visitor', completed: 1, completedIds: [item.id],
  });
  upstreamStatus = 404;
  upstreamError = 'player_not_found';
  assert.deepEqual(await fetch(`${endpoint}?server=alpha&player=visitor`).then(response => response.json()), { error: 'player_not_found' });
  upstreamStatus = 503;
  assert.equal((await fetch(`${endpoint}?server=alpha&player=visitor`)).status, 503);
  upstreamStatus = 401;
  assert.equal((await fetch(`${endpoint}?server=alpha`)).status, 403);
  assert.equal(requests, 5);
});
