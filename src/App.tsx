import { useEffect, useRef, useState } from 'react';
import discordLogo from '../assets/discord-symbol-white.svg';
import { ServerItems } from './items/ItemCatalog';
import { HomeHighlight } from './layout/HomeHighlight';
import { InfoPanel } from './layout/InfoPanel';
import { PageError } from './layout/PageError';
import { PageLayout } from './layout/PageLayout';
import { ServerOverview } from './layout/ServerOverview';
import { isServerAlias } from './minecraftServers.mjs';
import { homeHash, itemHash, routeFromHash, serverHash, type ItemRecipeView, type RecipeIngredientRoute } from './navigation';
import { PlayerList } from './players/PlayerList';
import { usePreferences } from './PreferencesProvider';
import { useServerDirectory } from './ServerDirectoryProvider';
import { NugwaPortrait } from './portrait/NugwaPortrait';
import { WinterScene } from './scene/WinterScene';
import { usePageHash } from './usePageHash';

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
  const [hash, setHash] = usePageHash(panels, isKnownServer);
  const [rememberedServer, setRememberedServer] = useState(readServerSelection);
  const route = routeFromHash(hash, isKnownServer);
  const { page } = route;
  const routeServer = 'server' in route ? route.server : undefined;
  const item = 'item' in route ? route.item : undefined;

  useEffect(() => {
    if (!routeServer) return;
    setRememberedServer(routeServer);
    storeServerSelection(routeServer);
  }, [routeServer]);

  function clearServer() {
    setRememberedServer(undefined);
    storeServerSelection();
  }

  const pageHash = routeServer || !rememberedServer || page !== 'home' ? hash : hash.replace(homeHash, serverHash(rememberedServer));

  function itemHref(id: string, view: ItemRecipeView = 'recipes') {
    return itemHash(pageHash, { id, view });
  }

  function openItem(id: string, view: ItemRecipeView = 'recipes') {
    const url = itemHref(id, view);
    const state = window.history.state;
    if (item) {
      // Replacing an ingredient entry leaves its parent recipe in the history.
      const recipeBack = state?.recipeBack ? state.recipeBack + (state.ingredientBack ? 1 : 0) : undefined;
      window.history.replaceState({ ...state, recipeBack, ingredientBack: false }, '', url);
    } else {
      window.history.pushState({ ...state, recipeBack: 1, ingredientBack: false }, '', url);
    }
    setHash(url);
  }

  function closeItem() {
    const state = window.history.state;
    if (state?.recipeBack) {
      window.history.go(-state.recipeBack);
    } else {
      const url = itemHash(hash);
      window.history.replaceState({ ...state, ingredientBack: false }, '', url);
      setHash(url);
    }
  }

  function openIngredient(ingredient: RecipeIngredientRoute) {
    if (!item) return;
    const url = itemHash(hash, { ...item, ingredient });
    window.history.pushState({ ...window.history.state, ingredientBack: true }, '', url);
    setHash(url);
  }

  function closeIngredient() {
    if (!item?.ingredient) return;
    const state = window.history.state;
    if (state?.ingredientBack) {
      window.history.back();
    } else {
      const url = itemHash(hash, { id: item.id, view: item.view });
      window.history.replaceState(state, '', url);
      setHash(url);
    }
  }

  return (
    <WinterScene page={page} server={page === 'notFound' ? undefined : routeServer ?? rememberedServer}
      onClearServer={clearServer} panelsRef={panels}>
      {page === 'notFound' && <PageError code={404} />}
      {route.page === 'players' && <PlayerList key={route.server} server={route.server} />}
      {routeServer && (page === 'items' || item) && <ServerItems key={routeServer} server={routeServer}
        showCatalog={page === 'items'} item={item} itemHref={itemHref} onOpenItem={openItem} onCloseItem={closeItem}
        onOpenIngredient={openIngredient} onCloseIngredient={closeIngredient} />}
      {page === 'home' && <PageLayout header={<HomeHighlight />} layout="grid">
        <InfoPanel title={text.about}>
          <p className="server-account-note">{text.officialMinecraftAccount}</p>
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
            <NugwaPortrait />
          </div>
        </InfoPanel>
        <ServerOverview />
      </PageLayout>}
    </WinterScene>
  );
}
