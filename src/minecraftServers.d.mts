export type ServerPage = 'items' | 'players';

export const defaultAlias: string;
export const defaultTabs: readonly ServerPage[];
export function isServerAlias(alias: unknown): alias is string;
export function catalogSubdirectory(alias: string): string;
