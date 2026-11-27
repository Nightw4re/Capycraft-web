import { isServerAlias, isServerPage } from './minecraftServers.mjs';
import { applyObjectPatch, isRecord, type ObjectPatch } from './objectPatch.mts';
import type { ServerPerformance, ServerSummary } from './serverDirectoryTypes';

export const directorySubscription = { directory: 'subscribe' } as const;
export type DirectorySnapshot = { type: 'servers'; servers: ServerSummary[] };
export type DirectoryPatch = {
  type: 'servers-patch';
  added: ServerSummary[];
  changed: (ObjectPatch & { alias: string })[];
  removed: string[];
};

const numbers = new Set(['playersOnline', 'maxPlayers', 'uptimeSeconds', 'totalUptimeSeconds',
  'worldAgeDays', 'worldAgeMinutes', 'worldGameTimeTicks', 'lastSeenAt', 'lastKnownPlayersOnline']);

export function worldGameTimeTenthsOfDay(ticks: number) {
  return Math.floor(ticks / 2_400);
}
const strings = new Set(['name', 'address', 'logo', 'motd']);
const statuses = new Set(['waiting', 'starting', 'ready', 'stopping', 'offline', 'unavailable']);
const access = new Set(['pending', 'catalog', 'players', 'achievements', 'quests', 'ponder']);
const performanceFields = ['tps', 'mspt', 'msptP95'] as const;

export function readServerPerformance(value: unknown): ServerPerformance | undefined {
  if (!isRecord(value)) return;
  const result: ServerPerformance = {};
  for (const field of performanceFields) {
    const measurement = value[field];
    if (typeof measurement === 'number' && Number.isFinite(measurement) && measurement >= 0) {
      result[field] = measurement;
    }
  }
  if (Object.keys(result).length) return result;
}

function isSummary(value: unknown): value is ServerSummary {
  if (!isRecord(value) || !isServerAlias(value.alias) || typeof value.status !== 'string' || !statuses.has(value.status)
    || !Array.isArray(value.tabs) || !value.tabs.every(isServerPage)
    || new Set(value.tabs).size !== value.tabs.length) return false;
  return Object.entries(value).every(([key, field]) => {
    if (key === 'alias' || key === 'status' || key === 'tabs') return true;
    if (strings.has(key)) return typeof field === 'string';
    if (numbers.has(key)) return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0;
    if (key === 'access') return typeof field === 'string' && access.has(field);
    if (key === 'performance') {
      const performance = readServerPerformance(field);
      return isRecord(field) && performance !== undefined && Object.keys(performance).length === Object.keys(field).length;
    }
    return key === 'modpack' && isRecord(field)
      && Object.entries(field).every(([part, text]) => (part === 'name' || part === 'version') && typeof text === 'string');
  });
}

export function isServerList(value: unknown): value is ServerSummary[] {
  return Array.isArray(value) && value.every(isSummary) && new Set(value.map(entry => entry.alias)).size === value.length;
}

export function applyDirectoryPatch(servers: readonly ServerSummary[], patch: unknown): ServerSummary[] | undefined {
  if (!isRecord(patch) || !isServerList(patch.added) || !Array.isArray(patch.changed) || !Array.isArray(patch.removed)) return;
  if (!patch.added.length && !patch.changed.length && !patch.removed.length) return;
  const updated = new Map(servers.map(server => [server.alias, server]));
  const touched = new Set<string>();
  for (const alias of patch.removed as unknown[]) {
    if (!isServerAlias(alias) || !updated.delete(alias)) return;
    touched.add(alias);
  }
  for (const change of patch.changed as unknown[]) {
    if (!isRecord(change) || !isServerAlias(change.alias) || touched.has(change.alias)) return;
    const server = updated.get(change.alias);
    if (!server) return;
    const result = applyObjectPatch(server, change);
    if (!isSummary(result) || result.alias !== change.alias) return;
    updated.set(change.alias, result);
    touched.add(change.alias);
  }
  for (const server of patch.added) {
    if (touched.has(server.alias) || updated.has(server.alias)) return;
    updated.set(server.alias, server);
  }
  return Array.from(updated.values());
}
