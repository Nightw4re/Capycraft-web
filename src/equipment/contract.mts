import type { ItemBar, TooltipTextSpan } from '../items/catalogIndex.mjs';
import { plainMinecraftText } from '../minecraftText.mts';

export const equipmentPreviewPath = '/equipment-preview';
export const equipmentSlots = ['head', 'chest', 'legs', 'feet', 'mainhand', 'offhand'] as const;
export const inventorySlots = Array.from({ length: 36 }, (_, index) => String((index + 9) % 36));
export const hotbarSlots = inventorySlots.slice(-9);

export type EquipmentSlot = typeof equipmentSlots[number];
export type EquipmentItem = {
  id: string;
  name: string;
  count: number;
  icon?: string;
  bar?: ItemBar;
  tooltip?: string[];
  tooltipLines?: TooltipTextSpan[][];
  modName?: string;
  trim?: { material: string; pattern: string };
  dye?: number;
};
export type EquipmentLoadout = { player: string; slots: Record<string, EquipmentItem | null>; savedAt?: number; selectedSlot?: number };

const energyLine = /^Stored energy:\s*([\d.,]+)\s*([kMGTPE]?)(FE|J|EU)\s*\/\s*([\d.,]+)\s*([kMGTPE]?)\3$/i;
const energyPrefixes = ['', 'k', 'm', 'g', 't', 'p', 'e'];

function energyAmount(value: string, prefix: string) {
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)
    ? value.replaceAll(',', '') : value.replace(',', '.');
  return Number(normalized) * 1000 ** energyPrefixes.indexOf(prefix.toLowerCase());
}

export function equipmentItemBar(item: EquipmentItem, catalogBar?: ItemBar): ItemBar | undefined {
  if (item.bar || !item.id.startsWith('mekanism:')) return item.bar;
  // Older Equipment feeds can report Mekanism's live energy without an item bar.
  for (const line of item.tooltip ?? []) {
    const match = energyLine.exec(plainMinecraftText(line).trim());
    if (!match) continue;
    const [, stored, storedPrefix, , capacity, capacityPrefix] = match;
    const current = energyAmount(stored, storedPrefix);
    const maximum = energyAmount(capacity, capacityPrefix);
    if (Number.isFinite(current) && Number.isFinite(maximum) && current >= 0 && maximum > 0 && current <= maximum) {
      return { width: Math.round(current / maximum * 13), color: catalogBar?.color ?? 0x55d8ff };
    }
  }
}
