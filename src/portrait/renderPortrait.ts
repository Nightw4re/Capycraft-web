import { grassFaces, grassTexture } from './grassBlock';
import { projectFigure, stageHeight, stageWidth, type PortraitFrame } from './portraitScene';
import { skinFaces, type Face, type Point, type PortraitSkin } from './skinGeometry';

type Raster = Pick<ImageData, 'width' | 'height' | 'data'>;

const samplesPerAxis = 2;

function scaleSamples([x, y, z]: Point): Point {
  return [x * samplesPerAxis, y * samplesPerAxis, z * samplesPerAxis];
}

export function shade([ux, uy, uz]: Point, [vx, vy, vz]: Point): number {
  // Convert the face normal to the view coordinates used by Armor Preview's lighting.
  const nx = uy * vz - uz * vy;
  const ny = ux * vz - uz * vx;
  const nz = uy * vx - ux * vy;
  const length = Math.hypot(nx, ny, nz);
  const key = (-0.4 * nx + 0.8 * ny - 0.7 * nz) / (length * Math.hypot(0.4, 0.8, 0.7));
  const fill = (0.6 * nx + 0.4 * ny + 0.7 * nz) / (length * Math.hypot(0.6, 0.4, 0.7));
  return 0.71 + 0.22 * Math.max(key, 0) + 0.1 * Math.max(fill, 0);
}

function drawFace(face: Face, skin: Uint8ClampedArray, image: Raster, depths: Float32Array) {
  const { corners: [a, b, c], texture: [u, v], width, height, flipU } = face;
  const [ux, uy, uz]: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz]: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) < 1e-6) return;

  const lighting = shade([ux, uy, uz], [vx, vy, vz]);
  const left = Math.max(0, Math.floor(a[0] + Math.min(0, ux) + Math.min(0, vx)));
  const right = Math.min(image.width, Math.ceil(a[0] + Math.max(0, ux) + Math.max(0, vx)));
  const top = Math.max(0, Math.floor(a[1] + Math.min(0, uy) + Math.min(0, vy)));
  const bottom = Math.min(image.height, Math.ceil(a[1] + Math.max(0, uy) + Math.max(0, vy)));

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const dx = x + 0.5 - a[0];
      const dy = y + 0.5 - a[1];
      const s = (dx * vy - dy * vx) / determinant;
      const t = (ux * dy - uy * dx) / determinant;
      if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;

      const depth = a[2] + s * uz + t * vz;
      const pixel = y * image.width + x;
      if (depth <= depths[pixel]) continue;

      // Nearest-neighbor sampling stays inside the face's UV rectangle. Cutouts leave the depth buffer untouched.
      const column = Math.floor(s * width);
      const texel = ((v + Math.floor(t * height)) * 64 + u + (flipU ? width - 1 - column : column)) * 4;
      if (skin[texel + 3] < 26) continue;

      depths[pixel] = depth;
      const offset = pixel * 4;
      image.data[offset] = skin[texel] * lighting;
      image.data[offset + 1] = skin[texel + 1] * lighting;
      image.data[offset + 2] = skin[texel + 2] * lighting;
      image.data[offset + 3] = 255;
    }
  }
}

function resolveSamples(samples: Raster, image: Raster) {
  const source = samples.data;
  const output = image.data;
  const rowBytes = samples.width * 4;

  // Average coverage at the outline and unpremultiply the color so transparent samples add no fringe.
  for (let y = 0; y < image.height; y++) {
    let top = y * samplesPerAxis * rowBytes;
    let target = y * image.width * 4;
    for (let x = 0; x < image.width; x++, top += 8, target += 4) {
      const bottom = top + rowBytes;
      const coverage = source[top + 3] + source[top + 7] + source[bottom + 3] + source[bottom + 7];
      if (!coverage) continue;

      const weight = 255 / coverage;
      for (let channel = 0; channel < 3; channel++) {
        output[target + channel] = weight * (source[top + channel] + source[top + 4 + channel]
          + source[bottom + channel] + source[bottom + 4 + channel]);
      }
      output[target + 3] = coverage / 4;
    }
  }
}

export function createPortraitRenderer(skins: ReadonlyMap<string, PortraitSkin>) {
  const width = stageWidth * samplesPerAxis;
  const height = stageHeight * samplesPerAxis;
  const samples = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const depths = new Float32Array(width * height);

  return function render({ actors, block }: PortraitFrame, image: Raster) {
    image.data.fill(0);
    samples.data.fill(0);
    depths.fill(-Infinity);

    for (const actor of actors) {
      const skin = skins.get(actor.player);
      if (!skin) throw new Error(`Missing skin for ${actor.player}`);
      const project = projectFigure(actor);
      for (const face of skinFaces(actor.pose, actor.headOnly ?? false, skin.model)) {
        const [a, b, c] = face.corners;
        const corners: Face['corners'] = [scaleSamples(project(a)), scaleSamples(project(b)), scaleSamples(project(c))];
        drawFace({ ...face, corners }, skin.pixels, samples, depths);
      }
    }
    if (block) {
      for (const face of grassFaces(block)) {
        const [a, b, c] = face.corners;
        drawFace({ ...face, corners: [scaleSamples(a), scaleSamples(b), scaleSamples(c)] }, grassTexture, samples, depths);
      }
    }

    resolveSamples(samples, image);
  };
}
