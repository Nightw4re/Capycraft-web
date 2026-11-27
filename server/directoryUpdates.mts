import { worldGameTimeTenthsOfDay, type DirectoryPatch } from '../src/directoryUpdates.mts';
import type { ServerSummary } from '../src/serverDirectoryTypes.ts';

function changedField(key: keyof ServerSummary, before: unknown, after: unknown) {
  if (before === after) return false;
  if (typeof before === 'number' && typeof after === 'number') {
    if (key === 'uptimeSeconds' || key === 'totalUptimeSeconds') {
      return Math.floor(before / 60) !== Math.floor(after / 60);
    }
    if (key === 'worldGameTimeTicks') return worldGameTimeTenthsOfDay(before) !== worldGameTimeTenthsOfDay(after);
  }
  return typeof before !== 'object' || typeof after !== 'object' || JSON.stringify(before) !== JSON.stringify(after);
}

export function directoryMessage(servers: ServerSummary[], previous?: ServerSummary[]): string | undefined {
  if (!previous) return JSON.stringify({ type: 'servers', servers });

  const patch: DirectoryPatch = { type: 'servers-patch', added: [], changed: [], removed: [] };
  const old = new Map(previous.map(server => [server.alias, server]));
  for (const server of servers) {
    const before = old.get(server.alias);
    if (!before) {
      patch.added.push(server);
      continue;
    }
    old.delete(server.alias);

    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(server)] as (keyof ServerSummary)[]);
    for (const key of keys) {
      if (key === 'alias' || key === 'lastSeenAt' || !changedField(key, before[key], server[key])) continue;
      if (server[key] === undefined) remove.push(key);
      else set[key] = server[key];
    }
    const lastSeenVisible = server.status === 'offline' || server.status === 'unavailable';
    if (server.lastSeenAt === undefined && before.lastSeenAt !== undefined) remove.push('lastSeenAt');
    if (server.lastSeenAt !== undefined && (Object.keys(set).length || remove.length || before.lastSeenAt === undefined
      || (lastSeenVisible && server.lastSeenAt !== before.lastSeenAt))) set.lastSeenAt = server.lastSeenAt;

    if (Object.keys(set).length || remove.length) patch.changed.push({ alias: server.alias, set, remove });
  }
  patch.removed = Array.from(old.keys());
  if (patch.added.length || patch.changed.length || patch.removed.length) return JSON.stringify(patch);
}
