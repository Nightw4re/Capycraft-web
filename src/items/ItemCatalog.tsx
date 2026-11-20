import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import copyIcon from '../../assets/pixel-copy-papers.png';
import { InfoPanel } from '../layout/InfoPanel';
import { PageLayout } from '../layout/PageLayout';
import { useNotifications } from '../notifications/Notifications';
import type { ItemRecipeView, ItemRoute, RecipeIngredientRoute } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { HeaderPicker } from '../scene/HeaderPicker';
import { useSceneContentReady } from '../scene/SceneEntrance';
import { useLiveCatalog } from '../ServerDirectoryProvider';
import { isItemId, loadCatalog, loadItemDetails, loadItemPayload, type Catalog, type CatalogItem, type ItemSprite, type ItemVariant } from './catalogData';
import type { ItemBar } from './catalogIndex.mjs';
import { pageSize, atlasColumns, tileSize } from './catalogLayout.json';
import { ItemLoadingHint } from './ItemLoadingHint';
import { ModPicker } from './ModPicker';
import { readLegacyRecipes, readRecipeFeed, recipeStations, type MachineRecipe, type RecipeEntry, type RecipeIngredient } from './itemRecipes';
import { ItemTooltip, ItemTooltipPopover, loadPageTooltipShortcuts, useItemTooltip } from './ItemTooltip';
import { ItemTooltipTools, tooltipShortcutColor, type TooltipModes } from './ItemTooltipTools';
import './items.css';

const atlasRows = pageSize / atlasColumns;
const iconTimeoutMs = 8000;
const itemHoldMs = 500;
const recipesPerPage = 3;
const ingredientRotationMs = 2000;
const ingredientTooltipLimit = 12;
const pageWheelDelayMs = 90;

type ItemNavigation = {
  itemHref: (id: string, view?: ItemRecipeView) => string;
  onOpenItem: (id: string, view?: ItemRecipeView, preview?: CatalogItem) => void;
};

type IngredientNavigation = {
  ingredient?: RecipeIngredientRoute;
  onOpenIngredient: (ingredient: RecipeIngredientRoute) => void;
  onCloseIngredient: () => void;
};

type ServerItemsProps = ItemNavigation & Omit<IngredientNavigation, 'ingredient'> & {
  server: string;
  showCatalog: boolean;
  item?: ItemRoute;
  onCloseItem: () => void;
};

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

function useRequest<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [result, setResult] = useState<{ load: typeof load; state: LoadState<T> }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ load, state: { status: 'ready', data } }); },
      () => { if (!controller.signal.aborted) setResult({ load, state: { status: 'error' } }); },
    );
    return () => controller.abort();
  }, [load, attempt, enabled]);
  function retry() {
    setResult(undefined);
    setAttempt(current => current + 1);
  }
  const state = enabled && result?.load === load ? result.state : { status: 'loading' } as const;
  return { state, retry };
}

function ItemIcon({ icon, sprite, bar, fluid = false, pending = false, lazy = false, timeout, onImageSettled }: {
  icon?: string;
  sprite?: ItemSprite;
  bar?: ItemBar;
  fluid?: boolean;
  pending?: boolean;
  lazy?: boolean;
  timeout?: number;
  onImageSettled?: (url: string) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const imageUrl = sprite || pending ? undefined : icon;

  useEffect(() => {
    const element = image.current;
    if (!element || !imageUrl) return;
    const settle = () => onImageSettled?.(imageUrl);
    if (element.complete) {
      if (onImageSettled) void element.decode().then(settle, settle);
      return;
    }
    if (timeout === undefined) return;
    const timer = window.setTimeout(() => {
      if (element.complete) return;
      element.hidden = true;
      element.removeAttribute('src');
      settle();
    }, timeout);
    return () => {
      window.clearTimeout(timer);
      if (!element.isConnected && !element.complete) element.removeAttribute('src');
    };
  }, [imageUrl, onImageSettled, timeout]);

  return (
    <span className="item-icon" aria-hidden="true" data-pending={pending || undefined} data-fluid={fluid || undefined}>
      {sprite && (
        <span className="item-sprite" style={{
          backgroundImage: `url("${sprite.url}")`,
          backgroundSize: `${atlasColumns * 100}% ${atlasRows * 100}%`,
          backgroundPosition: `${(sprite.position % atlasColumns) * 100 / (atlasColumns - 1)}% ${Math.floor(sprite.position / atlasColumns) * 100 / (atlasRows - 1)}%`,
        }} />
      )}
      {imageUrl && (
        <img
          key={imageUrl} ref={image} src={imageUrl} alt="" width={tileSize} height={tileSize} decoding="async"
          loading={lazy ? 'lazy' : undefined}
          onLoad={onImageSettled && (event => {
            const settle = () => onImageSettled(imageUrl);
            void event.currentTarget.decode().then(settle, settle);
          })}
          onError={event => {
            event.currentTarget.hidden = true;
            onImageSettled?.(imageUrl);
          }}
        />
      )}
      {bar && (sprite || imageUrl) && <span className="item-icon-bar"><span style={{
        inlineSize: `${bar.width / 13 * 100}%`,
        backgroundColor: `#${bar.color.toString(16).padStart(6, '0')}`,
      }} /></span>}
    </span>
  );
}

type TooltipTarget<Element extends HTMLElement = HTMLElement> = {
  anchor: Element;
  triggerId: string;
  touch: boolean;
};

function useTooltipTrigger<Element extends HTMLElement>(
  target: TooltipTarget | undefined, show: (target: TooltipTarget<Element>) => void, hide: (anchor: Element) => void,
) {
  const triggerId = useId();
  const lastPointerType = useRef<string>(undefined);
  const active = target?.triggerId === triggerId;
  const touch = active && target.touch;

  function reveal(anchor: Element, touch: boolean) {
    show({ anchor, triggerId, touch });
  }

  return {
    active,
    touch,
    onPointerEnter(event: PointerEvent<Element>) {
      if (event.pointerType !== 'touch') reveal(event.currentTarget, false);
    },
    onPointerLeave(event: PointerEvent<Element>) {
      if (event.pointerType !== 'touch' && active && !touch) hide(event.currentTarget);
    },
    onPointerDown(event: PointerEvent<Element>) {
      lastPointerType.current = event.pointerType;
    },
    onFocus(event: FocusEvent<Element>) {
      if (!active && event.currentTarget.matches(':focus-visible')) reveal(event.currentTarget, false);
    },
    onBlur(event: FocusEvent<Element>) {
      const next = event.relatedTarget;
      if (active && (!touch || (next && !next.closest('.item-tooltip-tools')))) hide(event.currentTarget);
    },
    previewTouch(event: MouseEvent<Element>) {
      const { nativeEvent } = event;
      // WebKit can report a mouse click after a touch pointer press.
      const pointerType = (event.detail > 0 ? lastPointerType.current : undefined)
        || ('pointerType' in nativeEvent ? nativeEvent.pointerType : undefined);
      lastPointerType.current = undefined;
      if (pointerType !== 'touch' || touch) return false;
      reveal(event.currentTarget, true);
      return true;
    },
  };
}

type ItemLinkActions = ItemNavigation & {
  showTooltip: (item: CatalogItem, target: TooltipTarget<HTMLAnchorElement>) => void;
  hideTooltip: (anchor?: HTMLElement) => void;
  description?: TooltipTarget & { id: string };
};

function ItemLink({ item, label = item.name, itemHref, description, showTooltip, hideTooltip, onOpenItem, children }: ItemLinkActions & {
  item: CatalogItem;
  label?: string;
  children: ReactNode;
}) {
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const suppressClick = useRef(false);
  const [holding, setHolding] = useState(false);
  const tooltip = useTooltipTrigger<HTMLAnchorElement>(description, target => showTooltip(item, target), hideTooltip);
  useEffect(() => () => window.clearTimeout(press.current?.timer), []);

  function stopHolding(pointerId: number) {
    if (press.current?.id !== pointerId) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
    setHolding(false);
  }

  function open(view: ItemRecipeView) {
    hideTooltip();
    onOpenItem(item.id, view, item);
  }

  return <a className="item-slot-button" href={itemHref(item.id)} aria-label={label} aria-haspopup="dialog"
    aria-describedby={tooltip.active ? description?.id : undefined}
    aria-keyshortcuts="Shift+F10"
    data-holding={holding || undefined} style={holding ? { '--item-hold-duration': `${itemHoldMs}ms` } as CSSProperties : undefined}
    onPointerEnter={tooltip.onPointerEnter}
    onPointerLeave={tooltip.onPointerLeave}
    onPointerDown={event => {
      tooltip.onPointerDown(event);
      suppressClick.current = false;
      if (event.pointerType !== 'touch' || !event.isPrimary || press.current) return;
      const { pointerId, clientX, clientY } = event;
      const timer = window.setTimeout(() => {
        stopHolding(pointerId);
        suppressClick.current = true;
        open('uses');
      }, itemHoldMs);
      press.current = { id: pointerId, x: clientX, y: clientY, timer };
      setHolding(true);
    }}
    onPointerMove={event => {
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) stopHolding(event.pointerId);
    }}
    onPointerUp={event => stopHolding(event.pointerId)}
    onPointerCancel={event => stopHolding(event.pointerId)}
    onLostPointerCapture={event => stopHolding(event.pointerId)}
    onFocus={tooltip.onFocus}
    onBlur={tooltip.onBlur}
    onKeyDown={event => {
      if (event.key === 'Escape' && tooltip.active) {
        event.preventDefault();
        hideTooltip(event.currentTarget);
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        open('uses');
      }
    }}
    onContextMenu={event => {
      event.preventDefault();
      if (!press.current && !suppressClick.current && !('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch')) {
        open('uses');
      }
    }}
    onClick={event => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        suppressClick.current = false;
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!tooltip.previewTouch(event)) open('recipes');
    }}>
    {children}
  </a>;
}

export function ServerItems({ server, showCatalog, item, onCloseItem, onOpenIngredient, onCloseIngredient, ...navigation }: ServerItemsProps) {
  const { language, text } = usePreferences();
  const load = useCallback((signal: AbortSignal) => loadCatalog(server, signal), [server]);
  const { state: initial, retry: retryInitial } = useRequest(load);
  const [refreshed, setRefreshed] = useState<Catalog | null>();
  const { status: importStatus, version } = useLiveCatalog(server) ?? {};
  const [tooltipModes, setTooltipModes] = useState<TooltipModes>({ advanced: false });
  const [openedItem, setOpenedItem] = useState<{ catalog: Catalog; preview: CatalogItem }>();
  const state = refreshed === undefined ? initial : { status: 'ready' as const, data: refreshed };
  const catalog = state.status === 'ready' ? state.data : null;
  const preview = openedItem && openedItem.catalog === catalog && openedItem.preview.id === item?.id ? openedItem.preview : undefined;
  const progress = catalog?.progress;
  const format = new Intl.NumberFormat(language);
  let notice = '';
  if (importStatus?.state === 'running') {
    const counts = importStatus.progress;
    const percent = counts?.expected ? new Intl.NumberFormat(language, { style: 'percent' })
      .format(Math.floor(counts.loaded * 100 / counts.expected) / 100) : undefined;
    if (catalog && !progress) {
      if (importStatus.phase === 'preparing') {
        notice = text.itemUpdatePreparing;
      } else if (importStatus.phase === 'publishing') {
        notice = text.itemUpdatePublishing;
      } else if (percent) {
        notice = text.itemUpdateProgress(percent);
      } else {
        notice = text.itemUpdateRunning;
      }
    } else if (counts && percent) {
      notice = text.itemImportProgress(format.format(counts.loaded), format.format(counts.expected), percent);
    } else {
      notice = text.itemImportStarting;
    }
  } else if (progress?.failed || importStatus?.state === 'failed') {
    notice = progress ? text.itemImportFailed : text.itemImportStopped;
  }

  useEffect(() => {
    if (version === undefined) return;
    if (version === null) {
      setRefreshed(null);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal).then(next => {
      if (!controller.signal.aborted) {
        setRefreshed(current => next?.key !== undefined && current?.key === next.key ? current : next);
      }
    }).catch(() => { /* Keep the most recent catalog on a failed refresh. */ });
    return () => controller.abort();
  }, [load, version]);

  function retry() {
    setRefreshed(undefined);
    retryInitial();
  }

  return <>
    {showCatalog && !item && !catalog && <ItemTooltipTools modes={tooltipModes} onChange={setTooltipModes} />}
    {showCatalog && <PageLayout title={text.items}>
      <InfoPanel>
        <p className="item-catalog-language">{text.itemCatalogLanguage}</p>
        <p className="item-import-progress" role="status">{notice}</p>
        {state.status === 'loading' && <p role="status">{text.itemLoading}</p>}
        {state.status === 'error' && (
          <div>
            <p role="status">{text.itemLoadError}</p>
            <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
          </div>
        )}
        {state.status === 'ready' && !catalog && (
          <div>
            <p role="status">{text.itemCatalogUnavailable}</p>
            <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
          </div>
        )}
        {catalog && <ItemList catalog={catalog} modes={tooltipModes} onModesChange={setTooltipModes}
          dialogOpen={!!item} itemHref={navigation.itemHref}
          onOpenItem={(id, view, preview) => {
            setOpenedItem(preview && { catalog, preview });
            navigation.onOpenItem(id, view);
          }} />}
      </InfoPanel>
    </PageLayout>}
    {item && <ItemDialog key={item.id} itemId={item.id} preview={preview} recipeView={item.view} ingredient={item.ingredient}
      catalog={catalog} modes={tooltipModes} onModesChange={setTooltipModes} onClose={onCloseItem}
      onOpenIngredient={onOpenIngredient} onCloseIngredient={onCloseIngredient} {...navigation}>
      {state.status === 'loading' ? <p role="status">{text.itemLoading}</p> : <div>
        <p role="status">{state.status === 'error' ? text.itemLoadError : text.itemCatalogUnavailable}</p>
        <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
      </div>}
    </ItemDialog>}
  </>;
}

type InventoryPage = {
  key: string;
  source: string;
  number: number;
  items: CatalogItem[];
  total: number;
  useAtlases: boolean;
};

type WheelPage = { source: string; number: number };
const blankInventory = { key: 'wheel-loading', items: [], useAtlases: false };

function ItemList({ catalog, modes, onModesChange, dialogOpen, ...navigation }: ItemNavigation & {
  catalog: Catalog;
  modes: TooltipModes;
  onModesChange: (modes: TooltipModes) => void;
  dialogOpen: boolean;
}) {
  const { language, text } = usePreferences();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [mod, setMod] = useState('');
  const [page, setPage] = useState(0);
  const [wheelPage, setWheelPage] = useState<WheelPage>();
  const wheelIntent = useRef<WheelPage>(undefined);
  const source = JSON.stringify([catalog.key, language, mod, query]);
  const wheelTarget = wheelPage?.source === source ? wheelPage.number : undefined;
  const [hovered, setHovered] = useState<TooltipTarget<HTMLAnchorElement> & { item: CatalogItem }>();
  const tooltipId = useId();
  const tooltip = dialogOpen ? undefined : hovered;
  const tooltipData = useItemTooltip(tooltip?.item);
  const [shown, setShown] = useState<InventoryPage>();
  const resultCount = useRef<HTMLParagraphElement>(null);
  const inventory = useRef<HTMLDivElement>(null);
  const clearWheel = useCallback(() => {
    wheelIntent.current = undefined;
    setWheelPage(undefined);
  }, []);
  useEffect(() => {
    if (search === query) return;
    const timer = window.setTimeout(() => {
      setHovered(undefined);
      clearWheel();
      setQuery(search);
      setPage(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, query, clearWheel]);

  useEffect(() => {
    if (wheelTarget === undefined || wheelTarget === page) return;
    const timer = window.setTimeout(() => setPage(wheelTarget), pageWheelDelayMs);
    return () => window.clearTimeout(timer);
  }, [page, wheelTarget]);

  const loadPage = useMemo(() => (signal: AbortSignal) => catalog.getPage({ language, page, mod, query }, signal),
    [catalog, language, page, mod, query]);
  const { state, retry } = useRequest(loadPage, wheelTarget === undefined || wheelTarget === page);
  const result = state.status === 'ready' ? state.data : undefined;
  const requested = useMemo<InventoryPage | undefined>(() => result && ({
    ...result,
    key: JSON.stringify([source, page]),
    source,
    number: page,
    useAtlases: !query.trim() && !mod,
  }), [result, source, page, mod, query]);
  const knownPage = shown ?? requested;
  const displayed = wheelTarget === undefined ? knownPage : requested;
  const wheelPending = wheelTarget !== undefined && !displayed;
  const gridPage = displayed ?? (wheelPending ? blankInventory : undefined);
  const displayedItems = displayed?.items;
  const loadShortcuts = useCallback((signal: AbortSignal) => loadPageTooltipShortcuts(displayedItems ?? [], signal),
    [displayedItems]);
  const { state: shortcuts } = useRequest(loadShortcuts);
  const activeShortcut = shortcuts.status === 'ready'
    ? shortcuts.data.find(shortcut => shortcut.id === modes.shortcut) : undefined;
  const highlight = activeShortcut
    ? { color: tooltipShortcutColor(activeShortcut.id), itemIds: activeShortcut.itemIds } : undefined;
  const preparing = wheelTarget === undefined && shown?.items.length && requested?.items.length
    && shown.key !== requested.key ? requested : undefined;
  const loading = state.status === 'loading' || preparing !== undefined;
  const displayedNumber = displayed?.number ?? wheelTarget ?? page;
  const pageCount = Math.ceil((displayed?.total ?? knownPage?.total ?? 0) / pageSize);
  const showPagination = displayedNumber > 0 || pageCount > 1;
  const format = new Intl.NumberFormat(language);

  useLayoutEffect(() => {
    const intent = wheelIntent.current;
    if (intent && intent.source !== source) clearWheel();
    if (intent?.source === source && requested?.number !== intent.number) return;
    if (!requested || preparing) return;
    setShown(requested);
    if (wheelTarget === requested.number) clearWheel();
  }, [requested, preparing, source, wheelTarget, clearWheel]);

  const showPreparedPage = useCallback(() => {
    if (!preparing || wheelIntent.current?.source === source) return;
    setHovered(undefined);
    setShown(preparing);
  }, [preparing, source]);

  function showTooltip(item: CatalogItem, target: TooltipTarget<HTMLAnchorElement>) {
    setHovered({ item, ...target });
  }

  const hideTooltip = useCallback((anchor?: HTMLElement) => {
    setHovered(current => !anchor || current?.anchor === anchor ? undefined : current);
  }, []);

  function updateTooltipOnScroll(scroller: HTMLDivElement) {
    if (!hovered || !scroller.contains(hovered.anchor)) return;
    if (hovered.touch || !hovered.anchor.matches(':hover, :focus-visible')) hideTooltip(hovered.anchor);
  }

  function navigate(nextPage: number) {
    setHovered(undefined);
    clearWheel();
    if (nextPage === page) retry();
    else setPage(nextPage);
    resultCount.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    const frame = inventory.current;
    if (!frame || !knownPage || knownPage.source !== source || dialogOpen) return;
    const { total, number } = knownPage;
    const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const scroller = event.target instanceof Element ? event.target.closest('.item-inventory') : null;
      if (!scroller) return;
      const forward = event.deltaY > 0;
      const intent = wheelIntent.current?.source === source ? wheelIntent.current : undefined;
      const canScroll = forward
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1
        : scroller.scrollTop > 1;
      if (!intent && canScroll) return;
      const current = intent?.number ?? number;
      const next = Math.max(0, Math.min(lastPage, current + (forward ? 1 : -1)));
      if (next === current) return;
      event.preventDefault();
      const turn = { source, number: next };
      wheelIntent.current = turn;
      setHovered(undefined);
      setWheelPage(turn);
    }

    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [dialogOpen, knownPage, source]);

  return (
    <>
      <div className="item-filters">
        <label>
          {text.itemSearch}
          <input type="search" value={search} maxLength={256} onChange={event => setSearch(event.target.value)} />
        </label>
        <ModPicker mods={catalog.mods} value={mod}
          onChange={value => { hideTooltip(); clearWheel(); setMod(value); setPage(0); }} />
      </div>
      <div className="item-results-status">
        <p className="item-result-count" role="status" ref={resultCount} tabIndex={-1}>
          {state.status === 'error' ? text.itemLoadError :
            pageCount > 0 ? text.itemPage(format.format(displayedNumber + 1), format.format(pageCount)) :
              state.status === 'loading' ? text.itemLoading : text.itemEmpty}
        </p>
        {displayed && loading && <ItemLoadingHint label={text.itemLoading} />}
      </div>
      {state.status === 'error' && <button className="item-action" type="button" onClick={retry}>{text.retry}</button>}
      {gridPage && (
        <div className="item-inventory-frame" aria-busy={loading} ref={inventory}>
          {[gridPage, preparing].map(view => view && (
            <div key={view.key} className="item-inventory" data-preparing={view === preparing || undefined}
              inert={view === preparing} onScroll={event => updateTooltipOnScroll(event.currentTarget)}>
              <ItemGrid items={view.items} useAtlases={view.useAtlases}
                highlight={view === displayed ? highlight : undefined}
                onReady={view === preparing ? showPreparedPage : undefined}
                description={view === displayed && tooltip ? { ...tooltip, id: tooltipId } : undefined}
                showTooltip={showTooltip} hideTooltip={hideTooltip} {...navigation} />
            </div>
          ))}
        </div>
      )}
      <ItemTooltip id={tooltipId} modes={modes} data={tooltipData}
        item={tooltip?.item} anchor={tooltip?.anchor} onDismiss={hideTooltip} />
      {!dialogOpen && <div className="item-catalog-tools-anchor">
        <ItemTooltipTools modes={modes} onChange={onModesChange}
          shortcuts={shortcuts.status === 'ready' ? shortcuts.data : undefined} />
      </div>}
      <div className="item-pagination" data-hidden={!showPagination || undefined}>
        <button className="item-action" type="button" disabled={loading || displayedNumber === 0} onClick={() => navigate(displayedNumber - 1)}>{text.itemPrevious}</button>
        <button className="item-action" type="button" disabled={loading || !displayed || displayedNumber + 1 >= pageCount} onClick={() => navigate(displayedNumber + 1)}>{text.itemNext}</button>
      </div>
    </>
  );
}

type AtlasStatus = 'ready' | 'failed';

function loadAtlas(url: string, onSettled: (status: AtlasStatus) => void) {
  const image = new Image();
  const timer = window.setTimeout(() => {
    finish('failed');
    image.removeAttribute('src');
  }, iconTimeoutMs);

  function cancel() {
    window.clearTimeout(timer);
    image.onload = image.onerror = null;
  }

  function finish(status: AtlasStatus) {
    cancel();
    onSettled(status);
  }

  image.onload = () => finish('ready');
  image.onerror = () => finish('failed');
  image.src = url;
  return () => {
    cancel();
    if (!image.complete) image.removeAttribute('src');
  };
}

function ItemGrid({ items, useAtlases, highlight, onReady, ...links }: ItemLinkActions & {
  items: CatalogItem[];
  useAtlases: boolean;
  highlight?: { color: string; itemIds: ReadonlySet<string> };
  onReady?: () => void;
}) {
  const { text } = usePreferences();
  const grid = useRef<HTMLUListElement>(null);
  const [seenItems, setSeenItems] = useState<Set<string>>();
  const [atlasStatuses, setAtlasStatuses] = useState(() => new Map<string, AtlasStatus>());
  const [settledImages, setSettledImages] = useState(() => new Set<string>());

  const markImageSettled = useCallback((url: string) => {
    setSettledImages(current => current.has(url) ? current : new Set([...current, url]));
  }, []);

  useEffect(() => {
    const list = grid.current;
    if (!list || !items.length) return;
    const slots = new Map(items.map((item, index) => [list.children[index], item]));
    const atlasRequests = new Map<string, () => void>();

    function requestPreviews(visibleItems: CatalogItem[]) {
      setSeenItems(seen => {
        if (seen && !visibleItems.length) return seen;
        const next = new Set(seen);
        for (const item of visibleItems) next.add(item.id);
        return next;
      });
      for (const item of visibleItems) {
        const url = useAtlases ? item.sprite?.url : undefined;
        if (!url || atlasRequests.has(url)) continue;
        atlasRequests.set(url, loadAtlas(url, status => {
          setAtlasStatuses(current => new Map(current).set(url, status));
        }));
      }
    }

    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      const visibleItems = [];
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        observer?.unobserve(target);
        const item = slots.get(target);
        if (item) visibleItems.push(item);
      }
      requestPreviews(visibleItems);
    });

    // The viewport observer also accounts for the inventory's scroll clipping.
    if (observer) slots.forEach((_, slot) => observer.observe(slot));
    else requestPreviews(items);

    return () => {
      observer?.disconnect();
      atlasRequests.forEach(cancel => cancel());
    };
  }, [items, useAtlases]);

  useEffect(() => {
    if (!onReady || !seenItems) return;
    for (const item of items) {
      if (!seenItems.has(item.id) || !item.icon) continue;
      const sprite = useAtlases ? item.sprite : undefined;
      const status = sprite && atlasStatuses.get(sprite.url);
      if (sprite && !status) return;
      if (status !== 'ready' && !settledImages.has(item.icon)) return;
    }
    onReady();
  }, [items, useAtlases, onReady, seenItems, atlasStatuses, settledImages]);

  return (
    <ul className="item-grid" ref={grid} aria-label={text.items}
      style={highlight ? { '--item-shortcut-color': highlight.color } as CSSProperties : undefined}>
      {items.map(item => {
        const seen = seenItems?.has(item.id);
        const sprite = useAtlases ? item.sprite : undefined;
        const atlasStatus = seen && sprite ? atlasStatuses.get(sprite.url) : undefined;
        const pending = Boolean(item.icon && (!seen || (sprite && !atlasStatus)));
        const matchesShortcut = highlight?.itemIds.has(item.id);
        return (
          <li className="item-slot" key={item.id} data-shortcut-match={matchesShortcut || undefined}>
            <ItemLink item={item} {...links}>
              <ItemIcon icon={item.icon} sprite={atlasStatus === 'ready' ? sprite : undefined} bar={item.bar}
                fluid={!!item.fluidId} pending={pending}
                timeout={iconTimeoutMs} onImageSettled={onReady ? markImageSettled : undefined} />
            </ItemLink>
          </li>
        );
      })}
      {Array.from({ length: pageSize - items.length }, (_, index) => (
        <li className="item-slot" key={index} aria-hidden="true" />
      ))}
    </ul>
  );
}

function ItemDialog({ itemId, preview, catalog, recipeView, modes, onModesChange, onClose, children,
  ingredient, onOpenIngredient, onCloseIngredient, itemHref, onOpenItem }: ItemNavigation & IngredientNavigation & {
  itemId: string;
  preview?: CatalogItem;
  catalog: Catalog | null;
  recipeView: ItemRecipeView;
  modes: TooltipModes;
  onModesChange: (modes: TooltipModes) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { text } = usePreferences();
  const notify = useNotifications();
  const sceneContentReady = useSceneContentReady();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [modalReady, setModalReady] = useState(false);
  const load = useMemo(() => (signal: AbortSignal) => preview || !catalog
    ? Promise.resolve(preview) : catalog.getItem(itemId, signal), [catalog, preview, itemId]);
  const { state, retry } = useRequest(load);
  const selected = preview ?? (state.status === 'ready' ? state.data : undefined);
  const minecraftId = selected?.fluidId ?? selected?.id;
  const recipeLabel = recipeView === 'uses' ? text.itemRecipeUses : text.itemRecipes;
  const title = catalog && !selected && state.status === 'ready' ? text.itemNotFound
    : selected?.fluidId ? `${recipeLabel} · ${selected.name}` : recipeLabel;
  const loadDetails = useMemo(() => () => selected ? loadItemDetails(selected) : Promise.resolve(undefined), [selected]);
  const details = useRequest(loadDetails);
  const data = details.state.status === 'ready' ? details.state.data : undefined;
  const [variantId, setVariantId] = useState('');
  const variant = modes.advanced ? data?.variants.find(entry => entry.id === variantId) : undefined;
  const payloads = variant ? variant.payloads : data?.payloads;
  const tooltipData = useItemTooltip(selected, payloads ?? null);

  function openRecipeItem(nextId: string, view: ItemRecipeView = 'recipes') {
    if (nextId !== itemId || view !== recipeView) onOpenItem(nextId, view);
    else if (ingredient) onCloseIngredient();
    else heading.current?.focus({ preventScroll: true });
  }

  async function copyMinecraftId() {
    if (!minecraftId) return;
    try {
      await navigator.clipboard.writeText(minecraftId);
      notify(text.itemIdCopied, 'success', dialog.current);
    } catch {
      notify(text.itemIdCopyFailed, 'error', dialog.current);
    }
  }

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!sceneContentReady || !element) return;
    element.showModal();
    setModalReady(true);
    return () => element.close();
  }, [sceneContentReady]);

  return (
    <dialog className="item-detail-overlay" ref={dialog} aria-label={selected && !selected.fluidId ? `${title} · ${selected.name}` : title}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="item-detail item-recipe-detail">
        <div className="item-detail-heading">
          <h2 ref={heading} tabIndex={-1}>{title}</h2>
          <div className="item-detail-heading-actions">
            {minecraftId && <button className="item-action item-detail-copy" type="button"
              onClick={copyMinecraftId} aria-label={text.copyItemId} title={text.copyItemId}>
              <img src={copyIcon} width={22} height={22} alt="" />
            </button>}
            <button className="item-action item-detail-close" type="button" onClick={onClose} aria-label={text.close}>×</button>
          </div>
        </div>
        {sceneContentReady && modalReady && (!catalog ? children : selected ? (
          selected.detail && details.state.status === 'loading' ? <p role="status">{text.itemDetailsLoading}</p> :
            details.state.status === 'error' ? <ItemRequestError retry={details.retry} /> :
              <ItemDetails item={selected} data={data} variant={variant} onVariantChange={setVariantId}
                catalog={catalog} modes={modes} stackUrl={tooltipData.stackUrl} itemHref={itemHref} onOpenItem={openRecipeItem}
                ingredient={ingredient} onCloseIngredient={onCloseIngredient} onOpenIngredient={onOpenIngredient}
                recipeView={recipeView} recipeLabel={recipeLabel} />
        ) : (
          state.status === 'error' ? <ItemRequestError retry={retry} /> :
            state.status === 'loading' && <p role="status">{text.itemDetailsLoading}</p>
        ))}
      </div>
      <ItemTooltipTools modes={modes} onChange={onModesChange} shortcuts={tooltipData.shortcuts} />
    </dialog>
  );
}

function ItemRequestError({ retry }: { retry: () => void }) {
  const { text } = usePreferences();
  return <div>
    <p role="status">{text.itemDetailsError}</p>
    <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
  </div>;
}

type RecipeCatalog = ItemNavigation & IngredientNavigation & { catalog: Catalog; item: CatalogItem; modes: TooltipModes };
type IngredientSelection = { input: RecipeIngredient; findItem: (id: string) => CatalogItem | undefined };

function ItemDetails({ item, data, variant, onVariantChange, catalog, modes, stackUrl, recipeView, recipeLabel,
  ...navigation }: RecipeCatalog & {
  data?: Awaited<ReturnType<typeof loadItemDetails>>;
  variant?: ItemVariant;
  onVariantChange: (id: string) => void;
  stackUrl?: string;
  recipeView: ItemRecipeView;
  recipeLabel: string;
}) {
  const { text } = usePreferences();
  const variants = data?.variants ?? [];
  const legacyRecipes = useMemo(() => data?.recipes && readLegacyRecipes(data.recipes, item.id), [data?.recipes, item.id]);
  const recipeCatalog = { item, catalog, modes, ...navigation };
  return (
    <>
      <div className="item-detail-section" data-section="recipes" key={recipeView} role="region" aria-label={recipeLabel} tabIndex={0}>
        {recipeView === 'uses' ? <ItemRecipeUses {...recipeCatalog} /> : data?.recipeFeed ? (
          <PayloadContent url={data.recipeFeed} render={feed => <RecipeTabs feed={feed} {...recipeCatalog} />} />
        ) : <RecipeTabs recipes={legacyRecipes} emptyLabel={legacyRecipes ? undefined : text.itemRecipesUnavailable} {...recipeCatalog} />}
      </div>
      {modes.advanced && variants.length > 0 && (
        <div className="item-variants item-picker">
          <span>{text.itemVariants}</span>
          <HeaderPicker label={text.itemVariants} value={variant?.id ?? ''}
            options={[{ value: '', label: text.itemDefaultVariant }, ...variants.map(entry => ({ value: entry.id, label: entry.name }))]}
            onChange={onVariantChange} />
        </div>
      )}
      {modes.advanced && stackUrl && <ItemPayload label={text.itemStackData}>
        <PayloadContent url={stackUrl} render={data => <pre>{JSON.stringify(data, null, 2)}</pre>} />
      </ItemPayload>}
    </>
  );
}

function ItemPayload({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <>
    <h3 className="item-detail-section-heading">
      <button type="button" className="item-payload-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}>
        {label}
      </button>
    </h3>
    <div id={id} className="item-detail-section" data-section="stack" role="region" aria-label={label} tabIndex={0} hidden={!open}>
      {open && children}
    </div>
  </>;
}

function PayloadContent({ url, render }: { url: string; render: (data: unknown) => ReactNode }) {
  const { text } = usePreferences();
  const load = useMemo(() => (signal: AbortSignal) => loadItemPayload(url, signal), [url]);
  const { state, retry } = useRequest(load);
  if (state.status === 'loading') return <p role="status">{text.itemDetailsLoading}</p>;
  if (state.status === 'error') return <ItemRequestError retry={retry} />;
  return render(state.data);
}

function ItemRecipeUses(recipeCatalog: RecipeCatalog) {
  const { text } = usePreferences();
  const { catalog, item } = recipeCatalog;
  const load = useMemo(() => (signal: AbortSignal) => catalog.getRecipeUses?.(item.id, signal) ?? Promise.resolve(undefined), [catalog, item.id]);
  const { state, retry } = useRequest(load);
  if (!catalog.getRecipeUses) return <RecipeTabs emptyLabel={text.itemRecipesUnavailable} {...recipeCatalog} />;
  if (state.status === 'loading') return <p role="status">{text.itemDetailsLoading}</p>;
  if (state.status === 'error') return <ItemRequestError retry={retry} />;
  return <RecipeTabs feed={state.data} emptyLabel={text.itemNoRecipeUses} {...recipeCatalog} />;
}

function RecipeTabs({ recipes, feed, emptyLabel, item, catalog, modes, itemHref, onOpenItem,
  ingredient, onOpenIngredient, onCloseIngredient }: RecipeCatalog & {
  recipes?: RecipeEntry[];
  feed?: unknown;
  emptyLabel?: string;
}) {
  const { text } = usePreferences();
  const id = useId();
  const tooltipId = useId();
  const tabStrip = useRef<HTMLDivElement>(null);
  const [tabScroll, setTabScroll] = useState({ overflow: false, previous: false, next: false });
  const [hovered, setHovered] = useState<TooltipTarget<HTMLAnchorElement> & { item: CatalogItem }>();
  const hideTooltip = useCallback((anchor?: HTMLElement) => {
    setHovered(current => !anchor || current?.anchor === anchor ? undefined : current);
  }, []);
  const tooltipData = useItemTooltip(hovered?.item);
  const groups = useMemo(() => {
    const byStation = new Map<string, RecipeEntry[]>();
    for (const recipe of recipes ?? readRecipeFeed(feed)) {
      const group = byStation.get(recipe.station);
      if (group) group.push(recipe);
      else byStation.set(recipe.station, [recipe]);
    }
    const order = [...new Set([...recipeStations, ...byStation.keys()].filter(Boolean)), ''];
    return order.flatMap(station => {
      const recipes = byStation.get(station);
      return recipes ? [{ station, recipes }] : [];
    });
  }, [recipes, feed]);
  const updateTabScroll = useCallback(() => {
    const strip = tabStrip.current;
    if (!strip?.parentElement) return;
    const overflow = strip.scrollWidth - strip.parentElement.clientWidth > 1;
    const previous = overflow && strip.scrollLeft > 1;
    const next = overflow && strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1;
    setTabScroll(current => current.overflow === overflow && current.previous === previous && current.next === next
      ? current : { overflow, previous, next });
  }, []);

  useLayoutEffect(() => {
    const strip = tabStrip.current;
    if (!strip?.parentElement) return;
    updateTabScroll();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateTabScroll);
      return () => window.removeEventListener('resize', updateTabScroll);
    }
    const observer = new ResizeObserver(updateTabScroll);
    observer.observe(strip.parentElement);
    observer.observe(strip);
    for (const tab of strip.children) observer.observe(tab);
    return () => observer.disconnect();
  }, [groups, updateTabScroll]);

  function scrollTabs(direction: 'previous' | 'next') {
    const strip = tabStrip.current;
    if (!strip) return;
    const { left } = strip.getBoundingClientRect();
    const position = strip.scrollLeft;
    const starts = Array.from(strip.children, tab => tab.getBoundingClientRect().left - left + position);
    const target = direction === 'previous'
      ? starts.reverse().find(start => start < position - 1) ?? 0
      : starts.find(start => start > position + 1) ?? strip.scrollWidth;
    strip.scrollTo({ left: target });
  }
  const ingredientGroup = groups.find(group => ingredient && group.recipes.some(recipe => recipe.id === ingredient.recipe && recipe.instructions));
  const ingredientRecipe = ingredientGroup?.recipes.find(recipe => recipe.id === ingredient?.recipe && recipe.instructions);
  const input = ingredient && ingredientRecipe?.instructions?.inputs[ingredient.slot];
  const [station, setStation] = useState(ingredientGroup?.station);
  const loadStations = useCallback((signal: AbortSignal) => {
    const ids = new Set(groups.map(group => group.station).filter(isItemId));
    ids.delete(item.id);
    return catalog.getItems(ids, signal);
  }, [catalog, groups, item.id]);
  const { state: stations } = useRequest(loadStations);
  const findStation = (id: string) => id === item.id ? item : stations.status === 'ready' ? stations.data.get(id) : undefined;
  const active = groups.findIndex(group => group.station === station);
  const selected = Math.max(active, 0);
  useLayoutEffect(() => {
    const strip = tabStrip.current;
    const tab = strip?.children[selected];
    if (!strip || !tab) return;
    const view = strip.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (bounds.left < view.left) strip.scrollLeft += bounds.left - view.left;
    else if (bounds.right > view.right) strip.scrollLeft += bounds.right - view.right;
  }, [groups, selected, tabScroll.overflow]);
  const links: ItemLinkActions = {
    itemHref, onOpenItem,
    showTooltip: (item, target) => setHovered({ item, ...target }),
    hideTooltip,
    description: hovered && { ...hovered, id: tooltipId },
  };
  const activeStation = groups[selected]?.station;
  const stationItem = activeStation === undefined ? undefined : findStation(activeStation);
  const showStationSlot = !!stationItem || (isItemId(activeStation) && stations.status === 'loading');
  const tooltip = hovered && <ItemTooltip key={hovered.item.id} id={tooltipId} modes={modes} data={tooltipData}
    onDismiss={links.hideTooltip} {...hovered} />;

  return <>
    {!groups.length && <p>{emptyLabel ?? text.itemNoRecipes}</p>}
    {!!groups.length && <div className="item-recipe-tab-bar">
      {tabScroll.overflow && <button className="item-action item-recipe-tab-arrow" type="button"
        aria-label={text.itemRecipePreviousStationTabs} aria-controls={`${id}-tabs`} disabled={!tabScroll.previous}
        onClick={() => scrollTabs('previous')}>←</button>}
      <div className="item-recipe-tabs" role="tablist" aria-label={text.itemRecipes} id={`${id}-tabs`}
        ref={tabStrip} onScroll={updateTabScroll}>
        {groups.map(({ station, recipes }, index) => {
          const known = recipeStations.find(key => key === station);
          const preview = findStation(station);
          const category = recipes.find(recipe => recipe.machine?.category === station)?.machine;
          const label = known ? text.itemRecipeStations[known] : preview?.name ?? category?.title ?? (station || text.itemRecipeOther);
          const showIcon = preview?.icon || (isItemId(station) && stations.status === 'loading');
          return <button key={station} id={`${id}-tab-${index}`} type="button" className="item-action" role="tab"
            aria-label={label} title={label}
            aria-selected={index === selected} aria-controls={`${id}-panel-${index}`} tabIndex={index === selected ? 0 : -1}
            onClick={event => {
              links.hideTooltip();
              setStation(station);
              event.currentTarget.closest('.item-detail-section')?.scrollTo(0, 0);
            }}
            onKeyDown={event => {
              const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              if (!tabs) return;
              const last = tabs.length - 1;
              let next: number;
              switch (event.key) {
                case 'ArrowLeft': next = index > 0 ? index - 1 : last; break;
                case 'ArrowRight': next = index < last ? index + 1 : 0; break;
                case 'Home': next = 0; break;
                case 'End': next = last; break;
                default: return;
              }
              event.preventDefault();
              tabs[next].focus();
            }}>
            {showIcon ? <ItemIcon icon={preview?.icon} pending={!preview?.icon} /> : <span className="item-recipe-tab-label">{label}</span>}
          </button>;
        })}
      </div>
      {tabScroll.overflow && <button className="item-action item-recipe-tab-arrow" type="button"
        aria-label={text.itemRecipeNextStationTabs} aria-controls={`${id}-tabs`} disabled={!tabScroll.next}
        onClick={() => scrollTabs('next')}>→</button>}
    </div>}
    {groups.map(({ station, recipes }, index) => (
      <div key={station} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`}
        tabIndex={index === selected ? 0 : undefined} hidden={index !== selected}>
        {index === selected && <div className="item-recipe-panel">
          {showStationSlot && <div className="item-recipe-station item-recipe-slot">
            {stationItem && <RecipeIcon item={stationItem} id={stationItem.id}
              label={text.itemRecipeMakeStation(stationItem.name)} links={links} />}
          </div>}
          <RecipeGroup recipes={recipes} item={item} catalog={catalog} links={links}
            initialRecipe={ingredientRecipe} onOpenIngredient={onOpenIngredient} />
        </div>}
      </div>
    ))}
    {ingredient ? <RecipeIngredientDialog input={input || undefined} item={item} catalog={catalog}
      onClose={() => { links.hideTooltip(); onCloseIngredient(); }} links={links}>
      {tooltip}
    </RecipeIngredientDialog> : tooltip}
  </>;
}

function RecipeGroup({ recipes, item, catalog, links, initialRecipe, onOpenIngredient }: Pick<RecipeCatalog, 'item' | 'catalog' | 'onOpenIngredient'> & {
  recipes: RecipeEntry[];
  links: ItemLinkActions;
  initialRecipe?: RecipeEntry;
}) {
  const { text } = usePreferences();
  const results = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(() => initialRecipe ? Math.max(0, Math.floor(recipes.indexOf(initialRecipe) / recipesPerPage)) : 0);
  const [rotation, setRotation] = useState(0);
  const pageCount = Math.ceil(recipes.length / recipesPerPage);
  const currentPage = Math.min(page, pageCount - 1);
  const first = currentPage * recipesPerPage;
  const visibleRecipes = useMemo(() => recipes.slice(first, first + recipesPerPage), [recipes, first]);
  const load = useMemo(() => (signal: AbortSignal) => {
    const ids = new Set<string>();
    for (const { instructions, machine } of visibleRecipes) {
      if (instructions) {
        ids.add(instructions.result.id);
        for (const input of instructions.inputs) input?.items.forEach(id => ids.add(id));
      }
      for (const slot of machine?.slots ?? []) {
        for (const ingredient of slot.alternatives) {
          if (ingredient.kind === 'item') ids.add(ingredient.id);
        }
      }
    }
    ids.delete(item.id);
    return catalog.getItems(ids, signal);
  }, [catalog, item.id, visibleRecipes]);
  const { state, retry } = useRequest(load);
  const findItem = (id: string) => id === item.id ? item : state.status === 'ready' ? state.data.get(id) : undefined;
  const rotates = state.status === 'ready' && visibleRecipes.some(
    recipe => recipe.instructions?.inputs.some(input => input && input.items.length > 1),
  );

  useEffect(() => {
    if (!rotates) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setInterval(() => {
      if (!motion.matches && !results.current?.querySelector('.item-recipe-ingredient:is(:hover, :focus-within, :active, [aria-describedby])')) {
        setRotation(current => current + 1);
      }
    }, ingredientRotationMs);
    return () => window.clearInterval(timer);
  }, [rotates]);

  function changePage(nextPage: number, button: HTMLButtonElement) {
    links.hideTooltip();
    setPage(nextPage);
    setRotation(0);
    button.closest('.item-detail-section')?.scrollTo(0, 0);
  }

  return <div className="item-recipe-results" ref={results}>
    {pageCount > 1 && <div className="item-recipe-pagination">
      <button className="item-action" type="button" aria-label={text.itemPrevious} disabled={currentPage === 0}
        onClick={event => changePage(currentPage - 1, event.currentTarget)}>←</button>
      <span role="status">{currentPage + 1} / {pageCount}</span>
      <button className="item-action" type="button" aria-label={text.itemNext} disabled={currentPage === pageCount - 1}
        onClick={event => changePage(currentPage + 1, event.currentTarget)}>→</button>
    </div>}
    {state.status === 'loading' ? <p role="status">{text.itemDetailsLoading}</p> :
      state.status === 'error' ? <ItemRequestError retry={retry} /> :
        <ul>
          {visibleRecipes.map(({ id, instructions, type, machine }, index) => (
            <li className="item-recipe" key={first + index}>
              {machine ? <MachineRecipeCard recipe={machine} item={item} findItem={findItem} links={links} />
                : instructions ? <Recipe instructions={instructions} findItem={findItem} links={links}
                rotation={rotation} onOpenIngredient={slot => { links.hideTooltip(); onOpenIngredient({ recipe: id, slot }); }} /> : <>
                {type && <strong>{type}</strong>}
                <p>{text.itemRecipeUnsupported}</p>
              </>}
            </li>
          ))}
        </ul>}
  </div>;
}

function MachineRecipeCard({ recipe: { title, frame, slots }, item, findItem, links }: {
  recipe: MachineRecipe;
  item: CatalogItem;
  findItem: IngredientSelection['findItem'];
  links: ItemLinkActions;
}) {
  const { text } = usePreferences();
  const hasLayout = slots.some(slot => slot.bounds);
  const details = slots.filter(({ bounds, alternatives, otherIngredients, alternativesTruncated }) =>
    (!bounds && (alternatives.length > 0 || otherIngredients)) || alternatives.length > 1
      || (alternatives.length > 0 && otherIngredients) || alternativesTruncated,
  );

  return <>
    {hasLayout && <div className="item-machine-recipe" role="group" aria-label={title}
      style={{ inlineSize: frame.width * 2.5, aspectRatio: `${frame.width} / ${frame.height}` }}>
      {slots.map(({ bounds, role, alternatives, otherIngredients }, index) => {
        if (!bounds) return null;
        const ingredient = alternatives[0];
        const style = {
          insetInlineStart: `${100 * (bounds.x - frame.x) / frame.width}%`,
          insetBlockStart: `${100 * (bounds.y - frame.y) / frame.height}%`,
          inlineSize: `${100 * bounds.width / frame.width}%`,
          blockSize: `${100 * bounds.height / frame.height}%`,
        };
        return <div key={index} className="item-recipe-slot item-machine-slot" data-role={role}
          data-fluid={ingredient?.kind === 'fluid' || undefined} style={style}>
          {ingredient?.kind === 'item' && <RecipeIcon item={findItem(ingredient.id)} id={ingredient.id}
            count={ingredient.amount} links={links} />}
          {ingredient?.kind === 'fluid' && <>
            {ingredient.id === item.fluidId && item.icon && <ItemIcon icon={item.icon} fluid lazy />}
            <span className="item-machine-fluid" title={`${ingredient.id} · ${ingredient.amount} mB`}>
              {ingredient.amount}<small> mB</small>
            </span>
          </>}
          {!ingredient && otherIngredients && <span title={text.itemRecipeUnknownInput}>?</span>}
        </div>;
      })}
    </div>}
    {details.length > 0 && <details className="item-machine-details" open={!hasLayout || details.some(slot => !slot.bounds) || undefined}>
      <summary>{text.itemMachineRecipeDetails}</summary>
      {(['input', 'output', 'catalyst'] as const).map(role => {
        const group = details.filter(slot => slot.role === role);
        return group.length > 0 && <div key={role}>
          <strong>{text.itemMachineRecipeRoles[role]}</strong>
          <ul>
            {group.map(({ name, alternatives, otherIngredients, alternativesTruncated }, index) => (
              <li key={index}>
                {name && <strong>{name} · </strong>}
                {alternatives.map(({ id, kind, amount }) => kind === 'fluid' ? `${id} · ${amount} mB`
                  : `${amount} × ${findItem(id)?.name ?? id}`).join(' / ')}
                {otherIngredients && <p>{text.itemRecipeUnknownInput}</p>}
                {alternativesTruncated && <p>{text.itemRecipeMoreExamples}</p>}
              </li>
            ))}
          </ul>
        </div>;
      })}
    </details>}
  </>;
}

function Recipe({ instructions: { columns, inputs, result }, findItem, links, rotation, onOpenIngredient }: {
  instructions: NonNullable<RecipeEntry['instructions']>;
  findItem: IngredientSelection['findItem'];
  links: ItemLinkActions;
  rotation: number;
  onOpenIngredient: (slot: number) => void;
}) {
  return <div className="item-recipe-body">
    <ul className="item-recipe-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 2.5rem))` }}>
      {inputs.map((input, index) => (
        <li className="item-recipe-slot" key={index} aria-hidden={!input || undefined}>
          {input && <RecipeInput input={input} findItem={findItem} rotation={rotation}
            links={links} onOpenIngredient={() => onOpenIngredient(index)} />}
        </li>
      ))}
    </ul>
    <span aria-hidden="true">→</span>
    <div className="item-recipe-slot item-recipe-output">
      <RecipeIcon item={findItem(result.id)} id={result.id} count={result.count} links={links} />
    </div>
  </div>;
}

function RecipeInput({ input, findItem, rotation, links, onOpenIngredient }: IngredientSelection & {
  rotation: number;
  links: ItemLinkActions;
  onOpenIngredient: () => void;
}) {
  const { text } = usePreferences();
  const tooltipId = useId();
  const [target, setTarget] = useState<TooltipTarget>();
  const hideIngredientTooltip = useCallback((anchor?: HTMLElement) => {
    setTarget(current => !anchor || current?.anchor === anchor ? undefined : current);
  }, []);
  const tooltip = useTooltipTrigger<HTMLButtonElement>(target, setTarget, hideIngredientTooltip);
  const { items, tags, custom, truncated } = input;
  const first = items[0];
  const single = items.length === 1 && !custom && !truncated ? findItem(first) : undefined;
  if (single && !tags.length) {
    return <RecipeIcon item={single} id={first} links={links} />;
  }

  const previews = items.map(findItem).filter(item => item?.icon);
  const preview = single ?? (previews.length ? previews[rotation % previews.length] : undefined);
  const tagLabels = tags.map(tag => `#${tag}`).join(', ');
  const label = tagLabels ? `${text.itemRecipeAlternatives} · ${tagLabels}` : text.itemRecipeAlternatives;
  const content = <>
    <ItemIcon icon={preview?.icon} bar={preview?.bar} />
    <span className="item-recipe-ingredient-mark" aria-hidden="true">{tags.length ? '#' : '…'}</span>
  </>;

  function openUses(item: CatalogItem) {
    hideIngredientTooltip();
    links.onOpenItem(item.id, 'uses', item);
  }

  return <>
    {single ? <ItemLink {...links} item={single} label={`${single.name} · ${tagLabels}`}
      description={target ? { ...target, id: tooltipId } : undefined}
      showTooltip={(_item, target) => setTarget(target)} hideTooltip={hideIngredientTooltip}>
      {content}
    </ItemLink> : <button className="item-slot-button item-recipe-ingredient" type="button" aria-label={label} aria-haspopup="dialog"
      aria-describedby={tooltip.active ? tooltipId : undefined}
      aria-keyshortcuts={preview ? 'Shift+F10' : undefined}
      onPointerEnter={tooltip.onPointerEnter}
      onPointerLeave={tooltip.onPointerLeave}
      onPointerDown={tooltip.onPointerDown}
      onFocus={tooltip.onFocus}
      onBlur={tooltip.onBlur}
      onKeyDown={event => {
        if (event.key === 'Escape' && tooltip.active) {
          event.preventDefault();
          hideIngredientTooltip(event.currentTarget);
        }
        if (preview && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault();
          openUses(preview);
        }
      }}
      onContextMenu={event => {
        if (!preview || ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch')) return;
        event.preventDefault();
        openUses(preview);
      }}
      onClick={event => {
        if (tooltip.previewTouch(event)) return;
        hideIngredientTooltip();
        onOpenIngredient();
      }}>
      {content}
    </button>}
    {target && <ItemTooltipPopover id={tooltipId} anchor={target.anchor} onDismiss={hideIngredientTooltip}>
      <strong>{tagLabels || text.itemRecipeAlternatives}</strong>
      <ul className="item-recipe-ingredient-tooltip-list">
        {items.slice(0, ingredientTooltipLimit).map(id => <li key={id}>{findItem(id)?.name ?? id}</li>)}
      </ul>
      {items.length > ingredientTooltipLimit && <div>{text.itemRecipeAdditionalOptions(items.length - ingredientTooltipLimit)}</div>}
      <IngredientNotes input={input} />
    </ItemTooltipPopover>}
  </>;
}

function IngredientNotes({ input }: { input: RecipeIngredient }) {
  const { text } = usePreferences();
  return <>
    {input.custom && <p>{text.itemRecipeCustomInput}</p>}
    {input.truncated && <p>{text.itemRecipeMoreExamples}</p>}
    {!input.items.length && !input.custom && <p>{text.itemRecipeUnknownInput}</p>}
  </>;
}

function RecipeIngredientDialog({ input, item, catalog, links, onClose, children }: Pick<RecipeCatalog, 'item' | 'catalog'> & {
  input?: RecipeIngredient;
  links: ItemLinkActions;
  onClose: () => void;
  children: ReactNode;
}) {
  const { text } = usePreferences();
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useMemo(() => (signal: AbortSignal) => {
    const ids = new Set(input?.items);
    ids.delete(item.id);
    return catalog.getItems(ids, signal);
  }, [catalog, input, item.id]);
  const { state, retry } = useRequest(load);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  return <dialog className="item-detail-overlay" ref={dialog} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="item-detail">
      <div className="item-detail-heading">
        <h2 id={headingId}>{text.itemRecipeAlternatives}</h2>
        <button className="item-action item-detail-close" type="button" onClick={onClose} aria-label={text.close}>×</button>
      </div>
      <div className="item-detail-section" data-section="recipes" tabIndex={0}>
        {input?.tags.map(tag => <code key={tag}>#{tag}</code>)}
        {!input && <p>{text.itemRecipeIngredientUnavailable}</p>}
        {input && state.status === 'loading' && <p role="status">{text.itemDetailsLoading}</p>}
        {input && state.status === 'error' && <ItemRequestError retry={retry} />}
        <ul className="item-recipe-ingredient-list">
          {input?.items.map(id => {
            const example = id === item.id ? item : state.status === 'ready' ? state.data.get(id) : undefined;
            return <li key={id}>
              <div className="item-recipe-slot"><RecipeIcon item={example} id={id} links={links} /></div>
              <span>{example?.name ?? id}</span>
            </li>;
          })}
        </ul>
        {input && <IngredientNotes input={input} />}
      </div>
    </div>
    {children}
  </dialog>;
}

function RecipeIcon({ item, id, count, label, links }: {
  item?: CatalogItem;
  id: string;
  count?: number;
  label?: string;
  links: ItemLinkActions;
}) {
  const name = item?.name ?? id;
  const accessibleName = label ?? (count ? `${count} × ${name}` : name);
  const content = <>
    <ItemIcon icon={item?.icon} bar={item?.bar} lazy />
    {count !== undefined && <span className="item-recipe-count" aria-hidden="true">{count}</span>}
  </>;
  return item ? <ItemLink item={item} label={accessibleName} {...links}>{content}</ItemLink>
    : <span className="item-recipe-missing" role="img" aria-label={accessibleName} title={accessibleName}>{content}</span>;
}
