// Minecraft's exported sprite sheets are non-interlaced, eight-bit RGBA PNGs.
export async function readPonderRgbaPixels(bytes: ArrayBuffer, width: number, height: number) {
  const header = new DataView(bytes);
  if (typeof DecompressionStream === 'undefined' || bytes.byteLength < 33
    || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
    || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452
    || header.getUint32(16) !== width || header.getUint32(20) !== height || width < 1 || width > 2048 || height < 1 || height > 2048
    || header.getUint8(24) !== 8 || header.getUint8(25) !== 6 || header.getUint8(26) || header.getUint8(27) || header.getUint8(28)) return;
  const fragments: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 33; offset + 12 <= bytes.byteLength;) {
    const size = header.getUint32(offset), type = header.getUint32(offset + 4);
    if (size > bytes.byteLength - offset - 12) return;
    if (type === 0x49454e44) break; // IEND
    if (type === 0x49444154) fragments.push(new Uint8Array(bytes, offset + 8, size)); // IDAT
    offset += size + 12;
  }
  if (!fragments.length) return;

  const stride = width * 4;
  const rows = new Uint8Array((stride + 1) * height);
  const reader = new Blob(fragments).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > rows.length - read) {
        await reader.cancel();
        return;
      }
      rows.set(value, read);
      read += value.byteLength;
    }
  } catch {
    return;
  } finally {
    reader.releaseLock();
  }
  if (read !== rows.length) return;
  const rgba = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1);
    const type = rows[start];
    const source = rows.subarray(start + 1, start + 1 + stride);
    const target = row * stride;
    if (type === 0) rgba.set(source, target);
    else if (type <= 4) {
      for (let column = 0; column < stride; column++) {
        const index = target + column;
        const left = column >= 4 ? rgba[index - 4] : 0;
        const up = row > 0 ? rgba[index - stride] : 0;
        const diagonal = row > 0 && column >= 4 ? rgba[index - stride - 4] : 0;
        const predictor = type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >>> 1 : paeth(left, up, diagonal);
        rgba[index] = source[column] + predictor;
      }
    } else return;
  }
  return new Uint8ClampedArray(rgba.buffer);
}

function paeth(left: number, up: number, diagonal: number) {
  const estimate = left + up - diagonal;
  const a = Math.abs(estimate - left), b = Math.abs(estimate - up), c = Math.abs(estimate - diagonal);
  return a <= b && a <= c ? left : b <= c ? up : diagonal;
}
