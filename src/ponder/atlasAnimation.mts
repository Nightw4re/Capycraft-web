import { isRecord } from '../objectPatch.mts';
import { maxTextureSide, ponderResource } from './format.mts';

type Rect = [number, number, number, number];
type TimedFrame = [index: number, duration: number];
export type PonderAtlasCopy = { image: string; rect: Rect; source: Rect; frames: TimedFrame[]; interpolate?: true };

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function rect(value: unknown): value is Rect {
  return Array.isArray(value) && value.length === 4 && value.every((number, index) => integer(number, index < 2 ? 0 : 1, maxTextureSide));
}

function timedFrames(value: unknown): value is TimedFrame[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 4096 && value.every(frame =>
    Array.isArray(frame) && frame.length === 2 && integer(frame[0], 0, maxTextureSide ** 2 - 1) && integer(frame[1], 1, 32767));
}

export function readPonderAtlasAnimation(value: unknown): PonderAtlasCopy[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 4096) return;
  const copies: PonderAtlasCopy[] = [];
  for (const copy of value) {
    if (!isRecord(copy)) return;
    const { image, rect: target, source, frames, interpolate } = copy;
    if (typeof image !== 'string' || ponderResource(image)?.kind !== 'image' || !rect(target) || !rect(source)
      || !timedFrames(frames) || (interpolate !== undefined && interpolate !== true)
      || source[0] + target[2] > source[2] || source[1] + target[3] > source[3]) return;
    copies.push({ image, rect: target, source, frames, ...(interpolate && { interpolate }) });
  }
  return copies;
}

export function ponderAtlasFrameFits(copy: PonderAtlasCopy, sheetWidth: number, sheetHeight: number) {
  const columns = Math.floor(sheetWidth / copy.source[2]);
  const rows = Math.floor(sheetHeight / copy.source[3]);
  return copy.frames.every(([index]) => index < columns * rows);
}

export function ponderAtlasCopyFits(copy: PonderAtlasCopy, pageWidth: number, pageHeight: number) {
  const [x, y, width, height] = copy.rect;
  return x + width <= pageWidth && y + height <= pageHeight;
}

export type PonderAtlasPixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

export function samplePonderAtlasCopy(copy: PonderAtlasCopy, sheet: PonderAtlasPixels, tick: number) {
  const cycle = copy.frames.reduce((sum, [, duration]) => sum + duration, 0);
  let elapsed = Math.floor(Math.max(0, tick)) % cycle;
  let frame = 0;
  while (elapsed >= copy.frames[frame][1]) elapsed -= copy.frames[frame++][1];
  const [index, duration] = copy.frames[frame];
  const following = copy.frames[(frame + 1) % copy.frames.length][0];
  const [sourceX, sourceY, frameWidth, frameHeight] = copy.source;
  const [x, y, width, height] = copy.rect;
  const columns = Math.floor(sheet.width / frameWidth);
  const offset = (i: number) => 4 * (((Math.floor(i / columns) * frameHeight) + sourceY) * sheet.width
    + (i % columns) * frameWidth + sourceX);
  const start = offset(index), next = offset(following);
  const mix = copy.interpolate && following !== index && elapsed > 0;
  const currentWeight = 1 - elapsed / duration;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const source = start + row * sheet.width * 4;
    const target = row * width * 4;
    pixels.set(sheet.data.subarray(source, source + width * 4), target);
    if (mix) for (let lane = 0; lane < width * 4; lane++) {
      // Minecraft interpolates RGB and preserves the current frame's alpha.
      if (lane % 4 !== 3) pixels[target + lane] = currentWeight * pixels[target + lane]
        + (1 - currentWeight) * sheet.data[next + row * sheet.width * 4 + lane];
    }
  }
  return { x, y, width, height, pixels };
}
