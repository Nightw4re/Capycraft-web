import type { DatabaseSync } from 'node:sqlite';
import type { GameMode, OnlinePlayer, PlayerPlayTime } from '../src/onlinePlayers.mts';

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function createPlayerStats(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_stats (
      server TEXT NOT NULL,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      play_time_minutes INTEGER NOT NULL,
      last_seen_at INTEGER,
      PRIMARY KEY (server, uuid)
    )
  `);
  const columns = new Set(database.prepare('PRAGMA table_info(player_stats)').all().map(column => column.name));
  for (const [column, type] of [['last_seen_at', 'INTEGER'], ['game_mode', 'TEXT'], ['operator', 'INTEGER'], ['seen_creative', 'INTEGER']]) {
    if (!columns.has(column)) database.exec(`ALTER TABLE player_stats ADD COLUMN ${column} ${type}`);
  }
  const save = database.prepare(`
    INSERT INTO player_stats (server, uuid, name, play_time_minutes, last_seen_at, game_mode, operator, seen_creative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (server, uuid) DO UPDATE SET
      name = excluded.name, play_time_minutes = excluded.play_time_minutes, last_seen_at = excluded.last_seen_at,
      game_mode = COALESCE(excluded.game_mode, game_mode), operator = COALESCE(excluded.operator, operator),
      seen_creative = COALESCE(seen_creative, excluded.seen_creative)
    WHERE name <> excluded.name OR play_time_minutes <> excluded.play_time_minutes
      OR last_seen_at IS NULL OR last_seen_at / 60000 <> excluded.last_seen_at / 60000
      OR (excluded.game_mode IS NOT NULL AND game_mode IS NOT excluded.game_mode)
      OR (excluded.operator IS NOT NULL AND operator IS NOT excluded.operator)
      OR (excluded.seen_creative = 1 AND seen_creative IS NULL)
  `);
  const list = database.prepare(`
    SELECT name, play_time_minutes AS playTimeMinutes, last_seen_at AS lastSeenAt,
      game_mode AS gameMode, operator, seen_creative AS seenCreative FROM (
      SELECT name, play_time_minutes, last_seen_at, game_mode, operator, seen_creative,
        ROW_NUMBER() OVER (PARTITION BY name COLLATE NOCASE ORDER BY last_seen_at DESC, uuid) AS priority
      FROM player_stats WHERE server = ?
    ) WHERE priority = 1 ORDER BY name COLLATE NOCASE
  `);
  const saveOffline = database.prepare(`
    INSERT INTO player_stats (server, uuid, name, play_time_minutes) VALUES (?, ?, ?, ?)
    ON CONFLICT (server, uuid) DO UPDATE SET
      name = CASE WHEN last_seen_at IS NULL THEN excluded.name ELSE name END,
      play_time_minutes = MAX(play_time_minutes, excluded.play_time_minutes)
    WHERE play_time_minutes < excluded.play_time_minutes OR (last_seen_at IS NULL AND name <> excluded.name)
  `);
  const findName = database.prepare('SELECT 1 FROM player_stats WHERE name = ? COLLATE NOCASE LIMIT 1');

  return {
    knowsName: (name: string) => !!findName.get(name),
    importSaved(server: string, uuid: string, name: string, playTimeMinutes: number) {
      saveOffline.run(server, uuid, name, playTimeMinutes);
    },
    collect(server: string, data: unknown, players: OnlinePlayer[]) {
      if (!data || typeof data !== 'object' || !('players' in data) || !Array.isArray(data.players)) return;
      const now = Date.now();
      for (const [index, player] of players.entries()) {
        const uuid: unknown = data.players[index]?.uuid;
        if (player.playTimeMinutes !== undefined && typeof uuid === 'string' && uuidPattern.test(uuid)) {
          save.run(server, uuid.toLowerCase(), player.name, player.playTimeMinutes, now, player.gameMode ?? null,
            player.operator === undefined ? null : Number(player.operator), player.gameMode === 'creative' ? 1 : null);
        }
      }
    },
    list(server: string): PlayerPlayTime[] {
      return (list.all(server) as { name: string; playTimeMinutes: number; lastSeenAt: number | null;
        gameMode: GameMode | null; operator: number | null; seenCreative: number | null }[])
        .map(({ name, playTimeMinutes, lastSeenAt, gameMode, operator, seenCreative }) => ({
          name, playTimeMinutes, ...(lastSeenAt !== null && { lastSeenAt }), ...(gameMode && { gameMode }),
          ...(operator !== null && { operator: operator === 1 }), ...(seenCreative === 1 && { seenCreative: true }),
        }));
    },
  };
}
