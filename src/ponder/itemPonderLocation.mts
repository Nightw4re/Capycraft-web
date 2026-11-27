import { isItemId } from '../items/itemRoutes.mts';
import { ponderItemOrder, type PonderChoice } from './guides.mts';

export type ItemPonderLocation = { itemId: string; sceneId?: string; schematic?: string };

export function selectItemPonderScene<T extends PonderChoice>(
  scenes: readonly T[], { itemId, sceneId, schematic }: ItemPonderLocation,
): T | undefined {
  const hasOrder = scenes.some(scene => ponderItemOrder(scene, itemId) !== undefined);
  const preferred = !hasOrder && itemId === 'create:fluid_pipe' ? 'create:fluid_pipe_flow' : undefined;
  return scenes.find(scene => scene.id === sceneId && scene.schematic === schematic)
    ?? scenes.find(scene => scene.id === sceneId) ?? scenes.find(scene => scene.id === preferred) ?? scenes[0];
}

export function readItemPonderLocation(location: string): ItemPonderLocation | undefined {
  const query = location.indexOf('?');
  if (query < 0) return;
  const params = new URLSearchParams(location.slice(query + 1));
  const itemId = params.get('ponder');
  if (!isItemId(itemId) || itemId.length > 512) return;
  const sceneId = params.get('ponderScene');
  const schematic = params.get('ponderSchematic');
  return sceneId && sceneId.length <= 512
    ? { itemId, sceneId, ...(schematic && schematic.length <= 512 && { schematic }) }
    : { itemId };
}

export function itemPonderLocation(location: string, ponder?: ItemPonderLocation) {
  const query = location.indexOf('?');
  const path = query < 0 ? location : location.slice(0, query);
  const params = new URLSearchParams(query < 0 ? '' : location.slice(query + 1));
  params.delete('ponder');
  params.delete('ponderScene');
  params.delete('ponderSchematic');
  if (ponder) {
    params.set('ponder', ponder.itemId);
    if (ponder.sceneId) {
      params.set('ponderScene', ponder.sceneId);
      if (ponder.schematic) params.set('ponderSchematic', ponder.schematic);
    }
  }
  return params.size ? `${path}?${params}` : path;
}
