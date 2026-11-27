import { grassFaces, grassTexture } from './grassBlock';
import { projectFigure, stageHeight, stageWidth, type PortraitFrame } from './portraitScene';
import { shade } from './renderPortrait';
import { skinFaces, type Face, type Point, type PortraitSkin } from './skinGeometry';

const vertexSource = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 faceUV;
layout(location = 2) in vec4 textureRect;
layout(location = 3) in vec2 lightingAndFlip;
out vec2 uv;
flat out vec4 rect;
flat out vec2 material;
void main() {
  gl_Position = vec4(position.x * ${2 / stageWidth} - 1.0,
    1.0 - position.y * ${2 / stageHeight}, -position.z / 512.0, 1.0);
  uv = faceUV;
  rect = textureRect;
  material = lightingAndFlip;
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D skin;
in vec2 uv;
flat in vec4 rect;
flat in vec2 material;
out vec4 color;
void main() {
  vec2 texel = clamp(floor(uv * rect.zw), vec2(0), rect.zw - 1.0);
  if (material.y > 0.0) texel.x = rect.z - 1.0 - texel.x;
  vec4 pixel = texelFetch(skin, ivec2(rect.xy + texel), 0);
  if (pixel.a < 26.0 / 255.0) discard;
  color = vec4(pixel.rgb * material.x, 1.0);
}`;

function attachShader(gl: WebGL2RenderingContext, program: WebGLProgram, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not allocate portrait shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  gl.attachShader(program, shader);
  gl.deleteShader(shader);
}

const quad = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]];
const components = [3, 2, 4, 2];
const vertexSize = 11;
const stride = vertexSize * Float32Array.BYTES_PER_ELEMENT;

function faceVertices(faces: Face[], project: (point: Point) => Point) {
  const vertices = new Float32Array(faces.length * quad.length * vertexSize);
  let index = 0;
  for (const { corners, texture: [u, v], width, height, flipU } of faces) {
    const [a, b, c] = corners.map(project);
    const along: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const down: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const lighting = shade(along, down);
    for (const [s, t] of quad) {
      vertices[index++] = a[0] + s * along[0] + t * down[0];
      vertices[index++] = a[1] + s * along[1] + t * down[1];
      vertices[index++] = a[2] + s * along[2] + t * down[2];
      vertices.set([s, t, u, v, width, height, lighting, Number(!!flipU)], index);
      index += 8;
    }
  }
  return vertices;
}

export function createWebGLPortraitRenderer(canvas: HTMLCanvasElement, skins: ReadonlyMap<string, PortraitSkin>) {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true });
  if (!context || context.isContextLost()) throw new Error('WebGL2 is unavailable');
  const gl = context;

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const textures = new Map<Uint8ClampedArray, WebGLTexture>();
  function dispose() {
    for (const texture of textures.values()) gl.deleteTexture(texture);
    textures.clear();
    gl.useProgram(null);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  }

  try {
    if (!program || !buffer) throw new Error('Could not allocate portrait renderer');
    attachShader(gl, program, gl.VERTEX_SHADER, vertexSource);
    attachShader(gl, program, gl.FRAGMENT_SHADER, fragmentSource);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link portrait shaders');
    }
    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    components.forEach((size, location) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      offset += size * Float32Array.BYTES_PER_ELEMENT;
    });
  } catch (error) {
    dispose();
    throw error;
  }

  function draw(vertices: Float32Array, pixels: Uint8ClampedArray) {
    let texture = textures.get(pixels);
    if (!texture) {
      texture = gl.createTexture() ?? undefined;
      if (!texture) throw new Error('Could not allocate portrait texture');
      textures.set(pixels, texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 64, 64);
      const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not upload portrait texture');
    } else {
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / vertexSize);
  }

  function render({ actors, block }: PortraitFrame) {
    if (gl.isContextLost()) throw new Error('WebGL context was lost');
    const retained = new Set([grassTexture, ...Array.from(skins.values(), skin => skin.pixels)]);
    for (const [pixels, texture] of textures) {
      if (retained.has(pixels)) continue;
      gl.deleteTexture(texture);
      textures.delete(pixels);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const actor of actors) {
      const skin = skins.get(actor.player);
      if (!skin) throw new Error(`Missing skin for ${actor.player}`);
      const faces = skinFaces(actor.pose, actor.headOnly ?? false, skin.model);
      draw(faceVertices(faces, projectFigure(actor)), skin.pixels);
    }
    if (block) draw(faceVertices(grassFaces(block), point => point), grassTexture);
  }

  return { render, dispose };
}
