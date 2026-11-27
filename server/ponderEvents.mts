import { isRecord } from '../src/objectPatch.mts';

const blockState = /^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[[a-z0-9_.-]+=[a-z0-9_.-]+(?:,[a-z0-9_.-]+=[a-z0-9_.-]+)*\])?$/;
const trackId = /^(0|[1-9][0-9]{0,8})$/;
const effectKinds = new Set(['entity', 'block_entity', 'particle', 'outline']);
const rigidShaders = new Set(['rendertype_solid', 'rendertype_cutout', 'rendertype_cutout_mipped']);

function vector(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size
    && value.every(part => typeof part === 'number' && Number.isFinite(part) && Math.abs(part) <= 1e9);
}

function position(value: unknown): value is number[] {
  return vector(value, 3) && value.every(Number.isSafeInteger);
}

function readSection(value: Record<string, unknown>) {
  return Object.keys(value).every(key => ['positions', 'transform', 'fade'].includes(key))
    && Array.isArray(value.positions) && value.positions.length <= 1_000_000 && value.positions.every(position)
    && vector(value.transform, 16) && typeof value.fade === 'number' && Number.isFinite(value.fade);
}

function readEffect(value: Record<string, unknown>) {
  return Object.keys(value).every(key => ['kind', 'type', 'position', 'rotation', 'bounds', 'remainingTicks', 'start', 'end',
    'color', 'lineWidth', 'data', 'dataError'].includes(key))
    && typeof value.kind === 'string' && effectKinds.has(value.kind)
    && typeof value.type === 'string' && value.type.length > 0 && value.type.length <= 512
    && (value.bounds === undefined || vector(value.bounds, 6))
    && (value.start === undefined || vector(value.start, 3)) && (value.end === undefined || vector(value.end, 3))
    && (value.remainingTicks === undefined || Number.isSafeInteger(value.remainingTicks))
    && (value.position === undefined ? value.kind !== 'entity' : vector(value.position, 3))
    && (value.rotation === undefined ? value.kind !== 'entity' : vector(value.rotation, 2))
    && (value.kind !== 'block_entity' || position(value.position))
    && (value.color === undefined || vector(value.color, 4))
    && (value.lineWidth === undefined || (typeof value.lineWidth === 'number' && Number.isFinite(value.lineWidth) && value.lineWidth >= 0))
    && (value.data === undefined || (typeof value.data === 'string' && value.data.length <= 65_536))
    && (value.dataError === undefined || (typeof value.dataError === 'string' && value.dataError.length <= 256))
    && (value.kind !== 'particle' || vector(value.bounds, 6));
}

export function createPonderEventState() {
  const blocks = new Map<string, string>();
  const sections = new Map<string, Record<string, unknown>>();
  const effects = new Map<string, Record<string, unknown>>();

  function applyTrack(value: unknown, track: typeof sections, read: typeof readSection) {
    if (value === undefined) return true;
    if (!isRecord(value)) return false;
    for (const [key, patch] of Object.entries(value)) {
      if (!trackId.test(key)) return false;
      if (patch === null) {
        if (!track.delete(key)) return false;
      } else {
        if (!isRecord(patch)) return false;
        const next = { ...track.get(key), ...patch };
        for (const field of Object.keys(patch)) if (patch[field] === null) delete next[field];
        if (!read(next)) return false;
        track.set(key, next);
      }
    }
    return track.size <= 100_000;
  }

  return {
    apply(value: unknown) {
      if (!isRecord(value) || Object.keys(value).some(key => !['blocks', 'sections', 'effects'].includes(key))) return false;
      if (value.blocks !== undefined) {
        if (!Array.isArray(value.blocks) || value.blocks.length > 1_000_000) return false;
        for (const change of value.blocks) {
          if (!Array.isArray(change) || change.length !== 4 || !position(change.slice(0, 3))) return false;
          const id = change.slice(0, 3).join(',');
          const state = change[3];
          if (state === null) {
            if (!blocks.delete(id)) return false;
          } else {
            if (typeof state !== 'string' || state.length > 4096 || !blockState.test(state)) return false;
            blocks.set(id, state);
          }
        }
      }
      return blocks.size <= 1_000_000 && applyTrack(value.sections, sections, readSection)
        && applyTrack(value.effects, effects, readEffect);
    },
  };
}

export function applyPonderSceneOffset(draws: unknown, offset: unknown) {
  if (offset === undefined) return true;
  if (!vector(offset, 3) || !Array.isArray(draws)) return false;
  if (offset.every(value => value === 0)) return true;
  const [x, y, z] = offset;
  let moved = false;
  for (const draw of draws) {
    if (!isRecord(draw)) return false;
    if (draw.shader === 'rendertype_gui') continue;
    if (typeof draw.shader !== 'string' || !rigidShaders.has(draw.shader) || draw.blend !== false
      || !vector(draw.modelView, 16)) return false;
    for (let row = 0; row < 4; row++) {
      draw.modelView[12 + row] += draw.modelView[row] * x + draw.modelView[4 + row] * y + draw.modelView[8 + row] * z;
    }
    moved = true;
  }
  return moved;
}

function affine(value: unknown): value is number[] {
  if (!vector(value, 16) || [value[3], value[7], value[11], value[15] - 1].some(part => Math.abs(part) > 1e-6)) return false;
  const [a, b, c, , d, e, f, , g, h, i] = value;
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  return determinant > 1e-6 && determinant < 1e6;
}

export function applyPonderSceneTransform(draws: unknown, transform: unknown) {
  if (transform === undefined || transform === null) return true;
  if (!isRecord(transform) || !affine(transform.blocks) || !affine(transform.shadow) || !Array.isArray(draws)) return false;
  let transformedBlocks = false;
  for (const draw of draws) {
    if (!isRecord(draw) || !vector(draw.modelView, 16)) return false;
    const shadow = draw.shader === 'rendertype_gui';
    if (!shadow && (typeof draw.shader !== 'string' || !rigidShaders.has(draw.shader) || draw.blend !== false)) return false;
    const motion = shadow ? transform.shadow : transform.blocks;
    const matrix = draw.modelView;
    draw.modelView = motion.map((_, i) => {
      const row = i % 4;
      const column = i - row;
      return matrix[row] * motion[column] + matrix[row + 4] * motion[column + 1]
        + matrix[row + 8] * motion[column + 2] + matrix[row + 12] * motion[column + 3];
    });
    transformedBlocks ||= !shadow;
  }
  return transformedBlocks;
}
