import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { writeStoredRecipeUses } from '../server/recipeUsesStore.mts';

test('recipe indexing lets heartbeat timers run while writing compressed groups', async () => {
  const clock = new Int32Array(new SharedArrayBuffer(4));
  const rows = new Map<string, string | Uint8Array>();
  let heartbeat = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updates: Parameters<NonNullable<Parameters<typeof writeStoredRecipeUses>[2]>>[0][] = [];
  try {
    await writeStoredRecipeUses({
      write(folder, name, data) {
        if (!rows.size) {
          timer = setTimeout(() => { heartbeat = true; }, 0);
          Atomics.wait(clock, 0, 0, 120);
        }
        rows.set(`${folder}/${name}`, data);
      },
    }, {
      recipes: [{ id: 'z' }, { id: 'a' }],
      ingredients: { first: [0, 1], second: [1, 0] },
    }, update => updates.push(update));
    assert.equal(heartbeat, true);
    assert.ok(updates.some(update => update.indexedIngredients === 1));
    const final = updates.at(-1)!;
    assert.equal(final.indexedIngredients, 2);
    assert.equal(final.compressedResponses, 1);
    const payload = [...rows].find(([name]) => name.startsWith('recipe-uses-responses/'))?.[1];
    assert.ok(payload instanceof Uint8Array);
    assert.equal(final.compressedBytes, payload.length);
    assert.deepEqual(JSON.parse(gunzipSync(payload).toString()), { recipes: [{ id: 'a' }, { id: 'z' }] });
  } finally {
    clearTimeout(timer);
  }
});
