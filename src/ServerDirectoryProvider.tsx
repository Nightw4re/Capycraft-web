import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { liveUpdatesPath, serverDirectoryPath, type CatalogSubscription, type CatalogUpdate, type LiveUpdate, type PlayersSubscription } from './liveUpdates.mts';
import { isServerAlias } from './minecraftServers.mjs';
import { readOnlinePlayersState, type OnlinePlayersState } from './onlinePlayers.mts';
import type { ServerSummary } from './serverDirectoryTypes';

type Directory = { servers?: readonly ServerSummary[]; unavailable: boolean };
const context = createContext<Directory>({ unavailable: false });
const catalogContext = createContext<CatalogUpdate | undefined>(undefined);
const subscriptionContext = createContext<(server: string) => (() => void)>(() => () => {});
type SubscribePlayers = (server: string, update: (state: OnlinePlayersState) => void, disconnect: () => void) => () => void;
const playersContext = createContext<SubscribePlayers>(() => () => {});
const emptyServers: readonly ServerSummary[] = [];

function isServerList(servers: unknown): servers is ServerSummary[] {
  return Array.isArray(servers) && servers.every(server => isServerAlias(server?.alias) && Array.isArray(server.tabs));
}

function markDirectoryUnavailable(servers: readonly ServerSummary[] | undefined): Directory {
  return {
    unavailable: true,
    servers: servers?.map(server => ({
      ...server,
      status: server.status === 'ready' || server.status === 'starting' || server.status === 'stopping'
        ? 'unavailable' : server.status,
      playersOnline: undefined,
      uptimeSeconds: undefined,
    })),
  };
}

export function ServerDirectoryProvider({ children }: { children: ReactNode }) {
  const [directory, setDirectory] = useState<Directory>({ unavailable: false });
  const [catalog, setCatalog] = useState<CatalogUpdate>();
  const connection = useRef<WebSocket>(undefined);
  const selection = useRef<CatalogSubscription>({ server: null });
  const playersSelection = useRef<{ request: PlayersSubscription; update: Parameters<SubscribePlayers>[1]; disconnect: () => void }>(undefined);
  const nextSubscription = useRef(0);

  const sendSubscription = useCallback(() => {
    if (connection.current?.readyState === WebSocket.OPEN) {
      connection.current.send(JSON.stringify(selection.current));
    }
  }, []);

  const sendPlayersSubscription = useCallback((request: PlayersSubscription) => {
    if (connection.current?.readyState === WebSocket.OPEN) connection.current.send(JSON.stringify(request));
  }, []);

  const subscribePlayers = useCallback<SubscribePlayers>((server, update, disconnect) => {
    const request = { players: server, subscription: ++nextSubscription.current };
    playersSelection.current = { request, update, disconnect };
    sendPlayersSubscription(request);
    return () => {
      if (playersSelection.current?.request !== request) return;
      playersSelection.current = undefined;
      sendPlayersSubscription({ ...request, players: null });
    };
  }, [sendPlayersSubscription]);

  const subscribe = useCallback((server: string) => {
    const subscription = { server };
    selection.current = subscription;
    sendSubscription();
    return () => {
      if (selection.current !== subscription) return;
      selection.current = { server: null };
      setCatalog(undefined);
      sendSubscription();
    };
  }, [sendSubscription]);

  useEffect(() => {
    const url = new URL(liveUpdatesPath, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let retry: number | undefined;
    let timeout: number | undefined;
    let delay = 1_000;
    let receivedLiveDirectory = false;
    let disconnected = false;
    const baseline = new AbortController();
    function sendSubscriptions() {
      sendSubscription();
      if (playersSelection.current) sendPlayersSubscription(playersSelection.current.request);
    }

    void fetch(serverDirectoryPath, { signal: baseline.signal })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json();
        if (!baseline.signal.aborted && !receivedLiveDirectory && isServerList(data?.servers)) {
          setDirectory(disconnected ? markDirectoryUnavailable(data.servers) : { servers: data.servers, unavailable: false });
        }
      })
      .catch(() => { /* The live connection can still supply the directory. */ });

    function connect() {
      const socket = new WebSocket(url);
      connection.current = socket;
      timeout = window.setTimeout(() => socket.close(), 5_000);
      socket.addEventListener('open', sendSubscriptions);
      socket.addEventListener('message', event => {
        if (connection.current !== socket || typeof event.data !== 'string') return;
        let update: LiveUpdate;
        try { update = JSON.parse(event.data); } catch { return; }
        if (update?.type === 'servers' && isServerList(update.servers)) {
          receivedLiveDirectory = true;
          disconnected = false;
          window.clearTimeout(timeout);
          delay = 1_000;
          setDirectory({ servers: update.servers, unavailable: false });
        }
        if (update?.type === 'catalog' && update.server === selection.current.server) setCatalog(update);
        if (update?.type === 'players') {
          const selected = playersSelection.current;
          if (selected && selected.request.players === update.server && selected.request.subscription === update.subscription) {
            const roster = readOnlinePlayersState(update.roster);
            if (roster) selected.update(roster);
          }
        }
      });
      socket.addEventListener('close', () => {
        if (connection.current !== socket) return;
        connection.current = undefined;
        disconnected = true;
        window.clearTimeout(timeout);
        setCatalog(undefined);
        playersSelection.current?.disconnect();
        setDirectory(current => markDirectoryUnavailable(current.servers));
        retry = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    }
    connect();
    return () => {
      baseline.abort();
      const socket = connection.current;
      connection.current = undefined;
      socket?.removeEventListener('open', sendSubscriptions);
      socket?.close();
      window.clearTimeout(timeout);
      window.clearTimeout(retry);
    };
  }, [sendPlayersSubscription, sendSubscription]);

  return <context.Provider value={directory}>
    <subscriptionContext.Provider value={subscribe}>
      <catalogContext.Provider value={catalog}>
        <playersContext.Provider value={subscribePlayers}>{children}</playersContext.Provider>
      </catalogContext.Provider>
    </subscriptionContext.Provider>
  </context.Provider>;
}

export function useOnlinePlayersSubscription() {
  return useContext(playersContext);
}

export function useServerDirectory() {
  const { servers, unavailable } = useContext(context);
  return { servers: servers ?? emptyServers, loaded: servers !== undefined, unavailable };
}

export function useLiveCatalog(server: string) {
  const subscribe = useContext(subscriptionContext);
  const catalog = useContext(catalogContext);
  useEffect(() => subscribe(server), [server, subscribe]);
  return catalog?.server === server ? catalog : undefined;
}
