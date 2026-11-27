import { isRecord } from './objectPatch.mts';
import { isItemId } from './items/itemRoutes.mts';
import { readProgressPosition, type ProgressDecoration, type ProgressNode } from './progressLayout.mts';

export const questsPath = '/api/quests';
type QuestIcon = { iconItemId?: string; iconImage?: string };
export type QuestDetailEntry = QuestIcon & {
  id: string; title: string; count?: number; countMax?: number; itemId?: string; itemEntry?: true;
};
export type Quest = ProgressNode & {
  description: string; minimumRequired?: number; hiddenDependencyCount?: number;
  tasks?: QuestDetailEntry[]; rewards?: QuestDetailEntry[];
};
export type QuestChapter = QuestIcon & {
  id: string; title: string; quests: Quest[]; group?: QuestDetailEntry; images?: ProgressDecoration[];
};
export type QuestCatalog = { total: number; chapters: QuestChapter[]; itemDetailVersion?: 2 | 3 | 4 | 5 };
export type QuestProgress = QuestCatalog & { player: string; completed: number; completedIds: string[];
  completedAt?: Record<string, number> };

function isFtbId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{1,16}$/i.test(id);
}

function isQuestItemPlaceholder(id: string) {
  return id.startsWith('ftbfiltersystem:') || id === 'ftbquests:custom_icon' || id === 'ftbquests:missing_item';
}

const genericPlaceholderTitle = /^(?:\d+\s*[x×]\s*)?(?:smart filter|custom icon|missing item|quest item|(?:item\.)?(?:ftbfiltersystem|ftbquests)\.[\w.]+)$/i;

function isQuestItemId(id: unknown): id is string {
  return isItemId(id) && !isQuestItemPlaceholder(id);
}

function readQuestIcon(row: Record<string, unknown>): QuestIcon {
  return {
    ...(isQuestItemId(row.iconItemId) && { iconItemId: row.iconItemId }),
    ...(typeof row.iconImage === 'string' && row.iconImage.length <= 175_000
      && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(row.iconImage) && { iconImage: row.iconImage }),
  };
}

function readDetailEntry(row: unknown): QuestDetailEntry | undefined {
  if (!isRecord(row) || !isFtbId(row.id) || typeof row.title !== 'string' || row.title.length > 512) return;
  const placeholder = isItemId(row.iconItemId) && isQuestItemPlaceholder(row.iconItemId);
  const itemId = isQuestItemId(row.itemId) ? row.itemId : undefined;
  const itemEntry = row.itemEntry === true || itemId !== undefined || placeholder;
  const count = typeof row.count === 'number' && Number.isSafeInteger(row.count) && row.count >= (itemEntry ? 1 : 2)
    ? row.count : undefined;
  const countMax = count !== undefined && typeof row.countMax === 'number' && Number.isSafeInteger(row.countMax)
    && row.countMax > count ? row.countMax : undefined;
  return { id: row.id, title: placeholder && genericPlaceholderTitle.test(row.title.trim()) ? '' : row.title, ...readQuestIcon(row),
    ...(itemEntry && { itemEntry: true }), ...(itemId && { itemId }), ...(count !== undefined && { count }),
    ...(countMax !== undefined && { countMax }) };
}

function readDetails(rows: unknown, rewards = false) {
  if (!Array.isArray(rows)) return;
  const details = new Map<string, QuestDetailEntry>();
  for (const row of rows.slice(0, 256)) {
    const entry = readDetailEntry(row);
    if (!entry) continue;
    const experience = rewards && !entry.itemEntry && entry.count !== undefined
      && (entry.title === 'XP' || entry.title === 'XP levels');
    details.set(entry.id, experience ? { ...entry, itemEntry: true, iconItemId: entry.iconItemId ?? 'minecraft:experience_bottle' } : entry);
  }
  if (details.size) return [...details.values()];
}

function readDecorations(rows: unknown) {
  if (!Array.isArray(rows)) return;
  const images = new Map<string, ProgressDecoration>();
  for (const row of rows.slice(0, 256)) {
    if (!isRecord(row) || !isFtbId(row.id)) continue;
    const position = readProgressPosition(row.x, row.y) ?? (isRecord(row.position)
      ? readProgressPosition(row.position.x, row.position.y) : undefined);
    const { width, height, rotation, opacity } = row;
    const icons = readQuestIcon(row);
    if (!position || (icons.iconImage === undefined && icons.iconItemId === undefined)
      || typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 512
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0 || height > 512) continue;
    images.set(row.id, { id: row.id, position, width, height, ...icons,
      ...(typeof rotation === 'number' && Number.isFinite(rotation) && { rotation: rotation % 360 }),
      ...(typeof opacity === 'number' && opacity >= 0 && opacity <= 1 && { opacity }),
      ...(row.foreground === true && { foreground: true }) });
  }
  if (images.size) return [...images.values()];
}

export function readQuestCatalog(data: unknown): QuestCatalog | undefined {
  if (!isRecord(data) || !Array.isArray(data.chapters) || data.chapters.length > 25_000) return;
  const chapterIds = new Set<string>();
  const questIds = new Set<string>();
  const chapters: QuestChapter[] = [];
  for (const rawChapter of data.chapters as unknown[]) {
    if (!isRecord(rawChapter)) return;
    const { id, title, quests } = rawChapter;
    if (!isFtbId(id) || chapterIds.has(id.toLowerCase()) || typeof title !== 'string' || title.length > 512
      || !Array.isArray(quests) || questIds.size + quests.length > 25_000) return;
    chapterIds.add(id.toLowerCase());
    const entries: Quest[] = [];
    for (const row of quests as unknown[]) {
      if (!isRecord(row)) return;
      const { id, title, description } = row;
      if (!isFtbId(id) || questIds.has(id.toLowerCase()) || typeof title !== 'string' || title.length > 512
        || typeof description !== 'string' || description.length > 16_384) return;
      questIds.add(id.toLowerCase());
      const position = readProgressPosition(row.x, row.y) ?? (isRecord(row.position)
        ? readProgressPosition(row.position.x, row.position.y) : undefined);
      const dependencyIds = Array.isArray(row.dependencyIds) ? [...new Set(row.dependencyIds
        .slice(0, 1024).filter(isFtbId).map(dependency => dependency.toLowerCase()))].filter(dependency => dependency !== id.toLowerCase()) : [];
      const tasks = readDetails(row.tasks);
      const rewards = readDetails(row.rewards, true);
      const icon = readQuestIcon(row);
      const fallbackItem = tasks?.find(task => task.iconItemId || task.itemId || task.iconImage);
      const fallbackId = fallbackItem?.iconItemId ?? fallbackItem?.itemId;
      const hiddenDependencyCount = typeof row.hiddenDependencyCount === 'number' && Number.isSafeInteger(row.hiddenDependencyCount)
        && row.hiddenDependencyCount > 0 && row.hiddenDependencyCount <= 25_000 ? row.hiddenDependencyCount : 0;
      entries.push({ id, title, description,
        ...(icon.iconImage || icon.iconItemId || !fallbackItem ? icon
          : { ...(fallbackId && { iconItemId: fallbackId }), ...(fallbackItem.iconImage && { iconImage: fallbackItem.iconImage }) }),
        ...(tasks && { tasks }), ...(rewards && { rewards }),
        ...(position && { position }),
        ...(dependencyIds.length > 0 && { dependencyIds }),
        ...(typeof row.minimumRequired === 'number' && Number.isSafeInteger(row.minimumRequired) && row.minimumRequired > 0
          && row.minimumRequired <= dependencyIds.length + hiddenDependencyCount && { minimumRequired: row.minimumRequired }),
        ...(hiddenDependencyCount > 0 && { hiddenDependencyCount }),
        ...(typeof row.size === 'number' && Number.isFinite(row.size) && row.size > 0 && { size: Math.min(row.size, 3) }),
        ...(typeof row.shape === 'string' && /^[a-z0-9_-]{1,32}$/.test(row.shape) && { shape: row.shape }),
        ...(row.hideDependencyLines === true && { hideDependencyLines: true }),
        ...(row.hideDependentLines === true && { hideDependentLines: true }),
      });
    }
    const group = readDetailEntry(rawChapter.group);
    const images = readDecorations(rawChapter.images);
    chapters.push({ id, title, quests: entries, ...readQuestIcon(rawChapter), ...(group && { group }), ...(images && { images }) });
  }
  if (data.total !== questIds.size) return;
  const canonical = new Map(chapters.flatMap(chapter => [chapter.id, ...chapter.quests.map(quest => quest.id)]
    .map(id => [id.toLowerCase(), id] as const)));
  for (const chapter of chapters) {
    for (const quest of chapter.quests) {
      if (!quest.dependencyIds) continue;
      quest.dependencyIds = quest.dependencyIds.flatMap(id => {
        const target = canonical.get(id);
        return target ? [target] : [];
      });
      if (quest.minimumRequired && quest.minimumRequired > quest.dependencyIds.length + (quest.hiddenDependencyCount ?? 0)) {
        delete quest.minimumRequired;
      }
      if (!quest.dependencyIds.length) delete quest.dependencyIds;
    }
  }
  const version = data.itemDetailVersion;
  return { total: questIds.size, chapters,
    ...((version === 2 || version === 3 || version === 4 || version === 5) && { itemDetailVersion: version }) };
}

export function readQuestCompletion(data: unknown, catalog: QuestCatalog) {
  if (!isRecord(data) || !Array.isArray(data.completedIds) || data.completed !== data.completedIds.length
    || data.completedIds.length > catalog.total) return;
  const visible = new Map(catalog.chapters.flatMap(chapter => chapter.quests.map(({ id }) => [id.toLowerCase(), id] as const)));
  const completedIds = new Set<string>();
  for (const id of data.completedIds as unknown[]) {
    const canonical = isFtbId(id) ? visible.get(id.toLowerCase()) : undefined;
    if (canonical === undefined || completedIds.has(canonical)) return;
    completedIds.add(canonical);
  }
  const completedAt: Record<string, number> = {};
  if (isRecord(data.completedAt)) {
    for (const [id, time] of Object.entries(data.completedAt)) {
      if (completedIds.has(id) && typeof time === 'number' && Number.isSafeInteger(time)
        && time > 0 && time <= 8.64e15) completedAt[id] = time;
    }
  }
  return { completed: completedIds.size, completedIds: Array.from(completedIds),
    ...(Object.keys(completedAt).length && { completedAt }) };
}

export function readQuestProgress(data: unknown, name: string): QuestProgress | undefined {
  if (!isRecord(data) || typeof data.player !== 'string' || data.player.toLowerCase() !== name.toLowerCase()) return;
  const catalog = readQuestCatalog(data);
  const completion = catalog && readQuestCompletion(data, catalog);
  if (catalog && completion) return { ...catalog, ...completion, player: data.player };
}
