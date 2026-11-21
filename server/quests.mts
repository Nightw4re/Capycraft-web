import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecord } from '../src/objectPatch.mts';
import { readQuestCatalog, readQuestCompletion } from '../src/quests.mts';
import { webcraftToken, type Instance } from './instances.mts';
import { playerNamePattern, type createPlayerRoster } from './playerRoster.mts';

const upstreamPath = '/api/v1/internal/modules/webcraft_quests/quests/data';

export function createQuests(instances: ReadonlyMap<string, Instance>, resolvePlayer: ReturnType<typeof createPlayerRoster>['resolvePlayer']) {
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
      const player = name === null ? undefined : await resolvePlayer(server, name);
      if (name !== null && !player) return fail(404, 'player_not_found');
      if (player) url.searchParams.set('player', player.uuid);
      const upstream = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(8_000),
      }).catch(() => undefined);
      if (!upstream) return fail(503, 'quests_unavailable');
      if (!upstream.ok) {
        const error: unknown = upstream.status === 404 && player ? await upstream.json().catch(() => undefined) : undefined;
        if (isRecord(error) && error.error === 'player_not_found') return fail(404, 'player_not_found');
        if (isRecord(error) && error.error === 'team_progress_unavailable') return fail(404, 'team_progress_unavailable');
        if (!upstream.bodyUsed) await upstream.body?.cancel().catch(() => {});
        if (upstream.status === 401 || upstream.status === 403) return fail(403, 'feed_restricted');
        return fail(503, 'quests_unavailable');
      }
      const data: unknown = await upstream.json();
      const catalog = readQuestCatalog(data);
      if (!catalog) return fail(502, 'invalid_quests');
      if (!player) return response.end(JSON.stringify(catalog));
      const completion = readQuestCompletion(data, catalog);
      if (!completion) return fail(502, 'invalid_quests');
      return response.end(JSON.stringify({ ...catalog, ...completion, player: player.name }));
    } catch {
      return fail(502, 'invalid_quests');
    }
  };
}
