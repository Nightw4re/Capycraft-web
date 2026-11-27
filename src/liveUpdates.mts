import type { DirectoryPatch, DirectorySnapshot } from './directoryUpdates.mts';
import type { OnlinePlayersState } from './onlinePlayers.mts';

export const liveUpdatesPath = '/api/live';
export const serverDirectoryPath = '/api/servers';

export const catalogImportStages = [
  'preparing', 'reading', 'ponder-scenes', 'ponder-definitions', 'items', 'recipe-index', 'publishing',
] as const;
export type CatalogImportStage = typeof catalogImportStages[number];
export type CatalogImportDurations = Partial<Record<CatalogImportStage, number>>;

export function readCatalogImportDurations(value: unknown): CatalogImportDurations | undefined {
  if (!value || typeof value !== 'object') return;
  const durations = value as CatalogImportDurations;
  const entries = catalogImportStages.flatMap(stage => {
    const duration = durations[stage];
    return typeof duration === 'number' && duration > 0 && Number.isSafeInteger(duration) ? [[stage, duration] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export type ImportStatus = {
  state: 'running' | 'succeeded' | 'failed';
  revision: string;
  updatedAt: number;
  phase?: 'preparing' | 'processing' | 'publishing';
  stage?: CatalogImportStage | 'publishing-ponder';
  stagePlan?: CatalogImportStage[];
  stageElapsedMs?: number;
  lastStageDurations?: CatalogImportDurations;
  progress?: { loaded: number; expected: number };
  recipeIndexProgress?: { indexed: number; total: number };
};

export type CatalogUpdate = {
  type: 'catalog';
  server: string;
  version: string | null;
  status: ImportStatus | null;
};

export type PlayersUpdate = { type: 'players'; server: string; subscription: number; roster: OnlinePlayersState };
export type LiveUpdate = DirectorySnapshot | DirectoryPatch | CatalogUpdate | PlayersUpdate;
export type CatalogSubscription = { server: string | null };
export type PlayersSubscription = { players: string | null; subscription: number };
