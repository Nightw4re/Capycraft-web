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
import { createServerDirectory } from '../server/serverDirectory.mts';
import type { LiveUpdate } from '../src/liveUpdates.mts';

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

test('WebSocket sends live snapshots, scopes subscriptions and keeps catalog updates on the same connection', async t => {
  let requests = 0;
  let snapshot = { players: [{ name: 'Listed', pingMillis: 0, private: token }] };
  const upstream = createServer((_request, response) => { requests++; response.writeHead(500).end(); });
  const ws = new WebSocketServer({ noServer: true });
  const publish = (socket: WebSocket, type: 'snapshot' | 'update', body: unknown, status = 200) =>
    socket.send(JSON.stringify({ id: 'online', type, response: { status, body } }));
  upstream.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/api/v1/internal/ws');
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    ws.handleUpgrade(request, socket, head, client => {
      client.once('message', message => {
        assert.deepEqual(JSON.parse(message.toString()), { id: 'online', op: 'subscribe', path: route });
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
  for (const socket of ws.clients) publish(socket, 'update', { players: [] });
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'ready' && !frame.roster.players.length), 'empty list');
  for (const socket of ws.clients) publish(socket, 'update', { players: [{ name: 'Malformed!', pingMillis: 0 }] });
  await until(() => messages.some(frame => frame.type === 'players' && frame.roster.status === 'unavailable'), 'malformed list clears state');
  assert.equal(await online.lists('live', 'Listed'), false);
  snapshot = { players: [{ name: 'Rejoined', pingMillis: 162, private: token }] };
  for (const socket of ws.clients) socket.terminate();
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
        if (cmd.id === 'server-status') {
          send(client, cmd.id, 'snapshot', 200, { status: starting ? 'starting' : 'ready' });
        } else {
          infoCommands++;
          if (infoCommands === 1) send(client, cmd.id, 'response', 404, { error: 'not_found' });
          else if (infoCommands === 2) send(client, cmd.id, 'response', 503, { error: 'server_busy' });
          else {
            const body = starting ? { error: 'server_unavailable' }
              : { serverName: 'New world', worldAgeMinutes: 5, worldAgeDays: 0 };
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
  const frames: LiveUpdate[] = [];
  browser.on('message', message => frames.push(JSON.parse(message.toString()) as LiveUpdate));
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
    send(client, 'server-status', 'update', 200, { status: 'ready' });
    send(client, 'server-info', 'update', 200, {
      serverName: 'New world', worldAgeMinutes: 5 * 1440, worldAgeDays: 5, uptimeSeconds: 180, totalUptimeSeconds: fourDays,
    });
  }
  await until(async () => (await current()).worldAgeMinutes === 5 * 1440, 'ready projection uses precise age');
  assert.equal((await current()).totalUptimeSeconds, fourDays);
  assert.equal((await current()).uptimeSeconds, 180);
  for (const client of ws.clients) client.terminate();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await until(async () => (await current()).status === 'offline', 'loss of the active WebCraft connection');
  assert.equal((await current()).worldAgeMinutes, 5 * 1440);
  assert.equal((await current()).totalUptimeSeconds, fourDays);
  assert.equal((await current()).uptimeSeconds, undefined);
  const cached = (await createServerDirectory(database, instances, () => false, new Map()).snapshot())[0];
  assert.equal(cached.worldAgeMinutes, 5 * 1440);
  assert.equal(cached.totalUptimeSeconds, fourDays);
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
  await until(() => frames.some(frame => frame.type === 'servers' && frame.servers[0].name === 'Legacy feed'
    && frame.servers[0].status === 'ready'), 'browser stayed subscribed and received the new ready state');
});
