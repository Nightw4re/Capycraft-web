import { ponderAtlasCopyFits, ponderAtlasFrameFits, readPonderAtlasAnimation, samplePonderAtlasCopy,
  type PonderAtlasCopy, type PonderAtlasPixels } from './atlasAnimation.mts';
import { ponderResource } from './format.mts';
import { readPonderRgbaPixels } from './atlasPixels.mts';

type ReadAsset = (path: string) => Promise<ArrayBuffer>;
export const ponderAtlasTextureKey = (image: string, animation?: string) => animation ? `${image}:${animation}` : image;

function readWebGlSheet(gl: WebGL2RenderingContext, bitmap: ImageBitmap): PonderAtlasPixels {
  const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const boundFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  const { width, height } = bitmap;
  try {
    if (!texture || !framebuffer) throw new Error('Ponder atlas readback is unavailable');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete Ponder atlas readback');
    const data = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { width, height, data };
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, boundFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, boundTexture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  }
}

export function createPonderAtlasPlayback(read: ReadAsset, gl?: WebGL2RenderingContext) {
  const metadata = new Map<string, Promise<PonderAtlasCopy[]>>();
  const sheets = new Map<string, Promise<PonderAtlasPixels>>();
  const sheetSizes = new Map<string, number>();
  const sheetBudget = 32 * 1024 ** 2;
  let sheetBytes = 0;
  const scratch = gl ? undefined : document.createElement('canvas');
  const context = scratch?.getContext('2d', { willReadFrequently: true });

  function cached<T>(cache: Map<string, Promise<T>>, limit: number, path: string, load: () => Promise<T>,
    evict = (key: string) => cache.delete(key)) {
    let entry = cache.get(path);
    if (entry) cache.delete(path);
    else {
      if (cache.size >= limit) evict(cache.keys().next().value!);
      entry = load().catch(error => {
        if (cache.get(path) === entry) cache.delete(path);
        throw error;
      });
    }
    cache.set(path, entry);
    return entry;
  }

  function dropSheet(path: string) {
    sheetBytes -= sheetSizes.get(path) ?? 0;
    sheetSizes.delete(path);
    return sheets.delete(path);
  }

  function sheet(path: string) {
    const entry = cached(sheets, 24, path, async () => {
      const bytes = await read(path);
      const header = new DataView(bytes);
      const width = header.getUint32(16), height = header.getUint32(20);
      if (!width || !height || width > 2048 || height > 2048) throw new Error('Invalid Ponder sheet dimensions');
      if (!gl) {
        const data = await readPonderRgbaPixels(bytes, width, height);
        if (data) return { width, height, data };
      }
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      try {
        if (bitmap.width !== width || bitmap.height !== height) throw new Error('Invalid Ponder sheet image');
        // Canvas 2D premultiplies RGB, which can lose colors under partial alpha before interpolation.
        if (gl) return readWebGlSheet(gl, bitmap);
        if (!context || !scratch) throw new Error('Ponder texture decoding is unavailable');
        scratch.width = width;
        scratch.height = height;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, width, height);
      } finally {
        bitmap.close();
        if (scratch) scratch.width = scratch.height = 1;
      }
    }, dropSheet);
    return entry.then(pixels => {
      if (sheets.get(path) === entry && !sheetSizes.has(path)) {
        const size = pixels.data.byteLength;
        for (const key of sheets.keys()) {
          if (sheetBytes + size <= sheetBudget) break;
          if (key !== path && sheetSizes.has(key)) dropSheet(key);
        }
        sheetSizes.set(path, size);
        sheetBytes += size;
      }
      return pixels;
    });
  }

  async function sample(animation: string, pageWidth: number, pageHeight: number, tick: number) {
    const copies = await cached(metadata, 32, animation, async () => {
      const bytes = await read(animation);
      if (bytes.byteLength > (ponderResource(animation)?.limit ?? 0)) throw new Error('Oversized Ponder atlas animation');
      const parsed = readPonderAtlasAnimation(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed) throw new Error('Invalid Ponder atlas animation');
      return parsed;
    });
    let remaining = pageWidth * pageHeight;
    const patches = [];
    for (const copy of copies) {
      remaining -= copy.rect[2] * copy.rect[3];
      if (remaining < 0 || !ponderAtlasCopyFits(copy, pageWidth, pageHeight)) throw new Error('Invalid Ponder atlas copy');
      const pixels = await sheet(copy.image);
      if (!ponderAtlasFrameFits(copy, pixels.width, pixels.height)) throw new Error('Invalid Ponder atlas frame');
      patches.push(samplePonderAtlasCopy(copy, pixels, tick));
    }
    return patches;
  }

  return { sample, dispose() { metadata.clear(); sheets.clear(); sheetSizes.clear(); sheetBytes = 0; } };
}
