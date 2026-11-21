import { WebSocket } from 'ws';
import { applyObjectPatch, isRecord } from '../src/objectPatch.mts';

export type FeedResult = { reachable: boolean; data?: unknown; httpStatus?: number };

const timeout = 5_000;
const heartbeatInterval = 15_000;

export function subscribeWebcraftFeeds<Feed extends string>(
  origin: string,
  endpoint: string,
  commands: { id: Feed; path: string }[],
  token: string | undefined,
  onResults: (results: ReadonlyMap<Feed, FeedResult>) => void,
) {
  const url = new URL(endpoint, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket: WebSocket | undefined;
  let retry: NodeJS.Timeout | undefined;
  let delay = 1_000;
  let stopped = false;

  function connect() {
    const client = socket = new WebSocket(url, {
      handshakeTimeout: timeout,
      maxPayload: 256 * 1024,
      followRedirects: false,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    let closed: FeedResult = { reachable: false };
    let heartbeat: NodeJS.Timeout | undefined;
    const current = new Map<Feed, FeedResult>();
    type Subscription = {
      command: { id: Feed; path: string };
      subscribed: boolean;
      delay: number;
      replyTimeout?: NodeJS.Timeout;
      retry?: NodeJS.Timeout;
      baseline?: Record<string, unknown>;
    };
    const subscriptions = new Map<string, Subscription>(commands.map(command =>
      [command.id, { command, subscribed: false, delay: 1_000 }]));
    let initialized = false;
    let alive = true;
    let delta = false;

    function publish(id: Feed, result: FeedResult) {
      current.set(id, result);
      if (initialized) onResults(new Map([[id, result]]));
      else if (current.size === commands.length) {
        initialized = true;
        delay = 1_000;
        onResults(current);
      }
    }

    function subscribe(subscription: Subscription) {
      if (client.readyState !== WebSocket.OPEN) return;
      client.send(JSON.stringify({ op: 'subscribe', ...subscription.command, ...(delta ? { updates: 'delta' } : {}) }));
      subscription.replyTimeout = setTimeout(() => client.terminate(), timeout).unref();
    }

    client.on('upgrade', response => {
      const updates = response.headers['x-webcraft-subscription-updates'];
      delta = typeof updates === 'string' && updates.trim().toLowerCase() === 'delta';
    });
    client.on('open', () => {
      for (const subscription of subscriptions.values()) subscribe(subscription);
      heartbeat = setInterval(() => {
        if (!alive) {
          client.terminate();
          return;
        }
        alive = false;
        client.ping();
      }, heartbeatInterval).unref();
    });
    client.on('pong', () => { alive = true; });
    client.on('message', (message, binary) => {
      if (stopped || binary || client.readyState !== WebSocket.OPEN) return;
      let data: { id?: unknown; type?: unknown; response?: { status?: unknown; body?: unknown }; patch?: unknown } | null;
      try { data = JSON.parse(message.toString()); } catch {
        if (delta) client.terminate();
        return;
      }
      const subscription = typeof data?.id === 'string' ? subscriptions.get(data.id) : undefined;
      if (data?.type === 'patch') {
        const status = subscription && current.get(subscription.command.id)?.httpStatus;
        const body = delta && subscription?.subscribed && subscription.baseline
          && applyObjectPatch(subscription.baseline, data.patch);
        if (!subscription || !status || !body) {
          client.terminate();
          return;
        }
        subscription.baseline = body;
        publish(subscription.command.id, { reachable: true, httpStatus: status,
          data: status >= 200 && status < 300 ? body : undefined });
        return;
      }
      const status = data?.response?.status;
      if (!data || !subscription || typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) return;
      if (subscription.subscribed ? data.type !== 'update'
        : !subscription.replyTimeout || (data.type !== 'snapshot' && data.type !== 'response')) return;
      clearTimeout(subscription.replyTimeout);
      subscription.replyTimeout = undefined;
      if (data.type === 'snapshot') subscription.subscribed = true;
      if (data.type === 'response' && (status === 404 || status === 409 || status === 425 || status === 429 || status >= 500)) {
        // A rejected command has no subscription. Retry it without discarding the other feeds.
        subscription.retry = setTimeout(() => subscribe(subscription), subscription.delay).unref();
        subscription.delay = Math.min(subscription.delay * 2, 30_000);
      }
      const result = {
        reachable: true, httpStatus: status, data: data.type !== 'response' && status >= 200 && status < 300 ? data.response?.body : undefined,
      };
      subscription.baseline = delta && data.type !== 'response' && isRecord(data.response?.body)
        ? data.response.body : undefined;
      publish(subscription.command.id, result);
    });
    client.on('unexpected-response', (_request, response) => {
      // Like HTTP polling, an error response still means the upstream is reachable.
      const status = response.statusCode ?? 0;
      closed = { reachable: status < 300 || status >= 400, httpStatus: status };
      response.destroy();
      client.terminate();
    });
    client.on('error', () => client.terminate());
    client.on('close', () => {
      clearTimeout(heartbeat);
      for (const subscription of subscriptions.values()) {
        clearTimeout(subscription.replyTimeout);
        clearTimeout(subscription.retry);
      }
      if (stopped) return;
      onResults(new Map(commands.map(({ id }) => [id, closed])));
      retry = setTimeout(connect, delay).unref();
      delay = Math.min(delay * 2, 30_000);
    });
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.terminate();
  };
}
