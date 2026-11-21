import type { DatabaseSync } from 'node:sqlite';
import { webcraftToken, type Instance } from './instances.mts';

export const playerNamePattern = /^[A-Za-z0-9_]{1,16}$/;
export const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const rosterPath = '/api/v1/internal/players/all';

function readRoster(data: unknown) {
  if (!data || typeof data !== 'object' || !('players' in data) || !Array.isArray(data.players)) {
    throw new Error('Invalid WebCraft roster.');
  }
  const seen = new Set<string>();
  const players: { uuid: string; name: string }[] = [];
  for (const player of data.players as unknown[]) {
    if (!player || typeof player !== 'object' || !('uuid' in player) || !('name' in player)
      || typeof player.uuid !== 'string' || !uuidPattern.test(player.uuid)
      || (player.name !== null && (typeof player.name !== 'string' || !playerNamePattern.test(player.name)))) {
      throw new Error('Invalid WebCraft roster entry.');
    }
    const uuid = player.uuid.toLowerCase();
    if (seen.has(uuid)) throw new Error('Duplicate UUID in WebCraft roster.');
    seen.add(uuid);
    if (player.name !== null) players.push({ uuid, name: player.name });
  }
  return players;
}

export function createPlayerRoster(database: DatabaseSync, instances: ReadonlyMap<string, Instance>) {
  const feeds = Array.from(instances.values()).filter(instance => instance.webcraft?.playerRoster);
  const published = JSON.stringify(feeds.map(instance => instance.alias));
  database.exec(`CREATE TABLE IF NOT EXISTS webcraft_roster (
    server TEXT NOT NULL, uuid TEXT NOT NULL, name TEXT NOT NULL, observed_at INTEGER NOT NULL,
    PRIMARY KEY (server, uuid)
  ) STRICT`);
  const save = database.prepare(`
    INSERT INTO webcraft_roster (server, uuid, name, observed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (server, uuid) DO UPDATE SET name = excluded.name, observed_at = excluded.observed_at
    WHERE webcraft_roster.name <> excluded.name
  `);
  const currentNames = (sources: string) => `
    WITH candidates AS (${sources}), current_names AS (
      SELECT uuid, name, row_number() OVER (PARTITION BY uuid ORDER BY dated DESC, seen DESC, name DESC, source) AS priority
      FROM candidates
    )
  `;
  const distinctNames = `
    SELECT min(name) AS name FROM current_names WHERE priority = 1 GROUP BY name COLLATE NOCASE
    ORDER BY name COLLATE NOCASE, name
  `;
  const all = database.prepare(currentNames(`
    SELECT uuid, name, last_seen_at AS seen, 1 AS dated, '' AS source FROM players
    UNION ALL
    SELECT uuid, name, observed_at, 0, server FROM webcraft_roster WHERE server IN (SELECT value FROM json_each(?))
  `) + distinctNames);
  const scopedNames = currentNames(`
    SELECT uuid, name, last_seen_at AS seen, 1 AS dated, '' AS source FROM server_players WHERE server = ?
    UNION ALL
    SELECT uuid, name, observed_at, 0, server FROM webcraft_roster WHERE server = ? AND server IN (SELECT value FROM json_each(?))
  `);
  const scoped = database.prepare(scopedNames + distinctNames);
  const match = database.prepare(scopedNames + `
    SELECT uuid, name FROM current_names WHERE priority = 1 AND name = ? COLLATE NOCASE LIMIT 2
  `);
  const knowsSkin = database.prepare(`
    SELECT 1 FROM webcraft_roster WHERE name = ? COLLATE NOCASE AND server IN (SELECT value FROM json_each(?)) LIMIT 1
  `);
  let pending: Promise<void> | undefined;

  const names = (server?: string) => (server === undefined ? all.all(published) : scoped.all(server, server, published))
    .map(row => row.name as string);

  async function read(instance: Instance) {
    const { alias, webcraft } = instance;
    if (!webcraft) return;
    const token = webcraftToken(webcraft.tokenEnv);
    if (!token) return;
    const response = await fetch(new URL(rosterPath, webcraft.origin), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error('WebCraft roster unavailable.');
    }
    const players = readRoster(await response.json());
    const now = Date.now();
    database.exec('BEGIN');
    try {
      for (const { uuid, name } of players) save.run(alias, uuid, name, now);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function sync() {
    pending ??= Promise.all(feeds.map(async instance => {
      try {
        await read(instance);
      } catch {
        console.warn(`Could not refresh the WebCraft roster for ${instance.alias}.`);
      }
    })).then(() => {}).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    names,
    knowsSkin: (name: string) => !!knowsSkin.get(name, published),
    async getNames(server?: string) {
      const saved = names(server);
      if (saved.length || !pending) return saved;
      await pending;
      return names(server);
    },
    async resolvePlayer(server: string, name: string) {
      let matches = match.all(server, server, published, name);
      if (!matches.length && pending) {
        await pending;
        matches = match.all(server, server, published, name);
      }
      if (matches.length !== 1) return;
      const record = matches[0];
      if (typeof record.uuid !== 'string' || !uuidPattern.test(record.uuid) || typeof record.name !== 'string'
        || !playerNamePattern.test(record.name)) return;
      return { uuid: record.uuid.toLowerCase(), name: record.name };
    },
    configured: feeds.length > 0,
    sync,
  };
}
