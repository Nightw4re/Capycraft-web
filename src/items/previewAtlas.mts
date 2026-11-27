import layout from './catalogLayout.json' with { type: 'json' };

export const atlasRows = layout.pageSize / layout.atlasColumns;
const standaloneIcon = /^[a-f0-9]{64}\.(?:webp|png)$/;
const atlasIcon = /^([a-f0-9]{64})-(0|[1-9][0-9]?)\.webp$/;

export function atlasIconName(atlas: string, position: number) {
  return `${atlas}-${position}.webp`;
}

export function parseAtlasIcon(name: string) {
  const match = atlasIcon.exec(name);
  if (match && Number(match[2]) < layout.pageSize) {
    return { atlas: match[1], position: Number(match[2]) };
  }
}

export function isPreviewIconName(name: string) {
  return standaloneIcon.test(name) || parseAtlasIcon(name) !== undefined;
}
