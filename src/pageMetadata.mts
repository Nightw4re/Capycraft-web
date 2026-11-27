import { serverPages, type ServerPage } from './minecraftServers.mjs';

export const serverPagePath = `/server/([a-z0-9-]+)(?:/(${serverPages.filter(page => page !== 'ponder').join('|')}))?/?`;
export const serverPagePattern = new RegExp(`^${serverPagePath}$`);
export const playersPath = '/players';

export function legacyQuestsLocation(server: string, params: URLSearchParams) {
  const path = `/server/${server}/players`;
  if (!profileName('players', params)) return path;
  const profile = new URLSearchParams(params);
  profile.set('tab', 'quests');
  return `${path}?${profile}`;
}

export const siteName = 'Capycraft';

export function pageTitle(name: string) {
  return name === siteName ? siteName : `${name} | ${siteName}`;
}

const sectionMetadata: Record<ServerPage, { name: string; description: string }> = {
  items: { name: 'Items', description: 'Browse Minecraft items and explore their recipes and uses.' },
  players: { name: 'Players', description: 'See who is playing and browse Minecraft player profiles.' },
  achievements: { name: 'Advancements', description: 'Explore Minecraft advancements and track player progress.' },
  quests: { name: 'Players', description: 'See who is playing and browse Minecraft player profiles.' },
  ponder: { name: 'Ponder', description: 'Watch interactive Minecraft scenes and learn how builds and machines work.' },
};

export function pageMetadata(page: ServerPage | 'home' | 'notFound', server?: string, player?: string) {
  if (page === 'notFound') return { name: 'Page not found', description: 'This page could not be found on Capycraft.' };
  if (page === 'home') return {
    name: server ?? siteName,
    description: server
      ? `See server status, join information, and what is happening on ${server}.`
      : 'Explore the Capycraft Minecraft community, check server status, and find items, recipes, and player progress.',
  };
  const section = sectionMetadata[page];
  if (!server) return section;
  if (player && (page === 'players' || page === 'achievements')) return {
    name: `${player} · ${server}`,
    description: `View ${player}'s Minecraft profile and progress on ${server}.`,
  };
  return { ...section, name: `${section.name} · ${server}` };
}

export function profileName(page: ServerPage | 'home' | 'notFound', params: URLSearchParams) {
  const name = params.get('player');
  return (page === 'players' || page === 'achievements') && name && /^[A-Za-z0-9_]{1,16}$/.test(name)
    ? name : undefined;
}
