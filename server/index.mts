import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServerItemSearch, itemSearchPath } from './itemSearch.mts';
import { createServerItemRecipeUses, itemRecipeUsesPath } from './itemRecipeUses.mts';
import { instanceDirectory, itemCatalogDirectories, loadInstances, webcraftToken } from './instances.mts';
import { catalogPrefix, readCatalogResource, serveCatalog } from './itemCatalog.mts';
import { createItemPages } from './itemPages.mts';
import { createServerDirectory, serverDirectoryPath } from './serverDirectory.mts';
import { attachLiveUpdates } from './liveUpdates.mts';
import { defaultAlias } from '../src/minecraftServers.mjs';
import { downloadMinecraftSkin } from './minecraftSkin.mts';
import { createOnlinePlayers } from './onlinePlayers.mts';
import { achievementsPath } from '../src/achievements.mts';
import { createAchievements } from './achievements.mts';
import { questsPath } from '../src/quests.mts';
import { createQuests } from './quests.mts';
import { ponderPath } from '../src/ponder/format.mts';
import { createPonder } from './ponder.mts';
import { createPlayerRoster, playerNamePattern, uuidPattern } from './playerRoster.mts';

const pollIntervalMs = 60_000;
const importPollIntervalMs = 30_000;
const requestTimeoutMs = 5_000;
const instancesRoot = instanceDirectory(process.env.CAPYCRAFT_INSTANCE_DIR);
mkdirSync(instancesRoot, { recursive: true });
const instances = loadInstances(instancesRoot);

function configuredFeeds(value: string | undefined) {
  const configError = 'WEBCRAFT_PLAYER_FEEDS must be a JSON array of WebCraft URLs, feed tokens and optional server aliases.';
  let feeds: unknown;
  try {
    feeds = JSON.parse(value || '[]');
  } catch {
    throw new Error(configError);
  }
  if (!Array.isArray(feeds)) throw new Error(configError);

  return feeds.map((feed: unknown) => {
    if (!feed || typeof feed !== 'object' || !('url' in feed) || !('token' in feed)
      || typeof feed.url !== 'string' || !URL.canParse(feed.url)
      || typeof feed.token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(feed.token)) {
      throw new Error(configError);
    }
    const url = new URL(feed.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(configError);
    }
    const server = 'server' in feed ? feed.server : defaultAlias;
    if (typeof server !== 'string' || !instances.has(server)) throw new Error(configError);
    return { url, token: feed.token, server };
  });
}

function parsePlayers(data: unknown) {
  if (!data || typeof data !== 'object' || !('players' in data) || !Array.isArray(data.players)) {
    throw new Error('Invalid WebCraft player feed.');
  }

  return data.players.map((player: unknown) => {
    if (!player || typeof player !== 'object' || !('uuid' in player) || !('name' in player) || !('lastSeenAt' in player)
      || typeof player.uuid !== 'string' || !uuidPattern.test(player.uuid)
      || typeof player.name !== 'string' || !playerNamePattern.test(player.name)
      || typeof player.lastSeenAt !== 'number' || !Number.isSafeInteger(player.lastSeenAt) || player.lastSeenAt < 0) {
      throw new Error('Invalid WebCraft player record.');
    }
    return { uuid: player.uuid.toLowerCase(), name: player.name, lastSeenAt: player.lastSeenAt };
  });
}

const feeds = configuredFeeds(process.env.WEBCRAFT_PLAYER_FEEDS);
for (const { alias, webcraft } of instances.values()) {
  if (!webcraft?.playerHistory || feeds.some(feed => feed.server === alias)) continue;
  const token = webcraftToken(webcraft.tokenEnv);
  if (token) feeds.push({ server: alias, token, url: new URL('/api/v1/internal/players', webcraft.origin) });
}
const databasePath = resolve(process.env.CAPYCRAFT_PLAYER_DATABASE || 'data/players.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec('BEGIN IMMEDIATE');
const hasServerPlayers = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'server_players'").get();
database.exec(`
  CREATE TABLE IF NOT EXISTS players (
    uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS server_players (
    server TEXT NOT NULL,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (server, uuid)
  ) STRICT;
`);
if (!hasServerPlayers && instances.has(defaultAlias)) {
  database.prepare('INSERT INTO server_players SELECT ?, uuid, name, last_seen_at FROM players').run(defaultAlias);
}
database.exec('COMMIT');
const roster = createPlayerRoster(database, instances);
const serveAchievements = createAchievements(instances, roster.getNames);
const serveQuests = createQuests(instances, roster.resolvePlayer);
const servePonder = createPonder(instances);

const savePlayer = database.prepare(`
  INSERT INTO players (uuid, name, last_seen_at) VALUES (?, ?, ?)
  ON CONFLICT (uuid) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at
  WHERE excluded.last_seen_at > players.last_seen_at
     OR (excluded.last_seen_at = players.last_seen_at AND excluded.name > players.name)
`);
const selectNames = database.prepare('SELECT name FROM players ORDER BY name COLLATE NOCASE, name, uuid');
const saveServerPlayer = database.prepare(`
  INSERT INTO server_players (server, uuid, name, last_seen_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (server, uuid) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at
  WHERE excluded.last_seen_at > server_players.last_seen_at
     OR (excluded.last_seen_at = server_players.last_seen_at AND excluded.name > server_players.name)
`);
const selectServerNames = database.prepare('SELECT name FROM server_players WHERE server = ? ORDER BY name COLLATE NOCASE, name, uuid');
const recentNames = database.prepare(`
  SELECT name FROM players GROUP BY name COLLATE NOCASE
  ORDER BY max(last_seen_at) DESC, name COLLATE NOCASE LIMIT 10
`);
const recentServerNames = database.prepare(`
  SELECT name FROM server_players WHERE server = ? GROUP BY name COLLATE NOCASE
  ORDER BY max(last_seen_at) DESC, name COLLATE NOCASE LIMIT 10
`);
const findPlayerName = database.prepare('SELECT 1 FROM players WHERE name = ? COLLATE NOCASE LIMIT 1');
const skinCache = new Map<string, { expires: number; result: ReturnType<typeof downloadMinecraftSkin> }>();

async function servePlayerSkin(name: string, response: ServerResponse, online: boolean) {
  const key = name.toLowerCase();
  const now = Date.now();
  let entry = skinCache.get(key);
  if (!entry || now >= entry.expires) {
    if (skinCache.size >= 256) skinCache.delete(skinCache.keys().next().value!);
    const pending = { expires: now + 60 * 60_000, result: downloadMinecraftSkin(key) };
    void pending.result.catch(() => { pending.expires = Date.now() + 60_000; });
    skinCache.set(key, pending);
    entry = pending;
  }
  try {
    const { bytes, model } = await entry.result;
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': online ? 'private, no-store' : 'public, max-age=3600',
      'X-Minecraft-Skin-Model': model,
    }).end(bytes);
  } catch {
    response.writeHead(502).end(JSON.stringify({ error: 'skin_unavailable' }));
  }
}

async function syncFeed({ url, token, server }: (typeof feeds)[number]) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`WebCraft returned HTTP ${response.status}.`);
  }
  const players = parsePlayers(await response.json());

  database.exec('BEGIN');
  try {
    for (const { uuid, name, lastSeenAt } of players) {
      savePlayer.run(uuid, name, lastSeenAt);
      saveServerPlayer.run(server, uuid, name, lastSeenAt);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function syncPlayers() {
  const histories = feeds.map(async feed => {
    try {
      await syncFeed(feed);
    } catch (error) {
      const message = error instanceof Error && /^((Invalid WebCraft)|(WebCraft returned))/.test(error.message)
        ? error.message
        : 'Could not load or store the player feed.';
      console.warn(`WebCraft player sync at ${feed.url.origin}: ${message}`);
    }
  });
  await Promise.all([...histories, roster.sync()]);
  setTimeout(() => void syncPlayers(), pollIntervalMs).unref();
}

function pollItemImports(server: string, inbox: string) {
  let importing = false;
  const checkInbox = () => {
    if (importing) return;
    importing = true;
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../scripts/import-items.mjs'), '--inbox-sqlite'], {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, CAPYCRAFT_ITEM_SERVER: server, CAPYCRAFT_ITEM_IMPORT_DIR: inbox },
    });
    child.once('error', error => console.warn(`Item import could not start: ${error.message}`));
    child.once('close', () => { importing = false; });
  };
  checkInbox();
  setInterval(checkInbox, importPollIntervalMs).unref();
}

const catalogDirectory = resolve(process.env.CAPYCRAFT_ITEM_CATALOG_DIR || 'public/item-catalog');
const catalogs = itemCatalogDirectories(instances, catalogDirectory);
const serveItemPage = createItemPages(catalogs.keys(), (server, path) => readCatalogResource(catalogs.get(server)!, path),
  () => readFile(new URL('../dist/index.html', import.meta.url), 'utf8'));
const searchItems = createServerItemSearch(catalogs);
const recipeUses = createServerItemRecipeUses(catalogs);
const hasLegacyPlayerFeed = feeds.some(feed => feed.server === defaultAlias);
const directory = createServerDirectory(database, instances, () =>
  hasLegacyPlayerFeed || existsSync(resolve(catalogDirectory, 'catalog.json')), catalogs,
);
const onlinePlayers = createOnlinePlayers(instances);

const api = createServer(async (request, response) => {
  const path = request.url?.split('?', 1)[0];
  if (serveItemPage(request, response, path)) return;
  if (path === serverDirectoryPath) return void directory.serve(request, response);
  if (path === achievementsPath) return void serveAchievements(request, response);
  if (path === questsPath) return void serveQuests(request, response);
  if (path === ponderPath) return void servePonder(request, response);
  if (path?.startsWith(catalogPrefix)) {
    void serveCatalog(catalogs, path.slice(catalogPrefix.length), request, response);
    return;
  }
  if (path === itemSearchPath && request.url) {
    void searchItems(request, response, new URL(request.url, 'http://localhost'));
    return;
  }
  if (path === itemRecipeUsesPath && request.url) {
    void recipeUses(request, response, new URL(request.url, 'http://localhost'));
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (path !== '/api/players' || !request.url) {
    response.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const server = params.get('server');
  if (server !== null && !instances.has(server)) {
    response.writeHead(404).end(JSON.stringify({ error: 'server_not_found' }));
    return;
  }
  try {
    const online = params.get('online') === '1';
    if (online && server === null) {
      response.writeHead(400).end(JSON.stringify({ error: 'server_required' }));
      return;
    }
    const skin = params.get('skin');
    if (skin !== null) {
      if (!playerNamePattern.test(skin) || !(online ? await onlinePlayers.lists(server!, skin) : findPlayerName.get(skin) || roster.knowsSkin(skin))) {
        response.writeHead(404).end(JSON.stringify({ error: 'player_not_found' }));
        return;
      }
      void servePlayerSkin(skin, response, online);
      return;
    }
    if (online) {
      response.end(JSON.stringify(await onlinePlayers.get(server!)));
      return;
    }
    if (params.get('roster') === '1') {
      response.end(JSON.stringify({ players: await roster.getNames(server ?? undefined) }));
      return;
    }
    const portrait = params.get('portrait') === '1';
    const rows = server === null
      ? (portrait ? recentNames : selectNames).all()
      : (portrait ? recentServerNames : selectServerNames).all(server);
    const players = rows.map(row => row.name);
    response.end(JSON.stringify({ players }));
  } catch {
    response.writeHead(500).end(JSON.stringify({ error: 'player_list_unavailable' }));
  }
});
const live = attachLiveUpdates(api, directory.snapshot, catalogs, onlinePlayers);
api.once('close', onlinePlayers.stop);
api.listen(8787, '127.0.0.1', () => {
  console.log('Capycraft player API listening on http://127.0.0.1:8787');
  api.once('close', directory.start(live.refreshDirectory));
  const inboxes = new Map<string, string>();
  const legacyServer = process.env.CAPYCRAFT_ITEM_SERVER?.trim() || defaultAlias;
  if (instances.has(legacyServer)) {
    inboxes.set(resolve(process.env.CAPYCRAFT_ITEM_IMPORT_DIR?.trim() || 'data/item-imports'), legacyServer);
  }
  for (const { alias, inbox } of instances.values()) {
    if (inbox) inboxes.set(inbox, alias);
  }
  for (const [inbox, alias] of inboxes) pollItemImports(alias, inbox);
  if (feeds.length > 0 || roster.configured) void syncPlayers();
});
