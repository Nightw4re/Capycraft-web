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
import { createProgressCache } from '../server/progressCache.mts';
import { createQuests } from '../server/quests.mts';
import { itemUrl, pageUrl, routeFromUrl } from '../src/navigation.ts';
import { layoutProgress } from '../src/progressLayout.mts';
import { readQuestCatalog } from '../src/quests.mts';

test('the quest board keeps the game layout and hides only the designated connections', () => {
  const result = readQuestCatalog({ total: 4, chapters: [{ id: 'c1', title: 'Chapter', quests: [
    { id: 'A1', title: 'First', description: '', x: -2, y: 1 },
    { id: 'a2', title: 'Second', description: '', x: 0, y: 1, dependencyIds: ['a1', 'ff'] },
    { id: 'a3', title: 'Third', description: '', x: 0, y: 3.5, dependencyIds: ['a2'], hideDependencyLines: true,
      minimumRequired: 2, hiddenDependencyCount: 1 },
    { id: 'a4', title: 'Older data', description: '' },
  ] }] });
  assert.ok(result);
  const entries = result.chapters[0].quests;
  assert.deepEqual(readQuestCatalog(result), result);
  assert.deepEqual(entries[1].dependencyIds, ['A1']);
  const graph = layoutProgress(entries);
  assert.ok(graph.nodes[0].x < graph.nodes[1].x);
  assert.equal(graph.nodes[0].y, graph.nodes[1].y);
  assert.ok(graph.nodes[2].y < graph.nodes[3].y);
  assert.ok(graph.nodes.slice(0, 3).some(node => node.x === graph.focus?.x && node.y === graph.focus?.y));
  assert.equal(layoutProgress([entries[3]]).focus, undefined);
  assert.deepEqual(graph.edges.map(edge => [edge.source.entry.id, edge.target.entry.id]), [['A1', 'a2']]);
  assert.deepEqual(graph.concealedEdges.map(edge => [edge.source.entry.id, edge.target.entry.id]), [['a2', 'a3']]);
  assert.equal(entries[2].minimumRequired, 2);
});

test('quest catalogs keep public chapter art, decorations, tasks and rewards through both parsers', () => {
  const iconImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1sAAAAASUVORK5CYII=';
  const result = readQuestCatalog({ total: 1, chapters: [{
    id: 'a', title: 'Chapter', iconImage, group: { id: 'b', title: 'Group', iconItemId: 'minecraft:book' },
    images: [{ id: 'c', iconImage, x: -2, y: 3, width: 4, height: 2, opacity: 0.5 },
      { id: 'd', iconImage: 'https://example.com/private.png', x: 0, y: 0, width: 1, height: 1 }],
    quests: [{ id: '4', title: 'Craft a chest', description: '', x: 7, y: 3, iconItemId: 'minecraft:chest',
      tasks: [{ id: 'e', title: 'Chest', count: 4, iconItemId: 'minecraft:chest' }],
      rewards: [{ id: 'f', title: 'Command', command: 'private' }] }],
  }] });
  assert.ok(result);
  assert.deepEqual(readQuestCatalog(result), result);
  const [chapter] = result.chapters;
  assert.equal(chapter.iconImage, iconImage);
  assert.equal(chapter.group?.iconItemId, 'minecraft:book');
  assert.equal(chapter.images?.length, 1);
  assert.equal(chapter.quests[0].tasks?.[0].count, 4);
  assert.deepEqual(chapter.quests[0].rewards, [{ id: 'f', title: 'Command' }]);
  const layout = layoutProgress(chapter.quests, chapter.images);
  assert.ok(layout.images[0].x < layout.nodes[0].x);
  assert.equal(layout.images[0].y, layout.nodes[0].y);
  assert.ok(layout.images[0].x - layout.images[0].width / 2 >= 0);
});

test('quest item slots keep separate art, actual items and inclusive quantities without exposing filter items', () => {
  const catalog = readQuestCatalog({ total: 1, itemDetailVersion: 2, chapters: [{
    id: '1', title: 'Chapter', quests: [{ id: '2', title: 'Quest', description: '', iconItemId: 'ftbfiltersystem:smart_filter',
      tasks: [{ id: '3', title: '16x Smart Filter', iconItemId: 'ftbfiltersystem:smart_filter', itemId: 'ftbfiltersystem:smart_filter' },
        { id: '4', title: 'Mine cobblestone', itemEntry: true, iconItemId: 'minecraft:stone', itemId: 'minecraft:cobblestone', count: 1 },
        { id: '7', title: 'Universal Cables', iconItemId: 'ftbfiltersystem:smart_filter' }],
      rewards: [{ id: '5', title: 'Dirt', itemId: 'minecraft:dirt', count: 5, countMax: 10 },
        { id: '6', title: 'Broken range', itemId: 'minecraft:sand', count: 5, countMax: 4 }] }],
  }] });
  assert.equal(catalog?.itemDetailVersion, 2);
  assert.deepEqual(readQuestCatalog(catalog), catalog);
  const quest = catalog?.chapters[0].quests[0];
  assert.equal(quest?.iconItemId, 'minecraft:stone');
  assert.deepEqual(quest?.tasks, [{ id: '3', title: '', itemEntry: true },
    { id: '4', title: 'Mine cobblestone', itemEntry: true, iconItemId: 'minecraft:stone', itemId: 'minecraft:cobblestone', count: 1 },
    { id: '7', title: 'Universal Cables', itemEntry: true }]);
  assert.deepEqual(quest?.rewards, [
    { id: '5', title: 'Dirt', itemEntry: true, itemId: 'minecraft:dirt', count: 5, countMax: 10 },
    { id: '6', title: 'Broken range', itemEntry: true, itemId: 'minecraft:sand', count: 5 },
  ]);
});

test('quest kill, experience and separate random reward icons keep no recipe target', () => {
  const iconImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1sAAAAASUVORK5CYII=';
  const randomRewards = ['5', '6'].map(id => ({ id, title: 'Reward: Uncommon', iconImage, itemEntry: true }));
  const chapter = { id: '1', title: 'Bounty Board', quests: [{
    id: '2', title: 'Kill: 10x Creeper', description: '', iconItemId: 'minecraft:creeper_spawn_egg',
    tasks: [{ id: '3', title: 'Kill: Creeper', iconItemId: 'minecraft:creeper_spawn_egg', itemEntry: true, count: 10 }],
    rewards: [{ id: '4', title: 'XP', count: 25 }, ...randomRewards],
  }] };
  const catalog = readQuestCatalog({ total: 1, itemDetailVersion: 5, chapters: [chapter] });
  assert.equal(catalog?.itemDetailVersion, 5);
  const quest = catalog?.chapters[0].quests[0];
  assert.equal(quest?.iconItemId, 'minecraft:creeper_spawn_egg');
  assert.deepEqual(quest?.tasks, chapter.quests[0].tasks);
  assert.deepEqual(quest?.rewards, [
    { id: '4', title: 'XP', iconItemId: 'minecraft:experience_bottle', itemEntry: true, count: 25 }, ...randomRewards,
  ]);
  assert.deepEqual(readQuestCatalog(catalog), catalog);
});

test('opening or closing an item from a quest preserves the underlying chapter and quest', () => {
  for (const base of ['/server/alpha/players?player=Builder&tab=quests&', '/server/alpha/quests?player=Builder&']) {
    const quest = base + 'questView=board&chapter=1&quest=2';
    for (const view of ['recipes', 'uses'] as const) {
      const item = itemUrl(quest, { id: 'minecraft:dirt', view });
      const route = routeFromUrl(item);
      assert.equal('item' in route && route.item?.view, view);
      const [pathname, search] = quest.split('?');
      assert.equal(itemUrl(item), pageUrl({ pathname, search: `?${search}`, hash: '' }));
    }
  }
});

test('legacy quest URLs land on the player list unless they identify a player', () => {
  const pathname = '/server/alpha/quests';
  assert.equal(pageUrl({ pathname, search: '', hash: '' }), '/server/alpha/players');
  assert.equal(pageUrl({ pathname, search: '?player=invalid%20name&quest=2', hash: '' }), '/server/alpha/players');
  assert.equal(pageUrl({ pathname, search: '?player=Builder&chapter=1&quest=2', hash: '' }),
    '/server/alpha/players?player=Builder&chapter=1&quest=2&tab=quests');
  assert.equal(pageUrl({ pathname: '/', search: '', hash: '#/server/alpha/quests' }), '/server/alpha/players');
});

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
  assert.equal(routeFromUrl('/server/alpha/quests').page, 'players');
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
  assert.deepEqual(requests, [null, alphaId, null, betaId, null]);
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

test('quest catalogs survive time and wait for a new import, while progress expires after 15 seconds', async t => {
  const database = new DatabaseSync(':memory:');
  let revision = 'first-import';
  const cache = createProgressCache(database, async () => revision);
  const oldCatalog = { total: 1, chapters: [{ id: 'a', title: 'Old chapter', quests: [
    { id: 'b', title: 'Old quest', description: '', position: { x: 0, y: 0 } },
  ] }] };
  const richCatalog = { total: 1, itemDetailVersion: 5, chapters: [{ id: 'a', title: 'New chapter', quests: [
    { id: 'b', title: 'New quest', description: '', position: { x: 0, y: 0 },
      tasks: [{ id: 'c', title: 'Required item' }] },
  ] }] };
  (await cache('alpha', 'quests-catalog-v2', null)).save(oldCatalog);
  let available = false;
  let upgraded = false;
  let catalogRequests = 0;
  let progressRequests = 0;
  const uuid = '00000000-0000-4000-8000-000000000001';
  const upstream = createServer((request, response) => {
    const query = new URL(request.url ?? '', 'http://localhost').searchParams;
    if (query.has('player')) {
      assert.equal(query.get('player'), uuid);
      assert.equal(query.get('view'), 'progress');
      progressRequests++;
      response.end(JSON.stringify({ total: 1, completed: 1, completedIds: ['b'] }));
      return;
    }
    catalogRequests++;
    if (!available) response.writeHead(503).end();
    else setTimeout(() => response.end(JSON.stringify(revision === 'first-import' || upgraded ? richCatalog : oldCatalog)), 20);
  });
  const origin = await listen(upstream);
  const temp = await mkdtemp(join(tmpdir(), 'capycraft-quest-cache-test-'));
  const tokenEnv = 'CAPYCRAFT_QUESTS_CACHE_TEST_TOKEN';
  process.env[tokenEnv] = 'ftb_quest_cache_test_'.repeat(4);
  await mkdir(join(temp, 'alpha'));
  await writeFile(join(temp, 'alpha', 'server.json'), JSON.stringify({ webcraftUrl: origin, tokenEnv, tabs: ['quests'], quests: true }));
  const api = createServer(createQuests(loadInstances(temp), async () => ({ uuid, name: 'Builder' }), cache));
  const site = await listen(api);
  t.after(async () => {
    await Promise.all([upstream, api].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    database.close();
    await rm(temp, { recursive: true, force: true });
    delete process.env[tokenEnv];
  });
  const fetchCatalog = () => fetch(`${site}/api/quests?server=alpha`).then(response => response.json());
  assert.deepEqual(await fetchCatalog(), oldCatalog);
  available = true;
  assert.deepEqual(await fetchCatalog(), richCatalog);
  database.exec("UPDATE progress_cache SET saved_at = 0 WHERE key = '[\"alpha\",\"quests-catalog-v7\",null]'");
  assert.deepEqual(await fetchCatalog(), richCatalog);
  assert.equal(catalogRequests, 2);

  const fetchProgress = (compact = false) => fetch(`${site}/api/quests?server=alpha&player=Builder${compact ? '&view=progress' : ''}`)
    .then(response => response.json());
  const progress = { player: 'Builder', total: 1, completed: 1, completedIds: ['b'] };
  assert.deepEqual(await fetchProgress(), { ...richCatalog, ...progress });
  assert.deepEqual(await fetchProgress(true), progress);
  assert.equal(progressRequests, 1);
  const ageProgress = database.prepare('UPDATE progress_cache SET saved_at = ? WHERE key = ?');
  const playerKey = JSON.stringify(['alpha', 'quests', uuid]);
  ageProgress.run(Date.now() - 16_000, playerKey);
  assert.deepEqual(await fetchProgress(true), progress);
  assert.equal(progressRequests, 2);
  assert.equal(catalogRequests, 2);

  revision = 'second-import';
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, fetchCatalog)), Array(6).fill(oldCatalog));
  assert.equal(catalogRequests, 3);
  assert.deepEqual(await fetchCatalog(), oldCatalog);
  assert.equal(catalogRequests, 3);
  upgraded = true;
  database.exec("UPDATE progress_cache SET saved_at = 0 WHERE key = '[\"alpha\",\"quests-catalog-v7-compat\",null]'");
  assert.deepEqual(await fetchCatalog(), richCatalog);
  assert.equal(catalogRequests, 4);
});
