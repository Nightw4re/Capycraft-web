import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { serverDirectoryPath } from '../src/liveUpdates.mts';
import type { ServerInformation, ServerStatus, ServerSummary } from '../src/serverDirectoryTypes.ts';
import { webcraftToken, type Instance } from './instances.mts';
import { subscribeWebcraftDirectory, type DirectoryFeed } from './webcraftDirectorySocket.mts';
import type { FeedResult } from './webcraftSocket.mts';

export { serverDirectoryPath };
const pollInterval = 60_000;
const timeout = 5_000;

type Snapshot = { status: ServerStatus; information?: ServerInformation; lastSeenAt?: number; fresh: boolean };

async function readFeed(url: string, token?: string): Promise<FeedResult> {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
  } catch {
    return { reachable: false };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { reachable: true, httpStatus: response.status };
  }
  try {
    return { reachable: true, data: await response.json() };
  } catch {
    return { reachable: true };
  }
}

function fields(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' && value.length <= limit ? value.trim() || undefined : undefined;
}

function wholeNumber(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readServerIcon(value: unknown) {
  const icon = text(value, 96_000);
  if (!icon) return;
  if (/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(icon)) return icon;

  const webp = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(icon);
  if (!webp) return;
  const header = Buffer.from(webp[1].slice(0, 16), 'base64');
  if (header.toString('latin1', 0, 4) === 'RIFF' && header.toString('latin1', 8, 12) === 'WEBP') return icon;
}

function readInformation(value: unknown): ServerInformation | undefined {
  const data = fields(value);
  if (!data) return;
  const modpack = fields(data.modpack);
  const modpackName = text(modpack?.name, 160);
  const modpackVersion = text(modpack?.version, 100);
  const information: ServerInformation = {
    name: text(data.serverName, 160),
    address: text(data.joinAddress, 255),
    logo: readServerIcon(data.serverIcon),
    motd: text(data.motd, 2048),
    playersOnline: wholeNumber(data.playersOnline),
    maxPlayers: wholeNumber(data.maxPlayers),
    uptimeSeconds: wholeNumber(data.uptimeSeconds),
    totalUptimeSeconds: wholeNumber(data.totalUptimeSeconds),
    worldAgeDays: wholeNumber(data.worldAgeDays),
    worldAgeMinutes: wholeNumber(data.worldAgeMinutes),
    modpack: modpackName || modpackVersion ? { name: modpackName, version: modpackVersion } : undefined,
  };
  if (Object.values(information).some(value => value !== undefined)) return information;
}

export function createServerDirectory(
  database: DatabaseSync,
  instances: ReadonlyMap<string, Instance>,
  hasLegacyServer: () => boolean,
  catalogs: ReadonlyMap<string, string>,
) {
  database.exec(`CREATE TABLE IF NOT EXISTS webcraft_instances (
    alias TEXT PRIMARY KEY,
    information TEXT,
    last_seen_at INTEGER NOT NULL
  ) STRICT`);
  const load = database.prepare('SELECT information, last_seen_at FROM webcraft_instances WHERE alias = ?');
  const save = database.prepare(`INSERT INTO webcraft_instances (alias, information, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT (alias) DO UPDATE SET information = excluded.information, last_seen_at = excluded.last_seen_at`);
  const snapshots = new Map<string, Snapshot>();
  for (const { alias } of instances.values()) {
    const saved = load.get(alias) as { information: string | null; last_seen_at: number } | undefined;
    const information = saved?.information ? JSON.parse(saved.information) as ServerInformation : undefined;
    snapshots.set(alias, {
      status: saved ? 'unavailable' : 'waiting',
      information: information && Object.keys(information).length ? information : undefined,
      lastSeenAt: saved?.last_seen_at,
      fresh: false,
    });
  }

  async function poll(instance: Instance) {
    const { alias, webcraft } = instance;
    if (!webcraft) return;
    const { origin } = webcraft;
    const token = webcraftToken(webcraft.tokenEnv);
    async function request(feed: DirectoryFeed, exposure: 'public' | 'internal'): Promise<FeedResult> {
      const internal = exposure === 'internal';
      if (internal && !token) return { reachable: true };
      const url = `${origin}/api/v1/${internal ? 'internal/' : ''}${feed}`;
      const authorization = internal ? token : undefined;
      if (feed === 'server-status') return readFeed(url, authorization);

      const preferred = await readFeed(`${url}?iconFormat=webp`, authorization);
      // Older WebCraft versions reject query parameters on this feed.
      return preferred.httpStatus === 400 ? readFeed(url, authorization) : preferred;
    }
    const [statusResult, infoResult] = await Promise.all([
      request('server-status', webcraft.status), request('server-info', webcraft.info),
    ]);
    applyResults(alias, statusResult, infoResult, true);
  }

  function applyResults(alias: string, statusResult: FeedResult, infoResult: FeedResult, received: boolean) {
    const reported = fields(statusResult.data)?.status;
    const status = reported === 'starting' || reported === 'ready' || reported === 'stopping' ? reported : undefined;
    const current = snapshots.get(alias)!;
    const information = readInformation(infoResult.data);
    const fresh = status === 'ready' && information !== undefined;
    if (received && (status || information)) {
      const lastSeenAt = Date.now();
      const latestInformation = information && !fresh ? {
        ...information,
        maxPlayers: information.maxPlayers ?? current.information?.maxPlayers,
        totalUptimeSeconds: information.totalUptimeSeconds ?? current.information?.totalUptimeSeconds,
        worldAgeDays: information.worldAgeDays ?? current.information?.worldAgeDays,
        worldAgeMinutes: information.worldAgeMinutes ?? current.information?.worldAgeMinutes,
      } : information ?? current.information;
      save.run(alias, latestInformation ? JSON.stringify(latestInformation) : null, lastSeenAt);
      current.lastSeenAt = lastSeenAt;
      current.information = latestInformation;
    }
    current.fresh = fresh;
    current.status = status ?? (statusResult.reachable || infoResult.reachable ? 'unavailable'
      : current.lastSeenAt === undefined ? 'waiting' : 'offline');
  }

  function start(onChange: () => void) {
    const polling: Instance[] = [];
    const stopSubscriptions: (() => void)[] = [];
    for (const instance of instances.values()) {
      const { alias, webcraft } = instance;
      if (!webcraft) continue;
      if (webcraft.directoryTransport !== 'websocket') {
        polling.push(instance);
        continue;
      }
      const results = new Map<DirectoryFeed, FeedResult>();
      const unreachable = { reachable: false };
      const stop = subscribeWebcraftDirectory(webcraft, updates => {
        for (const [feed, result] of updates) results.set(feed, result);
        try {
          applyResults(alias, results.get('server-status') ?? unreachable, results.get('server-info') ?? unreachable,
            Array.from(updates.values()).some(result => result.data !== undefined));
          onChange();
        } catch (error) {
          console.warn(`Could not refresh server information for ${alias}.`, error);
        }
      });
      stopSubscriptions.push(stop);
    }

    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    async function pollAll() {
      await Promise.all(polling.map(async instance => {
        try {
          await poll(instance);
        } catch (error) {
          console.warn(`Could not refresh server information for ${instance.alias}.`, error);
        }
      }));
      if (stopped) return;
      onChange();
      timer = setTimeout(() => void pollAll(), pollInterval).unref();
    }
    if (polling.length) void pollAll();

    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const stop of stopSubscriptions) stop();
    };
  }

  async function snapshot() {
    // The legacy alias also reserves an import destination on a fresh installation.
    const visibleInstances = Array.from(instances.values()).filter(instance => instance.webcraft || hasLegacyServer());
    const servers = await Promise.all(visibleInstances.map(async ({ alias, tabs, webcraft }): Promise<ServerSummary> => {
      const snapshot = snapshots.get(alias)!;
      if (webcraft && !snapshot.information) {
        const catalog = catalogs.get(alias);
        const onlinePlayers = webcraft.onlinePlayersTransport && tabs.includes('players');
        const achievements = webcraft.achievements && tabs.includes('achievements');
        const quests = webcraft.quests && tabs.includes('quests');
        const ponder = webcraft.ponder && tabs.includes('ponder');
        let items = false;
        if (catalog && tabs.includes('items')) {
          const manifest = await readFile(join(catalog, 'catalog.json'), 'utf8').then(text => fields(JSON.parse(text))).catch(() => undefined);
          const hasPublishedItems = manifest && (manifest.state === 'importing' || manifest.state === 'failed')
            && typeof manifest.total === 'number' && manifest.total > 0;
          items = manifest?.state === 'ready' || !!hasPublishedItems;
        }
        const availableTabs = { items, players: onlinePlayers, achievements, quests, ponder };
        return {
          alias, status: snapshot.status, lastSeenAt: snapshot.lastSeenAt,
          tabs: tabs.filter(tab => availableTabs[tab]),
          access: items ? 'catalog' : onlinePlayers ? 'players' : achievements ? 'achievements'
            : quests ? 'quests' : ponder ? 'ponder' : 'pending',
        };
      }
      const { playersOnline, uptimeSeconds, ...information } = snapshot.information ?? {};
      return {
        alias, tabs, status: snapshot.status, lastSeenAt: snapshot.lastSeenAt, ...information,
        ...(snapshot.fresh ? { playersOnline, uptimeSeconds } : {}),
      };
    }));
    return servers;
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    response.end(JSON.stringify({ servers: await snapshot() }));
  }

  return { start, serve, snapshot };
}
