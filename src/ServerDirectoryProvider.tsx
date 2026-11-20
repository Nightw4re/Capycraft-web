import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { liveUpdatesPath, type CatalogSubscription, type CatalogUpdate, type LiveUpdate } from './liveUpdates.mts';
import { isServerAlias } from './minecraftServers.mjs';
import type { ServerSummary } from './serverDirectoryTypes';

type Directory = { servers?: readonly ServerSummary[]; unavailable: boolean };
const context = createContext<Directory>({ unavailable: false });
const catalogContext = createContext<CatalogUpdate | undefined>(undefined);
const subscriptionContext = createContext<(server: string) => (() => void)>(() => () => {});
const emptyServers: readonly ServerSummary[] = [];

export function ServerDirectoryProvider({ children }: { children: ReactNode }) {
  const [directory, setDirectory] = useState<Directory>({ unavailable: false });
  const [catalog, setCatalog] = useState<CatalogUpdate>();
  const connection = useRef<WebSocket>(undefined);
  const selection = useRef<CatalogSubscription>({ server: null });

  const sendSubscription = useCallback(() => {
    if (connection.current?.readyState === WebSocket.OPEN) {
      connection.current.send(JSON.stringify(selection.current));
    }
  }, []);

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
    function connect() {
      const socket = new WebSocket(url);
      connection.current = socket;
      timeout = window.setTimeout(() => socket.close(), 5_000);
      socket.addEventListener('open', sendSubscription);
      socket.addEventListener('message', event => {
        if (connection.current !== socket || typeof event.data !== 'string') return;
        let update: LiveUpdate;
        try { update = JSON.parse(event.data); } catch { return; }
        if (update?.type === 'servers' && Array.isArray(update.servers) && update.servers.every(server =>
          isServerAlias(server?.alias) && Array.isArray(server.tabs))) {
          window.clearTimeout(timeout);
          delay = 1_000;
          setDirectory({ servers: update.servers, unavailable: false });
        }
        if (update?.type === 'catalog' && update.server === selection.current.server) setCatalog(update);
      });
      socket.addEventListener('close', () => {
        if (connection.current !== socket) return;
        connection.current = undefined;
        window.clearTimeout(timeout);
        setCatalog(undefined);
        setDirectory(current => ({
          unavailable: true,
          servers: current.servers?.map(server => ({
            ...server, status: server.access ? 'waiting' : 'unavailable',
            playersOnline: undefined, uptimeSeconds: undefined,
          })),
        }));
        retry = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    }
    connect();
    return () => {
      const socket = connection.current;
      connection.current = undefined;
      socket?.removeEventListener('open', sendSubscription);
      socket?.close();
      window.clearTimeout(timeout);
      window.clearTimeout(retry);
    };
  }, [sendSubscription]);

  return <context.Provider value={directory}>
    <subscriptionContext.Provider value={subscribe}>
      <catalogContext.Provider value={catalog}>{children}</catalogContext.Provider>
    </subscriptionContext.Provider>
  </context.Provider>;
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
