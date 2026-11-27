import { ponderCutout, ponderLightmapMode, ponderLineIndices, ponderLineShader, ponderLineViewScale, ponderQuadIndices, ponderUnlitEntityShader,
  supportsPonderWideLine, usesPonderEntityLighting, type PonderAttribute, type PonderDraw, type PonderManifest,
  type PonderTexture } from './format.mts';

export type PonderPixels = { width: number; height: number; data: Uint8ClampedArray };
export type PonderSurface = PonderPixels & { depth: Float32Array };
export type PonderRasterBudget = { vertices: number; primitives: number; samples: number };

const texturedShaders = new Set([
  'position_tex', 'position_tex_color', 'position_color_tex', 'position_tex_lightmap_color', 'particle',
  'rendertype_solid', 'rendertype_cutout', 'rendertype_cutout_mipped', 'rendertype_translucent',
  'rendertype_translucent_moving_block', 'rendertype_text', 'rendertype_text_see_through',
  'rendertype_text_polygon_offset', 'rendertype_entity_solid', 'rendertype_entity_cutout',
  'rendertype_entity_cutout_no_cull', 'rendertype_entity_cutout_no_cull_z_offset',
  'rendertype_entity_translucent', 'rendertype_entity_translucent_cull',
  'rendertype_entity_no_outline', 'rendertype_eyes',
  'rendertype_glint', 'rendertype_armor_cutout_no_cull', 'rendertype_crumbling',
  ponderUnlitEntityShader,
]);
const colorShaders = new Set(['position', 'position_color', 'rendertype_gui', 'rendertype_gui_overlay',
  'rendertype_gui_text_highlight', 'rendertype_text_background', 'rendertype_text_background_see_through', 'rendertype_lightning']);
const modes = new Set(['QUADS', 'TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN', 'DEBUG_LINES', 'DEBUG_LINE_STRIP', 'LINES', 'LINE_STRIP']);

export function supportsPonderDraw2d(draw: PonderDraw) {
  if (!modes.has(draw.mode)) return false;
  const position = draw.attributes.find(attribute => attribute.name === 'Position');
  if (position?.type !== 'FLOAT' || position.count !== 3) return false;
  if (draw.shader === ponderLineShader || draw.mode === 'LINES' || draw.mode === 'LINE_STRIP') return supportsPonderWideLine(draw);
  if (draw.mode === 'QUADS' && !draw.indices && (draw.vertexCount % 4 || draw.indexCount !== draw.vertexCount / 4 * 6)) return false;
  return colorShaders.has(draw.shader) || (texturedShaders.has(draw.shader) && !!draw.textures[0]
    && draw.attributes.some(attribute => attribute.name === 'UV0' && attribute.count === 2));
}

type Vertex = {
  x: number; y: number; z: number; inverseW: number;
  red: number; green: number; blue: number; alpha: number; u: number; v: number;
  overlayU: number; overlayV: number;
  lighting?: number[];
};

function reader(view: DataView, layout: PonderAttribute[], name: string, normalized = false) {
  const field = layout.find(attribute => attribute.name === name);
  if (!field) return (_offset: number, _channel: number, fallback = 0) => fallback;
  const { count, offset, type } = field;
  const at = (start: number, channel: number, fallback = 0): number => {
    if (channel >= count) return fallback;
    const address = start + offset;
    switch (type) {
      case 'BYTE': {
        const value = view.getInt8(address + channel);
        return normalized ? Math.max(-1, value / 127) : value;
      }
      case 'UBYTE': {
        const value = view.getUint8(address + channel);
        return normalized ? value / 255 : value;
      }
      case 'SHORT': {
        const value = view.getInt16(address + channel * 2, true);
        return normalized ? Math.max(-1, value / 32767) : value;
      }
      case 'USHORT': {
        const value = view.getUint16(address + channel * 2, true);
        return normalized ? value / 65535 : value;
      }
      case 'FLOAT': return view.getFloat32(address + channel * 4, true);
      default: return fallback;
    }
  };
  return at;
}

function multiply(left: Float32Array, right: Float32Array) {
  const matrix = new Float64Array(16);
  for (let column = 0; column < 16; column += 4) {
    for (let row = 0; row < 4; row++) {
      matrix[column + row] = left[row] * right[column] + left[row + 4] * right[column + 1]
        + left[row + 8] * right[column + 2] + left[row + 12] * right[column + 3];
    }
  }
  return matrix;
}

function texel(coordinate: number, size: number, wrap = 33071) {
  const index = Math.floor(coordinate * size);
  if (index >= 0 && index < size) return index;
  if (wrap === 33071) return index < 0 ? 0 : size - 1;
  if (wrap === 10497) return (index % size + size) % size;
  const period = size * 2;
  const mirrored = (index % period + period) % period;
  return mirrored < size ? mirrored : period - 1 - mirrored;
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)); }

function lightSample(image: PonderPixels, u: number, v: number, filtered: boolean, linear: boolean) {
  const coord = (value: number) => Math.min(15.5 / 16, Math.max(0.5 / 16, value / 256));
  const read = (x: number, y: number, lane: number) => image.data[(Math.max(0, Math.min(image.height - 1, y)) * image.width
    + Math.max(0, Math.min(image.width - 1, x))) * 4 + lane];
  if (!filtered) return [0, 1, 2, 3].map(lane => read(Math.trunc(u / 16), Math.trunc(v / 16), lane) / 255);
  const x = coord(u) * image.width, y = coord(v) * image.height;
  if (!linear) return [0, 1, 2, 3].map(lane => read(Math.floor(x), Math.floor(y), lane) / 255);
  const i = Math.floor(x - .5), j = Math.floor(y - .5);
  const tx = x - .5 - i, ty = y - .5 - j;
  return [0, 1, 2, 3].map(lane => (
    (read(i, j, lane) * (1 - tx) + read(i + 1, j, lane) * tx) * (1 - ty)
    + (read(i, j + 1, lane) * (1 - tx) + read(i + 1, j + 1, lane) * tx) * ty) / 255);
}

function lineOffset(matrix: Float64Array, x: number, y: number, w: number, nx: number, ny: number, nz: number,
  surface: PonderSurface, width: number, vertex: number) {
  const endW = w + matrix[3] * nx + matrix[7] * ny + matrix[11] * nz;
  const dx = ((x * w + matrix[0] * nx + matrix[4] * ny + matrix[8] * nz) / endW - x) * surface.width;
  const dy = ((y * w + matrix[1] * nx + matrix[5] * ny + matrix[9] * nz) / endW - y) * surface.height;
  const length = Math.hypot(dx, dy);
  if (!length || !Number.isFinite(length)) return [0, 0];
  const side = (vertex % 2 === 0 ? 1 : -1) * (dy > 0 ? -1 : 1) * width / (2 * length);
  return [-dy * side, -dx * side];
}

function readVertices(draw: PonderDraw, bytes: ArrayBuffer, surface: PonderSurface,
  diffuseLights: PonderManifest['diffuseLights'], lightmap?: PonderPixels) {
  const view = new DataView(bytes);
  const position = reader(view, draw.attributes, 'Position');
  const color = reader(view, draw.attributes, 'Color', true);
  const uv = reader(view, draw.attributes, 'UV0');
  const overlay = reader(view, draw.attributes, 'UV1');
  const light = reader(view, draw.attributes, 'UV2');
  const normal = reader(view, draw.attributes, 'Normal', true);
  const lineWidth = draw.shader === ponderLineShader ? draw.lineWidth ?? 0 : 0;
  const modelView = lineWidth ? draw.modelView.map((value, index) => index % 4 === 3 ? value : value * ponderLineViewScale)
    : draw.modelView;
  const matrix = multiply(draw.projection, modelView);
  const texture = draw.textureMatrix;
  const entity = usesPonderEntityLighting(draw.shader);
  const lightMode = ponderLightmapMode(draw.shader);
  const [first, second] = diffuseLights;
  const [uniformR, uniformG, uniformB, uniformA] = draw.color;
  const vertices: (Vertex | undefined)[] = new Array(draw.vertexCount);
  for (let i = 0; i < draw.vertexCount; i++) {
    const offset = i * draw.stride;
    const x = position(offset, 0), y = position(offset, 1), z = position(offset, 2);
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!Number.isFinite(w) || w <= 1e-8) continue;
    const inverseW = 1 / w;
    const clipX = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW;
    const clipY = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW;
    const depth = ((matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW + 1) / 2;
    const u = uv(offset, 0), v = uv(offset, 1);
    const textureU = texture[0] * u + texture[4] * v + texture[12];
    const textureV = texture[1] * u + texture[5] * v + texture[13];
    if (![clipX, clipY, depth, textureU, textureV].every(Number.isFinite) || Math.abs(clipX) > 1e6 || Math.abs(clipY) > 1e6) continue;
    let shade = 1;
    if (entity) {
      const nx = normal(offset, 0), ny = normal(offset, 1, 1), nz = normal(offset, 2);
      shade = Math.min(1, 0.4 + 0.6 * (Math.max(0, nx * first[0] + ny * first[1] + nz * first[2])
        + Math.max(0, nx * second[0] + ny * second[1] + nz * second[2])));
    }
    let red = color(offset, 0, 1) * uniformR * shade;
    let green = color(offset, 1, 1) * uniformG * shade;
    let blue = color(offset, 2, 1) * uniformB * shade;
    let alpha = color(offset, 3, 1) * uniformA;
    let lighting: number[] | undefined;
    if (lightmap) {
      const sample = lightSample(lightmap, light(offset, 0), light(offset, 1), lightMode === 'filtered-color',
        draw.textures[2]?.magFilter === 9729);
      if (lightMode === 'separate') lighting = sample;
      else {
        red *= sample[0];
        green *= sample[1];
        blue *= sample[2];
        alpha *= sample[3];
      }
    }
    if (![red, green, blue, alpha].every(Number.isFinite)) continue;
    const [offsetX, offsetY] = lineWidth ? lineOffset(matrix, clipX, clipY, w, normal(offset, 0), normal(offset, 1),
      normal(offset, 2), surface, lineWidth, i) : [0, 0];
    vertices[i] = { x: (clipX + 1) * surface.width / 2 + offsetX, y: (1 - clipY) * surface.height / 2 + offsetY, z: depth, inverseW,
      red, green, blue, alpha, u: textureU, v: textureV, overlayU: overlay(offset, 0), overlayV: overlay(offset, 1), lighting };
  }
  return vertices;
}

function depthPass(fn: number, incoming: number, stored: number) {
  switch (fn) {
    case 512: return false;
    case 513: return incoming < stored;
    case 514: return incoming === stored;
    case 515: return incoming <= stored;
    case 516: return incoming > stored;
    case 517: return incoming !== stored;
    case 518: return incoming >= stored;
    default: return true;
  }
}

function factor(code: number, source: number, destination: number, srcAlpha: number, dstAlpha: number, alphaChannel = false) {
  switch (code) {
    case 1: return 1;
    case 768: return source;
    case 769: return 1 - source;
    case 770: return srcAlpha;
    case 771: return 1 - srcAlpha;
    case 772: return dstAlpha;
    case 773: return 1 - dstAlpha;
    case 774: return destination;
    case 775: return 1 - destination;
    case 776: return alphaChannel ? 1 : Math.min(srcAlpha, 1 - dstAlpha);
    // The WebGL renderer has the initial blend color (transparent black).
    case 32770: case 32772: return 1;
    default: return 0;
  }
}

function blended(source: number, destination: number, srcAlpha: number, dstAlpha: number,
  sourceFactor: number, destinationFactor: number, alphaChannel = false) {
  return source * factor(sourceFactor, source, destination, srcAlpha, dstAlpha, alphaChannel)
    + destination * factor(destinationFactor, source, destination, srcAlpha, dstAlpha, alphaChannel);
}

type Paint = {
  draw: PonderDraw;
  surface: PonderSurface;
  base?: PonderPixels;
  next?: PonderPixels;
  descriptor?: PonderTexture;
  overlay?: PonderPixels;
  cutout: number;
};

function overlaySample(image: PonderPixels | undefined, vertex: Vertex) {
  if (!image) return 0;
  const x = Math.max(0, Math.min(image.width - 1, Math.trunc(vertex.overlayU)));
  const y = Math.max(0, Math.min(image.height - 1, Math.trunc(vertex.overlayV)));
  return (y * image.width + x) * 4;
}

function fragment(paint: Paint, pixel: number, overlay: number, a: Vertex, b: Vertex, c: Vertex,
  weightA: number, weightB: number, weightC: number) {
  const { draw, surface } = paint;
  const z = Math.fround(weightA * a.z + weightB * b.z + weightC * c.z);
  if (z < 0 || z > 1 || (draw.depthTest && !depthPass(draw.depthFunction, z, surface.depth[pixel]))) return;
  if (a.inverseW !== 1 || b.inverseW !== 1 || c.inverseW !== 1) {
    weightA *= a.inverseW;
    weightB *= b.inverseW;
    weightC *= c.inverseW;
    const total = weightA + weightB + weightC;
    weightA /= total;
    weightB /= total;
    weightC /= total;
  }
  let alpha = a.alpha * weightA + b.alpha * weightB + c.alpha * weightC;
  let red = a.red * weightA + b.red * weightB + c.red * weightC;
  let green = a.green * weightA + b.green * weightB + c.green * weightC;
  let blue = a.blue * weightA + b.blue * weightB + c.blue * weightC;
  if (paint.base && paint.descriptor) {
    const texture = paint.base;
    let u = a.u * weightA + b.u * weightB + c.u * weightC;
    let v = a.v * weightA + b.v * weightB + c.v * weightC;
    const regions = paint.descriptor.atlasRegions;
    if (regions) {
      u = Math.fround(u);
      v = Math.fround(v);
      let region = 0;
      for (; region < regions.length; region++) {
        const [uMin, vMin, uMax, vMax] = regions[region];
        if (u >= uMin && v >= vMin && u <= uMax && v <= vMax) break;
      }
      if (region === regions.length) return;
      const [, , , , scaleU, scaleV, offsetU, offsetV] = regions[region];
      u = Math.fround(u * scaleU + offsetU);
      v = Math.fround(v * scaleV + offsetV);
    }
    const sample = (texel(v, texture.height, paint.descriptor.wrapT) * texture.width + texel(u, texture.width, paint.descriptor.wrapS)) * 4;
    const textureAlpha = texture.data[sample + 3] / 255;
    if (draw.shader === ponderUnlitEntityShader && textureAlpha < .1) return;
    alpha *= textureAlpha;
    if (paint.next && paint.descriptor.transition) {
      const next = paint.next;
      const weight = paint.descriptor.transition.weight;
      const index = (texel(v, next.height, paint.descriptor.wrapT) * next.width + texel(u, next.width, paint.descriptor.wrapS)) * 4;
      red *= Math.floor((1 - weight) * texture.data[sample] + weight * next.data[index]) / 255;
      green *= Math.floor((1 - weight) * texture.data[sample + 1] + weight * next.data[index + 1]) / 255;
      blue *= Math.floor((1 - weight) * texture.data[sample + 2] + weight * next.data[index + 2]) / 255;
    } else {
      red *= texture.data[sample] / 255;
      green *= texture.data[sample + 1] / 255;
      blue *= texture.data[sample + 2] / 255;
    }
  }
  if (alpha < paint.cutout) return;
  if (paint.overlay) {
    const samples = paint.overlay.data;
    const mix = samples[overlay + 3] / 255;
    red = red * mix + samples[overlay] * (1 - mix) / 255;
    green = green * mix + samples[overlay + 1] * (1 - mix) / 255;
    blue = blue * mix + samples[overlay + 2] * (1 - mix) / 255;
  }
  if (a.lighting && b.lighting && c.lighting) {
    const shade = (lane: number) => a.lighting![lane] * weightA + b.lighting![lane] * weightB + c.lighting![lane] * weightC;
    red *= shade(0);
    green *= shade(1);
    blue *= shade(2);
    alpha *= shade(3);
  }
  if (draw.depthTest && draw.depthWrite) surface.depth[pixel] = z;
  const offset = pixel * 4;
  const target = surface.data;
  if (draw.blend && draw.blendFactors) {
    const [sr, dr, sa, da] = draw.blendFactors;
    const dstAlpha = target[offset + 3] / 255;
    alpha = clamp(alpha);
    if (sr === 770 && dr === 771) {
      const remainder = 1 - alpha;
      red = clamp(red) * alpha + target[offset] * remainder / 255;
      green = clamp(green) * alpha + target[offset + 1] * remainder / 255;
      blue = clamp(blue) * alpha + target[offset + 2] * remainder / 255;
    } else {
      red = blended(clamp(red), target[offset] / 255, alpha, dstAlpha, sr, dr);
      green = blended(clamp(green), target[offset + 1] / 255, alpha, dstAlpha, sr, dr);
      blue = blended(clamp(blue), target[offset + 2] / 255, alpha, dstAlpha, sr, dr);
    }
    alpha = blended(alpha, dstAlpha, alpha, dstAlpha, sa, da, true);
  }
  target[offset] = red * 255;
  target[offset + 1] = green * 255;
  target[offset + 2] = blue * 255;
  target[offset + 3] = alpha * 255;
}

function edge(a: Vertex, b: Vertex, x: number, y: number) {
  return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
}

function topLeft(a: Vertex, b: Vertex) { return a.y > b.y || (a.y === b.y && a.x < b.x); }

function triangle(paint: Paint, a: Vertex, b: Vertex, c: Vertex, budget: PonderRasterBudget) {
  const area = edge(a, b, c.x, c.y);
  if (Math.abs(area) < 1e-8 || (paint.draw.cull && area >= 0)) return true;
  const overlay = overlaySample(paint.overlay, c);
  if (area < 0) [b, c] = [c, b];
  const { width, height } = paint.surface;
  const left = Math.max(0, Math.ceil(Math.min(a.x, b.x, c.x) - 0.5));
  const right = Math.min(width - 1, Math.floor(Math.max(a.x, b.x, c.x) - 0.5));
  const top = Math.max(0, Math.ceil(Math.min(a.y, b.y, c.y) - 0.5));
  const bottom = Math.min(height - 1, Math.floor(Math.max(a.y, b.y, c.y) - 0.5));
  if (right < left || bottom < top) return true;
  const samples = (right - left + 1) * (bottom - top + 1);
  if (samples > budget.samples) return false;
  budget.samples -= samples;
  const inverseArea = 1 / Math.abs(area);
  const inclusiveA = topLeft(b, c), inclusiveB = topLeft(c, a), inclusiveC = topLeft(a, b);
  const stepA = b.y - c.y, stepB = c.y - a.y, stepC = a.y - b.y;
  for (let y = top; y <= bottom; y++) {
    let coverageA = edge(b, c, left + 0.5, y + 0.5);
    let coverageB = edge(c, a, left + 0.5, y + 0.5);
    let coverageC = edge(a, b, left + 0.5, y + 0.5);
    for (let x = left; x <= right; x++) {
      if ((coverageA > 0 || (coverageA === 0 && inclusiveA)) && (coverageB > 0 || (coverageB === 0 && inclusiveB))
        && (coverageC > 0 || (coverageC === 0 && inclusiveC))) {
        fragment(paint, y * width + x, overlay, a, b, c, coverageA * inverseArea, coverageB * inverseArea, coverageC * inverseArea);
      }
      coverageA += stepA; coverageB += stepB; coverageC += stepC;
    }
  }
  return true;
}

function line(paint: Paint, a: Vertex, b: Vertex, budget: PonderRasterBudget) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  if (steps > budget.samples) return false;
  budget.samples -= steps;
  const { width, height } = paint.surface;
  const overlay = overlaySample(paint.overlay, b);
  let previous = -1;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + dx * t), y = Math.floor(a.y + dy * t);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const pixel = y * width + x;
    if (pixel === previous) continue;
    previous = pixel;
    fragment(paint, pixel, overlay, a, b, b, 1 - t, t, 0);
  }
  return true;
}

export function drawPonder2d(surface: PonderSurface, draw: PonderDraw, vertexBytes: ArrayBuffer, indexBytes: ArrayBuffer | undefined,
  textures: readonly (PonderPixels | undefined)[], light: PonderManifest['diffuseLights'], budget: PonderRasterBudget) {
  if (draw.vertexCount > budget.vertices || vertexBytes.byteLength < draw.vertexCount * draw.stride) return false;
  if ((draw.textures[0] && !textures[0]) || (draw.textures[0]?.transition && !textures[3])) return false;
  const indexed = draw.indices !== undefined;
  const indexSize = draw.indexType === 'INT' ? 4 : 2;
  if (indexed && (!indexBytes || indexBytes.byteLength < draw.indexCount * indexSize)) return false;
  const indices = indexed ? new DataView(indexBytes!) : undefined;
  const sequential = !indexed && (draw.mode === 'QUADS' ? ponderQuadIndices : draw.mode === 'LINES' ? ponderLineIndices : undefined);
  const count = indexed || sequential ? draw.indexCount : draw.vertexCount;
  const at = (i: number) => indices ? (indexSize === 4 ? indices.getUint32(i * 4, true) : indices.getUint16(i * 2, true))
    : sequential ? Math.floor(i / 6) * 4 + sequential[i % 6] : i;
  const triangleStrip = draw.mode === 'TRIANGLE_STRIP' || draw.mode === 'LINE_STRIP';
  const strip = triangleStrip || draw.mode === 'TRIANGLE_FAN';
  const lines = draw.mode === 'DEBUG_LINES' || draw.mode === 'DEBUG_LINE_STRIP';
  const spacing = draw.mode === 'DEBUG_LINE_STRIP' || strip ? 1 : lines ? 2 : 3;
  const width = lines ? 2 : 3;
  const primitives = Math.max(0, Math.floor((count - width) / spacing) + 1);
  if (primitives > budget.primitives) return false;
  budget.primitives -= primitives;
  budget.vertices -= draw.vertexCount;
  if (indices) {
    for (let i = 0; i < count; i++) if (at(i) >= draw.vertexCount) return false;
  }
  const vertices = readVertices(draw, vertexBytes, surface, light, textures[2]);
  const paint: Paint = { draw, surface, cutout: ponderCutout(draw),
    base: textures[0], next: textures[3], descriptor: draw.textures[0], overlay: textures[1] };
  let complete = true;
  for (let i = 0; i + width <= count; i += spacing) {
    const a = vertices[at(draw.mode === 'TRIANGLE_FAN' ? 0 : i)];
    const b = vertices[at(i + 1)];
    if (!a || !b) { complete = false; continue; }
    if (lines) {
      if (!line(paint, a, b, budget)) return false;
    } else {
      const c = vertices[at(i + 2)];
      if (!c) { complete = false; continue; }
      const reverse = triangleStrip && i % 2 === 1;
      if (!triangle(paint, reverse ? b : a, reverse ? a : b, c, budget)) return false;
    }
  }
  return complete;
}
