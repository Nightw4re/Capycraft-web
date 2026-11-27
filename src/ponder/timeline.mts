import { isRecord } from '../objectPatch.mts';
import { compressPonderBundleRef, expandPonderBundleRef } from './bundleRefs.mts';
import { compactPonderMatrixEdit, readCompactPonderMatrixEdit } from './matrixEdits.mts';

const listFields = ['layout', 'movingLayout', 'scene', 'overlay', 'fluidFaces'] as const;
const transformFields = ['layout', 'movingLayout', 'fluidFaces'] as const;
const layoutLanes = ['transform', 'blocks', 'textureOffsets'] as const;
const layoutPaletteLanes = ['blocks', 'textureOffsets'] as const;
const drawPaletteLanes = ['attributes', 'textures', 'modelView', 'projection', 'textureMatrix', 'color',
  'blendFactors', 'vertices', 'indices'] as const;
const vectorLengths = new Map([['transform', 16], ['modelView', 16], ['projection', 16], ['textureMatrix', 16], ['color', 4]]);
const identityTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const maxEntries = 8192;
type Entry = Record<string, unknown>;
type Edit = [number, Entry, string[]?];
type Timeline = { version: number; patches: Entry[]; transforms?: unknown[]; layoutValues?: Entry };

function mapDrawRefs(entry: Entry, remap: (value: string) => string | undefined): Entry | undefined {
  const vertices = typeof entry.vertices === 'string' ? remap(entry.vertices) : entry.vertices;
  const indices = typeof entry.indices === 'string' ? remap(entry.indices) : entry.indices;
  if ((vertices === undefined && typeof entry.vertices === 'string') || (indices === undefined && typeof entry.indices === 'string')) return;
  return vertices === entry.vertices && indices === entry.indices ? entry
    : { ...entry, ...(vertices !== undefined && { vertices }), ...(indices !== undefined && { indices }) };
}

function recordList(value: unknown): value is Entry[] {
  return Array.isArray(value) && value.length <= maxEntries && value.every(isRecord);
}

function isVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function applyMaskedVector(base: unknown, packed: unknown, length: number, allowIdentity = false, version = 0): number[] | undefined {
  if (version >= 7 && typeof packed === 'string') packed = readCompactPonderMatrixEdit(packed, version >= 9);
  if (!isVector(base, length) || !Array.isArray(packed) || packed.length < 1 || packed.length > length + 1) return;
  const [mask, ...values] = packed;
  if (!Number.isInteger(mask) || mask < (allowIdentity ? 0 : 1) || mask >= (1 << length)
    || !values.every(Number.isFinite)) return;
  let index = 0;
  const result = base.map((value, lane) => mask & (1 << lane) ? values[index++] : value);
  if (index === values.length) return result;
}

function applyVectorEdit(base: unknown, edit: Entry, length: number, version = 0) {
  if (Object.keys(edit).length === 1) return applyMaskedVector(base, edit.d, length, false, version);
}

function absoluteTransform(value: unknown, version: number) {
  if (isRecord(value) && Object.keys(value).length === 1) return applyMaskedVector(identityTransform, value.a, 16, true, version);
}

function mapDrawEntries(value: unknown, replace: (draw: Entry) => Entry | undefined): unknown {
  if (Array.isArray(value) && value.length <= maxEntries) return value.map(draw => isRecord(draw) ? replace(draw) : undefined);
  if (!isRecord(value) || !Array.isArray(value.edits) || value.edits.length > maxEntries) return;
  return { ...value, edits: value.edits.map(edit => {
    if (!Array.isArray(edit) || edit.length < 2 || edit.length > 3 || !isRecord(edit[1])) return;
    return [edit[0], replace(edit[1]), ...edit.slice(2)];
  }) };
}

function drawPaletteValue(lane: string, value: unknown) {
  if (lane === 'vertices' || lane === 'indices') return typeof value === 'string';
  if (lane === 'textures') return isRecord(value);
  return Array.isArray(value);
}

function expandDrawValues(entry: Entry, palettes: Entry): Entry | undefined {
  let result = entry;
  for (const lane of drawPaletteLanes) {
    const index = entry[lane];
    if (typeof index !== 'number') continue;
    const values = palettes[lane];
    if (!Array.isArray(values) || !Number.isInteger(index) || index < 0 || index >= values.length) return;
    if (result === entry) result = { ...entry };
    result[lane] = values[index];
  }
  return result;
}

function layoutEntry(value: unknown): Entry | undefined {
  if (isRecord(value)) return value;
  if (!Array.isArray(value) || value.length < 1 || value.length > layoutLanes.length || value.at(-1) == null) return;
  return Object.fromEntries(layoutLanes.flatMap((key, index) => value[index] == null ? [] : [[key, value[index]]]));
}

function resolveTransform(entry: Entry, transforms?: unknown[], absolute = false, version = 0): Entry | undefined {
  if (absolute && isRecord(entry.transform) && Object.hasOwn(entry.transform, 'a')) {
    const decoded = absoluteTransform(entry.transform, version);
    return decoded && { ...entry, transform: decoded };
  }
  if (typeof entry.transform !== 'number' || (!transforms && !absolute)) return entry;
  const index = entry.transform;
  if (transforms && Number.isInteger(index) && index >= 0 && index < transforms.length) {
    return { ...entry, transform: transforms[index] };
  }
}

function applyListEdits(base: Entry[], value: Entry, vectorEdits: boolean, transforms?: unknown[], absolute = false,
  tuple = false, version = 0): Entry[] | undefined {
  const { length, edits } = value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > maxEntries
    || !Array.isArray(edits) || edits.length > length) return;
  const result = base.slice(0, length);
  let last = -1;
  for (const edit of edits) {
    if (!Array.isArray(edit) || edit.length < 2 || edit.length > 3) return;
    const [slot, encoded, removed = []] = edit;
    const decoded = tuple ? layoutEntry(encoded) : encoded;
    if (!Number.isInteger(slot) || slot <= last || slot >= length || slot > result.length
      || !isRecord(decoded) || !Array.isArray(removed)) return;
    const changes = resolveTransform(decoded, transforms, absolute, version);
    if (!changes) return;
    const old = base[slot];
    const entry = { ...old, ...changes };
    if (vectorEdits) {
      for (const [key, change] of Object.entries(changes)) {
        const lanes = vectorLengths.get(key);
        if (!lanes || !isRecord(change) || !Object.hasOwn(change, 'd')) continue;
        const vector = applyVectorEdit(old?.[key], change, lanes, version);
        if (!vector) return;
        entry[key] = vector;
      }
    }
    const keys = new Set<string>();
    for (const key of removed) {
      if (typeof key !== 'string' || !old || !Object.hasOwn(old, key)
        || Object.hasOwn(changes, key) || keys.has(key)) return;
      keys.add(key);
      delete entry[key];
    }
    result[slot] = entry;
    last = slot;
  }
  if (result.length === length) return result;
}

function expandMovingEdits(value: unknown): unknown {
  if (!Array.isArray(value) || typeof value[0] !== 'number') return value;
  const length = value[0];
  if (!Number.isSafeInteger(length) || length < 0 || length > maxEntries || value.length - 1 > length) return;
  return { length, edits: value.slice(1).map(edit => {
    if (!Array.isArray(edit) || edit.length !== 2) return edit;
    const [slot, field] = edit;
    if (typeof field === 'string') return [slot, [{ d: field }]];
    if (!Number.isSafeInteger(field)) return edit;
    return [slot, field >= 0 ? [field] : [null, null, -1 - field]];
  }) };
}

/** Each encoded chunk has its own baseline and can be decoded in isolation. */
export function readPonderTimelinePatches(data: unknown, count: number, bundle?: string): Entry[] | undefined {
  if (Array.isArray(data)) return data.length === count && data.every(isRecord) ? data : undefined;
  if (!isRecord(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3
    && data.version !== 4 && data.version !== 5 && data.version !== 6 && data.version !== 7 && data.version !== 8 && data.version !== 9
    && data.version !== 10)
    || !Array.isArray(data.patches)
    || data.patches.length !== count) return;
  const version = data.version;
  const drawValues = version >= 8 ? data.drawValues : undefined;
  if ((version === 8 || drawValues !== undefined) && (!isRecord(drawValues) || !Object.keys(drawValues).length
    || Object.entries(drawValues).some(([lane, values]) => !drawPaletteLanes.some(key => key === lane)
      || !Array.isArray(values) || !values.length || values.length > maxEntries
      || !values.every(value => drawPaletteValue(lane, value))))) return;
  const layoutValues = data.version >= 6 ? data.layoutValues : undefined;
  if ((data.version === 6 || layoutValues !== undefined) && (!isRecord(layoutValues) || !Object.keys(layoutValues).length
    || Object.keys(layoutValues).some(lane => !layoutPaletteLanes.some(key => key === lane))
    || Object.values(layoutValues).some(values => !Array.isArray(values) || !values.length
      || values.length > maxEntries || !values.every(Array.isArray)))) return;
  const shortRefs = data.version >= 5;
  const absolute = data.version === 4 || shortRefs;
  let palette: unknown[] | undefined;
  if (data.version === 3 || (absolute && data.transforms !== undefined)) {
    const { transforms } = data;
    if (!Array.isArray(transforms) || !transforms.length || transforms.length > maxEntries) return;
    const zero = Array<number>(16).fill(0);
    palette = transforms.map(value => isVector(value, 16) ? value
      : absolute && isRecord(value) && Object.hasOwn(value, 'a') ? absoluteTransform(value, version)
      : isRecord(value) && applyVectorEdit(zero, value, 16, version) ? value : undefined);
    if (palette.some(value => value === undefined)) return;
  }
  const previous = new Map<string, Entry[]>();
  const bundleRefs = new Map<string, string | undefined>();
  const resolveBundleRef = (path: string) => {
    if (!path.startsWith('~')) return path;
    if (!bundleRefs.has(path)) bundleRefs.set(path, expandPonderBundleRef(path, bundle));
    return bundleRefs.get(path);
  };
  const patches: Entry[] = [];
  for (const patch of data.patches) {
    if (!isRecord(patch)) return;
    const frame = { ...patch };
    for (const field of listFields) {
      if (!Object.hasOwn(patch, field)) continue;
      const base = previous.get(field);
      const transformField = field !== 'scene' && field !== 'overlay';
      const raw = !transformField && isRecord(drawValues)
        ? mapDrawEntries(patch[field], draw => expandDrawValues(draw, drawValues))
        : version === 10 && field === 'movingLayout' ? expandMovingEdits(patch[field]) : patch[field];
      const transforms = transformField ? palette : undefined;
      const allowAbsolute = transformField && absolute;
      const tuple = absolute && (field === 'layout' || field === 'movingLayout');
      const value = tuple && Array.isArray(raw) && raw.length <= maxEntries ? raw.map(layoutEntry) : raw;
      const full = recordList(value);
      const decoded = full ? (transforms || allowAbsolute ? value.map(entry => resolveTransform(entry, transforms, allowAbsolute, version)) : value)
        : base && isRecord(value)
        ? applyListEdits(base, value, version !== 1, transforms, allowAbsolute, tuple, version)
        : undefined;
      if (!recordList(decoded) || ((transforms || allowAbsolute) && full && decoded.some(entry =>
        Object.hasOwn(entry, 'transform') && !isVector(entry.transform, 16)))) return;
      const resolved = shortRefs && !transformField ? decoded.map(entry => mapDrawRefs(entry, resolveBundleRef))
        : tuple && isRecord(layoutValues) ? decoded.map(entry => resolveLayoutValues(entry, layoutValues)) : decoded;
      if (!recordList(resolved)) return;
      frame[field] = resolved;
      previous.set(field, resolved);
    }
    patches.push(frame);
  }
  return patches;
}

function resolveLayoutValues(entry: Entry, palettes: Entry): Entry | undefined {
  let result = entry;
  for (const lane of layoutPaletteLanes) {
    const value = entry[lane];
    if (typeof value !== 'number') continue;
    const values = palettes[lane];
    if (!Array.isArray(values) || !Number.isInteger(value) || value < 0 || value >= values.length) return;
    result = { ...result, [lane]: values[value] };
  }
  return result;
}

function mapTimelineTransforms(encoded: Entry[], replace: (entry: Entry, field: typeof transformFields[number]) => unknown) {
  return encoded.map(frame => {
    const patch = { ...frame };
    for (const field of transformFields) {
      const value = frame[field];
      if (recordList(value)) patch[field] = value.map(entry => replace(entry, field));
      else if (isRecord(value) && Array.isArray(value.edits)) {
        patch[field] = { ...value, edits: (value.edits as Edit[]).map(([slot, entry, ...rest]) =>
          [slot, replace(entry, field), ...rest]) };
      }
    }
    return patch;
  });
}

function shareTimelineTransforms(encoded: Entry[], keyOf: (value: unknown) => string) {
  const entries = encoded.flatMap(frame => transformFields.flatMap(field => {
    const value = frame[field];
    return recordList(value) ? value : isRecord(value) && Array.isArray(value.edits)
      ? (value.edits as Edit[]).map(edit => edit[1]) : [];
  }));
  const occurrences = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!Object.hasOwn(entry, 'transform')) continue;
    const key = keyOf(entry.transform);
    const matching = occurrences.get(key);
    if (matching) matching.push(entry);
    else occurrences.set(key, [entry]);
  }
  const transforms: unknown[] = [];
  const references = new Map<Entry, number>();
  for (const [key, matching] of occurrences) {
    const index = transforms.length;
    if (index >= maxEntries) break;
    if ((matching.length - 1) * key.length <= matching.length * String(index).length + 1) continue;
    transforms.push(matching[0].transform);
    for (const entry of matching) references.set(entry, index);
  }
  if (!transforms.length) return;
  const replace = (entry: Entry) => references.has(entry) ? { ...entry, transform: references.get(entry) } : entry;
  return { version: 3, transforms, patches: mapTimelineTransforms(encoded, replace) };
}

function maskedVector(base: number[], value: number[]) {
  let mask = 0;
  const values: number[] = [];
  value.forEach((next, lane) => {
    if (Object.is(next, base[lane])) return;
    mask |= 1 << lane;
    values.push(next);
  });
  return [mask, ...values];
}

function encodeVectorEdit(key: string, base: unknown, value: unknown) {
  const length = vectorLengths.get(key);
  if (!length || !isVector(base, length) || !isVector(value, length)) return value;
  const edit = { d: maskedVector(base, value) };
  return edit.d[0] && JSON.stringify(edit).length < JSON.stringify(value).length ? edit : value;
}

function shareLayoutValues(timeline: Timeline, keyOf: (value: unknown) => string): Timeline {
  const palettes: Entry = {};
  const references = new Map<string, Map<string, number>>();
  for (const lane of layoutPaletteLanes) {
    const counts = new Map<string, { value: unknown[]; count: number }>();
    for (const frame of timeline.patches) {
      for (const field of ['layout', 'movingLayout']) {
        const current = frame[field];
        const entries = recordList(current) ? current : isRecord(current) && Array.isArray(current.edits)
          ? (current.edits as Edit[]).map(edit => edit[1]) : [];
        for (const entry of entries) {
          const value = entry[lane];
          if (!Array.isArray(value)) continue;
          const key = keyOf(value);
          const seen = counts.get(key);
          if (seen) seen.count++;
          else counts.set(key, { value, count: 1 });
        }
      }
    }
    const values: unknown[][] = [];
    const indices = new Map<string, number>();
    for (const [key, { value, count }] of counts) {
      const index = values.length;
      if (index >= maxEntries) break;
      if ((count - 1) * key.length <= count * String(index).length + 1) continue;
      indices.set(key, index);
      values.push(value);
    }
    if (values.length) {
      palettes[lane] = values;
      references.set(lane, indices);
    }
  }
  if (!references.size) return timeline;
  const patches = mapTimelineTransforms(timeline.patches, (entry, field) => {
    let result = entry;
    if (field === 'fluidFaces') return result;
    for (const [lane, indices] of references) {
      const value = entry[lane];
      const index = Array.isArray(value) ? indices.get(keyOf(value)) : undefined;
      if (index !== undefined) result = { ...result, [lane]: index };
    }
    return result;
  });
  return { ...timeline, version: 6, layoutValues: palettes, patches };
}

function compactLayoutValues(timeline: Timeline, binary = false) {
  let changed = false;
  let packedMatrices = false;
  let packedRotation = false;
  const encodeEdit = (key: 'a' | 'd', values: number[]) => {
    const data = binary ? compactPonderMatrixEdit(values) : values;
    packedMatrices ||= typeof data === 'string';
    packedRotation ||= typeof data === 'string' && data.startsWith('.');
    return { [key]: data };
  };
  const pack = (value: unknown) => {
    if (binary && isRecord(value) && Array.isArray(value.d) && value.d.every(Number.isFinite)) {
      const result = encodeEdit('d', value.d);
      if (typeof result.d === 'string') {
        changed = true;
        return result;
      }
    }
    if (!isVector(value, 16)) return value;
    const edit = encodeEdit('a', maskedVector(identityTransform, value));
    if (JSON.stringify(edit).length >= JSON.stringify(value).length) return value;
    changed = true;
    return edit;
  };
  const transforms = timeline.transforms?.map(pack);
  const patches = mapTimelineTransforms(timeline.patches, (entry, field) => {
    const transform = pack(entry.transform);
    const value = transform === entry.transform ? entry : { ...entry, transform };
    if (field === 'fluidFaces' || Object.keys(value).some(key => !layoutLanes.some(lane => lane === key))) return value;
    if (Object.values(value).some(lane => lane == null)) return value;
    const slots = layoutLanes.map(lane => value[lane] ?? null);
    while (slots.at(-1) === null) slots.pop();
    if (!slots.length || JSON.stringify(slots).length >= JSON.stringify(value).length) return value;
    changed = true;
    return slots;
  });
  return changed ? { ...timeline, version: packedRotation ? 9 : packedMatrices ? 7 : Math.max(4, timeline.version),
    ...(transforms && { transforms }), patches } : timeline;
}

function shareDrawValues(document: Timeline | Entry[]) {
  const timeline = Array.isArray(document) ? { patches: document } : document;
  const occurrences = new Map<string, Map<string, number>>();
  for (const lane of drawPaletteLanes) occurrences.set(lane, new Map());
  for (const patch of timeline.patches) {
    for (const field of ['scene', 'overlay']) {
      mapDrawEntries(patch[field], draw => {
        for (const lane of drawPaletteLanes) {
          const value = draw[lane];
          if (!drawPaletteValue(lane, value)) continue;
          const counts = occurrences.get(lane)!;
          const key = JSON.stringify(value);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return draw;
      });
    }
  }
  const palettes: Entry = {};
  const references = new Map<string, Map<string, number>>();
  for (const [lane, counts] of occurrences) {
    const values = [];
    const indices = new Map<string, number>();
    for (const [key, count] of counts) {
      if (values.length >= maxEntries) break;
      if ((count - 1) * key.length <= count * String(values.length).length + 1) continue;
      indices.set(key, values.length);
      values.push(JSON.parse(key));
    }
    if (values.length) {
      palettes[lane] = values;
      references.set(lane, indices);
    }
  }
  if (!references.size) return document;
  const patches = timeline.patches.map(patch => {
    const fields = { ...patch };
    for (const field of ['scene', 'overlay']) {
      if (!Object.hasOwn(patch, field)) continue;
      fields[field] = mapDrawEntries(patch[field], draw => Object.fromEntries(
        Object.entries(draw).map(([lane, value]) => [lane, references.get(lane)?.get(JSON.stringify(value)) ?? value])));
    }
    return fields;
  });
  return { ...timeline, version: Math.max(8, 'version' in timeline ? timeline.version : 0), drawValues: palettes, patches };
}

function packMovingEdits(document: Timeline | Entry[]) {
  if (Array.isArray(document)) return document;
  let changed = false;
  const patches = document.patches.map(patch => {
    const moving = patch.movingLayout;
    if (!isRecord(moving) || !Array.isArray(moving.edits)) return patch;
    changed = true;
    const edits = moving.edits.map(([slot, fields, ...removed]) => {
      if (!removed.length && Array.isArray(fields)) {
        if (fields.length === 1 && Number.isSafeInteger(fields[0]) && fields[0] >= 0) return [slot, fields[0]];
        if (fields.length === 1 && isRecord(fields[0]) && typeof fields[0].d === 'string'
          && Object.keys(fields[0]).length === 1) return [slot, fields[0].d];
        if (fields.length === 3 && fields[0] === null && fields[1] === null && Number.isSafeInteger(fields[2]) && fields[2] >= 0)
          return [slot, -1 - fields[2]];
      }
      return [slot, fields, ...removed];
    });
    return { ...patch, movingLayout: [moving.length, ...edits] };
  });
  return changed ? { ...document, version: 10, patches } : document;
}

export function encodePonderTimelinePatches(patches: Entry[], bundle?: string) {
  const fieldKeys = new WeakMap<object, string>();
  function keyOf(value: unknown) {
    if (typeof value !== 'object' || value === null) return JSON.stringify(value);
    let json = fieldKeys.get(value);
    if (json === undefined) {
      json = JSON.stringify(value);
      fieldKeys.set(value, json);
    }
    return json;
  }
  let shortRefs = false;
  const shortenedDraws = new WeakMap<Entry, Entry>();
  if (bundle) patches = patches.map(patch => {
    const fields = { ...patch };
    for (const name of ['scene', 'overlay']) {
      const draws = patch[name];
      if (!recordList(draws)) continue;
      fields[name] = draws.map(draw => {
        let shortened = shortenedDraws.get(draw);
        if (!shortened) {
          shortened = mapDrawRefs(draw, path => {
            const compact = compressPonderBundleRef(path, bundle);
            shortRefs ||= compact !== path;
            return compact;
          })!;
          shortenedDraws.set(draw, shortened);
        }
        return shortened;
      });
    }
    return fields;
  });
  const previous = new Map<string, Entry[]>();
  let version = 1;
  const encoded = patches.map(patch => {
    const frame = { ...patch };
    for (const field of listFields) {
      const current = patch[field];
      if (!recordList(current)) continue;
      const base = previous.get(field);
      previous.set(field, current);
      if (!base) continue;
      const edits: Edit[] = [];
      let vectorEdits = false;
      current.forEach((value, slot) => {
        const old = base[slot];
        if (!old) {
          edits.push([slot, value]);
          return;
        }
        if (value === old) return;
        const entries = Object.entries(value).filter(([key, next]) =>
          !Object.hasOwn(old, key) || (!Object.is(next, old[key]) && keyOf(next) !== keyOf(old[key])));
        const removed = Object.keys(old).filter(key => !Object.hasOwn(value, key));
        if (entries.length || removed.length) {
          const changes = Object.fromEntries(entries.map(([key, next]) => {
            const edit = encodeVectorEdit(key, old[key], next);
            vectorEdits ||= edit !== next;
            return [key, edit];
          }));
          edits.push(removed.length ? [slot, changes, removed] : [slot, changes]);
        }
      });
      const delta = { length: current.length, edits };
      if (JSON.stringify(delta).length < JSON.stringify(current).length) {
        frame[field] = delta;
        if (vectorEdits) version = 2;
      }
    }
    return frame;
  });
  const full = JSON.stringify(shortRefs ? { version: 5, patches } : patches);
  const shared = shareTimelineTransforms(encoded, keyOf);
  const compact = { version, patches: encoded };
  const candidates = shared ? [compact, shared] : [compact];
  const layouts = new Set(candidates.flatMap(candidate => [candidate, shareLayoutValues(candidate, keyOf)]));
  const variants = new Set([...layouts].flatMap(candidate =>
    [candidate, compactLayoutValues(candidate), compactLayoutValues(candidate, true)]));
  const best = [...variants]
    .reduce((smallest, candidate) => {
      const json = JSON.stringify(shortRefs ? { ...candidate, version: Math.max(5, candidate.version) } : candidate);
      return json.length < smallest.length ? json : smallest;
    }, full);
  const document = JSON.parse(best) as Timeline | Entry[];
  const packedDraws = shareDrawValues(document);
  const packed = packedDraws === document ? best : JSON.stringify(packedDraws);
  const useDrawPalette = packed.length < best.length;
  const current = useDrawPalette ? packed : best;
  const currentDocument = useDrawPalette ? packedDraws : document;
  const moving = packMovingEdits(currentDocument);
  if (moving === currentDocument) return current;
  const encodedMoving = JSON.stringify(moving);
  return encodedMoving.length < current.length ? encodedMoving : current;
}
