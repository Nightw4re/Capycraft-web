import { maxTextureSide, type PonderAttribute, type PonderDraw, type PonderFrame, type PonderManifest } from './format.mts';

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
out vec4 vColor;
out vec2 vUV;
flat out ivec2 vOverlay;
out vec2 vLight;
void main() {
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
  vUV = (uTextureMatrix * vec4(aUV, 0.0, 1.0)).xy;
  vColor = aColor;
  vOverlay = ivec2(aOverlay);
  vLight = aLight;
  if (uEntity) {
    vec3 normal = normalize(aNormal);
    float shading = min(1.0, 0.4 + 0.6 * (max(0.0, dot(normal, uLight0)) + max(0.0, dot(normal, uLight1))));
    vColor.rgb *= shading;
  }
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D uBase, uOverlay, uLightmap;
uniform bool uHasBase, uHasOverlay, uHasLightmap;
uniform float uCutout;
uniform vec4 uColor;
in vec4 vColor;
in vec2 vUV;
flat in ivec2 vOverlay;
in vec2 vLight;
out vec4 color;
void main() {
  color = vColor * uColor;
  if (uHasBase) color *= texture(uBase, vUV);
  if (color.a < uCutout) discard;
  if (uHasOverlay) {
    ivec2 size = textureSize(uOverlay, 0);
    vec4 overlay = texelFetch(uOverlay, clamp(vOverlay, ivec2(0), size - 1), 0);
    color.rgb = mix(overlay.rgb, color.rgb, overlay.a);
  }
  if (uHasLightmap) {
    vec2 size = vec2(textureSize(uLightmap, 0));
    color *= texture(uLightmap, clamp((vLight / 16.0 + 0.5) / size, 0.5 / size, 1.0 - 0.5 / size));
  }
}`;

const texturedShaders = new Set([
  'position_tex', 'position_tex_color', 'position_color_tex', 'position_tex_lightmap_color', 'particle',
  'rendertype_solid', 'rendertype_cutout', 'rendertype_cutout_mipped', 'rendertype_translucent',
  'rendertype_translucent_moving_block', 'rendertype_text', 'rendertype_text_see_through',
  'rendertype_text_polygon_offset', 'rendertype_entity_solid', 'rendertype_entity_cutout',
  'rendertype_entity_cutout_no_cull', 'rendertype_entity_cutout_no_cull_z_offset',
  'rendertype_entity_translucent', 'rendertype_entity_translucent_cull',
]);
const colorShaders = new Set(['position', 'position_color', 'rendertype_gui', 'rendertype_gui_overlay',
  'rendertype_gui_text_highlight', 'rendertype_text_background', 'rendertype_text_background_see_through']);
const modes: Record<string, number> = { QUADS: 4, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, DEBUG_LINES: 1, DEBUG_LINE_STRIP: 3 };
const attributeTypes: Record<string, number> = { BYTE: 5120, UBYTE: 5121, SHORT: 5122, USHORT: 5123, FLOAT: 5126 };
const attributes = ['Position', 'Color', 'UV0', 'UV1', 'UV2', 'Normal'];
const bufferBudget = 96 * 1024 ** 2;

function supported(draw: PonderDraw) {
  if (!Object.hasOwn(modes, draw.mode)) return false;
  const position = draw.attributes.find(attribute => attribute.name === 'Position');
  if (!position || position.count !== 3 || position.type !== 'FLOAT') return false;
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

type Resource = { path: string; kind: 'mesh' | 'index' | 'image' };
type ImageData = { resource: Resource; bitmap: ImageBitmap; size: number };
type BufferData = { resource: Resource; bytes: ArrayBuffer; size: number };
type CpuData = ImageData | BufferData;
type GpuData =
  | { texture: WebGLTexture; size: number; mipmapped: boolean }
  | { buffer: WebGLBuffer; size: number; upperBounds: Map<string, number>; bytes?: ArrayBuffer };

function resourceKey(kind: Resource['kind'], path: string) {
  return `${kind}:${path}`;
}

export function createPonderRenderer(canvas: HTMLCanvasElement, manifest: PonderManifest, readAsset: (path: string) => Promise<ArrayBuffer>) {
  const context = canvas.getContext('webgl2', { alpha: true, depth: true, premultipliedAlpha: false });
  if (!context || context.isContextLost()) throw new PonderWebGlUnavailable();
  const gl = context;
  const program = createProgram(gl);
  const neutral = gl.createTexture();
  const quad = gl.createBuffer();
  if (!neutral || !quad) {
    gl.deleteTexture(neutral);
    gl.deleteBuffer(quad);
    gl.deleteProgram(program);
    throw new PonderWebGlUnavailable();
  }
  const cache = new Map<string, GpuData>();
  let cachedBytes = 0;
  let quadCount = 0;
  let disposed = false;
  gl.bindTexture(gl.TEXTURE_2D, neutral);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  const uniforms = Object.fromEntries(['uProjection', 'uModelView', 'uTextureMatrix', 'uColor', 'uLight0', 'uLight1',
    'uEntity', 'uBase', 'uOverlay', 'uLightmap', 'uHasBase', 'uHasOverlay', 'uHasLightmap', 'uCutout']
    .map(name => [name, gl.getUniformLocation(program, name)]));

  function drop(data: GpuData) {
    if ('texture' in data) gl.deleteTexture(data.texture);
    else gl.deleteBuffer(data.buffer);
  }

  function get(kind: Resource['kind'], path: string) {
    return cache.get(resourceKey(kind, path));
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
      return { texture, size: data.size, mipmapped: false };
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

  function bindQuads(vertices: number) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad);
    if (vertices <= quadCount) return;
    const indices = new Uint32Array(vertices / 4 * 6);
    for (let vertex = 0, index = 0; vertex < vertices; vertex += 4, index += 6) {
      indices[index] = vertex;
      indices[index + 1] = vertex + 1;
      indices[index + 2] = vertex + 2;
      indices[index + 3] = vertex + 2;
      indices[index + 4] = vertex + 3;
      indices[index + 5] = vertex;
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    quadCount = vertices;
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
    for (let slot = 0; slot < 3; slot++) {
      const descriptor = draw.textures[slot];
      const asset = descriptor && get('image', descriptor.image);
      const loaded = asset && 'texture' in asset ? asset : undefined;
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, loaded?.texture ?? neutral);
      if (!descriptor || !loaded) continue;
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
    gl.uniform1i(uniforms.uEntity, Number(draw.shader.startsWith('rendertype_entity')));
    gl.uniform1i(uniforms.uHasBase, Number(!!draw.textures[0]));
    gl.uniform1i(uniforms.uHasOverlay, Number(!!draw.textures[1]));
    gl.uniform1i(uniforms.uHasLightmap, Number(!!draw.textures[2]));
    gl.uniform1f(uniforms.uCutout, /cutout|text|particle/.test(draw.shader) ? 0.1 : 0.003);
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
    } else if (draw.mode === 'QUADS') {
      bindQuads(draw.vertexCount);
      gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_INT, 0);
    } else gl.drawArrays(mode, 0, draw.vertexCount);
    return true;
  }

  async function render(frame: PonderFrame, current: () => boolean) {
    if (disposed || !current()) return;
    const list = frame.draws.filter(supported);
    const required = new Map<string, Resource>();
    const add = (kind: Resource['kind'], path: string) => required.set(resourceKey(kind, path), { kind, path });
    for (const draw of list) {
      add('mesh', draw.vertices);
      if (draw.indices) add('index', draw.indices);
      for (const texture of Object.values(draw.textures)) add('image', texture.image);
    }
    if (required.size > 192) throw new Error('Too many Ponder draw resources');
    const queue = [...required].filter(([key]) => !cache.has(key));
    const pending = new Map<string, CpuData>();
    let position = 0;
    let bytes = 0;
    let failed: { error: unknown } | undefined;
    const workers = Array.from({ length: Math.min(queue.length, 6) }, async () => {
      while (!failed && position < queue.length && !disposed && current()) {
        const [key, resource] = queue[position++];
        try {
          const data = await readAsset(resource.path);
          if (disposed || !current()) return;
          const view = new DataView(data);
          const imageSize = resource.kind === 'image' ? [view.getUint32(16), view.getUint32(20)] : undefined;
          if (imageSize?.some(side => side === 0 || side > maxTextureSide)) throw new Error('Invalid texture dimensions');
          // RGBA8 plus a complete mip chain is at most four thirds of the base image.
          const size = imageSize ? Math.ceil(imageSize[0] * imageSize[1] * 16 / 3) : data.byteLength;
          bytes += size;
          if (bytes > bufferBudget) throw new Error('Ponder graphics budget exceeded');
          const value = imageSize ? { resource, size, bitmap: await createImageBitmap(new Blob([data], { type: 'image/png' }),
            { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) } : { resource, size, bytes: data };
          pending.set(key, value);
        } catch (error) {
          failed = { error };
        }
      }
    });
    try {
      await Promise.all(workers);
      if (disposed || !current()) return;
      if (failed) throw failed.error;
      if (gl.isContextLost()) throw new PonderWebGlUnavailable();
      gl.useProgram(program);
      reserve(required, [...pending].reduce((total, [key, data]) => total + (cache.has(key) ? 0 : data.size), 0));
      for (const [key, data] of pending) {
        if (!cache.has(key)) {
          cache.set(key, upload(data));
          cachedBytes += data.size;
        }
      }
      for (const key of required.keys()) {
        const entry = cache.get(key);
        if (entry) {
          cache.delete(key);
          cache.set(key, entry);
        }
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1i(uniforms.uBase, 0);
      gl.uniform1i(uniforms.uOverlay, 1);
      gl.uniform1i(uniforms.uLightmap, 2);
      gl.uniform3fv(uniforms.uLight0, manifest.diffuseLights[0]);
      gl.uniform3fv(uniforms.uLight1, manifest.diffuseLights[1]);
      let rendered = 0;
      for (const draw of list) if (paint(draw)) rendered++;
      return {
        omitted: frame.omitted + frame.draws.length - rendered,
        staticTextures: list.some(draw => Object.values(draw.textures).some(texture => texture.animation)),
      };
    } finally {
      for (const data of pending.values()) if ('bitmap' in data) data.bitmap.close();
    }
  }

  return {
    render,
    dispose() {
      disposed = true;
      for (const data of cache.values()) drop(data);
      cache.clear();
      gl.deleteBuffer(quad);
      gl.deleteTexture(neutral);
      gl.deleteProgram(program);
    },
  };
}
