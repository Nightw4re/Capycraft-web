import type { DatabaseSync } from 'node:sqlite';
import { downloadMinecraftSkin } from './minecraftSkin.mts';

const refreshInterval = 60 * 60_000;
const retryInterval = 60_000;
const cacheSize = 1024;
type Skin = Awaited<ReturnType<typeof downloadMinecraftSkin>>;

export function createPlayerSkins(database: DatabaseSync, download = downloadMinecraftSkin) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_skins (
      name TEXT PRIMARY KEY, bytes BLOB NOT NULL, hash TEXT NOT NULL, model TEXT NOT NULL, saved_at INTEGER NOT NULL
    ) STRICT
  `);
  const read = database.prepare('SELECT bytes, hash, model, saved_at FROM player_skins WHERE name = ?');
  const save = database.prepare(`
    INSERT INTO player_skins VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET bytes = excluded.bytes, hash = excluded.hash,
      model = excluded.model, saved_at = excluded.saved_at
  `);
  const prune = database.prepare(`
    DELETE FROM player_skins WHERE name IN (
      SELECT name FROM player_skins ORDER BY saved_at DESC, name LIMIT -1 OFFSET ?
    )
  `);
  const pending = new Map<string, Promise<Skin>>();
  const retryAfter = new Map<string, number>();
  return async function getSkin(name: string): Promise<Skin> {
    const key = name.toLowerCase();
    const now = Date.now();
    const saved = read.get(key) as (Skin & { saved_at: number }) | undefined;
    if (saved && now - saved.saved_at < refreshInterval) return saved;
    let request = pending.get(key);
    if (!request && (retryAfter.get(key) ?? 0) <= now) {
      request = download(key).then(skin => {
        save.run(key, skin.bytes, skin.hash, skin.model, Date.now());
        prune.run(cacheSize);
        retryAfter.delete(key);
        return skin;
      }).catch(error => {
        if (retryAfter.size >= cacheSize) retryAfter.delete(retryAfter.keys().next().value!);
        retryAfter.set(key, Date.now() + retryInterval);
        throw error;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    if (saved) {
      void request?.catch(() => {});
      return saved;
    }
    if (request) return request;
    throw new Error('Skin lookup is temporarily unavailable.');
  };
}
