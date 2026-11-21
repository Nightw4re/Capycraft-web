import { useCallback, useEffect, useRef, useState } from 'react';
import discordLogo from '../assets/discord-symbol-white.svg';
import { CatalogLanguageNotice } from './items/CatalogLanguageNotice';
import { ServerItems } from './items/ItemCatalog';
import { HomeHighlight } from './layout/HomeHighlight';
import { InfoPanel } from './layout/InfoPanel';
import { PageError } from './layout/PageError';
import { PageLayout } from './layout/PageLayout';
import { ServerOverview } from './layout/ServerOverview';
import { isServerAlias } from './minecraftServers.mjs';
import { catalogPageUrl, itemUrl, pageUrl, routeFromUrl, serverPath,
  type ItemRecipeView, type RecipeIngredientRoute } from './navigation';
import { PlayerList } from './players/PlayerList';
import { usePreferences } from './PreferencesProvider';
import { useServerDirectory } from './ServerDirectoryProvider';
import { NugwaPortrait } from './portrait/NugwaPortrait';
import { WinterScene } from './scene/WinterScene';
import { usePageLocation } from './usePageLocation';

const serverSelectionKey = 'capycraft.selectedServer';

function readServerSelection() {
  try {
    const server = window.sessionStorage.getItem(serverSelectionKey);
    if (isServerAlias(server)) return server;
  } catch {
    // The selection can still be kept in memory when storage is unavailable.
  }
}

function storeServerSelection(server?: string) {
  try {
    if (server) window.sessionStorage.setItem(serverSelectionKey, server);
    else window.sessionStorage.removeItem(serverSelectionKey);
  } catch {
    // The selection can still be kept in memory when storage is unavailable.
  }
}

export function App() {
  const { text } = usePreferences();
  const { servers, loaded } = useServerDirectory();
  const isKnownServer = (alias: string) => !loaded || servers.some(server => server.alias === alias);
  const panels = useRef<HTMLDivElement>(null);
  const [url, setUrl] = usePageLocation(panels, isKnownServer);
  const [rememberedServer, setRememberedServer] = useState(readServerSelection);
  const route = routeFromUrl(url, isKnownServer);
  const { page } = route;
  const routeServer = 'server' in route ? route.server : undefined;
  const item = 'item' in route ? route.item : undefined;
  const catalogPage = 'catalogPage' in route ? route.catalogPage ?? 0 : 0;
  const catalogQuery = 'catalogQuery' in route ? route.catalogQuery ?? '' : '';

  const changeCatalogPage = useCallback((number: number, query?: string) => {
    const currentUrl = pageUrl(window.location);
    const current = routeFromUrl(currentUrl);
    if (current.page !== 'items' || current.server !== routeServer) return;
    if ((current.catalogPage ?? 0) === number && (query === undefined || (current.catalogQuery ?? '') === query)) return;
    const next = catalogPageUrl(currentUrl, number, query);
    window.history.replaceState(window.history.state, '', next);
    setUrl(next);
  }, [routeServer, setUrl]);

  useEffect(() => {
    if (!routeServer) return;
    setRememberedServer(routeServer);
    storeServerSelection(routeServer);
  }, [routeServer]);

  function clearServer() {
    setRememberedServer(undefined);
    storeServerSelection();
  }

  const itemBaseUrl = !routeServer && rememberedServer && page === 'home' ? serverPath(rememberedServer) : url;

  function itemHref(id: string, view: ItemRecipeView = 'recipes') {
    return itemUrl(itemBaseUrl, { id, view });
  }

  function openItem(id: string, view: ItemRecipeView = 'recipes') {
    const next = itemHref(id, view);
    const state = window.history.state;
    if (item) {
      // Replacing an ingredient entry leaves its parent recipe in the history.
      const recipeBack = state?.recipeBack ? state.recipeBack + (state.ingredientBack ? 1 : 0) : undefined;
      window.history.replaceState({ ...state, recipeBack, ingredientBack: false }, '', next);
    } else {
      window.history.pushState({ ...state, recipeBack: 1, ingredientBack: false,
        catalogPageAtOpen: catalogPage, catalogQueryAtOpen: catalogQuery }, '', next);
    }
    setUrl(next);
  }

  function closeItem() {
    const state = window.history.state;
    if (state?.recipeBack && (state.catalogPageAtOpen ?? 0) === catalogPage && (state.catalogQueryAtOpen ?? '') === catalogQuery) {
      window.history.go(-state.recipeBack);
    } else {
      const next = itemUrl(url);
      window.history.replaceState({ ...state, recipeBack: undefined, ingredientBack: false,
        catalogPageAtOpen: undefined, catalogQueryAtOpen: undefined }, '', next);
      setUrl(next);
    }
  }

  function openIngredient(ingredient: RecipeIngredientRoute) {
    if (!item) return;
    const next = itemUrl(url, { ...item, ingredient });
    window.history.pushState({ ...window.history.state, ingredientBack: true }, '', next);
    setUrl(next);
  }

  function changeRecipePosition(station: string, recipePage?: number) {
    const currentUrl = pageUrl(window.location);
    const current = routeFromUrl(currentUrl);
    const currentItem = 'item' in current ? current.item : undefined;
    if (!currentItem || currentItem.id !== item?.id || currentItem.view !== item.view || currentItem.ingredient
      || (currentItem.station === station && currentItem.recipePage === recipePage)) return;
    const next = itemUrl(currentUrl, { ...currentItem, station, recipePage });
    window.history.replaceState(window.history.state, '', next);
    setUrl(next);
  }

  function closeIngredient() {
    if (!item?.ingredient) return;
    const state = window.history.state;
    if (state?.ingredientBack) {
      window.history.back();
    } else {
      const next = itemUrl(url, { ...item, ingredient: undefined });
      window.history.replaceState(state, '', next);
      setUrl(next);
    }
  }

  return (
    <WinterScene page={page} server={page === 'notFound' ? undefined : routeServer ?? rememberedServer}
      onClearServer={clearServer} panelsRef={panels}>
      {page === 'notFound' && <PageError code={404} />}
      {route.page === 'players' && <PlayerList key={route.server} server={route.server} />}
      <CatalogLanguageNotice active={page === 'items'} />
      {routeServer && (page === 'items' || item) && <ServerItems key={routeServer} server={routeServer}
        showCatalog={page === 'items'} page={catalogPage} query={catalogQuery} onPageChange={changeCatalogPage}
        item={item} itemHref={itemHref} onOpenItem={openItem} onCloseItem={closeItem}
        onRecipePositionChange={changeRecipePosition} onOpenIngredient={openIngredient} onCloseIngredient={closeIngredient} />}
      {page === 'home' && <PageLayout header={<HomeHighlight />} layout="grid">
        <InfoPanel title={text.about}>
          <p className="info-panel-note">{text.officialMinecraftAccount}</p>
          <p>{text.server}</p>
          <p>{text.communityLanguage}</p>
          <a className="discord-invite" href="https://discord.gg/qsggTTjKE8" target="_blank" rel="noopener noreferrer">
            <img src={discordLogo} width={36} height={27} alt="" loading="lazy" />
            {text.discordInvite}
          </a>
        </InfoPanel>
        <InfoPanel title={text.dashboard}>
          <div className="player-dashboard-preview">
            <p>{text.dashboardSoon}</p>
            <NugwaPortrait server={routeServer ?? rememberedServer} />
          </div>
        </InfoPanel>
        <ServerOverview />
      </PageLayout>}
    </WinterScene>
  );
}
