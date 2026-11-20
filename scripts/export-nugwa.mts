import { writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { createPortraitAnimation } from '../src/portrait/portraitAnimation';
import { stageHeight, stageWidth } from '../src/portrait/portraitScene';
import { createPortraitRenderer } from '../src/portrait/renderPortrait';
import { readSkin, resolvePortraitCast, writePortraitCast } from './portrait-cast.mts';

type Region = { left: number; top: number; width: number; height: number };

function chunk(type: string, data: Buffer) {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 'ascii');
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
}

function imageData(png: Buffer) {
  const data = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat(data);
}

function changedRegion(previous: Uint32Array, current: Uint32Array): Region | undefined {
  let left = stageWidth;
  let top = stageHeight;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < current.length; index++) {
    if (previous[index] === current[index]) continue;
    const x = index % stageWidth;
    const y = Math.floor(index / stageWidth);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = y;
  }
  if (right < left) return;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function frameControl(sequence: number, { left, top, width, height }: Region, duration: number) {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(width, 4);
  data.writeUInt32BE(height, 8);
  data.writeUInt32BE(left, 12);
  data.writeUInt32BE(top, 16);
  data.writeUInt16BE(duration, 20);
  data.writeUInt16BE(1000, 22);
  // Both operations are zero. Keep the previous frame and replace all pixels in this region, including transparent ones.
  return chunk('fcTL', data);
}

const players = await resolvePortraitCast(process.argv.includes('--refresh-skins'));
const skins = new Map(await Promise.all(players.map(async player => [player.name, await readSkin(player)] as const)));
const portraitFrames = createPortraitAnimation(players.map(player => player.name));
const render = createPortraitRenderer(skins);
const raster = { width: stageWidth, height: stageHeight, data: new Uint8ClampedArray(stageWidth * stageHeight * 4) };
const bytes = Buffer.from(raster.data.buffer);
const current = new Uint32Array(raster.data.buffer);
const previous = new Uint32Array(current.length);
const fullStage = { left: 0, top: 0, width: stageWidth, height: stageHeight };

function encode(region: Region) {
  return sharp(bytes, { raw: { width: stageWidth, height: stageHeight, channels: 4 } })
    .extract(region).png({ adaptiveFiltering: true }).toBuffer();
}

const [first, ...animation] = portraitFrames;
render(first.frame, raster);
const still = await encode(fullStage);
previous.set(current);
const frames = [{ region: fullStage, duration: first.duration, data: imageData(still) }];

for (const { frame, duration } of animation) {
  render(frame, raster);
  const region = changedRegion(previous, current);
  if (!region) {
    frames[frames.length - 1].duration += duration;
    continue;
  }
  const png = await encode(region);
  frames.push({ region, duration, data: imageData(png) });
  previous.set(current);
}

const animationControl = Buffer.alloc(8);
animationControl.writeUInt32BE(frames.length, 0);
const chunks = [still.subarray(0, 33), chunk('acTL', animationControl)];
let sequence = 0;
for (const { region, duration, data } of frames) {
  chunks.push(frameControl(sequence++, region, duration));
  if (sequence === 1) {
    chunks.push(chunk('IDAT', data));
  } else {
    const frame = Buffer.alloc(data.length + 4);
    frame.writeUInt32BE(sequence++, 0);
    data.copy(frame, 4);
    chunks.push(chunk('fdAT', frame));
  }
}
chunks.push(chunk('IEND', Buffer.alloc(0)));

await Promise.all([
  writeFile(new URL('../assets/nugwa-seated.png', import.meta.url), still),
  writeFile(new URL('../assets/nugwa-animated.png', import.meta.url), Buffer.concat(chunks)),
]);
await writePortraitCast(players);
