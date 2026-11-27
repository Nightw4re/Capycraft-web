import type { ServerPage } from './minecraftServers.mjs';

export type ServerStatus = 'waiting' | 'starting' | 'ready' | 'stopping' | 'offline' | 'unavailable';
export type ServerPerformance = { tps?: number; mspt?: number; msptP95?: number };

export type ServerInformation = {
  name?: string;
  address?: string;
  logo?: string;
  motd?: string;
  playersOnline?: number;
  maxPlayers?: number;
  uptimeSeconds?: number;
  totalUptimeSeconds?: number;
  worldAgeDays?: number;
  worldAgeMinutes?: number;
  worldGameTimeTicks?: number;
  performance?: ServerPerformance;
  modpack?: { name?: string; version?: string };
};

export type ServerSummary = ServerInformation & {
  alias: string;
  tabs: readonly ServerPage[];
  status: ServerStatus;
  access?: 'pending' | 'catalog' | 'players' | 'achievements' | 'quests' | 'ponder';
  lastSeenAt?: number;
  lastKnownPlayersOnline?: number;
};
