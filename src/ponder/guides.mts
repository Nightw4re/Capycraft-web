import { isRecord } from '../objectPatch.mts';
import type { PonderScene } from './format.mts';

export type PonderGuide = { id: string; title: string; schematic: string; items: string[]; steps: string[] };
export type PonderChoice = PonderScene | PonderGuide;
export const ponderGuideIndexLimit = 4 * 1024 ** 2;

export function ponderItemOrder(scene: PonderChoice, itemId: string) {
  return 'itemOrder' in scene ? scene.itemOrder?.[scene.items.indexOf(itemId)] : undefined;
}

export function indexItemPonderChoices(scenes: readonly PonderScene[], guides: readonly PonderGuide[]) {
  const items = new Map<string, PonderChoice[]>();
  for (const scene of [...scenes, ...guides]) {
    for (const id of new Set(scene.items)) {
      const matches = items.get(id);
      if (!matches) items.set(id, [scene]);
      else if (!matches.some(match => match.id === scene.id && match.schematic === scene.schematic)) matches.push(scene);
    }
  }
  for (const [itemId, choices] of items) {
    choices.sort((left, right) => (ponderItemOrder(left, itemId) ?? Number.MAX_SAFE_INTEGER)
      - (ponderItemOrder(right, itemId) ?? Number.MAX_SAFE_INTEGER));
  }
  return items;
}

export function readPonderGuideIndex(data: unknown): PonderGuide[] | undefined {
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.guides) || data.guides.length > 25_000) return;
  const guides: PonderGuide[] = [];
  for (const entry of data.guides) {
    if (!isRecord(entry)) return;
    const { id, title, schematic, items, steps } = entry;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof schematic !== 'string'
      || !Array.isArray(items) || !items.length || !items.every(item => typeof item === 'string')
      || !Array.isArray(steps) || !steps.length || !steps.every(step => typeof step === 'string' && step.trim())) return;
    guides.push({ id, title, schematic, items, steps });
  }
  return guides;
}
