export function searchText(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/_/g, ' ');
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
