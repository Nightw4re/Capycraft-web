import { isRecord } from '../objectPatch.mts';
import { ponderResource, type PonderDraw, type PonderFrame, type PonderManifest } from './format.mts';
import { ponderFluidDraws, type FluidFace } from './fluidFaces.mts';
import { ponderSpriteImage, readPonderSpriteAnimations, readPonderSpriteFrames, type SpriteAnimation } from './spriteAnimation.mts';
import { ponderPlatformShadowDraw } from './platformShadow.mts';

const shaders = new Set(['rendertype_solid', 'rendertype_cutout', 'rendertype_cutout_mipped', 'rendertype_translucent']);
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const layoutLimit = 8192;

type BlockDraw = {
  shader: string; vertices: string; image: string; vertexCount: number; frames?: ReturnType<typeof readPonderSpriteFrames>; interpolate?: true;
  atlasAnimation?: string;
  animated?: true;
  spriteAnimation?: number;
  liquid?: true;
  liquidCenter?: [number, number, number];
};
type CompactGroup = {
  transform: number[];
  blocks: ([number, number, number, number] | [number, number, number, number, number, number, number])[];
  textureOffsets?: [number, number][];
};

export function readPonderBlockModels(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.models) || value.models.length > 32_768) return;
  const spriteAnimations = value.spriteAnimations === undefined ? [] : readPonderSpriteAnimations(value.spriteAnimations);
  if (!spriteAnimations) return;
  const models: BlockDraw[][] = [];
  for (const entry of value.models) {
    if (!Array.isArray(entry) || !entry.length || entry.length > 128) return;
    const model: BlockDraw[] = [];
    for (const draw of entry) {
      if (!isRecord(draw)) return;
      const { shader, vertices, image, vertexCount, spriteAnimation, atlasAnimation, animated, liquid, liquidCenter } = draw;
      if (typeof shader !== 'string' || !shaders.has(shader)
        || typeof vertices !== 'string' || ponderResource(vertices)?.kind !== 'mesh'
        || typeof image !== 'string' || ponderResource(image)?.kind !== 'image'
        || typeof vertexCount !== 'number' || !Number.isSafeInteger(vertexCount) || vertexCount < 4
        || vertexCount % 4 || vertexCount > 65_536) return;
      const frames = readPonderSpriteFrames(draw.frames);
      if (draw.frames !== undefined && !frames) return;
      if (draw.interpolate !== undefined && (draw.interpolate !== true || !frames)) return;
      if (liquid !== undefined && liquid !== true) return;
      if (liquidCenter !== undefined && (liquid !== true || shader !== 'rendertype_translucent'
        || !Array.isArray(liquidCenter) || liquidCenter.length !== 3
        || liquidCenter.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1))) return;
      if (spriteAnimation !== undefined && (typeof spriteAnimation !== 'number' || !Number.isInteger(spriteAnimation)
        || spriteAnimation < 0 || spriteAnimation >= spriteAnimations.length || frames)) return;
      if (atlasAnimation !== undefined && (typeof atlasAnimation !== 'string' || ponderResource(atlasAnimation)?.kind !== 'animation'
        || frames || spriteAnimation !== undefined)) return;
      if (animated !== undefined && animated !== true) return;
      model.push({ shader, vertices, image, vertexCount, ...(frames && { frames }),
        ...(draw.interpolate && { interpolate: draw.interpolate }),
        ...(atlasAnimation && { atlasAnimation }), ...(animated && { animated }),
        ...(typeof spriteAnimation === 'number' && { spriteAnimation }), ...(liquid && { liquid }),
        ...(liquidCenter !== undefined && { liquidCenter: liquidCenter as [number, number, number] }) });
    }
    models.push(model);
  }
  return { version: 1, models, ...(spriteAnimations.length && { spriteAnimations }) };
}

export function readPonderCompactLayout(value: unknown, models: readonly (readonly BlockDraw[])[]): CompactGroup[] | undefined {
  if (!Array.isArray(value) || value.length > 512) return;
  let blocks = 0;
  for (const group of value) {
    if (!isRecord(group) || !Array.isArray(group.transform) || group.transform.length !== 16
      || !group.transform.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e6)
      || !Array.isArray(group.blocks)) return;
    blocks += group.blocks.length;
    if (blocks > layoutLimit) return;
    for (const block of group.blocks) {
      if (!Array.isArray(block) || (block.length !== 4 && block.length !== 7) || !block.slice(0, 4).every(Number.isSafeInteger)
        || block.slice(0, 3).some(value => Math.abs(value) > 4096) || block[3] < -1 || block[3] >= models.length) return;
      if (block.length === 7 && block.slice(4).some(value => typeof value !== 'number' || !Number.isFinite(value)
        || Math.abs(value) > 16)) return;
    }
    if (group.textureOffsets !== undefined && (!Array.isArray(group.textureOffsets) || group.blocks.length !== 1
      || group.textureOffsets.length !== models[group.blocks[0][3]]?.length
      || group.textureOffsets.some(offset => !Array.isArray(offset) || offset.length !== 2
        || offset.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 16)))) return;
  }
  return value as CompactGroup[];
}

function multiply(left: Float32Array, right: number[]) {
  return Float32Array.from(right, (_, index) => {
    const row = index % 4;
    const column = index - row;
    return left[row] * right[column] + left[4 + row] * right[column + 1]
      + left[8 + row] * right[column + 2] + left[12 + row] * right[column + 3];
  });
}

export function compactPonderDraws(frame: PonderFrame, layout: CompactGroup[], models: BlockDraw[][],
  width: number, height: number, fluids: readonly FluidFace[] = [], tick = 0, shadow?: PonderManifest['platformShadow'],
  spriteAnimations: readonly SpriteAnimation[] = []) {
  const projection = Float32Array.of(2 / width, 0, 0, 0, 0, -2 / height, 0, 0, 0, 0, -1 / 4096, 0, -1, 1, 0, 1);
  const opaque: PonderDraw[] = [];
  const translucent: PonderDraw[] = [];
  const liquids: { depth: number; draw: PonderDraw }[] = [];
  let omitted = frame.omitted;
  for (const group of layout) {
    const pose = multiply(frame.sceneToGui, group.transform);
    for (const [x, y, z, model, dx = 0, dy = 0, dz = 0] of group.blocks) {
      const entries = models[model];
      if (!entries || opaque.length + translucent.length + liquids.length + entries.length > layoutLimit) {
        omitted++;
        continue;
      }
      const modelView = new Float32Array(pose);
      const px = x + dx, py = y + dy, pz = z + dz;
      for (let row = 0; row < 4; row++) modelView[12 + row] +=
        pose[row] * px + pose[4 + row] * py + pose[8 + row] * pz;
      for (const [index, entry] of entries.entries()) {
        const { shader, image, vertices, vertexCount, frames, interpolate, spriteAnimation, atlasAnimation, animated, liquid, liquidCenter } = entry;
        const blend = shader === 'rendertype_translucent';
        const animation = spriteAnimation === undefined ? undefined : spriteAnimations[spriteAnimation];
        const offset = group.textureOffsets?.[index];
        const textureMatrix = offset ? new Float32Array(identity) : identity;
        if (offset) textureMatrix.set(offset, 12);
        const draw: PonderDraw = {
          shader, vertices, vertexCount, indexCount: vertexCount / 4 * 6, mode: 'QUADS', stride: 24, projection, modelView,
          attributes: [
            { name: 'Position', offset: 0, type: 'FLOAT', count: 3 }, { name: 'Color', offset: 12, type: 'UBYTE', count: 4 },
            { name: 'UV0', offset: 16, type: 'FLOAT', count: 2 },
          ],
          textures: { 0: { ...ponderSpriteImage(image, animation?.frames ?? frames, tick, animation?.interpolate ?? interpolate),
            ...(atlasAnimation && { atlasAnimation }), ...(animated && { animated }),
            minFilter: 9728, magFilter: 9728, wrapS: 33071, wrapT: 33071 } },
          textureMatrix, color: Float32Array.of(1, 1, 1, 1), depthTest: true, depthFunction: 515,
          depthWrite: !blend, cull: true, blend, ...(blend && { blendFactors: [770, 771, 1, 771] }),
        };
        if (blend && liquid) {
          const [cx, cy, cz] = liquidCenter ?? [0.5, 0.5, 0.5];
          const depth = modelView[14] + modelView[2] * cx + modelView[6] * cy + modelView[10] * cz;
          liquids.push({ depth, draw });
        } else {
          (blend ? translucent : opaque).push(draw);
        }
      }
    }
  }
  translucent.sort((first, second) => first.modelView[14] - second.modelView[14]);
  const sceneDraws: PonderDraw[] = [];
  const overlays: PonderDraw[] = [];
  const overlayStart = frame.overlayStart ?? frame.draws.length;
  frame.draws.forEach((draw, index) => (index < overlayStart && draw.depthTest ? sceneDraws : overlays).push(draw));
  // Moving parts and tank contents must be drawn before the shared glass shell.
  const platform = shadow ? [ponderPlatformShadowDraw(shadow, frame.sceneToGui, projection)] : [];
  liquids.push(...ponderFluidDraws(fluids, projection, tick, spriteAnimations));
  liquids.sort((first, second) => first.depth - second.depth);
  const draws = [...opaque, ...sceneDraws, ...platform, ...liquids.map(({ draw }) => draw), ...translucent];
  return { ...frame, draws: [...draws, ...overlays], overlayStart: draws.length, omitted };
}
