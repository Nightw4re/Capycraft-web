const codecs = [
  '', 'particle-quads/v1', 'particle-quads/v2', 'outline-cuboids/v1', 'box-faces/v1',
  'rigid-batches/v1', 'rigid-batches/v2', 'rigid-batches/v3', 'rigid-batches/v4', 'rigid-glint/v1', 'box-faces/v2',
  'lightning/v1', 'rigid-batches/v5', 'particle-quads/v3', 'particle-quads/v4', 'box-faces/v3', 'box-faces/v4',
];
const codeByCodec = new Map(codecs.map((codec, index) => [codec, index]));
const longRef = /^(0|[1-9][0-9]{0,6}):([1-9][0-9]{0,3}):([a-f0-9]{64})(?::([^:]+))?$/;
const shortRef = /^~([0-9a-z]):(0|[1-9][0-9]{0,6}):([1-9][0-9]{0,3}):([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;
const maxBundleBytes = 4 * 1024 ** 2;
const maxRangeBytes = 1024;

function validRange(offset: string, size: string) {
  return Number(size) <= maxRangeBytes && Number(offset) + Number(size) <= maxBundleBytes;
}

export function compressPonderBundleRef(path: string, bundle: string) {
  const prefix = bundle + '#';
  if (!path.startsWith(prefix)) return path;
  const range = longRef.exec(path.slice(prefix.length));
  if (!range || !validRange(range[1], range[2])) return path;
  const [, offset, size, hex, codec = ''] = range;
  const code = codeByCodec.get(codec);
  if (code === undefined) return path;
  const bytes = hex.match(/../g)!.map(pair => Number.parseInt(pair, 16));
  const digest = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 43);
  return `~${code.toString(36)}:${offset}:${size}:${digest}`;
}

export function expandPonderBundleRef(path: string, bundle?: string) {
  if (!path.startsWith('~')) return path;
  const range = shortRef.exec(path);
  if (!bundle || !range || !validRange(range[2], range[3])) return;
  const [, code, offset, size, digest] = range;
  const codec = codecs[Number.parseInt(code, 36)];
  if (codec === undefined) return;
  const bytes = atob(digest.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const hex = Array.from(bytes, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `${bundle}#${offset}:${size}:${hex}${codec && ':' + codec}`;
}
