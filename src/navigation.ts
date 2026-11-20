import { defaultAlias, isServerAlias, type ServerPage } from './minecraftServers.mjs';

export const homeHash = '#/';

export type ItemRecipeView = 'recipes' | 'uses';
export type RecipeIngredientRoute = { recipe: string; slot: number };
export type ItemRoute = { id: string; view: ItemRecipeView; ingredient?: RecipeIngredientRoute };
export type Page = 'home' | ServerPage | 'notFound';

export type Route =
  | { page: 'home'; server?: string; item?: ItemRoute }
  | { page: ServerPage; server: string; item?: ItemRoute }
  | { page: 'notFound' };

export function serverHash(alias: string, page?: ServerPage) {
  return `${homeHash}server/${alias}${page ? `/${page}` : ''}`;
}

function splitHash(hash: string) {
  const end = hash.indexOf('?');
  const path = end < 0 ? hash : hash.slice(0, end);
  return { path, params: new URLSearchParams(end < 0 ? '' : hash.slice(end + 1)) };
}

function joinHash(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function itemHash(hash: string, item?: ItemRoute) {
  const { path, params } = splitHash(canonicalHash(hash));
  params.delete('item');
  params.delete('view');
  params.delete('ingredient');
  if (item) {
    params.set('item', item.id);
    if (item.view === 'uses') params.set('view', 'uses');
    if (item.ingredient) params.set('ingredient', `${item.ingredient.recipe}@${item.ingredient.slot}`);
  }
  return joinHash(path, params);
}

export function canonicalHash(hash: string) {
  if (hash === '' || hash === '#/info' || hash === '#/information') return homeHash;
  const { path, params } = splitHash(hash);
  if (path === '#/items' || path === '#/players' || path.startsWith('#/items/')) {
    return canonicalHash(`${serverHash(defaultAlias)}${hash.slice(1)}`);
  }
  const legacyItem = /^(#\/server\/[a-z0-9-]+\/items)\/(.+)$/.exec(path);
  if (legacyItem) {
    params.set('item', legacyItem[2]);
    return joinHash(legacyItem[1], params);
  }
  return hash;
}

export function routeFromHash(hash: string, isKnownServer?: (alias: string) => boolean): Route {
  const { path, params } = splitHash(canonicalHash(hash));
  if (path === homeHash) return { page: 'home' };
  const match = /^#\/server\/([a-z0-9-]+)(?:\/(items|players))?$/.exec(path);
  if (!match || !isServerAlias(match[1]) || (isKnownServer && !isKnownServer(match[1]))) return { page: 'notFound' };
  const [, server, section] = match;
  const page = section === 'items' || section === 'players' ? section : 'home';
  const id = params.get('item');
  if (!id) return { page, server };
  const ingredientMatch = /^(.+)@(\d+)$/.exec(params.get('ingredient') ?? '');
  const slot = Number(ingredientMatch?.[2]);
  const ingredient = ingredientMatch && Number.isSafeInteger(slot) ? { recipe: ingredientMatch[1], slot } : undefined;
  return { page, server, item: { id, view: params.get('view') === 'uses' ? 'uses' : 'recipes', ingredient } };
}
