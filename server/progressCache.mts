import type { DatabaseSync } from 'node:sqlite';

export function createProgressCache(database: DatabaseSync, revision: (server: string) => Promise<string>) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS progress_cache (
      key TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL, saved_at INTEGER NOT NULL
    ) STRICT
  `);
  const read = database.prepare('SELECT revision, payload, saved_at FROM progress_cache WHERE key = ?');
  const save = database.prepare(`
    INSERT INTO progress_cache VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, saved_at = excluded.saved_at
  `);
  return async function entry(server: string, feature: string, player: string | null,
    ttl = player ? 15_000 : 86_400_000) {
    const key = JSON.stringify([server, feature, player?.toLowerCase()]);
    const version = await revision(server);
    const row = read.get(key) as { revision: string; payload: string; saved_at: number } | undefined;
    const same = row?.revision === version ? row : undefined;
    return {
      revision: version,
      fresh: same && Date.now() - same.saved_at < ttl ? same.payload : undefined,
      stale: same?.payload,
      save(value: object) {
        const payload = JSON.stringify(value);
        save.run(key, version, payload, Date.now());
        return payload;
      },
    };
  };
}

export function compactProgress(value: unknown, validId: (id: string) => boolean) {
  if (!value || typeof value !== 'object' || !('total' in value) || !('completed' in value)
    || !('completedIds' in value) || typeof value.total !== 'number' || !Number.isSafeInteger(value.total)
    || value.total < 0 || value.total > 25_000 || !Array.isArray(value.completedIds)
    || value.completed !== value.completedIds.length || value.completed > value.total) return;
  const completedIds: string[] = [];
  const seen = new Set<string>();
  for (const id of value.completedIds) {
    if (typeof id !== 'string' || seen.has(id) || !validId(id)) return;
    seen.add(id);
    completedIds.push(id);
  }
  const completedAt: Record<string, number> = {};
  if ('completedAt' in value && value.completedAt && typeof value.completedAt === 'object') {
    for (const [id, time] of Object.entries(value.completedAt)) {
      if (seen.has(id) && typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time <= 8.64e15) completedAt[id] = time;
    }
  }
  return { total: value.total, completed: completedIds.length, completedIds,
    ...(Object.keys(completedAt).length && { completedAt }) };
}
