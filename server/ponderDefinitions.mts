import { isItemId } from '../src/items/itemRoutes.mts';
import { isRecord } from '../src/objectPatch.mts';
import type { PonderGuide } from '../src/ponder/guides.mts';
import { ponderPlaybackChunkTicks, readPonderIndex } from '../src/ponder/format.mts';

export const ponderDefinitionsPath = 'ponder/definitions.json';
export const ponderDefinitionsLimit = 32 * 1024 ** 2;
export const ponderSchematicLimit = 16 * 1024 ** 2;
const schematicPath = /^ponder\/schematics\/([a-f0-9]{64})\.nbt$/;
const timelinePath = /^ponder\/scenes\/[a-f0-9]{64}\/timeline\/(0|[1-9][0-9]{0,4})\.json$/;
export const ponderTimelineChunkTicks = ponderPlaybackChunkTicks;
export const isPonderTimelinePath = (path: string) => timelinePath.test(path);
export const ponderSchematicHash = (path: string) => schematicPath.exec(path)?.[1];

function text(value: unknown, limit = 4096): value is string {
  return typeof value === 'string' && value.length <= limit;
}

function id(value: unknown): value is string {
  return text(value, 512) && isItemId(value);
}

function limitedArray(value: unknown, limit: number): value is unknown[] {
  return Array.isArray(value) && value.length <= limit;
}

function caption(value: unknown) {
  return isRecord(value)
    && (value.text === undefined || text(value.text, 16_384))
    && (value.textError === undefined || text(value.textError, 256))
    && Number.isSafeInteger(value.color) && Number.isSafeInteger(value.y) && typeof value.nearTarget === 'boolean'
    && (value.anchor === undefined || (Array.isArray(value.anchor) && value.anchor.length === 3
      && value.anchor.every(Number.isFinite)));
}

function instruction(value: unknown) {
  return isRecord(value) && text(value.type, 512) && typeof value.blocking === 'boolean'
    && (value.durationTicks === undefined || (typeof value.durationTicks === 'number'
      && Number.isSafeInteger(value.durationTicks) && value.durationTicks >= 0))
    && (value.caption === undefined || caption(value.caption));
}

function scene(value: unknown) {
  return isRecord(value) && id(value.id) && text(value.title)
    && Number.isFinite(value.scale) && Number.isFinite(value.yOffset)
    && Number.isSafeInteger(value.basePlateSize) && Number.isSafeInteger(value.basePlateOffsetX)
    && Number.isSafeInteger(value.basePlateOffsetZ) && typeof value.hidePlatformShadow === 'boolean'
    && isRecord(value.text) && Object.entries(value.text).every(([key, item]) => /^text_[1-9][0-9]*$/.test(key) && text(item, 16_384))
    && limitedArray(value.instructions, 25_000) && value.instructions.every(instruction);
}

function registeredScene(entry: Record<string, unknown>, scenes: unknown[] | undefined) {
  const reference = entry.scene;
  if (typeof reference !== 'number') return reference;
  if (scenes && Number.isSafeInteger(reference) && reference >= 0 && reference < scenes.length) return scenes[reference];
}

export function readPonderDefinitions(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || !text(value.locale, 32)
    || typeof value.ticksPerSecond !== 'number' || !Number.isSafeInteger(value.ticksPerSecond)
    || value.ticksPerSecond < 1 || value.ticksPerSecond > 60
    || !limitedArray(value.registrations, 25_000)) return;
  const definitions = value.sceneDefinitions;
  if (definitions !== undefined && (!limitedArray(definitions, 25_000) || !definitions.every(scene))) return;
  const schematics = new Map<string, string>();
  const playback = value.playback === undefined ? undefined : readPonderIndex(value.playback);
  if (value.playback !== undefined && (!playback || !playback.scenes.length || playback.locale !== value.locale)) return;
  const registered = new Map<string, Map<string, number>>();
  for (const entry of value.registrations) {
    if (!isRecord(entry) || !text(entry.namespace, 128) || !id(entry.item) || !id(entry.schematic)
      || !limitedArray(entry.tags, 1024) || !entry.tags.every(id)
      || !limitedArray(entry.ordering, 1024)
      || !entry.ordering.every(order => isRecord(order) && text(order.type, 32) && id(order.scene))
      || (entry.schematicError !== undefined && !text(entry.schematicError, 256))) return;
    const compiled = registeredScene(entry, definitions);
    if (entry.scene === undefined ? !text(entry.compileError, 256)
      : typeof entry.scene === 'number' ? compiled === undefined : !scene(compiled)) return;
    if (playback) {
      if (!isRecord(compiled)) return;
      const key = JSON.stringify([compiled.id, entry.schematic]);
      let scenes = registered.get(entry.item);
      if (!scenes) {
        scenes = new Map();
        registered.set(entry.item, scenes);
      }
      if (!scenes.has(key)) scenes.set(key, scenes.size);
    }
    if (entry.schematicFile !== undefined) {
      const hash = text(entry.schematicFile, 96) && ponderSchematicHash(entry.schematicFile);
      if (!hash || typeof entry.schematicFile !== 'string') return;
      schematics.set(entry.schematicFile, hash);
    }
  }
  if (playback) {
    const scenes = new Set<string>();
    const ordered = [];
    for (const entry of playback.scenes) {
      const scene = JSON.stringify([entry.id, entry.schematic]);
      if (scenes.has(scene) || !entry.items.length) return;
      scenes.add(scene);
      const itemOrder = [];
      for (const item of entry.items) {
        const registrations = registered.get(item);
        const order = registrations?.get(scene);
        if (registrations === undefined || order === undefined) return;
        itemOrder.push(order);
        registrations.delete(scene);
        if (!registrations.size) registered.delete(item);
      }
      ordered.push({ ...entry, itemOrder });
    }
    if (registered.size) return;
    return { registrations: value.registrations.length, schematics, playback: { ...playback, scenes: ordered } };
  }
  return { registrations: value.registrations.length, schematics, playback };
}

export function ponderGuides(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || !limitedArray(value.registrations, 25_000)) return;
  const definitions = limitedArray(value.sceneDefinitions, 25_000) ? value.sceneDefinitions : undefined;
  const guides = new Map<string, Omit<PonderGuide, 'items'> & { items: Set<string> }>();
  for (const entry of value.registrations) {
    if (!isRecord(entry) || !id(entry.item) || !id(entry.schematic)) continue;
    const compiled = registeredScene(entry, definitions);
    if (!isRecord(compiled) || !id(compiled.id) || !text(compiled.title) || !limitedArray(compiled.instructions, 25_000)) continue;
    const steps: string[] = [];
    for (const instruction of compiled.instructions) {
      if (!isRecord(instruction) || !isRecord(instruction.caption)) continue;
      const caption = instruction.caption.text;
      if (text(caption, 16_384) && caption.trim()) steps.push(caption);
    }
    if (!steps.length) continue;
    const { id: sceneId, title } = compiled;
    const key = JSON.stringify([sceneId, entry.schematic, title, steps]);
    const guide = guides.get(key);
    if (guide) guide.items.add(entry.item);
    else guides.set(key, { id: sceneId, title, schematic: entry.schematic, items: new Set([entry.item]), steps });
  }
  return { version: 1, guides: Array.from(guides.values(), guide => ({ ...guide, items: [...guide.items] })) };
}
