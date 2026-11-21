import { readOnlinePlayers, type OnlinePlayersState } from '../src/onlinePlayers.mts';
import { webcraftToken, type Instance } from './instances.mts';
import { subscribeWebcraftFeeds, type FeedResult } from './webcraftSocket.mts';

const feedPath = '/api/v1/internal/players/online';
const pollInterval = 5_000;
const disabled = { status: 'disabled' } as const;
type Listener = (state: OnlinePlayersState) => void;

function project(result: FeedResult): OnlinePlayersState {
  if (result.httpStatus === 401 || result.httpStatus === 403) return { status: 'restricted' };
  if (!result.reachable) return { status: 'offline' };
  const players = readOnlinePlayers(result.data);
  if (!players) return { status: 'unavailable' };
  players.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
  return { status: 'ready', players };
}

function createRoster(webcraft: NonNullable<Instance['webcraft']>) {
  const token = webcraftToken(webcraft.tokenEnv);
  const listeners = new Set<Listener>();
  let current: OnlinePlayersState = { status: token ? 'loading' : 'restricted' };
  let serialized = JSON.stringify(current);
  let pollAfter = 0;
  let request: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  function publish(next: OnlinePlayersState) {
    if (stopped) return;
    const message = JSON.stringify(next);
    if (message === serialized) return;
    current = next;
    serialized = message;
    for (const listener of listeners) listener(current);
  }

  const useHttp = !!token && webcraft.onlinePlayersTransport === 'http';
  const stopSocket = token && webcraft.onlinePlayersTransport === 'websocket'
    ? subscribeWebcraftFeeds(webcraft.origin, '/api/v1/internal/ws', [{ id: 'online', path: feedPath }], token,
      updates => publish(project(updates.get('online')!)))
    : undefined;

  async function poll() {
    let response;
    try {
      response = await fetch(new URL(feedPath, webcraft.origin), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(pollInterval), redirect: 'error',
      });
    } catch {
      publish({ status: 'offline' });
      return;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      publish(project({ reachable: true, httpStatus: response.status }));
      return;
    }
    const data: unknown = await response.json().catch(() => undefined);
    publish(project({ reachable: true, data }));
  }

  async function get(): Promise<OnlinePlayersState> {
    if (!stopped && useHttp) {
      if (!request && Date.now() >= pollAfter) {
        pollAfter = Date.now() + pollInterval;
        request = poll().finally(() => { request = undefined; });
      }
      await request;
    }
    return current;
  }

  return {
    get,
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener(current);
      if (useHttp && listeners.size === 1) {
        void get();
        timer = setInterval(() => void get(), pollInterval).unref();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) clearInterval(timer);
      };
    },
    async lists(name: string) {
      const state = await get();
      return state.status === 'ready' && state.players.some(player => player.name.toLowerCase() === name.toLowerCase());
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      stopSocket?.();
      listeners.clear();
    },
  };
}

export function createOnlinePlayers(instances: ReadonlyMap<string, Instance>) {
  const feeds = new Map<string, ReturnType<typeof createRoster>>();
  for (const { alias, tabs, webcraft } of instances.values()) {
    if (tabs.includes('players') && webcraft?.onlinePlayersTransport) feeds.set(alias, createRoster(webcraft));
  }
  return {
    get: async (alias: string) => feeds.get(alias)?.get() ?? disabled,
    lists: async (alias: string, name: string) => feeds.get(alias)?.lists(name) ?? false,
    subscribe: (alias: string, listener: Listener) => feeds.get(alias)?.subscribe(listener),
    stop: () => { for (const feed of feeds.values()) feed.stop(); },
  };
}
