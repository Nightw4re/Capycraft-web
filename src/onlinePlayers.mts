const gameModes = ['survival', 'creative', 'adventure', 'spectator'] as const;
export type GameMode = typeof gameModes[number];
type PlayerGameState = { gameMode?: GameMode; operator?: boolean; seenCreative?: boolean };
export type PlayerPlayTime = { name: string; playTimeMinutes: number; lastSeenAt?: number } & PlayerGameState;
export type OnlinePlayer = { name: string; pingMillis: number; maxHealth?: number; playTimeMinutes?: number } & PlayerGameState;

function readGameState(data: object): PlayerGameState {
  const state: PlayerGameState = {};
  if ('gameMode' in data && gameModes.includes(data.gameMode as GameMode)) state.gameMode = data.gameMode as GameMode;
  if ('operator' in data && typeof data.operator === 'boolean') state.operator = data.operator;
  if ('seenCreative' in data && data.seenCreative === true) state.seenCreative = true;
  return state;
}

export function offlinePlayers(online: readonly OnlinePlayer[], knownNames: readonly string[],
  saved: readonly PlayerPlayTime[], language: string): (Partial<PlayerPlayTime> & { name: string })[] {
  const offline = new Map<string, Partial<PlayerPlayTime> & { name: string }>();
  for (const name of knownNames) offline.set(name.toLowerCase(), { name });
  for (const player of saved) offline.set(player.name.toLowerCase(), player);
  for (const { name } of online) offline.delete(name.toLowerCase());
  return [...offline.values()].sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
}

export type OnlinePlayersState = (
  | { status: 'ready'; players: OnlinePlayer[] }
  | { status: 'loading' | 'offline' | 'unavailable' | 'restricted' | 'disabled' }
) & { previousPlayers?: PlayerPlayTime[] };

export function validPlayTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function readOnlinePlayers(data: unknown): OnlinePlayer[] | undefined {
  if (!data || typeof data !== 'object' || !('players' in data) || !Array.isArray(data.players)) return;
  const players: OnlinePlayer[] = [];
  const names = new Set<string>();
  for (const player of data.players as unknown[]) {
    if (!player || typeof player !== 'object' || !('name' in player) || !('pingMillis' in player)
      || typeof player.name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(player.name)
      || typeof player.pingMillis !== 'number' || !Number.isSafeInteger(player.pingMillis) || player.pingMillis < 0) return;
    const normalized = player.name.toLowerCase();
    if (names.has(normalized)) return;
    names.add(normalized);
    const entry: OnlinePlayer = { name: player.name, pingMillis: player.pingMillis, ...readGameState(player) };
    if ('maxHealth' in player && typeof player.maxHealth === 'number'
      && Number.isFinite(player.maxHealth) && player.maxHealth > 0) entry.maxHealth = player.maxHealth;
    if ('playTimeMinutes' in player && validPlayTime(player.playTimeMinutes)) entry.playTimeMinutes = player.playTimeMinutes;
    players.push(entry);
  }
  return players;
}

export function readOnlinePlayersState(data: unknown): OnlinePlayersState | undefined {
  if (!data || typeof data !== 'object' || !('status' in data)) return;
  const { status } = data;
  const previousPlayers: PlayerPlayTime[] = [];
  if ('previousPlayers' in data && Array.isArray(data.previousPlayers)) {
    for (const row of data.previousPlayers as unknown[]) {
      if (row && typeof row === 'object' && 'name' in row && typeof row.name === 'string'
        && /^[A-Za-z0-9_]{1,16}$/.test(row.name) && 'playTimeMinutes' in row && validPlayTime(row.playTimeMinutes)) {
        const player: PlayerPlayTime = { name: row.name, playTimeMinutes: row.playTimeMinutes, ...readGameState(row) };
        if ('lastSeenAt' in row && typeof row.lastSeenAt === 'number'
          && Number.isSafeInteger(row.lastSeenAt) && row.lastSeenAt > 0 && row.lastSeenAt <= 8.64e15) {
          player.lastSeenAt = row.lastSeenAt;
        }
        previousPlayers.push(player);
      }
    }
  }
  const history = previousPlayers.length ? { previousPlayers } : {};
  if (status === 'ready') {
    const players = readOnlinePlayers(data);
    if (players) return { status, players, ...history };
  } else if (status === 'loading' || status === 'offline' || status === 'unavailable'
    || status === 'restricted' || status === 'disabled') {
    return { status, ...history };
  }
}
