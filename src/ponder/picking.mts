import { isItemId } from '../items/itemRoutes.mts';
import { isRecord } from '../objectPatch.mts';

type Point2 = [number, number];
type Point3 = [number, number, number];
type BlockBox = [number, number, number, number, number, number];

export type PonderPickingBlock = { position: Point3; block: string; item?: string; boxes: BlockBox[] };
export type PonderPickingGroup = { transform: Float32Array; blocks: PonderPickingBlock[] };
export type PonderBlockHit = {
  block: string; item?: string; position: Point3; depth: number; outline: Point2[];
};

export const maxPonderPickingGroups = 256;
export const maxPonderPickingBlocks = 32_768;
export const maxPonderPickingBoxes = 65_536;
const maxBoxesPerBlock = 512;

function boundedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
}

function tuple(data: unknown, length: number): data is number[] {
  if (!Array.isArray(data) || data.length !== length) return false;
  for (let i = 0; i < length; i++) if (!boundedNumber(data[i])) return false;
  return true;
}

function registryId(data: unknown): data is string {
  return typeof data === 'string' && data.length <= 512 && isItemId(data)
    && data.slice(data.indexOf(':') + 1).split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function affine(matrix: ArrayLike<number>) {
  if (matrix.length !== 16 || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) return false;
  for (let i = 0; i < matrix.length; i++) if (!boundedNumber(matrix[i])) return false;
  return true;
}

export function readPonderPickingTransform(value: unknown) {
  if (tuple(value, 16) && affine(value)) return new Float32Array(value);
}

export function readPonderPickingBlock(entry: unknown): PonderPickingBlock | undefined {
  if (!isRecord(entry)) return;
  const { position, block, item, boxes } = entry;
  if (!registryId(block) || (item !== undefined && !registryId(item)) || !tuple(position, 3)
    || !position.every(Number.isSafeInteger) || !Array.isArray(boxes) || boxes.length === 0
    || boxes.length > maxBoxesPerBlock) return;
  const bounds: BlockBox[] = [];
  for (const box of boxes) {
    if (!tuple(box, 6) || box[0] >= box[3] || box[1] >= box[4] || box[2] >= box[5]) return;
    bounds.push([box[0], box[1], box[2], box[3], box[4], box[5]]);
  }
  return { position: [position[0], position[1], position[2]], block, ...(item && { item }), boxes: bounds };
}

export function readPonderPicking(data: unknown): PonderPickingGroup[] | undefined {
  if (!Array.isArray(data) || data.length > maxPonderPickingGroups) return;
  const groups: PonderPickingGroup[] = [];
  let blockCount = 0;
  let boxCount = 0;
  for (const group of data) {
    if (!isRecord(group) || !Array.isArray(group.blocks) || blockCount + group.blocks.length > maxPonderPickingBlocks) return;
    const transform = readPonderPickingTransform(group.transform);
    if (!transform) return;
    blockCount += group.blocks.length;
    const blocks: PonderPickingBlock[] = [];
    for (const entry of group.blocks) {
      const block = readPonderPickingBlock(entry);
      if (!block || boxCount + block.boxes.length > maxPonderPickingBoxes) return;
      boxCount += block.boxes.length;
      blocks.push(block);
    }
    groups.push({ transform, blocks });
  }
  return groups;
}

function composeAffine(camera: ArrayLike<number>, section: Float32Array) {
  // JOML stores columns consecutively. The section pose transforms local positions before the camera.
  const result = new Float64Array(16);
  for (let column = 0; column < 16; column += 4) {
    const x = section[column], y = section[column + 1], z = section[column + 2], w = section[column + 3];
    for (let row = 0; row < 3; row++) {
      result[column + row] = camera[row] * x + camera[4 + row] * y + camera[8 + row] * z + camera[12 + row] * w;
    }
  }
  result[15] = 1;
  return result;
}

function localRay(matrix: Float64Array, x: number, y: number): { zero: Point3; direction: Point3 } | undefined {
  const a = matrix[0], b = matrix[4], c = matrix[8];
  const d = matrix[1], e = matrix[5], f = matrix[9];
  const g = matrix[2], h = matrix[6], i = matrix[10];
  const r0 = e * i - f * h, r1 = c * h - b * i, r2 = b * f - c * e;
  const r3 = f * g - d * i, r4 = a * i - c * g, r5 = c * d - a * f;
  const r6 = d * h - e * g, r7 = b * g - a * h, r8 = a * e - b * d;
  const determinant = a * r0 + b * r3 + c * r6;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), Math.abs(e), Math.abs(f),
    Math.abs(g), Math.abs(h), Math.abs(i));
  if (!scale || Math.abs(determinant) <= Number.EPSILON * scale ** 3) return;
  const u = x - matrix[12], v = y - matrix[13], w = -matrix[14];
  // The unprojected ray is parameterized by GUI depth, so hits in different sections remain comparable.
  return {
    zero: [(r0 * u + r1 * v + r2 * w) / determinant,
      (r3 * u + r4 * v + r5 * w) / determinant, (r6 * u + r7 * v + r8 * w) / determinant],
    direction: [r2 / determinant, r5 / determinant, r8 / determinant],
  };
}

function entryDepth(zero: Point3, direction: Point3, position: Point3, box: BlockBox) {
  // PonderUI clips the ray from GUI z = 1000 toward z = -100.
  let back = -100;
  let front = 1000;
  for (let axis = 0; axis < 3; axis++) {
    const offset = zero[axis] - position[axis];
    const step = direction[axis], min = box[axis], max = box[axis + 3];
    if (step === 0) {
      if (offset < min || offset > max) return;
    } else {
      const start = (min - offset) / step, end = (max - offset) / step;
      back = Math.max(back, Math.min(start, end));
      front = Math.min(front, Math.max(start, end));
      if (front < back) return;
    }
  }
  return front;
}

function turn(a: Point2, b: Point2, c: Point2) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function halfHull(points: Point2[]) {
  const hull: Point2[] = [];
  for (const point of points) {
    while (hull.length >= 2 && turn(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
    hull.push(point);
  }
  return hull.slice(0, -1);
}

function projectedOutline(matrix: Float64Array, block: PonderPickingBlock): Point2[] {
  const points: Point2[] = [];
  for (const box of block.boxes) {
    for (const x of [box[0] + block.position[0], box[3] + block.position[0]]) {
      for (const y of [box[1] + block.position[1], box[4] + block.position[1]]) {
        for (const z of [box[2] + block.position[2], box[5] + block.position[2]]) {
          points.push([matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
            matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]]);
        }
      }
    }
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = halfHull(points);
  const upper = halfHull(points.reverse());
  return [...lower, ...upper];
}

/** Picks the nearest visible outline shape if it is selectable. */
export function pickPonderBlock(frameMatrix: ArrayLike<number>, groups: readonly PonderPickingGroup[],
  x: number, y: number, selectable?: (block: PonderPickingBlock) => boolean): PonderBlockHit | undefined {
  if (!boundedNumber(x) || !boundedNumber(y) || !affine(frameMatrix)) return;
  let hit: { block: PonderPickingBlock; matrix: Float64Array; depth: number } | undefined;
  for (const group of groups) {
    const matrix = composeAffine(frameMatrix, group.transform);
    const ray = localRay(matrix, x, y);
    if (!ray) continue;
    for (const block of group.blocks) {
      for (const box of block.boxes) {
        const depth = entryDepth(ray.zero, ray.direction, block.position, box);
        if (depth !== undefined && (!hit || depth > hit.depth)) hit = { block, matrix, depth };
      }
    }
  }
  if (hit && (!selectable || selectable(hit.block))) return { block: hit.block.block, item: hit.block.item, position: hit.block.position,
    depth: hit.depth, outline: projectedOutline(hit.matrix, hit.block) };
}
