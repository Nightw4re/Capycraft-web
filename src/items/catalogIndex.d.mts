export function searchText(text: string): string;
export function lookupSlot(id: string): number;
export type ItemBar = { width: number; color: number };
export function readItemBar(value: unknown): ItemBar | undefined;
