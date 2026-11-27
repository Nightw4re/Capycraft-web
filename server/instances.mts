import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { catalogSubdirectory, defaultAlias, defaultTabs, isServerAlias, isServerPage, type ServerPage } from '../src/minecraftServers.mjs';

export type Exposure = 'public' | 'internal';

export type Instance = {
  alias: string;
  tabs: readonly ServerPage[];
  inbox?: string;
  catalog?: string;
  webcraft?: {
    origin: string;
    tokenEnv?: string;
    accountLinkTokenEnv?: string;
    info: Exposure;
    status: Exposure;
    directoryTransport: 'http' | 'websocket';
    onlinePlayersTransport?: 'http' | 'websocket';
    playerHistory: boolean;
    playerRoster?: boolean;
    achievements?: boolean;
    quests?: boolean;
    ponder?: boolean;
  };
};

export function instanceDirectory(path?: string, root = process.cwd()) {
  const directory = resolve(root, path?.trim() || 'data/instances');
  for (const publicFolder of ['public', 'dist']) {
    const fromPublic = relative(resolve(root, publicFolder), directory);
    if (!isAbsolute(fromPublic) && fromPublic !== '..' && !fromPublic.startsWith(`..${sep}`)) {
      throw new Error('CAPYCRAFT_INSTANCE_DIR must be outside public and dist.');
    }
  }
  return directory;
}

export function loadInstances(directory: string): ReadonlyMap<string, Instance> {
  const instances = new Map<string, Instance>();
  let folders: Dirent[];
  try {
    folders = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    folders = [];
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const instancePath = join(directory, folder.name);
    const configPath = join(instancePath, 'server.json');
    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    try {
      const config: unknown = JSON.parse(raw);
      const instance = parseInstance(folder.name, config, instancePath);
      if (instances.has(instance.alias)) throw new Error(`Duplicate server alias ${instance.alias}.`);
      instances.set(instance.alias, instance);
    } catch (cause) {
      throw new Error(`Invalid server configuration at ${configPath}.`, { cause });
    }
  }

  // Existing installations can still use the default catalog before configuring a WebCraft listener.
  if (!instances.size) instances.set(defaultAlias, { alias: defaultAlias, tabs: defaultTabs });
  return instances;
}

export function itemCatalogDirectory(instance: Instance, legacyDirectory: string) {
  const legacy = resolve(legacyDirectory, catalogSubdirectory(instance.alias));
  if (!instance.catalog || existsSync(join(legacy, 'catalog.json'))) return legacy;
  return instance.catalog;
}

export function itemCatalogDirectories(instances: ReadonlyMap<string, Instance>, legacyDirectory: string) {
  return new Map(Array.from(instances, ([alias, instance]) => [alias, itemCatalogDirectory(instance, legacyDirectory)]));
}

function parseInstance(folder: string, value: unknown, directory: string): Instance {
  if (!value || typeof value !== 'object' || !('webcraftUrl' in value) || typeof value.webcraftUrl !== 'string') {
    throw new Error('Set webcraftUrl to the WebCraft HTTP origin.');
  }
  const alias = 'alias' in value ? value.alias : folder;
  if (!isServerAlias(alias)) throw new Error('Use lowercase letters, digits, and hyphens in the server alias.');
  const url = new URL(value.webcraftUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('webcraftUrl must be an HTTP or HTTPS origin without credentials or a path.');
  }
  const tokenEnv = 'tokenEnv' in value ? value.tokenEnv : undefined;
  if (tokenEnv !== undefined && (typeof tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(tokenEnv))) {
    throw new Error('tokenEnv must name an environment variable.');
  }
  const accountLinkTokenEnv = 'accountLinkTokenEnv' in value ? value.accountLinkTokenEnv : undefined;
  if (accountLinkTokenEnv !== undefined && (typeof accountLinkTokenEnv !== 'string'
    || !/^[A-Z][A-Z0-9_]*$/.test(accountLinkTokenEnv) || accountLinkTokenEnv === tokenEnv
    || !['127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Account linking requires a separate token environment variable and a loopback WebCraft origin.');
  }
  const info = 'infoExposure' in value ? value.infoExposure : 'public';
  const status = 'statusExposure' in value ? value.statusExposure : tokenEnv ? 'internal' : 'public';
  if ((info !== 'public' && info !== 'internal') || (status !== 'public' && status !== 'internal')) {
    throw new Error('Feed exposure must be public or internal.');
  }
  const playerHistory = 'playerHistory' in value ? value.playerHistory : false;
  const playerRoster = 'playerRoster' in value ? value.playerRoster : false;
  const achievements = 'achievements' in value ? value.achievements : false;
  const quests = 'quests' in value ? value.quests : false;
  const ponder = 'ponder' in value ? value.ponder : false;
  const onlinePlayersTransport = 'onlinePlayersTransport' in value ? value.onlinePlayersTransport : undefined;
  if (onlinePlayersTransport !== undefined && onlinePlayersTransport !== 'http' && onlinePlayersTransport !== 'websocket') {
    throw new Error('onlinePlayersTransport must be http or websocket.');
  }
  if (typeof playerHistory !== 'boolean' || typeof playerRoster !== 'boolean'
    || typeof achievements !== 'boolean' || typeof quests !== 'boolean' || typeof ponder !== 'boolean') {
    throw new Error('Player history, player roster, achievements, quests and Ponder settings must be boolean.');
  }
  if (!tokenEnv && (info === 'internal' || status === 'internal' || playerHistory || playerRoster || achievements || quests || onlinePlayersTransport)) {
    throw new Error('Internal feeds require tokenEnv.');
  }
  const directoryTransport = 'directoryTransport' in value ? value.directoryTransport : 'http';
  if (directoryTransport !== 'http' && directoryTransport !== 'websocket') {
    throw new Error('directoryTransport must be http or websocket.');
  }
  const tabs = 'tabs' in value ? value.tabs : defaultTabs;
  if (!Array.isArray(tabs) || !tabs.every(isServerPage) || new Set(tabs).size !== tabs.length
    || (tabs.includes('achievements') && !achievements) || (tabs.includes('quests') && !quests)
    || (tabs.includes('ponder') && !ponder)) {
    throw new Error('tabs must list enabled items, players, achievements, quests or Ponder at most once each.');
  }
  return {
    alias, tabs, inbox: join(directory, 'imports'), catalog: join(directory, 'catalog'),
    webcraft: { origin: url.origin, tokenEnv, accountLinkTokenEnv, info, status, directoryTransport, onlinePlayersTransport,
      playerHistory, playerRoster, achievements, quests, ponder },
  };
}

export function webcraftToken(variable: string | undefined) {
  const token = variable && process.env[variable];
  if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) return undefined;
  return token;
}
