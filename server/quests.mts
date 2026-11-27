import { compactProgress, type createProgressCache } from './progressCache.mts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecord } from '../src/objectPatch.mts';
import { readQuestCatalog, readQuestCompletion, type QuestCatalog } from '../src/quests.mts';
import { webcraftToken, type Instance } from './instances.mts';
import { playerNamePattern, type createPlayerRoster } from './playerRoster.mts';

const upstreamPath = '/api/v1/internal/modules/webcraft_quests/quests/data';
const catalogKey = 'quests-catalog-v7';
const compatibleCatalogTtl = 60_000;
const previousCatalogKeys = ['quests-catalog-v6', 'quests-catalog-v6-compat',
  'quests-catalog-v5', 'quests-catalog-v5-compat', 'quests-catalog-v4', 'quests-catalog-v4-compat',
  'quests-catalog-v3', 'quests-catalog-v2', 'quests'];

type QuestResult<T> = { data: T } | { status: number; error: string };
type QuestProgress = NonNullable<ReturnType<typeof compactProgress>>;

async function fetchQuestData(url: URL, token: string, player?: string): Promise<QuestResult<unknown>> {
  if (player) {
    url.searchParams.set('player', player);
    url.searchParams.set('view', 'progress');
  }
  const fetchUpstream = () => fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
  let upstream = await fetchUpstream();
  if (player && upstream?.status === 400) {
    await upstream.body?.cancel().catch(() => undefined);
    url.searchParams.delete('view');
    upstream = await fetchUpstream();
  }
  if (!upstream) return { status: 503, error: 'quests_unavailable' };
  if (!upstream.ok) {
    const error: unknown = upstream.status === 404 && player ? await upstream.json().catch(() => undefined) : undefined;
    if (isRecord(error) && (error.error === 'player_not_found' || error.error === 'team_progress_unavailable')) {
      return { status: 404, error: error.error };
    }
    if (!upstream.bodyUsed) await upstream.body?.cancel().catch(() => undefined);
    if (upstream.status === 401 || upstream.status === 403) return { status: 403, error: 'feed_restricted' };
    return { status: 503, error: 'quests_unavailable' };
  }
  return { data: await upstream.json() };
}

export function createQuests(instances: ReadonlyMap<string, Instance>, resolvePlayer: ReturnType<typeof createPlayerRoster>['resolvePlayer'],
  cache?: ReturnType<typeof createProgressCache>) {
  const pendingCatalogs = new Map<string, { revision: string | undefined; result: Promise<QuestResult<string>> }>();

  async function loadCatalog(server: string, url: URL, token: string): Promise<QuestResult<string>> {
    const saved = await cache?.(server, catalogKey, null, Infinity);
    if (saved?.fresh) return { data: saved.fresh };
    const pending = pendingCatalogs.get(server);
    if (pending) {
      if (pending.revision === saved?.revision) return pending.result;
      // Serialize refreshes so a response from before an import cannot overwrite the new catalog.
      await pending.result.catch(() => undefined);
      return loadCatalog(server, url, token);
    }

    const result = (async () => {
      const compatible = await cache?.(server, `${catalogKey}-compat`, null, compatibleCatalogTtl);
      if (compatible?.fresh) return { data: compatible.fresh };
      const incoming = await fetchQuestData(url, token);
      if ('error' in incoming) {
        if (incoming.status === 503) {
          if (compatible?.stale) return { data: compatible.stale };
          for (const key of previousCatalogKeys) {
            const previous = await cache?.(server, key, null);
            if (!previous?.stale) continue;
            const catalog = readQuestCatalog(JSON.parse(previous.stale));
            if (catalog) return { data: JSON.stringify(catalog) };
          }
        }
        return incoming;
      }
      const catalog = readQuestCatalog(incoming.data);
      if (!catalog) return { status: 502, error: 'invalid_quests' };
      const storage = catalog.itemDetailVersion === 5 ? saved : compatible;
      return { data: storage?.save(catalog) ?? JSON.stringify(catalog) };
    })();
    pendingCatalogs.set(server, { revision: saved?.revision, result });
    try {
      return await result;
    } finally {
      pendingCatalogs.delete(server);
    }
  }

  async function loadProgress(server: string, url: URL, token: string, uuid: string): Promise<QuestResult<QuestProgress>> {
    const saved = await cache?.(server, 'quests', uuid, 15_000);
    if (saved?.fresh) return { data: JSON.parse(saved.fresh) };
    const incoming = await fetchQuestData(url, token, uuid);
    if ('error' in incoming) {
      return incoming.status === 503 && saved?.stale ? { data: JSON.parse(saved.stale) } : incoming;
    }
    const progress = compactProgress(incoming.data, id => /^[a-f0-9]{1,16}$/i.test(id));
    if (!progress) return { status: 502, error: 'invalid_quests' };
    saved?.save(progress);
    return { data: progress };
  }

  return async function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, error: string) => response.writeHead(status).end(JSON.stringify({ error }));
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return fail(405, 'method_not_allowed');
    }
    const params = new URL(request.url ?? '', 'http://localhost').searchParams;
    const server = params.get('server');
    const name = params.get('player');
    if (!server || (name !== null && !playerNamePattern.test(name))) return fail(400, 'invalid_request');
    const instance = instances.get(server);
    const webcraft = instance?.webcraft;
    if (!webcraft?.quests || !instance?.tabs.includes('quests')) return fail(404, 'quests_disabled');
    const token = webcraftToken(webcraft.tokenEnv);
    if (!token) return fail(403, 'feed_restricted');

    try {
      const url = new URL(upstreamPath, webcraft.origin);
      if (name === null) {
        const catalog = await loadCatalog(server, url, token);
        return 'error' in catalog ? fail(catalog.status, catalog.error) : response.end(catalog.data);
      }
      const player = await resolvePlayer(server, name);
      if (!player) return fail(404, 'player_not_found');
      const progress = await loadProgress(server, new URL(url), token, player.uuid);
      if ('error' in progress) return fail(progress.status, progress.error);
      if (params.get('view') === 'progress') return response.end(JSON.stringify({ ...progress.data, player: player.name }));
      const cached = await loadCatalog(server, url, token);
      if ('error' in cached) return fail(cached.status, cached.error);
      const catalog: QuestCatalog = JSON.parse(cached.data);
      const completion = readQuestCompletion(progress.data, catalog);
      if (!completion) return fail(502, 'invalid_quests');
      return response.end(JSON.stringify({ ...catalog, ...completion, player: player.name }));
    } catch {
      return fail(502, 'invalid_quests');
    }
  };
}
