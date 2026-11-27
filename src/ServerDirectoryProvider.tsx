import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { liveUpdatesPath, serverDirectoryPath, type CatalogSubscription, type CatalogUpdate, type LiveUpdate, type PlayersSubscription } from './liveUpdates.mts';
import { applyDirectoryPatch, directorySubscription, isServerList } from './directoryUpdates.mts';
import { readOnlinePlayersState, type OnlinePlayersState } from './onlinePlayers.mts';
import type { ServerSummary } from './serverDirectoryTypes';

type Directory = { servers?: readonly ServerSummary[]; unavailable: boolean };
const context = createContext<Directory>({ unavailable: false });
const catalogContext = createContext<CatalogUpdate | undefined>(undefined);
const subscriptionContext = createContext<(server: string) => (() => void)>(() => () => {});
type SubscribePlayers = (server: string, update: (state: OnlinePlayersState) => void, disconnect: () => void) => () => void;
const playersContext = createContext<SubscribePlayers>(() => () => {});
const emptyServers: readonly ServerSummary[] = [];

function markDirectoryUnavailable(servers: readonly ServerSummary[] | undefined): Directory {
  return {
    unavailable: true,
    servers: servers?.map(server => ({
      ...server,
      status: server.status === 'ready' || server.status === 'starting' || server.status === 'stopping'
        ? 'unavailable' : server.status,
      playersOnline: undefined,
      lastKnownPlayersOnline: server.playersOnline ?? server.lastKnownPlayersOnline,
      uptimeSeconds: undefined,
      performance: undefined,
    })),
  };
}

export function ServerDirectoryProvider({ children }: { children: ReactNode }) {
  const [directory, setDirectory] = useState<Directory>({ unavailable: false });
  const [catalog, setCatalog] = useState<CatalogUpdate>();
  const connection = useRef<WebSocket>(undefined);
  const selection = useRef<CatalogSubscription>(undefined);
  const sentCatalog = useRef<string>(undefined);
  const playersSelection = useRef<{ request: PlayersSubscription; update: Parameters<SubscribePlayers>[1]; disconnect: () => void }>(undefined);
  const nextSubscription = useRef(0);

  const sendSubscription = useCallback(() => {
    const server = selection.current?.server ?? undefined;
    if (connection.current?.readyState !== WebSocket.OPEN || server === sentCatalog.current) return;
    connection.current.send(JSON.stringify({ server: server ?? null }));
    sentCatalog.current = server;
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
      selection.current = undefined;
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
      let liveServers: ServerSummary[] | undefined;
      connection.current = socket;
      timeout = window.setTimeout(() => socket.close(), 5_000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(directorySubscription));
        sendSubscription();
        if (playersSelection.current) sendPlayersSubscription(playersSelection.current.request);
      });
      socket.addEventListener('message', event => {
        if (connection.current !== socket || socket.readyState !== WebSocket.OPEN || typeof event.data !== 'string') return;
        let update: LiveUpdate;
        try { update = JSON.parse(event.data); } catch {
          socket.close();
          return;
        }
        if (update?.type === 'servers') {
          if (!isServerList(update.servers)) {
            socket.close();
            return;
          }
          liveServers = update.servers;
          receivedLiveDirectory = true;
          baseline.abort();
          disconnected = false;
          window.clearTimeout(timeout);
          delay = 1_000;
          setDirectory({ servers: liveServers, unavailable: false });
        }
        if (update?.type === 'servers-patch') {
          const servers = liveServers && applyDirectoryPatch(liveServers, update);
          if (!servers) {
            socket.close();
            return;
          }
          liveServers = servers;
          setDirectory({ servers, unavailable: false });
        }
        if (update?.type === 'catalog' && update.server === selection.current?.server) setCatalog(update);
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
        sentCatalog.current = undefined;
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
      sentCatalog.current = undefined;
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

export function useLiveCatalog(server?: string) {
  const subscribe = useContext(subscriptionContext);
  const catalog = useContext(catalogContext);
  useEffect(() => server ? subscribe(server) : undefined, [server, subscribe]);
  return catalog?.server === server ? catalog : undefined;
}
