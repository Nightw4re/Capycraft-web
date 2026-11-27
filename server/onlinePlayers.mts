import { readOnlinePlayers, type OnlinePlayer, type OnlinePlayersState } from '../src/onlinePlayers.mts';
import { webcraftToken, type Instance } from './instances.mts';
import { subscribeWebcraftFeeds, type FeedResult } from './webcraftSocket.mts';
import type { createPlayerStats } from './playerStats.mts';

const feedPath = '/api/v1/internal/players/online';
const pollInterval = 5_000;
const disabled = { status: 'disabled' } as const;
type Listener = (state: OnlinePlayersState) => void;

function project(result: FeedResult, collect: (data: unknown, players: OnlinePlayer[]) => void): OnlinePlayersState {
  if (result.httpStatus === 401 || result.httpStatus === 403) return { status: 'restricted' };
  if (!result.reachable) return { status: 'offline' };
  const players = readOnlinePlayers(result.data);
  if (!players) return { status: 'unavailable' };
  collect(result.data, players);
  players.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
  return { status: 'ready', players };
}

function createRoster(alias: string, webcraft: NonNullable<Instance['webcraft']>, stats?: ReturnType<typeof createPlayerStats>) {
  const token = webcraftToken(webcraft.tokenEnv);
  const listeners = new Set<Listener>();
  let source: OnlinePlayersState = !webcraft.onlinePlayersTransport ? disabled : { status: token ? 'loading' : 'restricted' };
  let current = withHistory(source);
  let serialized = JSON.stringify(current);
  let pollAfter = 0;
  let request: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  function publish(next: OnlinePlayersState) {
    if (stopped) return;
    source = next;
    const state = withHistory(next);
    const message = JSON.stringify(state);
    if (message === serialized) return;
    current = state;
    serialized = message;
    for (const listener of listeners) listener(current);
  }

  function publishResult(result: FeedResult) {
    if (stopped) return;
    const next = project(result, (data, players) => {
      try {
        stats?.collect(alias, data, players);
      } catch (error) {
        console.error(`Could not store player stats for ${alias}`, error);
      }
    });
    publish(next);
  }

  function withHistory(state: OnlinePlayersState): OnlinePlayersState {
    if (!stats || state.status === 'restricted') return state;
    const online = new Set(state.status === 'ready' ? state.players.map(player => player.name.toLowerCase()) : []);
    try {
      const saved = stats.list(alias);
      const previousPlayers = saved.filter(player => !online.has(player.name.toLowerCase()));
      if (state.status === 'ready') {
        const creative = new Set(saved.filter(player => player.seenCreative).map(player => player.name.toLowerCase()));
        state = { ...state, players: state.players.map(player => creative.has(player.name.toLowerCase())
          ? { ...player, seenCreative: true } : player) };
      }
      return previousPlayers.length ? { ...state, previousPlayers } : state;
    } catch (error) {
      console.error(`Could not load player stats for ${alias}`, error);
      return state;
    }
  }

  const useHttp = !!token && webcraft.onlinePlayersTransport === 'http';
  const stopSocket = token && webcraft.onlinePlayersTransport === 'websocket'
    ? subscribeWebcraftFeeds(webcraft.origin, '/api/v1/internal/ws', [{ id: 'online', path: feedPath }], token,
      updates => publishResult(updates.get('online')!))
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
      publishResult({ reachable: true, httpStatus: response.status });
      return;
    }
    const data: unknown = await response.json().catch(() => undefined);
    publishResult({ reachable: true, data });
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

  if (useHttp && stats) {
    void get();
    timer = setInterval(() => void get(), pollInterval).unref();
  }

  return {
    get,
    refreshHistory: () => publish(source),
    currentlyLists: (name: string) => current.status === 'ready'
      && current.players.some(player => player.name.toLowerCase() === name),
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener(current);
      if (useHttp && !stats && listeners.size === 1) {
        void get();
        timer = setInterval(() => void get(), pollInterval).unref();
      }
      return () => {
        listeners.delete(listener);
        if (!stats && !listeners.size) clearInterval(timer);
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

export function createOnlinePlayers(instances: ReadonlyMap<string, Instance>, stats?: ReturnType<typeof createPlayerStats>) {
  const feeds = new Map<string, ReturnType<typeof createRoster>>();
  for (const { alias, tabs, webcraft } of instances.values()) {
    if (tabs.includes('players') && webcraft && (webcraft.onlinePlayersTransport || stats && webcraft.playerRoster)) {
      feeds.set(alias, createRoster(alias, webcraft, stats));
    }
  }
  return {
    get: async (alias: string) => feeds.get(alias)?.get() ?? disabled,
    lists: async (alias: string, name: string) => feeds.get(alias)?.lists(name) ?? false,
    listsAnywhere: (name: string) => [...feeds.values()].some(feed => feed.currentlyLists(name.toLowerCase())),
    subscribe: (alias: string, listener: Listener) => feeds.get(alias)?.subscribe(listener),
    refreshHistory: () => { for (const feed of feeds.values()) feed.refreshHistory(); },
    stop: () => { for (const feed of feeds.values()) feed.stop(); },
  };
}
