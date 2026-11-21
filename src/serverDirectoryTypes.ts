import type { ServerPage } from './minecraftServers.mjs';

export type ServerStatus = 'waiting' | 'starting' | 'ready' | 'stopping' | 'offline' | 'unavailable';

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
  modpack?: { name?: string; version?: string };
};

export type ServerSummary = ServerInformation & {
  alias: string;
  tabs: readonly ServerPage[];
  status: ServerStatus;
  access?: 'pending' | 'catalog' | 'players';
  lastSeenAt?: number;
};
