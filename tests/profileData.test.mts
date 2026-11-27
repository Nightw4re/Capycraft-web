import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalEquipment } from '../server/localEquipment.mts';
import { compactProgress, createProgressCache } from '../server/progressCache.mts';
import { equipmentItemBar, equipmentSlots, hotbarSlots, inventorySlots } from '../src/equipment/contract.mts';
import { itemUrl, playerProfilePath, routeFromUrl } from '../src/navigation.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('inventory uses the viewer token and preserves a snapshot only for the configured player', async t => {
  let online = true;
  const token = 't'.repeat(43);
  const upstream = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const kind = request.url?.split('/').at(-1);
    assert.ok(kind === 'inventory' || kind === 'loadout');
    if (!online) return response.writeHead(404).end();
    const slots = kind === 'loadout' ? [...equipmentSlots, ...hotbarSlots] : inventorySlots;
    response.end(JSON.stringify({ player: 'Builder', selectedSlot: 0, slots: slots.map(slot => ({
      slot, item: slot === '0' ? { id: 'minecraft:stone', name: 'Stone', count: 3 }
        : slot === '1' ? { id: 'mekanism:electric_bow', name: 'Electric Bow', count: 1, modName: 'Mekanism',
          tooltip: ['Stored energy: 48.0 kFE/48.0 kFE'],
          tooltipLines: [[{ text: 'Stored energy: ', color: 0x760689 }, { text: '48.0 kFE/48.0 kFE' }]] }
        : slot === 'head' ? { id: 'minecraft:leather_helmet', name: 'Leather Cap', count: 1, dye: 0xAA1122,
          trim: { material: 'minecraft:gold', pattern: 'minecraft:sentry' } } : null,
    })) }));
  });
  const origin = await listen(upstream);
  const database = new DatabaseSync(':memory:');
  const equipment = createLocalEquipment(database, { CAPYCRAFT_LOCAL_EQUIPMENT_URL: origin,
    CAPYCRAFT_LOCAL_EQUIPMENT_TOKEN: token, CAPYCRAFT_LOCAL_EQUIPMENT_PLAYER: 'Builder' });
  const api = createServer((request, response) => {
    const query = new URL(request.url!, 'http://localhost').searchParams;
    void equipment.serve(request, response, 'local', origin, query.get('player')!, query.get('view') ?? 'inventory');
  });
  t.after(() => { api.close(); upstream.close(); database.close(); });
  const endpoint = await listen(api);
  const live = await fetch(`${endpoint}/?player=Builder`).then(response => response.json());
  assert.equal(live.slots[0].count, 3);
  assert.deepEqual(live.slots[1].tooltip, ['Stored energy: 48.0 kFE/48.0 kFE']);
  assert.deepEqual(live.slots[1].tooltipLines[0][0], { text: 'Stored energy: ', color: 0x760689 });
  assert.equal(live.slots[1].modName, 'Mekanism');
  assert.deepEqual(equipmentItemBar(live.slots[1], { width: 0, color: 0x44AAFF }), { width: 13, color: 0x44AAFF });
  assert.equal(live.selectedSlot, 0);
  const equipped = await fetch(`${endpoint}/?player=Builder&view=loadout`).then(response => response.json());
  assert.equal(equipped.slots[0].count, 3);
  assert.equal(equipmentItemBar(equipped.slots[1])?.width, 13);
  assert.equal(equipped.slots[8], null);
  assert.equal(equipped.selectedSlot, 0);
  assert.equal(equipped.slots.head.dye, 0xAA1122);
  assert.deepEqual(equipped.slots.head.trim, { material: 'minecraft:gold', pattern: 'minecraft:sentry' });
  online = false;
  const saved = await fetch(`${endpoint}/?player=Builder`).then(response => response.json());
  assert.equal(saved.slots[0].count, 3);
  assert.deepEqual(saved.slots[1], live.slots[1]);
  assert.equal(saved.selectedSlot, 0);
  assert.ok(saved.savedAt > 0);
  const savedEquipment = await fetch(`${endpoint}/?player=Builder&view=loadout`).then(response => response.json());
  assert.deepEqual(savedEquipment.slots.head, equipped.slots.head);
  assert.equal((await fetch(`${endpoint}/?player=Other`)).status, 404);
});

test('equipment energy bars use the stack ratio and normalize energy prefixes', () => {
  const stack = { id: 'mekanism:electric_bow', name: 'Electric Bow', count: 1 };
  const color = 0x44AAFF;
  const catalogBar = { width: 13, color };
  assert.equal(equipmentItemBar(stack, catalogBar), undefined);
  assert.deepEqual(equipmentItemBar({ ...stack, tooltip: ['Stored energy: 500.0 FE/1.0 kFE'] }, catalogBar),
    { width: 7, color });
  assert.deepEqual(equipmentItemBar({ ...stack, tooltip: ['Stored energy: 0.0 FE/48.0 kFE'] }, catalogBar),
    { width: 0, color });
  const nativeBar = { width: 10, color: 0xAA1122 };
  assert.deepEqual(equipmentItemBar({ ...stack, bar: nativeBar, tooltip: ['Stored energy: 0.0 FE/48.0 kFE'] }, catalogBar), nativeBar);
});

test('item recipes and uses preserve the player profile and tab', () => {
  const profile = playerProfilePath('local', 'Builder', 'inventory');
  for (const view of ['recipes', 'uses'] as const) {
    const dialog = itemUrl(profile, { id: 'minecraft:iron_boots', view });
    const route = routeFromUrl(dialog);
    assert.equal(route.page, 'players');
    assert.equal('item' in route && route.item?.view, view);
    assert.equal(new URL(dialog, 'http://localhost').searchParams.get('player'), 'Builder');
    assert.equal(itemUrl(dialog), profile);
  }
});

test('a new item import revision invalidates the cached progress and catalog', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    let revision = 'first';
    const cache = createProgressCache(database, async () => revision);
    const compact = compactProgress({ total: 2, completed: 1, completedIds: ['demo:one'],
      completedAt: { 'demo:one': 42, 'demo:other': 99 }, advancements: ['discarded'] }, () => true);
    assert.deepEqual(compact, { total: 2, completed: 1, completedIds: ['demo:one'], completedAt: { 'demo:one': 42 } });
    const saved = await cache('local', 'achievements', 'Builder');
    saved.save(compact!);
    assert.ok((await cache('local', 'achievements', 'builder')).fresh);
    revision = 'second';
    assert.equal((await cache('local', 'achievements', 'Builder')).stale, undefined);
  } finally {
    database.close();
  }
});
