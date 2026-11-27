import { maxPonderAtlasRegions, maxTextureSide, ponderCutout, ponderLightmapMode, ponderLineIndices, ponderLineShader, ponderLineViewScale, ponderQuadIndices,
  ponderUnlitEntityShader, supportsPonderWideLine, usesPonderEntityLighting, type PonderAttribute, type PonderDraw,
  type PonderFrame, type PonderManifest } from './format.mts';
import { createPonderAtlasPlayback, ponderAtlasTextureKey } from './atlasPlayback';

const vertexShader = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec4 aColor;
layout(location=2) in vec2 aUV;
layout(location=3) in vec2 aOverlay;
layout(location=4) in vec2 aLight;
layout(location=5) in vec3 aNormal;
uniform mat4 uProjection, uModelView, uTextureMatrix;
uniform vec3 uLight0, uLight1;
uniform bool uEntity;
uniform sampler2D uLightmap;
uniform int uLightmapMode;
uniform float uLineWidth;
uniform vec2 uViewport;
out vec4 vColor;
out vec2 vUV;
flat out ivec2 vOverlay;
out vec4 vLightmapColor;
void main() {
  vec4 viewPosition = uModelView * vec4(aPosition, 1.0);
  gl_Position = uProjection * viewPosition;
  if (uLineWidth > 0.0) {
    viewPosition.xyz *= ${ponderLineViewScale};
    gl_Position = uProjection * viewPosition;
    vec4 direction = uModelView * vec4(aNormal, 0.0);
    direction.xyz *= ${ponderLineViewScale};
    vec4 end = gl_Position + uProjection * direction;
    vec2 screenDirection = (end.xy / end.w - gl_Position.xy / gl_Position.w) * uViewport;
    float lengthSquared = dot(screenDirection, screenDirection);
    if (lengthSquared > 0.0) {
      vec2 normal = vec2(-screenDirection.y, screenDirection.x) * inversesqrt(lengthSquared);
      float side = ((gl_VertexID & 1) == 0 ? 1.0 : -1.0) * (normal.x < 0.0 ? -1.0 : 1.0);
      gl_Position.xy += normal * (side * uLineWidth * gl_Position.w) / uViewport;
    }
  }
  vUV = (uTextureMatrix * vec4(aUV, 0.0, 1.0)).xy;
  vColor = aColor;
  vOverlay = ivec2(aOverlay);
  if (uEntity) {
    float shading = min(1.0, 0.4 + 0.6 * (max(0.0, dot(aNormal, uLight0)) + max(0.0, dot(aNormal, uLight1))));
    vColor.rgb *= shading;
  }
  vLightmapColor = vec4(1.0);
  if (uLightmapMode != 0) {
    ivec2 size = textureSize(uLightmap, 0);
    vec4 light = uLightmapMode == 1
      ? texture(uLightmap, clamp(aLight / 256.0, 0.5 / 16.0, 15.5 / 16.0))
      : texelFetch(uLightmap, clamp(ivec2(aLight) / 16, ivec2(0), size - 1), 0);
    if (uLightmapMode == 3) vLightmapColor = light;
    else vColor *= light;
  }
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D uBase, uOverlay, uNextSprite;
uniform bool uHasBase, uHasOverlay, uUnlitEntity;
uniform float uCutout, uSpriteWeight;
uniform vec4 uColor;
uniform int uAtlasRegionCount;
uniform vec4 uAtlasBounds[${maxPonderAtlasRegions}], uAtlasTransforms[${maxPonderAtlasRegions}];
in vec4 vColor;
in vec2 vUV;
flat in ivec2 vOverlay;
in vec4 vLightmapColor;
out vec4 color;
void main() {
  color = vColor * uColor;
  if (uHasBase) {
    vec4 base;
    if (uAtlasRegionCount == 0) {
      base = texture(uBase, vUV);
    } else {
      vec2 dx = dFdx(vUV), dy = dFdy(vUV);
      int selected = -1;
      for (int region = 0; region < uAtlasRegionCount; region++) {
        vec4 bounds = uAtlasBounds[region];
        if (all(greaterThanEqual(vUV, bounds.xy)) && all(lessThanEqual(vUV, bounds.zw))) {
          selected = region;
          break;
        }
      }
      if (selected < 0) discard;
      vec4 transform = uAtlasTransforms[selected];
      base = textureGrad(uBase, vUV * transform.xy + transform.zw, dx * transform.xy, dy * transform.xy);
    }
    if (uUnlitEntity && base.a < 0.1) discard;
    if (uSpriteWeight > 0.0) {
      vec3 next = texture(uNextSprite, vUV).rgb;
      base.rgb = floor(mix(base.rgb, next, uSpriteWeight) * 255.0 + 0.0001) / 255.0;
    }
    color *= base;
  }
  if (color.a < uCutout) discard;
  if (uHasOverlay) {
    ivec2 size = textureSize(uOverlay, 0);
    vec4 overlay = texelFetch(uOverlay, clamp(vOverlay, ivec2(0), size - 1), 0);
    color.rgb = mix(overlay.rgb, color.rgb, overlay.a);
  }
  color *= vLightmapColor;
}`;

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
const modes: Record<string, number> = {
  QUADS: 4, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, DEBUG_LINES: 1, DEBUG_LINE_STRIP: 3, LINES: 4, LINE_STRIP: 5,
};
const attributeTypes: Record<string, number> = { BYTE: 5120, UBYTE: 5121, SHORT: 5122, USHORT: 5123, FLOAT: 5126 };
const attributes = ['Position', 'Color', 'UV0', 'UV1', 'UV2', 'Normal'];
const bufferBudget = 96 * 1024 ** 2;

function supported(draw: PonderDraw) {
  if (!Object.hasOwn(modes, draw.mode)) return false;
  const position = draw.attributes.find(attribute => attribute.name === 'Position');
  if (!position || position.count !== 3 || position.type !== 'FLOAT') return false;
  if (draw.shader === ponderLineShader || draw.mode === 'LINES' || draw.mode === 'LINE_STRIP') return supportsPonderWideLine(draw);
  if (draw.mode === 'QUADS' && !draw.indices && (draw.vertexCount % 4 || draw.indexCount !== draw.vertexCount / 4 * 6)) return false;
  if (colorShaders.has(draw.shader)) return true;
  return texturedShaders.has(draw.shader) && !!draw.textures[0]
    && draw.attributes.some(attribute => attribute.name === 'UV0' && attribute.count === 2);
}

export class PonderWebGlUnavailable extends Error {}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new PonderWebGlUnavailable();
  const shaders: WebGLShader[] = [];
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, fragmentShader]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new PonderWebGlUnavailable();
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new PonderWebGlUnavailable(gl.getShaderInfoLog(shader) ?? '');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new PonderWebGlUnavailable(gl.getProgramInfoLog(program) ?? '');
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

type Resource = { path: string; kind: 'mesh' | 'index' | 'image'; atlasAnimation?: string };
type ImageData = { resource: Resource; bitmap: ImageBitmap; size: number };
type BufferData = { resource: Resource; bytes: ArrayBuffer; size: number };
type CpuData = ImageData | BufferData;
type GpuData =
  | { texture: WebGLTexture; size: number; width: number; height: number; mipmapped: boolean; atlasTick?: number }
  | { buffer: WebGLBuffer; size: number; upperBounds: Map<string, number>; bytes?: ArrayBuffer };

function resourceKey(kind: Resource['kind'], path: string) {
  return `${kind}:${path}`;
}

export function createPonderRenderer(canvas: HTMLCanvasElement, manifest: PonderManifest, readAsset: (path: string) => Promise<ArrayBuffer>) {
  const context = canvas.getContext('webgl2', { alpha: true, depth: true, premultipliedAlpha: false });
  if (!context || context.isContextLost()) throw new PonderWebGlUnavailable();
  const gl = context;
  const atlasPlayback = createPonderAtlasPlayback(readAsset, gl);
  const program = createProgram(gl);
  const neutral = gl.createTexture();
  const quad = gl.createBuffer();
  const line = gl.createBuffer();
  if (!neutral || !quad || !line) {
    gl.deleteTexture(neutral);
    gl.deleteBuffer(quad);
    gl.deleteBuffer(line);
    gl.deleteProgram(program);
    throw new PonderWebGlUnavailable();
  }
  const cache = new Map<string, GpuData>();
  let cachedBytes = 0;
  const sequential = {
    QUADS: { buffer: quad, indices: ponderQuadIndices, count: 0 },
    LINES: { buffer: line, indices: ponderLineIndices, count: 0 },
  };
  let disposed = false;
  gl.bindTexture(gl.TEXTURE_2D, neutral);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  const uniforms = Object.fromEntries(['uProjection', 'uModelView', 'uTextureMatrix', 'uColor', 'uLight0', 'uLight1',
    'uEntity', 'uBase', 'uOverlay', 'uLightmap', 'uHasBase', 'uHasOverlay', 'uLightmapMode', 'uCutout',
    'uNextSprite', 'uSpriteWeight', 'uUnlitEntity', 'uLineWidth', 'uViewport',
    'uAtlasRegionCount', 'uAtlasBounds[0]', 'uAtlasTransforms[0]']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  const atlasBounds = new Float32Array(maxPonderAtlasRegions * 4);
  const atlasTransforms = new Float32Array(maxPonderAtlasRegions * 4);

  function drop(data: GpuData) {
    if ('texture' in data) gl.deleteTexture(data.texture);
    else gl.deleteBuffer(data.buffer);
  }

  function fitCanvas() {
    const width = canvas.clientWidth || manifest.width;
    const height = canvas.clientHeight || manifest.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2048 / Math.max(width, height));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  }

  function get(kind: Resource['kind'], path: string, atlasAnimation?: string) {
    return cache.get(resourceKey(kind, ponderAtlasTextureKey(path, atlasAnimation)));
  }

  function reserve(requirements: Map<string, Resource>, bytes: number) {
    let needed = bytes;
    for (const [key, data] of cache) if (requirements.has(key)) needed += data.size;
    if (needed > bufferBudget) throw new Error('Ponder graphics budget exceeded');
    for (const [key, data] of cache) {
      if (cachedBytes + bytes <= bufferBudget) break;
      if (requirements.has(key)) continue;
      drop(data);
      cache.delete(key);
      cachedBytes -= data.size;
    }
  }

  function upload(data: CpuData): GpuData {
    if ('bitmap' in data) {
      const texture = gl.createTexture();
      if (!texture) throw new PonderWebGlUnavailable();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Exported PNG row zero is the OpenGL row sampled at v = 0.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data.bitmap);
      return { texture, size: data.size, width: data.bitmap.width, height: data.bitmap.height, mipmapped: false };
    }
    const buffer = gl.createBuffer();
    if (!buffer) throw new PonderWebGlUnavailable();
    const indexed = data.resource.kind === 'index';
    const target = indexed ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data.bytes, gl.STATIC_DRAW);
    return { buffer, size: data.size, upperBounds: new Map(), bytes: indexed ? data.bytes : undefined };
  }

  function bindAttributes(layout: PonderAttribute[]) {
    for (let index = 0; index < attributes.length; index++) {
      const name = attributes[index];
      const field = layout.find(attribute => attribute.name === name);
      if (field) gl.enableVertexAttribArray(index);
      else {
        gl.disableVertexAttribArray(index);
        if (name === 'Color') gl.vertexAttrib4f(index, 1, 1, 1, 1);
        else if (name === 'Normal') gl.vertexAttrib3f(index, 0, 1, 0);
        else gl.vertexAttrib2f(index, 0, 0);
      }
    }
  }

  function bindSequential(mode: keyof typeof sequential, vertices: number) {
    const pattern = sequential[mode];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pattern.buffer);
    if (vertices <= pattern.count) return;
    const indices = new Uint32Array(vertices / 4 * 6);
    for (let vertex = 0, index = 0; vertex < vertices; vertex += 4, index += 6) {
      for (let lane = 0; lane < 6; lane++) indices[index + lane] = vertex + pattern.indices[lane];
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    pattern.count = vertices;
  }

  function indicesFit(index: Extract<GpuData, { buffer: WebGLBuffer }>, draw: PonderDraw) {
    const size = draw.indexType === 'INT' ? 4 : 2;
    if (!index.bytes || index.size < draw.indexCount * size) return false;
    const key = `${size}/${draw.indexCount}`;
    let maximum = index.upperBounds.get(key);
    if (maximum === undefined) {
      maximum = 0;
      const view = new DataView(index.bytes);
      for (let offset = 0; offset < draw.indexCount * size; offset += size) {
        maximum = Math.max(maximum, size === 4 ? view.getUint32(offset, true) : view.getUint16(offset, true));
      }
      if (index.upperBounds.size >= 16) index.upperBounds.clear();
      index.upperBounds.set(key, maximum);
    }
    return maximum < draw.vertexCount;
  }

  function paint(draw: PonderDraw) {
    const mesh = get('mesh', draw.vertices);
    const index = draw.indices ? get('index', draw.indices) : undefined;
    if (!mesh || !('buffer' in mesh) || mesh.size < draw.vertexCount * draw.stride
      || (draw.indices && (!index || !('buffer' in index) || !indicesFit(index, draw)))) return false;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    bindAttributes(draw.attributes);
    for (const field of draw.attributes) {
      const location = attributes.indexOf(field.name);
      if (location < 0) continue;
      gl.vertexAttribPointer(location, field.count, attributeTypes[field.type],
        field.name === 'Color' || field.name === 'Normal', draw.stride, field.offset);
    }
    const base = draw.textures[0];
    const regions = base?.atlasRegions;
    const missingBase = base && !get('image', base.image, base.atlasAnimation);
    if (missingBase && (draw.shader !== 'rendertype_solid' || regions)) return false;
    const next = base?.transition;
    const slots = [base, draw.textures[1], draw.textures[2], base && next ? { ...base, image: next.image } : undefined];
    const loadedSlots = [false, false, false, false];
    for (const [slot, descriptor] of slots.entries()) {
      const asset = descriptor && get('image', descriptor.image, descriptor.atlasAnimation);
      const loaded = asset && 'texture' in asset ? asset : undefined;
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, loaded?.texture ?? neutral);
      if (!descriptor || !loaded) continue;
      loadedSlots[slot] = true;
      if (descriptor.minFilter >= 9984 && !loaded.mipmapped) {
        gl.generateMipmap(gl.TEXTURE_2D);
        loaded.mipmapped = true;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, descriptor.minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, descriptor.magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, descriptor.wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, descriptor.wrapT);
    }
    gl.uniformMatrix4fv(uniforms.uProjection, false, draw.projection);
    gl.uniformMatrix4fv(uniforms.uModelView, false, draw.modelView);
    gl.uniformMatrix4fv(uniforms.uTextureMatrix, false, draw.textureMatrix);
    gl.uniform4fv(uniforms.uColor, draw.color);
    gl.uniform1i(uniforms.uEntity, Number(usesPonderEntityLighting(draw.shader)));
    gl.uniform1i(uniforms.uHasBase, Number(loadedSlots[0]));
    gl.uniform1i(uniforms.uHasOverlay, Number(loadedSlots[1]));
    const lightMode = ponderLightmapMode(draw.shader);
    gl.uniform1i(uniforms.uLightmapMode, !loadedSlots[2] ? 0 : lightMode === 'filtered-color' ? 1 : lightMode === 'separate' ? 3 : 2);
    gl.uniform1f(uniforms.uSpriteWeight, loadedSlots[3] && next ? next.weight : 0);
    gl.uniform1i(uniforms.uAtlasRegionCount, regions?.length ?? 0);
    if (regions) {
      for (const [index, [uMin, vMin, uMax, vMax, scaleU, scaleV, offsetU, offsetV]] of regions.entries()) {
        atlasBounds.set([uMin, vMin, uMax, vMax], index * 4);
        atlasTransforms.set([scaleU, scaleV, offsetU, offsetV], index * 4);
      }
      gl.uniform4fv(uniforms['uAtlasBounds[0]'], atlasBounds, 0, regions.length * 4);
      gl.uniform4fv(uniforms['uAtlasTransforms[0]'], atlasTransforms, 0, regions.length * 4);
    }
    gl.uniform1f(uniforms.uCutout, ponderCutout(draw));
    gl.uniform1i(uniforms.uUnlitEntity, Number(draw.shader === ponderUnlitEntityShader));
    gl.uniform1f(uniforms.uLineWidth, draw.shader === ponderLineShader ? draw.lineWidth ?? 0 : 0);
    if (draw.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(draw.depthFunction);
    gl.depthMask(draw.depthWrite);
    if (draw.cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    if (draw.blend && draw.blendFactors) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(...draw.blendFactors);
    } else gl.disable(gl.BLEND);

    const mode = modes[draw.mode];
    if (index && 'buffer' in index) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);
      gl.drawElements(mode, draw.indexCount, draw.indexType === 'INT' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    } else if (draw.mode === 'QUADS' || draw.mode === 'LINES') {
      bindSequential(draw.mode, draw.vertexCount);
      gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_INT, 0);
    } else gl.drawArrays(mode, 0, draw.vertexCount);
    return Object.values(draw.textures).every(texture => get('image', texture.image, texture.atlasAnimation)) && (!next || loadedSlots[3]);
  }

  async function render(frame: PonderFrame, current: () => boolean, tick = 0) {
    if (disposed || !current()) return;
    const list = frame.draws.filter(supported);
    const overlayStart = manifest.blockModels && frame.overlayStart !== undefined && frame.overlayStart < frame.draws.length
      ? frame.draws.slice(0, frame.overlayStart).filter(supported).length : -1;
    const required = new Map<string, Resource>();
    const add = (kind: Resource['kind'], path: string, atlasAnimation?: string) =>
      required.set(resourceKey(kind, ponderAtlasTextureKey(path, atlasAnimation)), { kind, path, atlasAnimation });
    for (const draw of list) {
      add('mesh', draw.vertices);
      if (draw.indices) add('index', draw.indices);
      for (const texture of Object.values(draw.textures)) add('image', texture.image, texture.atlasAnimation);
      const next = draw.textures[0]?.transition;
      if (next) add('image', next.image);
    }
    if (required.size > 192) throw new Error('Too many Ponder draw resources');
    const queue = [...required].filter(([key]) => !cache.has(key));
    const pending = new Map<string, CpuData>();
    let position = 0;
    let bytes = 0;
    let exceedsBudget = false;
    const workers = Array.from({ length: Math.min(queue.length, 6) }, async () => {
      while (!exceedsBudget && position < queue.length && !disposed && current()) {
        const [key, resource] = queue[position++];
        try {
          const data = await readAsset(resource.path);
          if (disposed || !current()) return;
          const view = new DataView(data);
          const imageSize = resource.kind === 'image' ? [view.getUint32(16), view.getUint32(20)] : undefined;
          if (imageSize?.some(side => side === 0 || side > maxTextureSide)) throw new Error('Invalid texture dimensions');
          // RGBA8 plus a complete mip chain is at most four thirds of the base image.
          const size = imageSize ? Math.ceil(imageSize[0] * imageSize[1] * 16 / 3) : data.byteLength;
          if (bytes + size > bufferBudget) {
            exceedsBudget = true;
            return;
          }
          bytes += size;
          try {
            const value = imageSize ? { resource, size, bitmap: await createImageBitmap(new Blob([data], { type: 'image/png' }),
              { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) } : { resource, size, bytes: data };
            pending.set(key, value);
          } catch {
            bytes -= size;
          }
        } catch {
          // A missing or invalid resource affects its draws, not the rest of the frame.
        }
      }
    });
    try {
      await Promise.all(workers);
      if (disposed || !current()) return;
      if (exceedsBudget) throw new Error('Ponder graphics budget exceeded');
      if (gl.isContextLost()) throw new PonderWebGlUnavailable();
      gl.useProgram(program);
      reserve(required, [...pending].reduce((total, [key, data]) => total + (cache.has(key) ? 0 : data.size), 0));
      for (const [key, data] of pending) {
        if (!cache.has(key)) {
          cache.set(key, upload(data));
          cachedBytes += data.size;
        }
      }
      let staticTextures = false;
      for (const [key, { atlasAnimation }] of required) {
        const entry = cache.get(key);
        if (entry) {
          cache.delete(key);
          cache.set(key, entry);
        }
        if (!atlasAnimation || !entry || !('texture' in entry) || entry.atlasTick === tick) continue;
        try {
          const patches = await atlasPlayback.sample(atlasAnimation, entry.width, entry.height, tick);
          if (disposed || !current()) return;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.texture);
          for (const { x, y, width, height, pixels } of patches) {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          }
          entry.atlasTick = tick;
          entry.mipmapped = false;
        } catch {
          if (disposed || !current()) return;
          staticTextures = true;
        }
      }
      fitCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uViewport, canvas.width, canvas.height);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1i(uniforms.uBase, 0);
      gl.uniform1i(uniforms.uOverlay, 1);
      gl.uniform1i(uniforms.uLightmap, 2);
      gl.uniform1i(uniforms.uNextSprite, 3);
      gl.uniform3fv(uniforms.uLight0, manifest.diffuseLights[0]);
      gl.uniform3fv(uniforms.uLight1, manifest.diffuseLights[1]);
      let rendered = 0;
      for (const [index, draw] of list.entries()) {
        if (index === overlayStart) {
          // GUI draws use a different depth projection. Keep depth ordering inside each layer.
          gl.depthMask(true);
          gl.clear(gl.DEPTH_BUFFER_BIT);
        }
        if (paint(draw)) rendered++;
      }
      return {
        omitted: frame.omitted + frame.draws.length - rendered,
        staticTextures: staticTextures || list.some(draw => Object.values(draw.textures).some(texture => texture.animation || texture.animated)),
      };
    } finally {
      for (const data of pending.values()) if ('bitmap' in data) data.bitmap.close();
    }
  }

  return {
    render,
    dispose() {
      disposed = true;
      atlasPlayback.dispose();
      for (const data of cache.values()) drop(data);
      cache.clear();
      gl.deleteBuffer(quad);
      gl.deleteBuffer(line);
      gl.deleteTexture(neutral);
      gl.deleteProgram(program);
    },
  };
}
