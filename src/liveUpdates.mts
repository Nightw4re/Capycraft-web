import type { ServerSummary } from './serverDirectoryTypes.ts';
import type { OnlinePlayersState } from './onlinePlayers.mts';

export const liveUpdatesPath = '/api/live';
export const serverDirectoryPath = '/api/servers';

export type ImportStatus = {
  state: 'running' | 'succeeded' | 'failed';
  revision: string;
  updatedAt: number;
  phase?: 'preparing' | 'processing' | 'publishing';
  progress?: { loaded: number; expected: number };
};

export type CatalogUpdate = {
  type: 'catalog';
  server: string;
  version: string | null;
  status: ImportStatus | null;
};

export type PlayersUpdate = { type: 'players'; server: string; subscription: number; roster: OnlinePlayersState };
export type LiveUpdate = { type: 'servers'; servers: ServerSummary[] } | CatalogUpdate | PlayersUpdate;
export type CatalogSubscription = { server: string | null };
export type PlayersSubscription = { players: string | null; subscription: number };
