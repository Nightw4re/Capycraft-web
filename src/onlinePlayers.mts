export type OnlinePlayer = { name: string; pingMillis: number };

export type OnlinePlayersState =
  | { status: 'ready'; players: OnlinePlayer[] }
  | { status: 'loading' | 'offline' | 'unavailable' | 'restricted' | 'disabled' };

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
    players.push({ name: player.name, pingMillis: player.pingMillis });
  }
  return players;
}

export function readOnlinePlayersState(data: unknown): OnlinePlayersState | undefined {
  if (!data || typeof data !== 'object' || !('status' in data)) return;
  const { status } = data;
  if (status === 'ready') {
    const players = readOnlinePlayers(data);
    if (players) return { status, players };
  } else if (status === 'loading' || status === 'offline' || status === 'unavailable'
    || status === 'restricted' || status === 'disabled') {
    return { status };
  }
}
