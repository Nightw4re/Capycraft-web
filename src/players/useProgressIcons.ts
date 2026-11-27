import { useEffect, useState } from 'react';
import { loadCatalog, type CatalogItem } from '../items/catalogData';

export function useProgressItems(server: string | undefined, entries: readonly { iconItemId?: string; itemId?: string }[],
  includeAdvancements = false) {
  const ids = [...new Set(entries.flatMap(entry => [entry.iconItemId, entry.itemId].filter(id => id !== undefined)))].sort().join(',');
  const [result, setResult] = useState<{ server: string; items?: ReadonlyMap<string, CatalogItem>;
    icons: ReadonlyMap<string, string>; advancementIcons?: ReadonlyMap<string, string> }>();
  useEffect(() => {
    if (!server || (!ids && !includeAdvancements)) return;
    const request = new AbortController();
    void (async () => {
      const catalog = await loadCatalog(server, request.signal);
      if (!catalog) return;
      const itemIds = new Set(ids ? ids.split(',') : []);
      const [items, advancementIcons] = await Promise.all([
        catalog.getItems(itemIds, request.signal).catch(() => undefined),
        includeAdvancements ? catalog.getAdvancementIcons?.(request.signal).catch(() => undefined) : undefined,
      ]);
      const icons = new Map<string, string>();
      for (const [id, item] of items ?? []) {
        if (!item.icon) continue;
        icons.set(id, item.icon);
        itemIds.delete(id);
      }
      if (itemIds.size && !request.signal.aborted) {
        const recipeIcons = await catalog.getRecipeItemIcons?.(itemIds, request.signal).catch(() => undefined);
        for (const [id, icon] of recipeIcons ?? []) icons.set(id, icon);
      }
      if (!request.signal.aborted) setResult({ server, items, icons, advancementIcons });
    })().catch(() => {});
    return () => request.abort();
  }, [ids, server, includeAdvancements]);
  return result?.server === server ? result : undefined;
}

export function useProgressIcons(server: string, entries: readonly { iconItemId?: string }[]) {
  return useProgressItems(server, entries)?.icons;
}
