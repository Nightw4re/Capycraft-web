import { mkdirSync, watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import layout from '../src/items/catalogLayout.json' with { type: 'json' };
import { liveUpdatesPath, type ImportStatus, type LiveUpdate } from '../src/liveUpdates.mts';
import type { ServerSummary } from '../src/serverDirectoryTypes.ts';
import type { createOnlinePlayers } from './onlinePlayers.mts';

function send(client: WebSocket, message: string) {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > 1024 * 1024) client.terminate();
  else client.send(message);
}

function createFeed(read: () => Promise<LiveUpdate>) {
  const clients = new Map<WebSocket, string | undefined>();
  let reading = false;
  let pending = false;

  async function refresh() {
    pending = true;
    if (reading) return;
    reading = true;
    try {
      while (pending) {
        pending = false;
        try {
          const subscribers = Array.from(clients.keys());
          const message = JSON.stringify(await read());
          for (const client of subscribers) {
            if (!clients.has(client) || clients.get(client) === message) continue;
            clients.set(client, message);
            send(client, message);
          }
        } catch (error) {
          console.warn('Could not update live status.', error);
        }
      }
    } finally {
      reading = false;
    }
  }

  return {
    refresh,
    subscribe(client: WebSocket) {
      clients.set(client, undefined);
      void refresh();
      return () => { clients.delete(client); };
    },
  };
}

function ignoreMissing(error: NodeJS.ErrnoException): undefined {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
}

function readStatus(text: string | undefined): ImportStatus | null {
  if (!text) return null;
  const data = JSON.parse(text) as Partial<ImportStatus> | null;
  if (typeof data?.revision !== 'string' || !/^[a-f0-9]{64}$/.test(data.revision)
    || typeof data.updatedAt !== 'number' || !Number.isSafeInteger(data.updatedAt)
    || (data.state !== 'running' && data.state !== 'succeeded' && data.state !== 'failed')) return null;
  const { state, revision, updatedAt, phase, progress } = data;
  const status: ImportStatus = { state, revision, updatedAt };
  if (phase === 'preparing' || phase === 'processing' || phase === 'publishing') status.phase = phase;
  if (progress && Number.isSafeInteger(progress.loaded) && Number.isSafeInteger(progress.expected)
    && progress.loaded >= 0 && progress.expected >= progress.loaded) {
    status.progress = { loaded: progress.loaded, expected: progress.expected };
  }
  return status;
}

export function attachLiveUpdates(api: Server, snapshot: () => Promise<ServerSummary[]>, catalogs: ReadonlyMap<string, string>,
  onlinePlayers: ReturnType<typeof createOnlinePlayers>,
) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 });
  const directory = createFeed(async () => ({ type: 'servers', servers: await snapshot() }));
  const stopWatching: (() => void)[] = [];
  const feeds = new Map(Array.from(catalogs, ([server, path]) => {
    const manifest = join(path, 'catalog.json');
    const statusPath = join(path, layout.statusFile);
    let expiry: NodeJS.Timeout | undefined;
    const feed = createFeed(async (): Promise<LiveUpdate> => {
      const [file, text] = await Promise.all([
        stat(manifest, { bigint: true }).catch(ignoreMissing),
        readFile(statusPath, 'utf8').catch(ignoreMissing),
      ]);
      const status = readStatus(text);
      clearTimeout(expiry);
      if (status?.state === 'running') {
        const remaining = status.updatedAt + layout.statusHeartbeatMs * 4 - Date.now();
        if (remaining <= 0) status.state = 'failed';
        else expiry = setTimeout(() => void feed.refresh(), remaining).unref();
      }
      const version = file ? `${file.ino}:${file.mtimeNs}:${file.size}` : null;
      return { type: 'catalog', server, version, status };
    });
    try {
      mkdirSync(path, { recursive: true });
      const watcher = watch(path, { persistent: false }, (_event, name) => {
        if (name === 'catalog.json' || !name) void directory.refresh();
        if (name === 'catalog.json' || name === layout.statusFile || !name) void feed.refresh();
      });
      watcher.on('error', error => console.warn(`Could not watch catalog for ${server}.`, error));
      stopWatching.push(() => watcher.close());
    } catch (error) {
      console.warn(`Could not watch catalog for ${server}.`, error);
    }
    stopWatching.push(() => clearTimeout(expiry));
    return [server, feed] as const;
  }));

  api.on('upgrade', (request, socket, head) => {
    const { origin, host } = request.headers;
    if (request.url !== liveUpdatesPath || (origin && (!URL.canParse(origin) || new URL(origin).host !== host))) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });

  const alive = new Set<WebSocket>();
  sockets.on('connection', client => {
    alive.add(client);
    client.on('pong', () => alive.add(client));
    client.on('error', () => client.terminate());
    const unsubscribeDirectory = directory.subscribe(client);
    let unsubscribeCatalog: (() => void) | undefined;
    let unsubscribePlayers: (() => void) | undefined;
    client.on('message', (message, binary) => {
      if (binary) return;
      try {
        const data: unknown = JSON.parse(message.toString());
        if (!data || typeof data !== 'object') return;
        if ('server' in data && (data.server === null || (typeof data.server === 'string' && feeds.has(data.server)))) {
          unsubscribeCatalog?.();
          unsubscribeCatalog = typeof data.server === 'string' ? feeds.get(data.server)?.subscribe(client) : undefined;
        }
        if ('players' in data && 'subscription' in data && typeof data.subscription === 'number'
          && Number.isSafeInteger(data.subscription) && (data.players === null || typeof data.players === 'string')) {
          const { players: server, subscription } = data;
          unsubscribePlayers?.();
          unsubscribePlayers = typeof server === 'string' ? onlinePlayers.subscribe(server, roster => {
            const update: LiveUpdate = { type: 'players', server, subscription, roster };
            send(client, JSON.stringify(update));
          }) : undefined;
        }
      } catch {
        client.close(1007);
      }
    });
    client.on('close', () => {
      alive.delete(client);
      unsubscribeDirectory();
      unsubscribeCatalog?.();
      unsubscribePlayers?.();
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (alive.delete(client)) client.ping();
      else client.terminate();
    }
  }, 30_000).unref();
  api.once('close', () => {
    clearInterval(heartbeat);
    for (const stop of stopWatching) stop();
    sockets.close();
  });

  return { refreshDirectory: () => void directory.refresh() };
}
