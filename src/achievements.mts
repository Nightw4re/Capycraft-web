import { isItemId } from './items/itemRoutes.mts';
import { readProgressPosition, type ProgressPosition } from './progressLayout.mts';

export const achievementsPath = '/api/achievements';
export type Advancement = { id: string; title: string; description: string; frame: 'task' | 'goal' | 'challenge';
  group?: string; groupTitle?: string; iconItemId?: string; position?: ProgressPosition; dependencyIds?: string[] };
export type AchievementCatalog = { total: number; advancements: Advancement[] };
export type AchievementProgress = AchievementCatalog & { player: string; completed: number; completedIds: string[];
  completedAt?: Record<string, number> };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readAchievementCatalog(data: unknown, player?: undefined): AchievementCatalog | undefined;
export function readAchievementCatalog(data: unknown, player: string): AchievementProgress | undefined;
export function readAchievementCatalog(data: unknown, player: string | undefined): AchievementCatalog | AchievementProgress | undefined;
export function readAchievementCatalog(data: unknown, player?: string): AchievementCatalog | AchievementProgress | undefined {
  if (!record(data) || !Array.isArray(data.advancements) || data.total !== data.advancements.length
    || data.advancements.length > 25_000) return;
  const advancements: Advancement[] = [];
  const ids = new Set<string>();
  for (const entry of data.advancements as unknown[]) {
    if (!record(entry)) return;
    const { id, title, description, frame } = entry;
    if (!isItemId(id) || id.length > 512 || ids.has(id) || typeof title !== 'string' || title.length > 512
      || typeof description !== 'string' || description.length > 4096
      || (frame !== 'task' && frame !== 'goal' && frame !== 'challenge')) return;
    ids.add(id);
    const position = readProgressPosition(entry.x, entry.y) ?? (record(entry.position)
      ? readProgressPosition(entry.position.x, entry.position.y) : undefined);
    const parent = isItemId(entry.parentId) ? entry.parentId
      : Array.isArray(entry.dependencyIds) && isItemId(entry.dependencyIds[0]) ? entry.dependencyIds[0] : undefined;
    advancements.push({ id, title, description, frame, ...(position && { position }),
      ...(parent && parent.length <= 512 && parent !== id && { dependencyIds: [parent] }),
      ...(isItemId(entry.group) && { group: entry.group }),
      ...(typeof entry.groupTitle === 'string' && entry.groupTitle.length <= 512 && { groupTitle: entry.groupTitle }),
      ...(isItemId(entry.iconItemId) && { iconItemId: entry.iconItemId }),
    });
  }
  const result = { total: advancements.length, advancements };
  if (player === undefined) return result;
  if (typeof data.player !== 'string' || data.player.toLowerCase() !== player.toLowerCase()
    || !Array.isArray(data.completedIds) || data.completed !== data.completedIds.length) return;
  const completedIds = new Set<string>();
  for (const id of data.completedIds as unknown[]) {
    if (typeof id !== 'string' || !ids.has(id) || completedIds.has(id)) return;
    completedIds.add(id);
  }
  const completedAt: Record<string, number> = {};
  if (record(data.completedAt)) {
    for (const [id, time] of Object.entries(data.completedAt)) {
      if (completedIds.has(id) && typeof time === 'number' && Number.isSafeInteger(time)
        && time > 0 && time <= 8.64e15) completedAt[id] = time;
    }
  }
  return { ...result, player: data.player, completed: completedIds.size, completedIds: Array.from(completedIds),
    ...(Object.keys(completedAt).length && { completedAt }) };
}
