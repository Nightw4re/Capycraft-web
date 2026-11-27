const digestPattern = /^[a-f0-9]{64}$/;
const meshPath = /^ponder\/meshes\/([a-f0-9]{64})\.bin$/;
const maxMeshBytes = 1024 ** 2;

type MeshPart = { path: string; bytes: number; positionPalette?: true };
type MeshColumn = { part: number; offset: number; width: number };
type MeshStreams = { digest: string; size: number; stride: number; count: number; parts: MeshPart[]; columns: MeshColumn[] };

/** Each part contains whole byte planes for one or more vertex attributes. */
export function ponderMeshStreams(path: string): MeshStreams | undefined {
  if (path.length > 540) return;
  const version = /#v([12]):/.exec(path);
  if (!version) return;
  const separator = version.index;
  const digest = meshPath.exec(path.slice(0, separator))?.[1];
  if (!digest) return;
  const [strideText, countText, maskText, remainder, ...shared] = path.slice(separator + 4).split(':');
  if (!/^(28|32|36)$/.test(strideText) || !/^[1-9][0-9]{0,4}$/.test(countText)
    || !/^[1-9a-f][0-9a-f]?$/.test(maskText)) return;
  const stride = Number(strideText);
  const count = Number(countText);
  const size = stride * count;
  const mask = Number.parseInt(maskText, 16);
  const widths = stride === 28 ? [12, 4, 8, 4] : [12, 4, 8, 4, stride - 28];
  if (size > maxMeshBytes || mask >= 1 << widths.length) return;
  const positionPalette = version[1] === '2';
  let encodedBytes: number | undefined;
  if (positionPalette) {
    const encoded = shared.shift();
    if (mask !== (1 << widths.length) - 2 || !encoded || !/^[1-9][0-9]{0,6}$/.test(encoded)) return;
    encodedBytes = Number(encoded);
    if (encodedBytes < 8 || encodedBytes >= count * 12) return;
  }
  const parts: MeshPart[] = [];
  const columns: MeshColumn[] = [];
  let remaining = 0;
  for (const [index, width] of widths.entries()) {
    const bytes = count * width;
    if (mask & (1 << index)) {
      const hash = shared[parts.length];
      if (!hash || !digestPattern.test(hash)) return;
      columns.push({ part: parts.length, offset: 0, width });
      parts.push({ path: `ponder/meshes/${hash}.bin`, bytes });
    } else {
      columns.push({ part: -1, offset: remaining, width });
      remaining += bytes;
    }
  }
  if (parts.length !== shared.length) return;
  if (remaining) {
    if (!remainder || !digestPattern.test(remainder)) return;
    for (const column of columns) if (column.part === -1) column.part = parts.length;
    parts.push({ path: `ponder/meshes/${remainder}.bin`, bytes: encodedBytes ?? remaining,
      ...(positionPalette && { positionPalette: true }) });
  } else if (remainder !== '-') return;
  return { digest, size, stride, count, parts, columns };
}

function decodePositionPlanes(source: Uint8Array, count: number) {
  const width = source[0];
  if (width !== 4 && width !== 12) return;
  const paletteCount = source[1] + source[2] * 256;
  const indexWidth = paletteCount <= 256 ? 1 : 2;
  const start = 3 + paletteCount * width;
  const wordsPerVertex = 12 / width;
  if (!paletteCount || start + count * wordsPerVertex * indexWidth !== source.byteLength) return;
  const result = new Uint8Array(12 * count);
  for (let vertex = 0, at = start; vertex < count; vertex++) {
    for (let word = 0; word < wordsPerVertex; word++, at += indexWidth) {
      const index = source[at] + (indexWidth === 2 ? source[at + 1] * 256 : 0);
      if (index >= paletteCount) return;
      const entry = 3 + index * width;
      for (let byte = 0; byte < width; byte++) result[(word * width + byte) * count + vertex] = source[entry + byte];
    }
  }
  return result;
}

export function assemblePonderMesh(stream: MeshStreams, parts: readonly Uint8Array[]) {
  if (parts.length !== stream.parts.length || parts.some((part, index) => part.byteLength !== stream.parts[index].bytes)) return;
  const result = new Uint8Array(stream.size);
  const { stride, count } = stream;
  let firstLane = 0;
  for (const { part, offset, width } of stream.columns) {
    const source = stream.parts[part].positionPalette ? decodePositionPlanes(parts[part], count) : parts[part];
    if (!source) return;
    for (let lane = 0; lane < width; lane++) {
      const start = offset + lane * count;
      for (let vertex = 0; vertex < count; vertex++) result[vertex * stride + firstLane + lane] = source[start + vertex];
    }
    firstLane += width;
  }
  return result;
}
