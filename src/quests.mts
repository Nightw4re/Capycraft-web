import { isRecord } from './objectPatch.mts';

export const questsPath = '/api/quests';
export type Quest = { id: string; title: string; description: string };
export type QuestChapter = { id: string; title: string; quests: Quest[] };
export type QuestCatalog = { total: number; chapters: QuestChapter[] };
export type QuestProgress = QuestCatalog & { player: string; completed: number; completedIds: string[] };

function isFtbId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{1,16}$/i.test(id);
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
      entries.push({ id, title, description });
    }
    chapters.push({ id, title, quests: entries });
  }
  if (data.total === questIds.size) return { total: questIds.size, chapters };
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
  return { completed: completedIds.size, completedIds: Array.from(completedIds) };
}

export function readQuestProgress(data: unknown, name: string): QuestProgress | undefined {
  if (!isRecord(data) || typeof data.player !== 'string' || data.player.toLowerCase() !== name.toLowerCase()) return;
  const catalog = readQuestCatalog(data);
  const completion = catalog && readQuestCompletion(data, catalog);
  if (catalog && completion) return { ...catalog, ...completion, player: data.player };
}
