import type { ServerSummary } from './serverDirectoryTypes.ts';

export const liveUpdatesPath = '/api/live';

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

export type LiveUpdate = { type: 'servers'; servers: ServerSummary[] } | CatalogUpdate;
export type CatalogSubscription = { server: string | null };
