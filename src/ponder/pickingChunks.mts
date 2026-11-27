import { isRecord } from '../objectPatch.mts';
import { ponderPickingChunkTicks } from './format.mts';
import { maxPonderPickingBlocks, maxPonderPickingBoxes, maxPonderPickingGroups, readPonderPickingBlock, readPonderPickingTransform, type PonderPickingBlock,
  type PonderPickingGroup } from './picking.mts';

type Shape = Omit<PonderPickingBlock, 'position'>;
type Placement = [...PonderPickingBlock['position'], number];
type Group = { transform: number[]; blocks: number[] };
type GroupChange = [number, { transform?: number[]; length?: number; blocks?: [number, number][] }];
type FrameChange = [number, number, GroupChange[]];

function palette<T>() {
  const ids = new Map<string, number>();
  const values: T[] = [];
  return { values, add(value: T) {
    const key = JSON.stringify(value);
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    const id = values.length;
    ids.set(key, id);
    values.push(value);
    return id;
  } };
}

export function createPonderPickingChunk() {
  const shapes = palette<Shape>();
  const placements = palette<Placement>();
  const frames: FrameChange[] = [];
  let previous: Group[] = [];
  return {
    append(offset: number, groups: readonly PonderPickingGroup[]) {
      // Keep the captured order, which breaks ties when two outlines have the same depth.
      const next = groups.map(({ transform, blocks }) => ({ transform: Array.from(transform),
        blocks: blocks.map(({ position, ...shape }) => placements.add([...position, shapes.add(shape)])),
      }));
      const changes: GroupChange[] = [];
      for (const [index, group] of next.entries()) {
        const before = previous[index];
        const patch: GroupChange[1] = {};
        if (group.transform.some((value, i) => value !== before?.transform[i])) patch.transform = group.transform;
        if (group.blocks.length !== before?.blocks.length) patch.length = group.blocks.length;
        const edits: [number, number][] = [];
        for (const [slot, id] of group.blocks.entries()) {
          if (before?.blocks[slot] !== id) edits.push([slot, id]);
        }
        if (edits.length) patch.blocks = edits;
        if (Object.keys(patch).length) changes.push([index, patch]);
      }
      if (changes.length || next.length !== previous.length) frames.push([offset, next.length, changes]);
      previous = next;
    },
    document() { return { shapes: shapes.values, placements: placements.values, frames }; },
  };
}

function index(value: unknown, end: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < end;
}

function decodePickingChunk(data: unknown, offset: number, snapshot?: PonderPickingGroup[]) {
  if (!isRecord(data) || !Array.isArray(data.shapes) || !Array.isArray(data.placements) || !Array.isArray(data.frames)
    || data.frames.length > ponderPickingChunkTicks || !index(offset, ponderPickingChunkTicks)) return;
  const groups: { transform?: Float32Array; blocks: number[] }[] = [];
  const shapes = data.shapes;
  const placements = data.placements;
  const decoded = new Map<number, PonderPickingBlock>();
  function inspectGroups() {
    let blockCount = 0;
    let boxCount = 0;
    for (const group of groups) {
      if (!group?.transform) return false;
      blockCount += group.blocks.length;
      if (blockCount > maxPonderPickingBlocks) return false;
      const blocks: PonderPickingBlock[] | undefined = snapshot ? [] : undefined;
      for (const id of group.blocks) {
        let block = decoded.get(id);
        if (!block) {
          const placement: unknown = placements[id];
          if (!Array.isArray(placement) || placement.length !== 4 || !index(placement[3], shapes.length)) return false;
          const shape: unknown = shapes[placement[3]];
          if (!isRecord(shape)) return false;
          block = readPonderPickingBlock({ ...shape, position: placement.slice(0, 3) });
          if (!block) return false;
          decoded.set(id, block);
        }
        boxCount += block.boxes.length;
        if (boxCount > maxPonderPickingBoxes) return false;
        blocks?.push(block);
      }
      if (snapshot && blocks) snapshot.push({ transform: group.transform, blocks });
    }
    return true;
  }
  let last = -1;
  for (const entry of data.frames) {
    if (!Array.isArray(entry) || entry.length !== 3) return;
    const [tick, count, changes] = entry;
    if (!index(tick, ponderPickingChunkTicks) || tick <= last || !index(count, maxPonderPickingGroups + 1) || !Array.isArray(changes)
      || changes.length > count) return;
    if (tick > offset) return snapshot ? inspectGroups() : false;
    last = tick;
    groups.length = count;
    for (const change of changes) {
      if (!Array.isArray(change) || change.length !== 2 || !index(change[0], count) || !isRecord(change[1])) return;
      const [slot, patch] = change;
      const group = groups[slot] ??= { blocks: [] };
      if (patch.transform !== undefined) group.transform = readPonderPickingTransform(patch.transform);
      if (patch.length !== undefined) {
        if (!index(patch.length, maxPonderPickingBlocks + 1)) return;
        group.blocks.length = patch.length;
      }
      if (patch.blocks !== undefined) {
        if (!Array.isArray(patch.blocks) || patch.blocks.length > group.blocks.length) return;
        for (const edit of patch.blocks) {
          if (!Array.isArray(edit) || edit.length !== 2 || !index(edit[0], group.blocks.length)
            || !index(edit[1], data.placements.length)) return;
          group.blocks[edit[0]] = edit[1];
        }
      }
    }
    if (!snapshot && !inspectGroups()) return false;
  }
  return !snapshot || inspectGroups();
}

export function readPonderPickingChunk(data: unknown, offset: number) {
  const snapshot: PonderPickingGroup[] = [];
  if (decodePickingChunk(data, offset, snapshot)) return snapshot;
}

/** Validates every intermediate snapshot with one pass over the changes. */
export function validatePonderPickingChunk(data: unknown, lastOffset: number) {
  return decodePickingChunk(data, lastOffset) === true;
}
