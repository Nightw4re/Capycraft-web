import { ponderResource, type PonderTexture } from './format.mts';
import { isRecord } from '../objectPatch.mts';

type SpriteFrame = [image: string, duration: number];
export type SpriteAnimation = { frames: SpriteFrame[]; interpolate?: true };

export function readPonderSpriteAnimations(value: unknown): SpriteAnimation[] | undefined {
  if (!Array.isArray(value) || value.length > 4096) return;
  const animations: SpriteAnimation[] = [];
  for (const animation of value) {
    if (!isRecord(animation)) return;
    const frames = readPonderSpriteFrames(animation.frames);
    if (!frames || (animation.interpolate !== undefined && animation.interpolate !== true)) return;
    animations.push({ frames, ...(animation.interpolate && { interpolate: animation.interpolate }) });
  }
  return animations;
}

export function readPonderSpriteFrames(value: unknown): SpriteFrame[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > 128
    || value.some(frame => !Array.isArray(frame) || frame.length !== 2
      || typeof frame[0] !== 'string' || ponderResource(frame[0])?.kind !== 'image'
      || !Number.isInteger(frame[1]) || frame[1] < 1 || frame[1] > 32767)) return;
  return value;
}

export function ponderSpriteImage(image: string, frames: readonly SpriteFrame[] | undefined, tick: number,
  interpolate?: true): Pick<PonderTexture, 'image' | 'transition'> {
  if (!frames) return { image };
  const duration = frames.reduce((sum, [, length]) => sum + length, 0);
  let position = tick % duration;
  for (const [index, [frame, length]] of frames.entries()) {
    if (position < length) {
      const following = frames[(index + 1) % frames.length][0];
      return { image: frame, ...(interpolate && position > 0 && following !== frame
        && { transition: { image: following, weight: position / length } }) };
    }
    position -= length;
  }
  return { image };
}
