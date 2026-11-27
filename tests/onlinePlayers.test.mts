import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { type Instance } from '../server/instances.mts';
import { attachLiveUpdates } from '../server/liveUpdates.mts';
import { createOnlinePlayers } from '../server/onlinePlayers.mts';
import { createPlayerStats } from '../server/playerStats.mts';
import { createPlayerSkins } from '../server/playerSkins.mts';
import { createPlayerRoster } from '../server/playerRoster.mts';
import { createServerDirectory } from '../server/serverDirectory.mts';
import { applyDirectoryPatch, directorySubscription } from '../src/directoryUpdates.mts';
import type { LiveUpdate } from '../src/liveUpdates.mts';
import type { ServerSummary } from '../src/serverDirectoryTypes.ts';
import { offlinePlayers, readOnlinePlayersState } from '../src/onlinePlayers.mts';

const token = 'test_'.repeat(10);
const tokenEnv = 'CAPYCRAFT_TEST_ROSTER_TOKEN';
const route = '/api/v1/internal/players/online';
process.env[tokenEnv] = token;

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function instance(alias: string, origin: string, transport?: 'http' | 'websocket'): Instance {
  return {
    alias, tabs: ['players'],
    webcraft: { origin, tokenEnv, onlinePlayersTransport: transport, info: 'public', status: 'public',
      directoryTransport: 'http', playerHistory: false },
  };
}

async function until<T>(read: () => T | Promise<T>, description: string, timeout = 5_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await wait(20);
  } while (Date.now() < end);
  assert.fail(description);
}

test('REST refreshes on demand, validates listed rows and clears the roster when access is denied', async t => {
  let requests = 0;
  let status = 200;
  let body: unknown = { players: [{ name: 'Listed', pingMillis: 36, uuid: 'private' }] };
  const webcraft = createServer((request, response) => {
    assert.equal(request.url, route);
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    requests++;
    response.writeHead(status).end(JSON.stringify(body));
  });
  const origin = await listen(webcraft);
  const online = createOnlinePlayers(new Map([
    ['rest', instance('rest', origin, 'http')],
    ['legacy', instance('legacy', origin)],
  ]));
  t.after(() => { online.stop(); webcraft.close(); });
  const [baseline, parallel] = await Promise.all([online.get('rest'), online.get('rest')]);
  assert.deepEqual(baseline, { status: 'ready', players: [{ name: 'Listed', pingMillis: 36 }] });
  assert.deepEqual(parallel, baseline);
  assert.equal(requests, 1);
  assert.deepEqual(await online.get('legacy'), { status: 'disabled' });
  assert.equal(online.subscribe('legacy', () => assert.fail()), undefined);
  assert.equal(await online.lists('rest', 'listed'), true);
  assert.equal(await online.lists('rest', 'Unlisted'), false);
  const statuses: string[] = [];
  const unsubscribe = online.subscribe('rest', state => statuses.push(state.status));
  t.after(() => unsubscribe?.());
  status = 403;
  body = { players: [{ name: 'Listed', pingMillis: 42 }] };
  await until(() => statuses.includes('restricted'), 'HTTP interval should publish restricted', 7_000);
  assert.equal(await online.lists('rest', 'Listed'), false);
  assert.equal(requests, 2);
});

test('merges known names with stored stats and excludes currently listed players', () => {
  const saved = { name: 'Builder', playTimeMinutes: 91, lastSeenAt: 15 };
  assert.deepEqual(offlinePlayers([{ name: 'Explorer', pingMillis: 8 }],
    ['zebra', 'explorer', 'builder'], [saved, { name: 'EXPLORER', playTimeMinutes: 2 }], 'en'),
  [saved, { name: 'zebra' }]);
});

test('imports saved offline time on servers with no live roster or online players', async t => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  const webcraft = createServer((request, response) => {
    assert.equal(request.url, '/api/v1/internal/players/all');
    response.end(JSON.stringify({ players: [{ uuid, name: 'Builder', playTimeMinutes: 42 }] }));
  });
  const origin = await listen(webcraft);
  const configured = instance('saved', origin);
  configured.webcraft!.playerRoster = true;
  const instances = new Map([['saved', configured]]);
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE players (uuid TEXT, name TEXT, last_seen_at INTEGER);'
    + 'CREATE TABLE server_players (server TEXT, uuid TEXT, name TEXT, last_seen_at INTEGER);');
  const stats = createPlayerStats(database);
  const roster = createPlayerRoster(database, instances, stats);
  const online = createOnlinePlayers(instances, stats);
  t.after(() => { online.stop(); database.close(); webcraft.close(); });
  const updates: unknown[] = [];
  online.subscribe('saved', state => updates.push(state));
  await roster.sync();
  online.refreshHistory();
  const expected = { status: 'disabled', previousPlayers: [{ name: 'Builder', playTimeMinutes: 42 }] };
  assert.deepEqual(readOnlinePlayersState(await online.get('saved')), expected);
  assert.deepEqual(readOnlinePlayersState(updates.at(-1)), expected);
  assert.deepEqual(await roster.getNames('saved'), ['Builder']);
});

test('retains a Creative observation when the player changes mode', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const stats = createPlayerStats(database);
    const row = { name: 'Builder', pingMillis: 5, playTimeMinutes: 42 };
    const source = { players: [{ uuid: '12345678-1234-1234-1234-123456789abc' }] };
    stats.collect('saved', source, [{ ...row, gameMode: 'creative', operator: true }]);
    stats.collect('saved', source, [{ ...row, gameMode: 'survival', operator: false }]);
    const [player] = stats.list('saved');
    assert.equal(player.gameMode, 'survival');
    assert.equal(player.operator, false);
    assert.equal(player.seenCreative, true);
  } finally {
    database.close();
  }
});

test('coalesces skin downloads and serves the disk cache after reopening SQLite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'capycraft-skins-'));
  const path = join(directory, 'players.sqlite');
  let database = new DatabaseSync(path);
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  const skin = { bytes: Buffer.from([1, 2, 3]), hash: 'texture', model: 'classic' as const };
  let downloads = 0;
  const getSkin = createPlayerSkins(database, async () => { downloads++; return skin; });
  assert.deepEqual(await Promise.all([getSkin('Builder'), getSkin('builder')]), [skin, skin]);
  assert.equal(downloads, 1);
  database.close();
  database = new DatabaseSync(path);
  const reopened = createPlayerSkins(database, async () => assert.fail('fresh skin should come from SQLite'));
  assert.deepEqual(Buffer.from((await reopened('Builder')).bytes), skin.bytes);
});

test('collects play time without viewers and retains it after logout and an API restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'capycraft-player-stats-'));
  const path = join(directory, 'players.sqlite');
  const uuid = '12345678-1234-1234-1234-123456789abc';
  let players = [{ name: 'Listed', pingMillis: 36, maxHealth: 27.5, playTimeMinutes: 125, uuid }];
  const webcraft = createServer((_request, response) => response.end(JSON.stringify({ players })));
  const origin = await listen(webcraft);
  const instances = new Map([['stats', instance('stats', origin, 'http')]]);
  let database = new DatabaseSync(path);
  let stats = createPlayerStats(database);
  let online = createOnlinePlayers(instances, stats);
  t.after(async () => {
    online.stop();
    database.close();
    webcraft.close();
    await rm(directory, { recursive: true, force: true });
  });
  const player = { name: 'Listed', playTimeMinutes: 125 };
  await until(() => stats.list('stats').length, 'background collection should save the player');
  assert.deepEqual(readOnlinePlayersState(await online.get('stats')), {
    status: 'ready', players: [{ ...player, pingMillis: 36, maxHealth: 27.5 }],
  });
  players = [];
  const afterLogout = await until(async () => {
    const state = await online.get('stats');
    return state.previousPlayers?.length ? state : undefined;
  }, 'logged-out player should move into history', 7_000);
  const lastSeenAt = afterLogout.previousPlayers?.[0]?.lastSeenAt;
  assert.ok(lastSeenAt && lastSeenAt <= Date.now());
  assert.deepEqual(readOnlinePlayersState(afterLogout), {
    status: 'ready', players: [], previousPlayers: [{ ...player, lastSeenAt }],
  });
  online.stop();
  database.close();
  database = new DatabaseSync(path);
  stats = createPlayerStats(database);
  online = createOnlinePlayers(instances, stats);
  assert.deepEqual(await online.get('stats'), afterLogout);
  assert.deepEqual(stats.list('another-server'), []);
});

test('WebSocket sends live snapshots, scopes subscriptions and keeps catalog updates on the same connection', async t => {
  let requests = 0;
  let snapshot = { players: [{ name: 'Listed', pingMillis: 0, private: token }] };
  const upstream = createServer((_request, response) => { requests++; response.writeHead(500).end(); });
  const ws = new WebSocketServer({ noServer: true });
  ws.on('headers', headers => headers.push('X-WebCraft-Subscription-Updates: delta'));
  const publish = (socket: WebSocket, type: 'snapshot' | 'update', body: unknown, status = 200) =>
    socket.send(JSON.stringify({ id: 'online', type, response: { status, body } }));
  upstream.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/api/v1/internal/ws');
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    ws.handleUpgrade(request, socket, head, client => {
      client.once('message', message => {
        assert.deepEqual(JSON.parse(message.toString()), { id: 'online', op: 'subscribe', path: route, updates: 'delta' });
        publish(client, 'snapshot', snapshot);
      });
    });
  });
  const origin = await listen(upstream);
  const online = createOnlinePlayers(new Map([['live', instance('live', origin, 'websocket')]]));
  const temp = await mkdtemp(join(tmpdir(), 'capycraft-roster-test-'));
  const api = createServer();
  attachLiveUpdates(api, async () => [], new Map([['live', temp]]), online);
  const site = await listen(api);
  const client = new WebSocket(site.replace('http:', 'ws:') + '/api/live');
  t.after(async () => {
    client.terminate();
    online.stop();
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    upstream.close();
    await new Promise<void>(resolve => api.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  });
  const messages: LiveUpdate[] = [];
  client.on('message', raw => {
    assert.ok(!raw.toString().includes(token));
    messages.push(JSON.parse(raw.toString()) as LiveUpdate);
  });
  await once(client, 'open');
  await until(async () => (await online.get('live')).status === 'ready', 'initial upstream snapshot');
  client.send(JSON.stringify({ server: 'live' }));
  client.send(JSON.stringify({ players: 'unknown', subscription: 1 }));
  client.send(JSON.stringify({ players: 'live', subscription: 2 }));
  const initial = await until(() => messages.find(frame => frame.type === 'players'), 'initial browser snapshot');
  assert.deepEqual(initial, {
    type: 'players', server: 'live', subscription: 2, roster: { status: 'ready', players: [{ name: 'Listed', pingMillis: 0 }] },
  });
  await until(() => messages.some(frame => frame.type === 'catalog' && frame.version === null), 'initial catalog frame');
  await writeFile(join(temp, 'catalog.json'), '{}');
  await until(() => messages.some(frame => frame.type === 'catalog' && frame.version), 'catalog update alongside players');
  for (const socket of ws.clients) socket.send(JSON.stringify({
    id: 'online', type: 'patch', patch: { set: { players: [] }, remove: [] },
  }));
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'ready' && !frame.roster.players.length), 'empty list');
  for (const socket of ws.clients) publish(socket, 'update', { players: [{ name: 'Malformed!', pingMillis: 0 }] });
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'unavailable'), 'malformed list clears state');
  assert.equal(await online.lists('live', 'Listed'), false);
  snapshot = { players: [{ name: 'Rejoined', pingMillis: 162, private: token }] };
  for (const socket of ws.clients) socket.send(JSON.stringify({
    id: 'online', type: 'patch', patch: { set: {}, remove: ['unknown-field'] },
  }));
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'offline'), 'socket disconnect clears state');
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'ready' && frame.roster.players[0]?.name === 'Rejoined'),
    'a fresh roster after reconnect');
  client.send(JSON.stringify({ players: null, subscription: 2 }));
  await wait(50);
  const previous = messages.length;
  for (const socket of ws.clients) publish(socket, 'update', { players: [] });
  await until(async () => {
    const current = await online.get('live');
    return current.status === 'ready' && current.players.length === 0;
  }, 'upstream update after unsubscribe');
  assert.equal(messages.length, previous);
  assert.equal(requests, 0);
});

test('the directory survives an initial refusal, rejected subscription and a restart on the same WebCraft URL', async t => {
  const reservation = createServer();
  const origin = await listen(reservation);
  const port = Number(new URL(origin).port);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const ws = new WebSocketServer({ noServer: true });
  const upstream = createServer((_request, response) => response.writeHead(405).end());
  let attempts = 0;
  ws.on('headers', headers => {
    if (attempts === 2) headers.push('X-WebCraft-Subscription-Updates: delta');
  });
  let infoCommands = 0;
  let starting = true;
  const send = (client: WebSocket, id: string, type: string, status: number, body: unknown) =>
    client.send(JSON.stringify({ id, type, response: { status, body } }));
  upstream.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/api/v1/ws');
    assert.equal(request.headers.authorization, undefined);
    if (++attempts === 1) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    ws.handleUpgrade(request, socket, head, client => {
      client.on('message', message => {
        const cmd = JSON.parse(message.toString());
        assert.equal(cmd.updates, attempts === 2 ? 'delta' : undefined);
        if (cmd.id === 'server-status') {
          send(client, cmd.id, 'snapshot', 200, { status: starting ? 'starting' : 'ready' });
        } else {
          infoCommands++;
          if (infoCommands === 1) send(client, cmd.id, 'response', 404, { error: 'not_found' });
          else if (infoCommands === 2) send(client, cmd.id, 'response', 503, { error: 'server_busy' });
          else {
            const body = starting ? { error: 'server_unavailable' }
              : { serverName: 'New world', worldAgeMinutes: 5, worldAgeDays: 0, worldGameTimeTicks: 6_000 };
            send(client, cmd.id, 'snapshot', starting ? 503 : 200, body);
          }
        }
      });
    });
  });
  const config = instance('restart', origin);
  config.webcraft!.directoryTransport = 'websocket';
  const instances = new Map([['restart', config]]);
  const database = new DatabaseSync(':memory:');
  createServerDirectory(database, instances, () => false, new Map());
  database.prepare('INSERT INTO webcraft_instances VALUES (?, ?, ?)').run('restart',
    JSON.stringify({ name: 'Cached world', worldAgeMinutes: 3, worldAgeDays: 0 }), 1);
  const directory = createServerDirectory(database, instances, () => false, new Map());
  const online = createOnlinePlayers(instances);
  const api = createServer();
  const { refreshDirectory } = attachLiveUpdates(api, directory.snapshot, new Map(), online);
  const site = await listen(api);
  const browser = new WebSocket(site.replace('http:', 'ws:') + '/api/live');
  let delivered: ServerSummary[] | undefined;
  browser.on('message', message => {
    const frame: LiveUpdate = JSON.parse(message.toString());
    if (frame.type === 'servers') delivered = frame.servers;
    if (frame.type === 'servers-patch') {
      assert.ok(delivered);
      delivered = applyDirectoryPatch(delivered, frame);
      assert.ok(delivered);
    }
  });
  const stop = directory.start(refreshDirectory);
  t.after(async () => {
    stop();
    online.stop();
    browser.terminate();
    for (const client of ws.clients) client.terminate();
    ws.close();
    upstream.close();
    await new Promise<void>(resolve => api.close(() => resolve()));
    database.close();
  });
  await once(browser, 'open');
  browser.send(JSON.stringify(directorySubscription));
  const current = async () => (await directory.snapshot())[0];
  await until(async () => (await current()).status === 'offline', 'refused TCP connection');
  upstream.listen(port, '127.0.0.1');
  await once(upstream, 'listening');
  await until(async () => (await current()).status === 'unavailable', 'temporary upgrade failure');
  await until(async () => (await current()).status === 'starting', 'status retained while info subscription retries');
  assert.equal((await current()).worldAgeMinutes, 3);
  await until(() => infoCommands === 3, 'retries resume the rejected info subscription');
  assert.equal(attempts, 2);
  starting = false;
  const fourDays = 4 * 24 * 60 * 60;
  for (const client of ws.clients) {
    client.send(JSON.stringify({ id: 'server-status', type: 'patch', patch: { set: { status: 'ready' }, remove: [] } }));
    send(client, 'server-info', 'update', 200, {
      serverName: 'New world', worldAgeMinutes: 5 * 1440, worldAgeDays: 5, worldGameTimeTicks: 24_123, motd: 'Old MOTD',
      uptimeSeconds: 180, totalUptimeSeconds: fourDays,
      performance: { tps: 19.98, mspt: 23.45, msptP95: 48.72 },
    });
  }
  await until(async () => (await current()).worldAgeMinutes === 5 * 1440, 'ready projection uses precise age');
  assert.equal((await current()).worldGameTimeTicks, 24_123);
  assert.equal((await current()).totalUptimeSeconds, fourDays);
  assert.equal((await current()).uptimeSeconds, 180);
  const performance = { tps: 19.98, mspt: 23.45, msptP95: 48.72 };
  assert.deepEqual((await current()).performance, performance);
  await until(() => delivered?.[0]?.performance?.msptP95 === 48.72, 'browser receives performance decimals');
  for (const client of ws.clients) {
    client.send(JSON.stringify({
      id: 'server-info', type: 'patch', patch: { set: { uptimeSeconds: 240, worldAgeDays: null }, remove: ['motd'] },
    }));
    client.send(JSON.stringify({
      id: 'server-info', type: 'patch', patch: { set: { playersOnline: 3 }, remove: ['worldAgeDays'] },
    }));
  }
  await until(async () => (await current()).playersOnline === 3 && (await current()).uptimeSeconds === 240
    && (await current()).worldAgeDays === undefined,
    'upstream applies consecutive patches including a null field and its removal');
  assert.equal((await current()).motd, undefined);
  assert.deepEqual((await current()).performance, performance);
  for (const client of ws.clients) client.terminate();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await until(async () => (await current()).status === 'offline', 'loss of the active WebCraft connection');
  assert.equal((await current()).worldAgeMinutes, 5 * 1440);
  assert.equal((await current()).totalUptimeSeconds, fourDays);
  assert.equal((await current()).uptimeSeconds, undefined);
  assert.equal((await current()).playersOnline, undefined);
  assert.equal((await current()).performance, undefined);
  await until(() => delivered?.[0]?.status === 'offline' && delivered[0].performance === undefined,
    'browser removes offline performance');
  assert.equal((await current()).lastKnownPlayersOnline, 3);
  const cached = (await createServerDirectory(database, instances, () => false, new Map()).snapshot())[0];
  assert.equal(cached.worldAgeMinutes, 5 * 1440);
  assert.equal(cached.worldGameTimeTicks, 24_123);
  assert.equal(cached.performance, undefined);
  assert.equal(cached.totalUptimeSeconds, fourDays);
  assert.equal(cached.lastKnownPlayersOnline, 3);
  starting = true;
  upstream.listen(port, '127.0.0.1');
  await once(upstream, 'listening');
  await until(async () => (await current()).status === 'starting', 'new startup on the same URL');
  for (const client of ws.clients) send(client, 'server-info', 'update', 200, { serverName: 'Partial startup' });
  await until(async () => (await current()).name === 'Partial startup', 'partial startup metadata');
  assert.equal((await current()).worldAgeMinutes, 5 * 1440);
  assert.equal((await current()).totalUptimeSeconds, fourDays);
  for (const client of ws.clients) {
    send(client, 'server-status', 'update', 200, { status: 'ready' });
    send(client, 'server-info', 'update', 200, { serverName: 'Legacy feed', worldAgeMinutes: -1, worldAgeDays: 1 });
  }
  await until(async () => (await current()).worldAgeDays === 1, 'legacy days update on the new socket');
  assert.equal((await current()).worldAgeMinutes, undefined);
  assert.equal((await current()).worldGameTimeTicks, undefined);
  await until(() => delivered?.[0]?.name === 'Legacy feed' && delivered[0].status === 'ready',
    'browser stayed subscribed and received the new ready state');
});

test('the browser opts in to one full directory and receives small per-instance patches afterward', async t => {
  const icon = 'data:image/png;base64,' + 'x'.repeat(6000);
  let servers: ServerSummary[] = [
    { alias: 'old', status: 'ready', tabs: [], logo: icon, uptimeSeconds: 60, worldGameTimeTicks: 24_000,
      playersOnline: 1, lastSeenAt: 100 },
    { alias: 'remove', status: 'waiting', tabs: [] },
  ];
  const api = createServer();
  api.on('request', (_request, response) => response.end(JSON.stringify({ servers })));
  let reads = 0;
  const live = attachLiveUpdates(api, async () => { reads++; return servers; }, new Map(), createOnlinePlayers(new Map()));
  const site = await listen(api);
  const address = site.replace('http:', 'ws:') + '/api/live';
  const active = new Set<WebSocket>();
  t.after(async () => {
    for (const socket of active) socket.terminate();
    await new Promise<void>(resolve => api.close(() => resolve()));
  });
  async function connect() {
    const client = new WebSocket(address, { origin: site });
    active.add(client);
    const frames: LiveUpdate[] = [];
    client.on('message', message => frames.push(JSON.parse(message.toString()) as LiveUpdate));
    await once(client, 'open');
    return { client, frames };
  }
  const rejected = new WebSocket(address, { origin: 'https://unrelated.example' });
  await once(rejected, 'error');
  const { client, frames } = await connect();
  live.refreshDirectory();
  assert.equal(reads, 0);
  client.send(JSON.stringify({ server: null }));
  client.send(JSON.stringify(directorySubscription));
  await until(() => frames.length === 1, 'initial browser snapshot');
  const initial = frames[0];
  assert.deepEqual(initial, { type: 'servers', servers });
  client.send(JSON.stringify(directorySubscription));
  await wait(50);
  assert.equal(frames.length, 1);

  servers = [{ ...servers[0], uptimeSeconds: 62, worldGameTimeTicks: 24_040, lastSeenAt: 123 }, servers[1]];
  live.refreshDirectory();
  await wait(50);
  assert.equal(frames.length, 1);
  assert.deepEqual(await fetch(site).then(response => response.json()), { servers });

  servers = [{ ...servers[0], uptimeSeconds: 120, worldGameTimeTicks: 26_400, lastSeenAt: 158 }, servers[1]];
  live.refreshDirectory();
  await until(() => frames.length === 2, 'minute boundary produces a patch');
  assert.deepEqual(frames[1], { type: 'servers-patch', added: [], removed: [], changed: [
    { alias: 'old', set: { uptimeSeconds: 120, worldGameTimeTicks: 26_400, lastSeenAt: 158 }, remove: [] },
  ] });
  assert.ok(JSON.stringify(frames[1]).length < 200);
  const minute = applyDirectoryPatch(initial.servers, frames[1])!;
  assert.deepEqual(minute, servers);

  servers = [
    { alias: 'old', status: 'offline', tabs: [], logo: icon, lastSeenAt: 159 },
    { alias: 'new', status: 'starting', tabs: ['items'] },
  ];
  live.refreshDirectory();
  await until(() => frames.length === 3, 'status, removals and additions produce a patch');
  assert.deepEqual(applyDirectoryPatch(minute, frames[2]), servers);
  assert.ok(!JSON.stringify(frames[2]).includes(icon));
  assert.equal(applyDirectoryPatch(minute, { added: [], removed: [], changed: [
    { alias: 'old', set: { status: 'offline' }, remove: ['status'] },
  ] }), undefined);
  assert.equal(applyDirectoryPatch(minute, { added: [], removed: [], changed: [
    { alias: 'old', set: { status: 'invalid' }, remove: [] },
  ] }), undefined);
  const closed = once(client, 'close');
  client.close();
  await closed;
  const fresh = await connect();
  fresh.client.send(JSON.stringify(directorySubscription));
  await until(() => fresh.frames.length === 1, 'reconnect starts with a fresh baseline');
  assert.deepEqual(fresh.frames[0], { type: 'servers', servers });
});
