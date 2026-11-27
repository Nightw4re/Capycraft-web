import layout from './catalogLayout.json';
import {
  catalogModMatches, catalogSearchTerms, catalogSearchWithMod, isTooltipShortcutId, lookupSlot, readItemBar, searchText,
  type ItemBar, type TooltipShortcut,
} from './catalogIndex.mjs';
import { isItemId } from './itemRoutes.mts';
import { isPreviewIconName, parseAtlasIcon } from './previewAtlas.mts';
import { catalogSubdirectory } from '../minecraftServers.mjs';
import type { Language } from '../preferences';

export type ItemSprite = {
  url: string;
  position: number;
};

export type CatalogItem = {
  id: string;
  name: string;
  fluidId?: string;
  icon?: string;
  detail?: string;
  sprite?: ItemSprite;
  bar?: ItemBar;
  tooltipShortcutIds?: readonly string[];
};

type CatalogRecord = Omit<CatalogItem, 'sprite'> & { sprite?: number };

type PageOptions = { language: Language; page: number; query: string };
type CatalogPage = { items: CatalogItem[]; total: number };

export type Catalog = {
  key?: string;
  revision?: string;
  publishedAt?: number;
  progress?: { loaded: number; expected: number; failed: boolean };
  mods: readonly string[];
  tooltipShortcuts?: readonly TooltipShortcut[];
  getPage(options: PageOptions, signal: AbortSignal): Promise<CatalogPage>;
  getItem(id: string, signal: AbortSignal): Promise<CatalogItem | undefined>;
  getItems(ids: ReadonlySet<string>, signal: AbortSignal): Promise<ReadonlyMap<string, CatalogItem>>;
  getRecipeItemIcons?(ids: ReadonlySet<string>, signal: AbortSignal): Promise<ReadonlyMap<string, string>>;
  getAdvancementIcons?(signal: AbortSignal): Promise<ReadonlyMap<string, string>>;
  getIcon?(name: string): string | undefined;
  getRecipeUses?(id: string, signal: AbortSignal, kind?: 'fluid'): Promise<{ feed: unknown; publishedAt?: number }>;
};

export type ItemPayloads = { tooltip?: string; stack?: string };

export type ItemVariant = {
  id: string;
  name: string;
  icon?: string;
  payloads?: ItemPayloads;
  bar?: ItemBar;
};

export type ItemRecipe = {
  station: string;
  columns: 1 | 2 | 3;
  ingredients: (string | null)[];
  outputCount: number;
};

type ItemDetails = {
  variants: ItemVariant[];
  payloads?: ItemPayloads;
  recipeFeed?: string;
  // Older exports omit recipes. An empty array means the item has no recipes.
  recipes?: ItemRecipe[];
};

const directory = `${import.meta.env.BASE_URL}item-catalog/`;
const catalogDirectory = (server: string) => directory + catalogSubdirectory(server);
const resource = /^[a-f0-9]{64}$/;
const itemDetails = new Map<string, Promise<ItemDetails>>();

export { isItemId };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResource(value: unknown): value is string {
  return typeof value === 'string' && resource.test(value);
}

function isTooltipShortcut(value: unknown): value is TooltipShortcut {
  return isRecord(value) && isTooltipShortcutId(value.id) && typeof value.label === 'string' && !!value.label.trim();
}

function isPayloads(value: unknown): value is ItemPayloads {
  return isRecord(value) && (value.tooltip === undefined || isResource(value.tooltip))
    && (value.stack === undefined || isResource(value.stack));
}

function isIcon(value: unknown, version: number): value is string {
  return typeof value === 'string' && (version === 1 ? resource.test(value) : isPreviewIconName(value));
}

function iconUrl(root: string, icon: string, version: number) {
  return `${root}icons/${version === 1 ? `${icon}.png` : icon}`;
}

export function spriteForIcon(url: string | undefined): ItemSprite | undefined {
  if (!url?.startsWith(directory)) return;
  const match = /\/icons\/([^/]+)$/.exec(url);
  const sprite = match && parseAtlasIcon(match[1]);
  if (sprite) return { url: `${url.slice(0, match.index)}/atlases/${sprite.atlas}.webp`, position: sprite.position };
}

function isCatalogItem(value: unknown, version: number, atlasCount: number): value is CatalogRecord {
  return isRecord(value) && isItemId(value.id)
    && typeof value.name === 'string' && (value.icon === undefined || isIcon(value.icon, version))
    && (value.fluidId === undefined || isItemId(value.fluidId))
    && (value.detail === undefined || isResource(value.detail))
    && (value.bar === undefined || readItemBar(value.bar) !== undefined)
    && (value.tooltipShortcutIds === undefined || (Array.isArray(value.tooltipShortcutIds)
      && value.tooltipShortcutIds.every(isTooltipShortcutId)))
    && (version === 1 || value.sprite === undefined || (typeof value.sprite === 'number'
      && Number.isSafeInteger(value.sprite) && value.sprite >= 0 && value.sprite < atlasCount * layout.pageSize
      && typeof value.icon === 'string'));
}

function isVariant(value: unknown, version: number): value is ItemVariant {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && (value.icon === undefined || isIcon(value.icon, version))
    && (value.payloads === undefined || isPayloads(value.payloads))
    && (value.bar === undefined || readItemBar(value.bar) !== undefined)
    && (value.icon !== undefined || value.payloads !== undefined);
}

function isRecipe(value: unknown): value is ItemRecipe {
  return isRecord(value) && typeof value.station === 'string'
    && (value.columns === 1 || value.columns === 2 || value.columns === 3)
    && Array.isArray(value.ingredients) && value.ingredients.length <= value.columns * 3
    && value.ingredients.length % value.columns === 0
    && value.ingredients.some(ingredient => ingredient !== null)
    && value.ingredients.every(ingredient => ingredient === null || isItemId(ingredient))
    && typeof value.outputCount === 'number' && Number.isSafeInteger(value.outputCount) && value.outputCount > 0;
}

function readRecords(data: unknown, version: number, atlases: string[], root = directory): CatalogItem[] {
  if (!Array.isArray(data) || !data.every((item): item is CatalogRecord => isCatalogItem(item, version, atlases.length))) {
    throw new Error('Invalid catalog records.');
  }
  return data.map(({ icon, sprite, detail, ...item }) => {
    const url = icon === undefined ? undefined : iconUrl(root, icon, version);
    const legacySprite = version !== 1 && sprite !== undefined ? {
      url: `${root}atlases/${atlases[Math.floor(sprite / layout.pageSize)]}.webp`,
      position: sprite % layout.pageSize,
    } : undefined;
    return { ...item, icon: url, sprite: spriteForIcon(url) ?? legacySprite,
      detail: detail === undefined ? undefined : `${root}details/${detail}.json` };
  });
}

function legacyCatalog(items: CatalogItem[]): Catalog {
  const byId = new Map(items.map(item => [item.id, item]));
  const index = items.map(item => ({
    item, mod: item.id.split(':')[0], search: searchText(`${item.name} ${item.id}`),
  }));
  const orders = new Map<Language, typeof index>();
  const mods = [...new Set(index.map(entry => entry.mod))].sort();
  return {
    mods,
    async getPage({ language, page, query }) {
      let order = orders.get(language);
      if (!order) {
        const collator = new Intl.Collator(language, { numeric: true });
        order = [...index].sort((a, b) => collator.compare(a.item.name, b.item.name) || collator.compare(a.item.id, b.item.id));
        orders.set(language, order);
      }
      const terms = catalogSearchTerms(query);
      const mod = exactCatalogMod(mods, terms.mods);
      const matches = terms.tags.length || terms.tooltips.length ? [] : order.filter(entry =>
        (mod ? entry.mod === mod : terms.mods.every(term => catalogModMatches(entry.mod, term)))
        && terms.items.every(term => entry.search.includes(term)));
      const first = page * layout.pageSize;
      return { total: matches.length, items: matches.slice(first, first + layout.pageSize).map(entry => entry.item) };
    },
    async getItem(id) { return byId.get(id); },
    async getItems(ids) {
      const items = new Map<string, CatalogItem>();
      for (const id of ids) {
        const item = byId.get(id);
        if (item) items.set(id, item);
      }
      return items;
    },
  };
}

function exactCatalogMod(mods: readonly string[], terms: string[]) {
  return terms.length === 1 ? mods.find(mod => searchText(mod) === terms[0]) : undefined;
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalog data request failed with HTTP ${response.status}.`);
  return response.json();
}

function recipePublishedAt(response: Response) {
  const value = Date.parse(response.headers.get('X-Catalog-Published-At') ?? '');
  return Number.isFinite(value) ? value : undefined;
}

function pagedCatalog(data: Record<string, unknown>, atlases: string[], server: string, publishedAt?: number): Catalog {
  const { total, pages, lookup, mods, search, revision, state, expected, tooltipShortcuts, recipeItemIcons, advancementIcons } = data;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || !isResource(search) || !isResource(revision)
    || (state !== 'ready' && state !== 'importing' && state !== 'failed')
    || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < total
    || !isRecord(pages) || !Array.isArray(pages.cs) || !Array.isArray(pages.en)
    || ![pages.cs, pages.en].every(pageIds => pageIds.length === Math.ceil(total / layout.pageSize) && pageIds.every(isResource))
    || !Array.isArray(lookup) || lookup.length !== 256 || !lookup.every(entry => entry === null || isResource(entry))
    || (tooltipShortcuts !== undefined && (!Array.isArray(tooltipShortcuts) || !tooltipShortcuts.every(isTooltipShortcut)))
    || !Array.isArray(mods) || !mods.every(mod => typeof mod === 'string' && /^[a-z0-9_.-]+$/.test(mod))) {
    throw new Error('Invalid paged catalog.');
  }
  const pageIds = { cs: pages.cs, en: pages.en };
  const root = `${catalogDirectory(server)}revisions/${revision}/`;
  const ingredientIconIndex = isResource(recipeItemIcons) ? `${root}payloads/${recipeItemIcons}.json` : undefined;
  const advancementIconIndex = isResource(advancementIcons) ? `${root}payloads/${advancementIcons}.json` : undefined;
  const lookupItems = async (hash: string, signal: AbortSignal) =>
    readRecords(await readJson(`${root}lookup/${hash}.json`, signal), layout.version, atlases, root);
  async function readIcons(index: string, signal: AbortSignal, ids?: ReadonlySet<string>) {
    const data = await readJson(index, signal);
    const icons = new Map<string, string>();
    if (!isRecord(data)) return icons;
    for (const id of ids ?? Object.keys(data)) {
      const name = data[id];
      if (isItemId(id) && Object.hasOwn(data, id) && isIcon(name, layout.version)) {
        icons.set(id, iconUrl(root, name, layout.version));
      }
    }
    return icons;
  }
  return {
    key: `${revision}:${state}:${search}:${atlases.length}`,
    revision,
    publishedAt,
    progress: state === 'ready' ? undefined : { loaded: total, expected, failed: state === 'failed' },
    mods,
    tooltipShortcuts,
    getIcon: name => isPreviewIconName(name) ? iconUrl(root, name, layout.version) : undefined,
    async getPage({ language, page, query }, signal) {
      const catalogLanguage = language === 'cs' ? 'cs' : 'en';
      if (query.trim()) {
        const mod = exactCatalogMod(mods, catalogSearchTerms(query).mods);
        const parameters = new URLSearchParams({ server, revision, index: search, language: catalogLanguage, page: String(page),
          q: mod ? catalogSearchWithMod(query, '') : query, mod: mod ?? '' });
        const data = await readJson(`/api/item-search?${parameters}`, signal);
        if (!isRecord(data) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
          throw new Error('Invalid catalog search results.');
        }
        return { items: readRecords(data.items, layout.version, atlases, root), total: data.total };
      }
      const hash = pageIds[catalogLanguage][page];
      const items = hash ? readRecords(await readJson(`${root}pages/${hash}.json`, signal), layout.version, atlases, root) : [];
      return { items, total };
    },
    async getItem(id, signal) {
      if (!isItemId(id)) return undefined;
      const hash = lookup[lookupSlot(id)];
      return hash ? (await lookupItems(hash, signal)).find(item => item.id === id) : undefined;
    },
    async getItems(ids, signal) {
      const hashes = new Set<string>();
      for (const id of ids) {
        const hash = lookup[lookupSlot(id)];
        if (hash) hashes.add(hash);
      }
      const items = new Map<string, CatalogItem>();
      await Promise.all([...hashes].map(async hash => {
        for (const item of await lookupItems(hash, signal)) {
          if (ids.has(item.id)) items.set(item.id, item);
        }
      }));
      return items;
    },
    getRecipeItemIcons: ingredientIconIndex ? (ids, signal) => readIcons(ingredientIconIndex, signal, ids) : undefined,
    getAdvancementIcons: advancementIconIndex ? signal => readIcons(advancementIconIndex, signal) : undefined,
    getRecipeUses: state === 'ready' ? async (id, signal, kind) => {
      const parameters = new URLSearchParams({ server, revision, id });
      if (kind) parameters.set('kind', kind);
      const response = await fetch(`/api/item-recipe-uses?${parameters}`, { signal });
      if (!response.ok) throw new Error(`Recipe request failed with HTTP ${response.status}.`);
      return { feed: await response.json(), publishedAt: recipePublishedAt(response) };
    } : undefined,
  };
}

export async function loadCatalog(server: string, signal: AbortSignal): Promise<Catalog | null> {
  const root = catalogDirectory(server);
  const response = await fetch(`${root}catalog.json`, { cache: 'no-cache', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}.`);
  // Vite and some hosts return the app shell for missing static files.
  if (response.headers.get('content-type')?.includes('text/html')) return null;
  const data: unknown = await response.json();
  if (!isRecord(data) || (data.version !== 1 && data.version !== 2 && data.version !== layout.version)) {
    throw new Error('Invalid item catalog.');
  }
  const version = data.version;
  const atlases = version === 1 ? [] : data.atlases;
  if (!Array.isArray(atlases) || !atlases.every(isResource)) throw new Error('Invalid catalog atlases.');
  const publishedAt = recipePublishedAt(response);
  return version === layout.version ? pagedCatalog(data, atlases, server, publishedAt)
    : { ...legacyCatalog(readRecords(data.items, version, atlases, root)), publishedAt };
}

async function readDetails(id: string, detail: string): Promise<ItemDetails> {
  const response = await fetch(detail);
  if (!response.ok) throw new Error(`Item details request failed with HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (!isRecord(data) || (data.version !== 1 && data.version !== layout.detailVersion) || data.id !== id
    || !Array.isArray(data.variants)
    || (data.payloads !== undefined && !isPayloads(data.payloads))
    || (data.recipeFeed !== undefined && !isResource(data.recipeFeed))
    || (data.recipes !== undefined && (!Array.isArray(data.recipes) || !data.recipes.every(isRecipe)))) {
    throw new Error('Invalid item details.');
  }
  const version = data.version;
  if (!data.variants.every((variant): variant is ItemVariant => isVariant(variant, version))) {
    throw new Error('Invalid item details.');
  }
  const root = detail.slice(0, detail.lastIndexOf('details/'));
  const payloadUrl = (hash?: string) => hash && `${root}payloads/${hash}.json`;
  const payloads = (entry?: ItemPayloads) => entry && { tooltip: payloadUrl(entry.tooltip), stack: payloadUrl(entry.stack) };
  return {
    variants: data.variants.map(variant => ({
      ...variant, icon: variant.icon && iconUrl(root, variant.icon, version), payloads: payloads(variant.payloads),
    })),
    recipes: data.recipes, payloads: payloads(data.payloads), recipeFeed: payloadUrl(data.recipeFeed),
  };
}

export function loadItemPayload(url: string, signal: AbortSignal) {
  return readJson(url, signal);
}

export function loadItemDetails({ id, detail }: CatalogItem) {
  if (!detail) return Promise.resolve<ItemDetails>({ variants: [] });
  let request = itemDetails.get(detail);
  if (!request) {
    request = readDetails(id, detail).catch(error => {
      itemDetails.delete(detail);
      throw error;
    });
    itemDetails.set(detail, request);
  }
  return request;
}
