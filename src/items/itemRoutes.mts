export const publicItemPathPattern = '/server/([a-z0-9-]+)/items/([^/]+)';

const itemPathPattern = new RegExp(`^${publicItemPathPattern}$`);
const identifier = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function isItemId(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value);
}

export function publicItemPath(server: string, id: string) {
  return `/server/${server}/items/${encodeURIComponent(id)}`;
}

export function parsePublicItemPath(path: string) {
  const match = itemPathPattern.exec(path);
  if (!match) return;
  try {
    const id = decodeURIComponent(match[2]);
    if (isItemId(id)) return { server: match[1], id };
  } catch {
    // An invalid percent escape cannot identify an item.
  }
}
