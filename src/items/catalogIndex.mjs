export function searchText(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/_/g, ' ');
}

const tooltipKey = /^key\.[a-z0-9_.-]+$/;

export function isTooltipShortcutId(value) {
  return typeof value === 'string' && value.split('+').every(key => tooltipKey.test(key));
}

export function readTooltipLines(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.lines)) return undefined;
  const lines = payload.lines.filter(Array.isArray).map(line => line.filter(span =>
    span && typeof span === 'object' && typeof span.text === 'string'));
  if (lines.some(line => line.some(span => span.text.trim()))) return lines;
}

export function readTooltipAlternatives(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.alternatives)) return [];
  const alternatives = new Map();
  for (const entry of payload.alternatives) {
    if (!entry || typeof entry !== 'object') continue;
    const { keys, label } = entry;
    if (!Array.isArray(keys) || !keys.length || !keys.every(key => typeof key === 'string' && tooltipKey.test(key))
        || typeof label !== 'string' || !label.trim()) continue;
    const lines = readTooltipLines(entry);
    if (!lines) continue;
    const id = [...new Set(keys)].sort().join('+');
    if (!alternatives.has(id)) alternatives.set(id, { id, label, lines });
  }
  return [...alternatives.values()];
}

function searchTokens(query) {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

export function catalogSearchTerms(query) {
  const terms = { items: [], mods: [], tags: [], tooltips: [] };
  for (const token of searchTokens(query)) {
    const [prefix] = token;
    const field = prefix === '@' ? 'mods' : prefix === '#' ? 'tags' : prefix === '$' ? 'tooltips' : 'items';
    const value = searchText((field === 'items' ? token : token.slice(1)).replaceAll('"', '')).trim();
    if (value) terms[field].push(value);
  }
  return terms;
}

export function catalogSearchWithMod(query, mod) {
  const text = searchTokens(query).filter(token => !token.startsWith('@')).join(' ');
  if (!mod) return text;
  const suffix = `@${mod}`;
  return [text.slice(0, 255 - suffix.length).trimEnd(), suffix].filter(Boolean).join(' ');
}

export function catalogModMatches(namespace, term) {
  const normalized = value => searchText(value).replace(/\s+/g, '');
  return normalized(namespace).includes(normalized(term));
}

export function lookupSlot(id) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  return (hash ^ (hash >>> 16)) & 255;
}

export function readItemBar(value) {
  if (!value || typeof value !== 'object') return undefined;
  const { width, color } = value;
  if (Number.isInteger(width) && width >= 0 && width <= 13 && Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
    return { width, color };
  }
}
