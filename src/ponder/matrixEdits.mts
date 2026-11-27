const fixedScale = 1_000_000;
const maxInteger = 2 ** 31 - 1;
const rotationPlanes = [[0, 1, 4, 5], [0, 2, 8, 10], [5, 6, 9, 10]] as const;

function base64Url(bytes: string) {
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function compactPonderMatrixEdit(values: number[]) {
  const [mask, ...lanes] = values;
  const bytes = [mask & 255, mask >>> 8];
  const fields = new Map<number, { fixed: number; bytes: number[] }>();
  let at = 0;
  for (let index = 0; index < 16; index++) {
    if (!(mask & 1 << index)) continue;
    const value = lanes[at++];
    const fixed = Math.round(value * fixedScale);
    if (Object.is(value, -0) || Math.abs(fixed) > maxInteger || fixed / fixedScale !== value) return values;
    const start = bytes.length;
    let zigzag = Math.abs(fixed) * 2 - Number(fixed < 0);
    while (zigzag >= 128) {
      bytes.push((zigzag % 128) + 128);
      zigzag = Math.floor(zigzag / 128);
    }
    bytes.push(zigzag);
    fields.set(index, { fixed, bytes: bytes.slice(start) });
  }
  let token = base64Url(String.fromCharCode(...bytes));
  for (const [plane, [x, y, opposite, diagonal]] of rotationPlanes.entries()) {
    const cosine = fields.get(x)?.fixed, sine = fields.get(y)?.fixed;
    if (cosine === undefined || sine === undefined
      || cosine !== fields.get(diagonal)?.fixed || -sine !== fields.get(opposite)?.fixed) continue;
    const reduced = mask ^ (1 << opposite | 1 << diagonal);
    const data = [reduced & 255, reduced >>> 8];
    for (const [index, field] of fields) {
      if (reduced & 1 << index) data.push(...field.bytes);
    }
    const candidate = `.${plane}${base64Url(String.fromCharCode(...data))}`;
    if (candidate.length < token.length) token = candidate;
  }
  return JSON.stringify(token).length < JSON.stringify(values).length ? token : values;
}

export function readCompactPonderMatrixEdit(token: string, rotation = false): number[] | undefined {
  if (token.startsWith('.')) {
    if (!rotation || !/^\.[0-2]/.test(token)) return;
    const values = readFixedMatrixEdit(token.slice(2));
    if (!values) return;
    const [x, y, opposite, diagonal] = rotationPlanes[Number(token[1])];
    const [mask, ...lanes] = values;
    if (!(mask & 1 << x) || !(mask & 1 << y) || mask & (1 << opposite | 1 << diagonal)) return;
    const fields = new Map<number, number>();
    let at = 0;
    for (let index = 0; index < 16; index++) {
      if (mask & 1 << index) fields.set(index, lanes[at++]);
    }
    if (at !== lanes.length || [...fields.values()].some(value => value === undefined)) return;
    fields.set(opposite, -fields.get(y)! || 0);
    fields.set(diagonal, fields.get(x)!);
    return [mask | 1 << opposite | 1 << diagonal,
      ...[...fields].sort(([left], [right]) => left - right).map(([, value]) => value)];
  }
  return readFixedMatrixEdit(token);
}

function readFixedMatrixEdit(token: string): number[] | undefined {
  if (!/^[A-Za-z0-9_-]{3,110}$/.test(token) || token.length % 4 === 1) return;
  const bytes = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  if (base64Url(bytes) !== token || bytes.length < 2) return;
  const values = [bytes.charCodeAt(0) + bytes.charCodeAt(1) * 256];
  let at = 2;
  while (at < bytes.length && values.length <= 16) {
    let zigzag = 0;
    for (let lane = 0;; lane++) {
      if (lane === 5 || at >= bytes.length) return;
      const byte = bytes.charCodeAt(at++);
      zigzag += (byte & 127) * 128 ** lane;
      if (byte >= 128) continue;
      if ((lane && !byte) || zigzag > 2 * maxInteger) return;
      break;
    }
    const fixed = zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2;
    values.push(fixed / fixedScale);
  }
  if (at === bytes.length) return values;
}
