import config from './minecraftServers.json' with { type: 'json' };

export const { defaultAlias } = config;
export const defaultTabs = ['items', 'players'];
export const serverPages = [...defaultTabs, 'achievements', 'quests', 'ponder'];

export function isServerPage(page) {
  return serverPages.includes(page);
}

export function isServerAlias(alias) {
  return typeof alias === 'string' && /^[a-z0-9-]+$/.test(alias);
}

export function catalogSubdirectory(alias) {
  return alias === defaultAlias ? '' : `servers/${alias}/`;
}
