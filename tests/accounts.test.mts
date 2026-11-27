import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createAccountApi } from '../server/accounts.mts';
import type { Instance } from '../server/instances.mts';

const site = 'http://127.0.0.1:5173';
const issuer = 'clerk-fixture.accounts.dev';
const bearer = 'test_'.repeat(10);
const code = 'Abc_234-defG567Z';
const otherCode = 'Abc_234-defG567X';
const retryCode = 'Abc_234-defG567R';
const uuid = 'bb019a8e-de4b-4674-a886-70188c2f4c3b';
const otherUuid = '1f79b823-0381-40a5-9db5-024789411eaf';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('Clerk sessions, WebCraft recovery and persistent Minecraft ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'capycraft-accounts-'));
  const file = join(directory, 'players.sqlite');
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    VITE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${issuer}$`).toString('base64')}`,
    CLERK_SECRET_KEY: 'sk_test_fixture',
    CLERK_JWT_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    CLERK_AUTHORIZED_ORIGINS: site,
    CLERK_TELEMETRY_DISABLED: '1',
    CAPYCRAFT_TEST_LINK_TOKEN: bearer,
  };
  for (const [key, value] of Object.entries(env)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }

  function token(sub: string, sid: string, claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = [
      encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture', cat: 'cl_B7d4PD111AAA' }),
      encode({ iss: `https://${issuer}`, sub, sid, azp: site, iat: now, nbf: now - 1, exp: now + 120, v: 2, ...claims }),
    ].join('.');
    return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), keys.privateKey).toString('base64url')}`;
  }
  const calls: Array<{ code: string; attemptId: string }> = [];
  const webcraft = createServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/internal/account-links/redeem');
    assert.equal(request.headers.authorization, `Bearer ${bearer}`);
    assert.equal(request.headers['content-type'], 'application/json');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(Object.keys(body).sort(), ['attemptId', 'code']);
    assert.match(body.attemptId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    const previous = calls.find(call => call.code === body.code);
    calls.push(body);
    if (body.code === retryCode && !previous) {
      // WebCraft records the receipt, but Capycraft does not receive the response.
      request.socket.destroy();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (body.code === retryCode) assert.equal(body.attemptId, previous?.attemptId);
    if (body.code === 'Limit_123456789A') {
      response.writeHead(429, { 'Retry-After': '25' }).end('{"error":"rate_limited"}');
    } else if (body.code === 'Offline_12345678') {
      response.writeHead(503).end('{"error":"unavailable"}');
    } else if (body.code === code || body.code === otherCode || body.code === retryCode) {
      response.end(JSON.stringify({ uuid: body.code === retryCode ? otherUuid : uuid, name: 'ExamplePlayer' }));
    } else {
      response.writeHead(404).end('{"error":"invalid_code"}');
    }
  });
  const origin = await listen(webcraft);
  t.after(() => { webcraft.closeAllConnections(); webcraft.close(); });
  const webcraftConfig = {
    origin, accountLinkTokenEnv: 'CAPYCRAFT_TEST_LINK_TOKEN', info: 'public', status: 'public',
    directoryTransport: 'http', playerHistory: false,
  } as const;
  const instances: ReadonlyMap<string, Instance> = new Map(['universum', 'second'].map(alias =>
    [alias, { alias, tabs: [], webcraft: webcraftConfig }]));
  let database = new DatabaseSync(file);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  database.exec("CREATE TABLE players (uuid TEXT PRIMARY KEY); INSERT INTO players VALUES ('legacy')");
  let handler = createAccountApi(database, instances);
  const api = createServer((request, response) => void handler(request, response));
  const apiOrigin = await listen(api);
  t.after(() => { api.closeAllConnections(); api.close(); });

  const alice = token('user_alice', 'sess_first');
  const bob = token('user_bob', 'sess_bob');
  const get = (jwt?: string) => fetch(`${apiOrigin}/api/account`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
  const post = (jwt: string, gameCode: string, server = 'universum', requestOrigin = site) =>
    fetch(`${apiOrigin}/api/account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, code: gameCode }),
    });

  assert.equal((await get()).status, 401);
  assert.equal((await get(`${alice.slice(0, -8)}12345678`)).status, 401);
  assert.equal((await get(token('user_alice', 'sess_old', { exp: 1 }))).status, 401);
  assert.equal((await get(token('user_alice', 'sess_old', { azp: 'https://other.example' }))).status, 401);
  assert.equal((await post(alice, code, 'universum', 'https://other.example')).status, 403);
  assert.equal((await post(alice, 'bad-code')).status, 400);
  assert.equal(calls.length, 0);

  handler = createAccountApi(database, new Map([['universum', {
    alias: 'universum', tabs: [], webcraft: { ...webcraftConfig, accountLinkTokenEnv: undefined },
  }]]));
  const unconfigured = await get(alice);
  assert.equal(unconfigured.status, 200);
  assert.deepEqual(await unconfigured.json(), { servers: [], links: [] });
  assert.equal(calls.length, 0);

  handler = createAccountApi(database, instances);
  const before = await get(alice);
  assert.equal(before.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await before.json(), { servers: ['second', 'universum'], links: [] });

  const first = await post(alice, code);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { server: 'universum', uuid, name: 'ExamplePlayer' });
  assert.equal((await post(alice, code)).status, 200);
  assert.equal((await post(alice, otherCode)).status, 409);
  assert.equal(calls.length, 1);

  const conflict = await post(bob, otherCode);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'minecraft_account_in_use' });
  assert.equal((await post(bob, otherCode, 'second')).status, 200);
  const interrupted = await post(bob, retryCode);
  assert.equal(interrupted.status, 503);
  assert.deepEqual(await interrupted.json(), { error: 'webcraft_unavailable' });
  database.close();
  database = new DatabaseSync(file);
  handler = createAccountApi(database, instances);
  assert.equal((await post(bob, retryCode)).status, 200);
  assert.equal(calls[0].code, code);
  assert.notEqual(calls[0].attemptId, calls[1].attemptId);
  assert.deepEqual(database.prepare('SELECT uuid FROM players').all().map(row => row.uuid), ['legacy']);
  const digests = database.prepare('SELECT code_digest FROM minecraft_link_attempts').all();
  assert.ok(digests.every(row => /^[0-9a-f]{64}$/.test(String(row.code_digest))));

  const newSession = await get(token('user_alice', 'sess_new'));
  assert.deepEqual(await newSession.json(), {
    servers: ['second', 'universum'],
    links: [{ server: 'universum', uuid, name: 'ExamplePlayer' }],
  });

  const charlie = token('user_charlie', 'sess_charlie');
  const expired = await post(charlie, 'Expired_12345678');
  assert.equal(expired.status, 404);
  assert.deepEqual(await expired.json(), { error: 'invalid_code' });
  const offline = await post(charlie, 'Offline_12345678');
  assert.equal(offline.status, 503);
  assert.deepEqual(await offline.json(), { error: 'webcraft_unavailable' });
  const limited = await post(charlie, 'Limit_123456789A');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '25');
});
