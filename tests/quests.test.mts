import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createAchievements } from '../server/achievements.mts';
import { loadInstances } from '../server/instances.mts';
import { createPlayerRoster } from '../server/playerRoster.mts';
import { createQuests } from '../server/quests.mts';
import { routeFromUrl } from '../src/navigation.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('FTB Quests scopes names by world and forwards only a private UUID to WebCraft', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'capycraft-quests-test-'));
  const tokenEnv = 'CAPYCRAFT_QUESTS_TEST_TOKEN';
  const token = 'ftb_quest_test_'.repeat(4);
  process.env[tokenEnv] = token;
  const alphaId = '00000000-0000-4000-8000-000000000001';
  const betaId = '00000000-0000-4000-8000-000000000002';
  const chapters = [{ id: 'a01', title: 'Getting Started', quests: [
    { id: 'b01', title: 'A new home', description: 'Build a shelter.' },
    { id: 'b02', title: 'Better tools', description: '' },
  ] }, { id: 'a02', title: 'Exploration', quests: [
    { id: 'b03', title: 'Find a village', description: 'Explore the overworld.' },
  ] }];
  const requests: (string | null)[] = [];
  let replyStatus = 200;
  let replyError = 'quest_progress_unavailable';
  let completedId = 'B01';
  let empty = false;
  const upstream = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers.origin, undefined);
    const url = new URL(request.url ?? '', 'http://localhost');
    if (url.pathname === '/api/v1/internal/advancements') {
      response.end(JSON.stringify({ total: 0, advancements: [], player: 'Explorer', completed: 0, completedIds: [] }));
      return;
    }
    assert.equal(url.pathname, '/api/v1/internal/modules/webcraft_quests/quests/data');
    const player = url.searchParams.get('player');
    requests.push(player);
    if (replyStatus !== 200) {
      response.writeHead(replyStatus).end(JSON.stringify({ error: replyError, privateToken: token }));
      return;
    }
    response.end(JSON.stringify({
      total: empty ? 0 : 3,
      chapters: empty ? [] : chapters.map(chapter => ({
        ...chapter, privateUuid: alphaId, quests: chapter.quests.map(quest => ({ ...quest, teamName: 'Private team' })),
      })),
      uuid: player, teamName: 'Private team', token,
      ...(player && { completed: 1, completedIds: [completedId] }),
    }));
  });
  const origin = await listen(upstream);
  t.after(async () => {
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  });
  const configs = {
    alpha: { webcraftUrl: origin, tokenEnv, tabs: ['quests', 'achievements'], quests: true, achievements: true, playerRoster: true },
    beta: { webcraftUrl: origin, tokenEnv, tabs: ['quests'], quests: true, playerRoster: true },
    legacy: { webcraftUrl: origin, tabs: ['players'] },
    disabled: { webcraftUrl: origin, tokenEnv, quests: true, tabs: ['players'] },
  };
  for (const [alias, config] of Object.entries(configs)) {
    await mkdir(join(temp, alias));
    await writeFile(join(temp, alias, 'server.json'), JSON.stringify(config));
  }
  const instances = loadInstances(temp);
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE players (uuid TEXT PRIMARY KEY, name TEXT, last_seen_at INTEGER);
    CREATE TABLE server_players (server TEXT, uuid TEXT, name TEXT, last_seen_at INTEGER);
  `);
  const roster = createPlayerRoster(db, instances);
  const history = db.prepare('INSERT INTO server_players VALUES (?, ?, ?, ?)');
  history.run('alpha', alphaId, 'Explorer', 20);
  const save = db.prepare('INSERT INTO webcraft_roster VALUES (?, ?, ?, ?)');
  save.run('alpha', alphaId, 'OldName', 10);
  save.run('beta', betaId, 'Explorer', 20);
  save.run('alpha', betaId, 'Ambiguous', 20);
  save.run('alpha', '00000000-0000-4000-8000-000000000003', 'ambiguous', 30);
  save.run('alpha', '00000000-0000-4000-8000-000000000004', 'OnlyAlpha', 40);
  assert.deepEqual(roster.names('alpha'), ['Ambiguous', 'Explorer', 'OnlyAlpha']);
  assert.deepEqual(roster.names('beta'), ['Explorer']);
  const quests = createQuests(instances, roster.resolvePlayer);
  const achievements = createAchievements(instances, roster.getNames);
  const api = createServer((request, response) => {
    if (request.url?.startsWith('/api/achievements?')) return achievements(request, response);
    return quests(request, response);
  });
  const site = await listen(api);
  t.after(async () => {
    await new Promise<void>(resolve => api.close(() => resolve()));
    db.close();
  });
  const endpoint = `${site}/api/quests`;
  assert.equal(routeFromUrl('/server/alpha/quests').page, 'quests');
  assert.equal(routeFromUrl('/server/alpha/achievements').page, 'achievements');
  assert.equal((await fetch(`${endpoint}?server=legacy`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=disabled`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=alpha&player=${alphaId}`)).status, 400);
  assert.equal((await fetch(`${endpoint}?server=alpha&player=ambiguous`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=beta&player=OnlyAlpha`)).status, 404);
  assert.equal((await fetch(`${endpoint}?server=alpha&player=OldName`)).status, 404);
  assert.deepEqual(requests, []);

  const catalog = await fetch(`${endpoint}?server=alpha`);
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await catalog.json(), { total: 3, chapters });
  for (const alias of ['alpha', 'beta']) {
    const result = await fetch(`${endpoint}?server=${alias}&player=eXpLoReR`);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { total: 3, chapters, player: 'Explorer', completed: 1, completedIds: ['b01'] });
  }
  assert.deepEqual(requests, [null, alphaId, betaId]);
  const advancement = await fetch(`${site}/api/achievements?server=alpha&player=explorer`);
  assert.deepEqual(await advancement.json(), { total: 0, advancements: [], player: 'Explorer', completed: 0, completedIds: [] });

  empty = true;
  assert.deepEqual(await fetch(`${endpoint}?server=alpha`).then(response => response.json()), { total: 0, chapters: [] });
  empty = false;
  completedId = 'ffff';
  const invalid = await fetch(`${endpoint}?server=alpha&player=Explorer`);
  assert.equal(invalid.status, 502);
  assert.deepEqual(await invalid.json(), { error: 'invalid_quests' });
  replyStatus = 503;
  const offline = await fetch(`${endpoint}?server=alpha&player=Explorer`);
  assert.equal(offline.status, 503);
  assert.deepEqual(await offline.json(), { error: 'quests_unavailable' });
  replyStatus = 404;
  replyError = 'team_progress_unavailable';
  assert.deepEqual(await fetch(`${endpoint}?server=alpha&player=Explorer`).then(response => response.json()),
    { error: 'team_progress_unavailable' });
  replyStatus = 403;
  const restricted = await fetch(`${endpoint}?server=alpha`);
  assert.equal(restricted.status, 403);
  assert.deepEqual(await restricted.json(), { error: 'feed_restricted' });
});
