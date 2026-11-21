export type ServerPage = 'items' | 'players' | 'achievements' | 'quests' | 'ponder';

export const defaultAlias: string;
export const defaultTabs: readonly ServerPage[];
export const serverPages: readonly ServerPage[];
export function isServerPage(page: unknown): page is ServerPage;
export function isServerAlias(alias: unknown): alias is string;
export function catalogSubdirectory(alias: string): string;
