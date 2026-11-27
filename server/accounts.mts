import { createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { createClerkClient } from '@clerk/backend';
import { linkCodePattern, type MinecraftLink } from '../src/auth/account.mts';
import { isServerAlias } from '../src/minecraftServers.mjs';
import { webcraftToken, type Instance } from './instances.mts';
import { uuidPattern } from './playerRoster.mts';

const redeemPath = '/api/v1/internal/account-links/redeem';
const attemptLifetime = 10 * 60_000;
const maxBodyBytes = 1024;

function clerkConfiguration() {
  const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const jwtKey = process.env.CLERK_JWT_KEY?.replace(/\\n/g, '\n').trim();
  const origins = (process.env.CLERK_AUTHORIZED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!publishableKey || !secretKey || !origins.length || origins.some(origin => {
    const url = URL.canParse(origin) ? new URL(origin) : null;
    return !url || url.origin !== origin || (url.protocol !== 'https:'
      && (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  })) return null;
  const clerk = createClerkClient({ publishableKey, secretKey, jwtKey });
  return { clerk, origins };
}

async function readCodeSubmission(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBodyBytes) return null;
      chunks.push(chunk);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && 'server' in value && isServerAlias(value.server)
      && 'code' in value && typeof value.code === 'string' && linkCodePattern.test(value.code)) {
      return { server: value.server, code: value.code };
    }
  } catch {
    // Treat malformed or interrupted input as an invalid submission.
  }
  return null;
}

function redemptionRateLimit() {
  const accounts = new Map<string, number>();
  const clients = new Map<string, number>();
  let reset = 0;
  return (userId: string, request: IncomingMessage, now: number) => {
    // The loopback API is behind Caddy or Vite. Use the address supplied by the nearest proxy.
    const header = request.headers['x-forwarded-for'];
    const forwarded = typeof header === 'string' ? header.split(',').at(-1)?.trim() : undefined;
    const client = forwarded && isIP(forwarded) ? forwarded : request.socket.remoteAddress ?? '';
    if (now >= reset) {
      accounts.clear();
      clients.clear();
      reset = now + 60_000;
    }
    const accountCount = accounts.get(userId) ?? 0;
    const clientCount = clients.get(client) ?? 0;
    if (accountCount >= 8 || clientCount >= 24 || accounts.size >= 4096 || clients.size >= 4096) {
      return Math.ceil((reset - now) / 1000);
    }
    accounts.set(userId, accountCount + 1);
    clients.set(client, clientCount + 1);
    return 0;
  };
}

export function createAccountApi(database: DatabaseSync, instances: ReadonlyMap<string, Instance>) {
  const config = clerkConfiguration();
  const destinations = new Map<string, { url: URL; token: string }>();
  for (const { alias, webcraft } of instances.values()) {
    if (!webcraft?.accountLinkTokenEnv) continue;
    const token = webcraftToken(webcraft.accountLinkTokenEnv);
    if (token && token !== webcraftToken(webcraft.tokenEnv)) {
      destinations.set(alias, { url: new URL(redeemPath, webcraft.origin), token });
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS capycraft_accounts (
      clerk_user_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS minecraft_account_links (
      clerk_user_id TEXT NOT NULL REFERENCES capycraft_accounts(clerk_user_id),
      server TEXT NOT NULL,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      PRIMARY KEY (clerk_user_id, server),
      UNIQUE (server, uuid)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS minecraft_link_attempts (
      clerk_user_id TEXT NOT NULL REFERENCES capycraft_accounts(clerk_user_id),
      server TEXT NOT NULL,
      code_digest TEXT NOT NULL,
      attempt_id TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (clerk_user_id, server, code_digest)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS minecraft_link_attempt_expiry ON minecraft_link_attempts (expires_at);
  `);
  const createAccount = database.prepare('INSERT INTO capycraft_accounts VALUES (?, ?) ON CONFLICT DO NOTHING');
  const listLinks = database.prepare('SELECT server, uuid, name FROM minecraft_account_links WHERE clerk_user_id = ? ORDER BY server');
  const getLink = database.prepare('SELECT uuid, name, attempt_id FROM minecraft_account_links WHERE clerk_user_id = ? AND server = ?');
  const saveLink = database.prepare('INSERT INTO minecraft_account_links VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const cleanAttempts = database.prepare('DELETE FROM minecraft_link_attempts WHERE expires_at <= ?');
  const createAttempt = database.prepare('INSERT INTO minecraft_link_attempts VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const getAttempt = database.prepare('SELECT attempt_id FROM minecraft_link_attempts WHERE clerk_user_id = ? AND server = ? AND code_digest = ?');
  const rateLimit = redemptionRateLimit();
  cleanAttempts.run(Date.now());

  return async function serveAccount(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, body: object) => response.writeHead(status).end(JSON.stringify(body));
    const fail = (status: number, error: string) => send(status, { error });
    const limited = (seconds: string) => {
      response.setHeader('Retry-After', seconds);
      return fail(429, 'rate_limited');
    };

    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return fail(405, 'method_not_allowed');
      }
      if (request.url?.includes('?')) return fail(400, 'invalid_request');
      if (!config) return fail(503, 'account_unavailable');
      const origin = request.headers.origin;
      if (request.method === 'POST' && (!origin || !config.origins.includes(origin))) {
        return fail(403, 'origin_not_allowed');
      }
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer [^\s,]+$/.test(authorization)) return fail(401, 'sign_in_required');
      const state = await config.clerk.authenticateRequest(new Request(config.origins[0], { headers: { authorization } }), {
        acceptsToken: 'session_token',
        authorizedParties: config.origins,
      });
      const auth = state.toAuth({ treatPendingAsSignedOut: true });
      if (!auth?.isAuthenticated || !auth.userId || !auth.sessionId || auth.actor || !auth.sessionClaims?.azp
        || !config.origins.includes(auth.sessionClaims.azp) || (origin && origin !== auth.sessionClaims.azp)) {
        return fail(401, 'sign_in_required');
      }

      const userId = auth.userId;
      const now = Date.now();
      if (request.method === 'GET') {
        createAccount.run(userId, now);
        return send(200, { servers: [...destinations.keys()].sort(), links: listLinks.all(userId) });
      }
      const delay = rateLimit(userId, request, now);
      if (delay) return limited(String(delay));
      const submission = await readCodeSubmission(request);
      if (!submission) return fail(400, 'invalid_request');
      const { server, code } = submission;
      const destination = destinations.get(server);
      if (!destination) return fail(404, 'server_unavailable');

      createAccount.run(userId, now);
      cleanAttempts.run(Date.now());
      const digest = createHmac('sha256', destination.token).update(code).digest('hex');
      const existing = getLink.get(userId, server);
      if (existing) {
        if (getAttempt.get(userId, server, digest)?.attempt_id !== existing.attempt_id) return fail(409, 'already_linked');
        return send(200, { server, uuid: existing.uuid, name: existing.name });
      }

      // Save the operation before contacting WebCraft so a restart can replay the same attempt.
      createAttempt.run(userId, server, digest, randomUUID(), Date.now() + attemptLifetime);
      const attemptId = getAttempt.get(userId, server, digest)?.attempt_id;
      if (typeof attemptId !== 'string') return fail(503, 'account_unavailable');
      let linked: MinecraftLink;
      try {
        const upstream = await fetch(destination.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${destination.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, attemptId }),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (upstream.status === 429) {
          const retry = upstream.headers.get('Retry-After');
          void upstream.body?.cancel().catch(() => {});
          return limited(retry && /^\d{1,6}$/.test(retry) ? retry : '60');
        }
        if (upstream.status === 404) {
          const result = await upstream.json();
          if (result?.error === 'invalid_code') return fail(404, 'invalid_code');
          return fail(503, 'account_unavailable');
        }
        if (upstream.status !== 200) {
          void upstream.body?.cancel().catch(() => {});
          return fail(503, upstream.status >= 500 ? 'webcraft_unavailable' : 'account_unavailable');
        }
        const result = await upstream.json();
        if (typeof result?.uuid !== 'string' || !uuidPattern.test(result.uuid) || typeof result.name !== 'string') {
          return fail(503, 'account_unavailable');
        }
        linked = { server, uuid: result.uuid.toLowerCase(), name: result.name };
      } catch {
        return fail(503, 'webcraft_unavailable');
      }
      saveLink.run(userId, server, linked.uuid, linked.name, attemptId);
      const stored = getLink.get(userId, server);
      if (stored?.uuid === linked.uuid) return send(200, { ...linked, name: stored.name });
      return fail(409, stored ? 'already_linked' : 'minecraft_account_in_use');
    } catch {
      // Upstream errors can contain request details. Return a generic failure without logging them.
      return fail(503, 'account_unavailable');
    } finally {
      request.resume();
    }
  };
}
