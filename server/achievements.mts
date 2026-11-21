import type { IncomingMessage, ServerResponse } from 'node:http';
import { readAchievementCatalog } from '../src/achievements.mts';
import { webcraftToken, type Instance } from './instances.mts';
import { playerNamePattern } from './playerRoster.mts';

export function createAchievements(instances: ReadonlyMap<string, Instance>, getNames: (server: string) => Promise<string[]>) {
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
    const player = params.get('player');
    if (!server || (player !== null && !playerNamePattern.test(player))) return fail(400, 'invalid_request');
    const instance = instances.get(server);
    const webcraft = instance?.webcraft;
    if (!webcraft?.achievements || !instance?.tabs.includes('achievements')) return fail(404, 'achievements_disabled');
    const token = webcraftToken(webcraft.tokenEnv);
    if (!token) return fail(403, 'feed_restricted');

    try {
      const url = new URL('/api/v1/internal/advancements', webcraft.origin);
      let knownPlayer: string | undefined;
      if (player !== null) {
        knownPlayer = (await getNames(server)).find(name => name.toLowerCase() === player.toLowerCase());
        if (!knownPlayer) return fail(404, 'player_not_found');
        url.searchParams.set('player', knownPlayer);
      }
      const upstream = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(8_000),
      }).catch(() => undefined);
      if (!upstream) return fail(503, 'achievements_unavailable');
      if (!upstream.ok) {
        const error = upstream.status === 404 && knownPlayer ? await upstream.json().catch(() => undefined) : undefined;
        if (error?.error === 'player_not_found') return fail(404, 'player_not_found');
        if (!upstream.bodyUsed) await upstream.body?.cancel().catch(() => {});
        if (upstream.status === 401 || upstream.status === 403) return fail(403, 'feed_restricted');
        return fail(503, 'achievements_unavailable');
      }
      const data = readAchievementCatalog(await upstream.json(), knownPlayer);
      if (!data) return fail(502, 'invalid_achievements');
      return response.end(JSON.stringify(data));
    } catch {
      return fail(502, 'invalid_achievements');
    }
  };
}
