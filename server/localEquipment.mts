import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { equipmentSlots, hotbarSlots, inventorySlots, type EquipmentItem, type EquipmentLoadout } from '../src/equipment/contract.mts';
import { readItemBar, type TooltipTextSpan } from '../src/items/catalogIndex.mjs';

const equipmentFeed = '/api/v1/modules/webcraft_equipment/equipment/';
const maxResponseBytes = 8 * 1024 * 1024;
const maxIconLength = 512 * 1024;
const armorAssets = new URL('../data/armor-preview/', import.meta.url);
const resourceId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

function isResourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && resourceId.test(value);
}

function localUpstream(value: string | undefined) {
  if (!value || !URL.canParse(value)) return;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return;
  return url;
}

function isLocalRequest(request: IncomingMessage) {
  const { host, origin, 'sec-fetch-site': site } = request.headers;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
    && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host ?? '')
    && (!origin || origin === `http://${host}`)
    && (!site || site === 'same-origin' || site === 'none');
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

const tooltipStyles = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const;

function equipmentTooltip(value: unknown): TooltipTextSpan[][] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 48) return;
  const lines: TooltipTextSpan[][] = [];
  for (const line of value) {
    if (!Array.isArray(line) || line.length > 512) return;
    const spans: TooltipTextSpan[] = [];
    let length = 0;
    for (const entry of line) {
      const span = record(entry);
      if (!span || typeof span.text !== 'string' || !span.text.length) return;
      length += span.text.length;
      if (length > 512) return;
      const { color } = span;
      const result: TooltipTextSpan = { text: span.text };
      if (typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff) result.color = color;
      for (const style of tooltipStyles) if (span[style] === true) result[style] = true;
      spans.push(result);
    }
    lines.push(spans);
  }
  return lines;
}

function itemFrom(value: unknown): EquipmentItem | null | undefined {
  if (value === null) return null;
  const item = record(value);
  if (!item || typeof item.name !== 'string' || !item.name || item.name.length > 512
      || !isResourceId(item.id)
      || typeof item.count !== 'number' || !Number.isSafeInteger(item.count) || item.count < 1) return;
  const preview = record(item.preview);
  let icon: string | undefined;
  if (preview?.type === 'sprite') {
    for (const format of ['webp', 'png']) {
      const bytes = preview[format];
      if (typeof bytes === 'string' && bytes.length <= maxIconLength && /^[A-Za-z0-9+/]+={0,2}$/.test(bytes)) {
        icon = `data:image/${format};base64,${bytes}`;
        break;
      }
    }
  }
  const trim = record(item.trim);
  const { dye } = item;
  const bar = readItemBar(item.bar);
  const tooltip = Array.isArray(item.tooltip) && item.tooltip.length <= 48
    && item.tooltip.every(line => typeof line === 'string' && line.length <= 512) ? item.tooltip as string[] : undefined;
  const tooltipLines = equipmentTooltip(item.tooltipLines);
  const modName = typeof item.modName === 'string' && item.modName.length <= 128 ? item.modName.trim() : undefined;
  return { id: item.id, name: item.name, count: item.count, icon,
    ...(bar && { bar }), ...(tooltip?.length && { tooltip }), ...(tooltipLines && { tooltipLines }), ...(modName && { modName }),
    ...(isResourceId(trim?.material) && isResourceId(trim.pattern) && { trim: { material: trim.material, pattern: trim.pattern } }),
    ...(typeof dye === 'number' && Number.isInteger(dye) && dye >= 0 && dye <= 0xffffff && { dye }),
  };
}

function loadoutFrom(value: unknown, player: string, expected: readonly string[]): EquipmentLoadout | undefined {
  const loadout = record(value);
  if (typeof loadout?.player !== 'string' || loadout.player.toLowerCase() !== player.toLowerCase()
    || !Array.isArray(loadout.slots)) return;
  const slotsToRead = expected === equipmentSlots && loadout.slots.length === expected.length + hotbarSlots.length
    ? [...expected, ...hotbarSlots] : expected;
  if (loadout.slots.length !== slotsToRead.length) return;
  const slots: EquipmentLoadout['slots'] = {};
  for (const slot of slotsToRead) {
    const entry = record(loadout.slots.find(entry => record(entry)?.slot === slot));
    const item = itemFrom(entry?.item);
    if (item === undefined) return;
    slots[slot] = item;
  }
  const { selectedSlot } = loadout;
  return { player: loadout.player, slots,
    ...(typeof selectedSlot === 'number' && Number.isInteger(selectedSlot) && selectedSlot >= 0 && selectedSlot < 9
      && { selectedSlot }),
  };
}

async function readJson(response: Response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) throw new Error('Equipment response exceeds size limit');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function reply(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin' }).end(JSON.stringify(body));
}

async function serveArmorAsset(response: ServerResponse, view: string, hash: string | null) {
  const texture = view === 'armor-texture' && hash && /^[a-f0-9]{64}$/.test(hash);
  const asset = view === 'armor-data' ? 'armor.json' : view === 'armor-geometry' ? 'armor_geometry.json'
    : texture ? `textures/${hash}.png` : undefined;
  if (!asset) return reply(response, 404, { error: 'equipment_unconfigured' });
  const body = await readFile(new URL(asset, armorAssets)).catch(() => undefined);
  if (!body) return reply(response, 404, { error: 'armor_asset_unavailable' });
  response.writeHead(200, { 'Content-Type': texture ? 'image/png' : 'application/json; charset=utf-8',
    'Cache-Control': texture ? 'private, max-age=86400' : 'no-cache', 'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff' }).end(body);
}

type View = 'loadout' | 'inventory';

export function createLocalEquipment(database: DatabaseSync, env: Record<string, string | undefined>) {
  const upstream = localUpstream(env.CAPYCRAFT_LOCAL_EQUIPMENT_URL);
  const token = env.CAPYCRAFT_LOCAL_EQUIPMENT_TOKEN?.trim();
  const player = env.CAPYCRAFT_LOCAL_EQUIPMENT_PLAYER?.trim() || 'nightware6';
  const identity = player.toLowerCase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_equipment (
      server TEXT NOT NULL, player TEXT NOT NULL, view TEXT NOT NULL, origin TEXT NOT NULL,
      payload TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (server, player, view)
    ) STRICT
  `);
  const store = database.prepare(`
    INSERT INTO player_equipment VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(server, player, view) DO UPDATE SET origin = excluded.origin,
      payload = excluded.payload, saved_at = excluded.saved_at
  `);
  const cached = database.prepare('SELECT payload, saved_at FROM player_equipment WHERE server = ? AND player = ? AND view = ? AND origin = ?');
  const pending = new Map<string, ReturnType<typeof read>>();
  const configured = !!upstream && !!token && /^[A-Za-z0-9_-]{43,128}$/.test(token) && /^[A-Za-z0-9_]{1,16}$/.test(player);

  async function read(server: string, view: View): Promise<{ status: number; body: object }> {
    try {
      const result = await fetch(new URL(equipmentFeed + view, upstream), { headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(3500) });
      if (result.status === 401 || result.status === 403) {
        await result.body?.cancel();
        return { status: 403, body: { error: 'equipment_denied' } };
      }
      if (result.ok) {
        const data = loadoutFrom(await readJson(result), player, view === 'inventory' ? inventorySlots : equipmentSlots);
        if (data) {
          store.run(server, identity, view, upstream!.origin, JSON.stringify(data), Date.now());
          return { status: 200, body: data };
        }
      } else {
        await result.body?.cancel();
      }
    } catch {
      // A previous successful snapshot can still be used during an outage.
    }
    const saved = cached.get(server, identity, view, upstream!.origin) as { payload: string; saved_at: number } | undefined;
    return saved ? { status: 200, body: { ...JSON.parse(saved.payload), savedAt: saved.saved_at } }
      : { status: 404, body: { error: 'equipment_unavailable' } };
  }

  function get(server: string, view: View) {
    const key = server + ':' + view;
    const request = pending.get(key) ?? read(server, view).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    async serve(request: IncomingMessage, response: ServerResponse, server: string, origin: string | undefined, name: string,
      view: string, hash: string | null = null) {
      if (!isLocalRequest(request)) return reply(response, 403, { error: 'local_only' });
      if (!configured || origin !== upstream?.origin || name.toLowerCase() !== identity) {
        return reply(response, 404, { error: 'equipment_unconfigured' });
      }
      if (view !== 'loadout' && view !== 'inventory') return serveArmorAsset(response, view, hash);
      const { status, body } = await get(server, view);
      return reply(response, status, body);
    },
    start(instances: ReadonlyMap<string, { webcraft?: { origin: string } }>, lists: (server: string, name: string) => Promise<boolean>) {
      const server = configured && [...instances].find(([, instance]) => instance.webcraft?.origin === upstream?.origin)?.[0];
      if (!server) return () => {};
      const collect = async () => {
        if (await lists(server, player)) await Promise.all([get(server, 'loadout'), get(server, 'inventory')]);
      };
      const timer = setInterval(() => void collect().catch(() => {}), 15_000).unref();
      return () => clearInterval(timer);
    },
  };
}
