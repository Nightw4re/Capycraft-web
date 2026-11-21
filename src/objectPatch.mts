export type ObjectPatch = { set: Record<string, unknown>; remove: string[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function applyObjectPatch(base: Record<string, unknown>, patch: unknown): Record<string, unknown> | undefined {
  if (!isRecord(patch) || !isRecord(patch.set) || !Array.isArray(patch.remove)) return;
  const { set, remove } = patch;
  const removed = new Set<string>();
  for (const key of remove as unknown[]) {
    if (typeof key !== 'string' || !Object.hasOwn(base, key) || Object.hasOwn(set, key) || removed.has(key)) return;
    removed.add(key);
  }
  if (!Object.keys(set).length && !removed.size) return;
  const result = { ...base, ...set };
  for (const key of removed) delete result[key];
  return result;
}
