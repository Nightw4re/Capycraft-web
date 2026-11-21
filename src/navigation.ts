import type { MouseEvent } from 'react';
import { defaultAlias, isServerAlias, type ServerPage } from './minecraftServers.mjs';
import { isItemId, parsePublicItemPath, publicItemPath } from './items/itemRoutes.mts';

export const homePath = '/';
const serverPagePattern = /^\/server\/([a-z0-9-]+)(?:\/(items|players))?\/?$/;

export type ItemRecipeView = 'recipes' | 'uses';
export type RecipeIngredientRoute = { recipe: string; slot: number };
export type ItemRoute = { id: string; view: ItemRecipeView; station?: string; recipePage?: number; ingredient?: RecipeIngredientRoute };
export type Page = 'home' | ServerPage | 'notFound';

export type Route =
  | { page: 'home'; server?: string; item?: ItemRoute }
  | { page: ServerPage; server: string; item?: ItemRoute; catalogPage?: number; catalogQuery?: string }
  | { page: 'notFound' };

export function serverPath(alias: string, page: ServerPage | 'home' = 'home') {
  return `/server/${alias}${page === 'home' ? '' : `/${page}`}`;
}

function splitUrl(url: string) {
  const end = url.indexOf('?');
  const path = end < 0 ? url : url.slice(0, end);
  return { path, params: new URLSearchParams(end < 0 ? '' : url.slice(end + 1)) };
}

function joinUrl(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function itemUrl(url: string, item?: ItemRoute) {
  const route = routeFromUrl(url);
  if (route.page === 'notFound' || !route.server) return url;
  const { params } = splitUrl(url);
  params.delete('item');
  params.delete('from');
  params.delete('view');
  params.delete('station');
  params.delete('recipePage');
  params.delete('ingredient');
  if (!item || !isItemId(item.id)) return joinUrl(serverPath(route.server, route.page), params);

  if (route.page !== 'items') params.set('from', route.page);
  if (item.view === 'uses') params.set('view', 'uses');
  if (item.station !== undefined) params.set('station', item.station);
  if (item.recipePage !== undefined) params.set('recipePage', String(item.recipePage + 1));
  if (item.ingredient) params.set('ingredient', `${item.ingredient.recipe}@${item.ingredient.slot}`);
  return joinUrl(publicItemPath(route.server, item.id), params);
}

export function catalogPageUrl(url: string, page: number, query?: string) {
  const { path, params } = splitUrl(url);
  params.set('page', String(page + 1));
  if (query !== undefined) {
    if (query) params.set('q', query);
    else params.delete('q');
  }
  return joinUrl(path, params);
}

function legacyPageUrl(fragment: string) {
  const { path: oldPath, params } = splitUrl(fragment);
  let path = oldPath;
  if (path === homePath || path === '/info' || path === '/information') return joinUrl(homePath, params);
  if (path === '/items' || path === '/players' || path.startsWith('/items/')) {
    path = serverPath(defaultAlias) + path;
  }
  let id = params.get('item');
  const legacyItem = /^(\/server\/[a-z0-9-]+\/items)\/(.+)$/.exec(path);
  if (legacyItem) {
    path = legacyItem[1];
    try {
      id = decodeURIComponent(legacyItem[2]);
    } catch {
      return '/404';
    }
  }
  const match = serverPagePattern.exec(path);
  if (!match) return '/404';
  const [, server, section] = match;
  params.delete('item');
  params.delete('from');
  if (!isItemId(id)) return joinUrl(path, params);
  if (section !== 'items') params.set('from', section ?? 'home');
  return joinUrl(publicItemPath(server, id), params);
}

export function pageUrl({ pathname, search, hash }: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  return hash.startsWith('#/') ? legacyPageUrl(hash.slice(1)) : pathname + search;
}

export function navigatePage(url: string) {
  const { pathname, search, hash } = window.location;
  if (url === pathname + search + hash) return;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function followPageLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  const { pathname, search } = event.currentTarget;
  navigatePage(pathname + search);
  return true;
}

function readPageNumber(value: string | null) {
  return value && /^[1-9]\d{0,7}$/.test(value) ? Number(value) - 1 : undefined;
}

export function routeFromUrl(url: string, isKnownServer?: (alias: string) => boolean): Route {
  const { path, params } = splitUrl(url);
  if (path === homePath) return { page: 'home' };
  const publicItem = parsePublicItemPath(path);
  const match = publicItem ? null : serverPagePattern.exec(path);
  const server = publicItem?.server ?? match?.[1];
  if (!isServerAlias(server) || (isKnownServer && !isKnownServer(server))) return { page: 'notFound' };
  const section = publicItem ? params.get('from') ?? 'items' : match?.[2];
  const page = section === 'items' || section === 'players' || section === 'home' ? section : publicItem ? 'items' : 'home';
  const catalogPage = page === 'items' ? readPageNumber(params.get('page')) : undefined;
  const catalogQuery = page === 'items' ? params.get('q')?.slice(0, 256) : undefined;
  const route = { page, server, catalogPage, catalogQuery } as const;
  const id = publicItem?.id;
  if (!id) return route;
  const ingredientMatch = /^(.+)@(\d+)$/.exec(params.get('ingredient') ?? '');
  const slot = Number(ingredientMatch?.[2]);
  const ingredient = ingredientMatch && Number.isSafeInteger(slot) ? { recipe: ingredientMatch[1], slot } : undefined;
  const station = params.get('station') ?? undefined;
  const recipePage = readPageNumber(params.get('recipePage'));
  return { ...route, item: { id, view: params.get('view') === 'uses' ? 'uses' : 'recipes', station, recipePage, ingredient } };
}
