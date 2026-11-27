import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import copyIcon from '../../assets/pixel-copy-papers.png';
import { InfoPanel } from '../layout/InfoPanel';
import { PageLayout } from '../layout/PageLayout';
import { PlayIcon } from '../layout/PlayIcon';
import { plainMinecraftText } from '../layout/minecraftMotd';
import { pageTitle } from '../pageMetadata.mts';
import { useNotifications } from '../notifications/Notifications';
import type { ItemRecipeView, ItemRoute, RecipeIngredientRoute } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { HeaderPicker } from '../scene/HeaderPicker';
import { useSceneContentReady } from '../scene/SceneEntrance';
import { animatePageArrival, animatePageDeparture, animatePanelArrival } from '../scene/pageMotion';
import type { CatalogUpdate } from '../liveUpdates.mts';
import { CatalogImportNotice } from './CatalogImportNotice';
import { isItemId, loadCatalog, loadItemDetails, loadItemPayload, spriteForIcon, type Catalog, type CatalogItem, type ItemSprite, type ItemVariant } from './catalogData';
import { catalogSearchTerms, catalogSearchWithMod, type ItemBar } from './catalogIndex.mjs';
import { pageSize, atlasColumns, tileSize } from './catalogLayout.json';
import { ItemLoadingHint } from './ItemLoadingHint';
import { ModPicker } from './ModPicker';
import { readLegacyRecipes, readRecipeFeed, recipeStations, type MachineIngredient, type MachineRecipe, type MachineRecipeSlot, type RecipeEntry, type RecipeIngredient } from './itemRecipes';
import { ItemTooltip, ItemTooltipPopover, MinecraftItemText, type TooltipTarget } from './ItemTooltip';
import './items.css';

const atlasRows = pageSize / atlasColumns;
const iconTimeoutMs = 8000;
const itemHoldMs = 500;
const recipesPerPage = 3;
const ingredientVariantsPerPage = 18;
const ingredientRotationMs = 2000;
const ingredientTooltipLimit = 12;
const pageSelectionDelayMs = 90;
const itemDetailsLoadingDelayMs = 180;
const wideCatalogQuery = '(min-width: 68rem)';

type ItemNavigation = {
  itemHref: (id: string, view?: ItemRecipeView) => string;
  onOpenItem: (id: string, view?: ItemRecipeView, preview?: CatalogItem) => void;
};

type IngredientNavigation = {
  ingredient?: RecipeIngredientRoute;
  onOpenIngredient: (ingredient: RecipeIngredientRoute) => void;
  onCloseIngredient: () => void;
};

type RecipeNavigation = IngredientNavigation & {
  recipeStation?: string;
  recipePage?: number;
  onRecipePositionChange: (station: string, page?: number) => void;
};

type ServerItemsProps = ItemNavigation & Omit<RecipeNavigation, 'ingredient' | 'recipeStation' | 'recipePage'> & {
  server: string;
  catalogUpdate?: CatalogUpdate;
  showCatalog: boolean;
  page: number;
  query: string;
  onPageChange: (page: number, query?: string) => void;
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

export function ItemIcon({ icon, sprite: explicitSprite, useIconSprite = true, bar, fluid = false, pending = false, lazy = false, timeout, onImageSettled }: {
  icon?: string;
  sprite?: ItemSprite;
  useIconSprite?: boolean;
  bar?: ItemBar;
  fluid?: boolean;
  pending?: boolean;
  lazy?: boolean;
  timeout?: number;
  onImageSettled?: (url: string) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const sprite = explicitSprite ?? (useIconSprite && !fluid && !pending ? spriteForIcon(icon) : undefined);
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
    <span className="item-icon" aria-hidden="true" data-pending={pending || undefined} data-fluid={fluid || undefined}
      style={fluid && imageUrl ? { '--item-fluid-texture': `url("${imageUrl}")` } as CSSProperties : undefined}>
      {sprite && (
        <span className="item-sprite" style={{
          backgroundImage: `url("${sprite.url}")`,
          backgroundSize: `${atlasColumns * 100}% ${atlasRows * 100}%`,
          backgroundPosition: `${(sprite.position % atlasColumns) * 100 / (atlasColumns - 1)}% ${Math.floor(sprite.position / atlasColumns) * 100 / (atlasRows - 1)}%`,
        }} />
      )}
      {imageUrl && (
        <img
          key={imageUrl} ref={image} src={imageUrl} alt="" width={tileSize} height={tileSize} decoding="async" draggable={false}
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

export type { TooltipTarget } from './ItemTooltip';

function useTooltipTrigger<Element extends HTMLElement>(
  target: TooltipTarget | undefined, show: (target: TooltipTarget<Element>) => void, hide: (anchor: Element) => void,
) {
  const triggerId = useId();
  const active = target?.triggerId === triggerId;
  const pinned = active && target.pinned;

  function preview(anchor: Element) {
    if (!anchor.ownerDocument.querySelector('.item-tooltip[data-pinned]')) show({ anchor, triggerId });
  }

  return {
    active,
    pinned,
    onPointerEnter(event: PointerEvent<Element>) {
      if (event.pointerType !== 'touch') preview(event.currentTarget);
    },
    onPointerLeave(event: PointerEvent<Element>) {
      if (event.pointerType !== 'touch' && active && !pinned) hide(event.currentTarget);
    },
    onFocus(event: FocusEvent<Element>) {
      if (!active && event.currentTarget.matches(':focus-visible')) show({ anchor: event.currentTarget, triggerId });
    },
    onBlur(event: FocusEvent<Element>) {
      if (active && !pinned) hide(event.currentTarget);
    },
    pin(event: MouseEvent<Element>, options?: Pick<TooltipTarget, 'actions' | 'recipeHelp'>) {
      if (pinned) return false;
      show({ anchor: event.currentTarget, triggerId, pinned: true, keyboard: event.detail === 0, ...options });
      return true;
    },
  };
}

type ItemLinkActions = ItemNavigation & {
  showTooltip: (item: CatalogItem, target: TooltipTarget<HTMLAnchorElement>) => void;
  hideTooltip: (anchor?: HTMLElement) => void;
  description?: TooltipTarget & { id: string };
};

export function ItemLink({ item, label = item.name, className, itemHref, description, showTooltip, hideTooltip, onOpenItem,
  children }: ItemLinkActions & {
  item: CatalogItem;
  label?: string;
  className?: string;
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

  return <a className={className ? `item-slot-button ${className}` : 'item-slot-button'} href={itemHref(item.id)} draggable={false}
    aria-label={plainMinecraftText(label)} aria-haspopup="dialog"
    aria-describedby={tooltip.active && !tooltip.pinned ? description?.id : undefined}
    aria-expanded={!!tooltip.pinned} aria-controls={tooltip.pinned ? description?.id : undefined}
    data-holding={holding || undefined} style={holding ? { '--item-hold-duration': `${itemHoldMs}ms` } as CSSProperties : undefined}
    onPointerEnter={tooltip.onPointerEnter}
    onPointerLeave={tooltip.onPointerLeave}
    onPointerDown={event => {
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
    }}
    onContextMenu={event => {
      const touch = 'pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch';
      if (event.button !== 2 && !touch) return;
      event.preventDefault();
      if (!touch && !press.current && !suppressClick.current) {
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
      if (!tooltip.pin(event, { recipeHelp: true })) open('recipes');
    }}>
    {children}
  </a>;
}

export function ServerItems({ server, catalogUpdate, showCatalog, page, query, onPageChange, item, onCloseItem, onRecipePositionChange,
  onOpenIngredient, onCloseIngredient, ...navigation }: ServerItemsProps) {
  const { text } = usePreferences();
  const load = useCallback((signal: AbortSignal) => loadCatalog(server, signal), [server]);
  const { state: initial, retry: retryInitial } = useRequest(load);
  const [refreshed, setRefreshed] = useState<Catalog | null>();
  const { status: importStatus, version } = catalogUpdate ?? {};
  const [openedItem, setOpenedItem] = useState<{ catalog: Catalog; preview: CatalogItem }>();
  const [wideCatalog, setWideCatalog] = useState(() => window.matchMedia(wideCatalogQuery).matches);
  const inlineDetails = showCatalog && wideCatalog;
  const requestedInlineItem = inlineDetails ? item : undefined;
  const [retainedItem, setRetainedItem] = useState(requestedInlineItem);
  const visibleItem = item ?? (inlineDetails ? retainedItem : undefined);
  const splitOpen = inlineDetails && !!visibleItem;
  const detailClosing = splitOpen && !item;
  const layout = useRef<HTMLDivElement>(null);
  const [splitReady, setSplitReady] = useState(false);
  const state = refreshed === undefined ? initial : { status: 'ready' as const, data: refreshed };
  const catalog = state.status === 'ready' ? state.data : null;
  const preview = openedItem && openedItem.catalog === catalog && openedItem.preview.id === visibleItem?.id ? openedItem.preview : undefined;

  useEffect(() => {
    const media = window.matchMedia(wideCatalogQuery);
    const update = () => setWideCatalog(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (requestedInlineItem) {
      setRetainedItem(requestedInlineItem);
      return;
    }
    if (!detailClosing) {
      setRetainedItem(undefined);
      return;
    }
    const panel = layout.current?.querySelector<HTMLElement>('.item-detail-overlay[open] > .item-recipe-detail');
    if (!panel?.animate || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      setRetainedItem(undefined);
      return;
    }
    const departure = animatePageDeparture(panel, -1);
    const finish = () => setRetainedItem(undefined);
    departure.onfinish = finish;
    departure.oncancel = finish;
    return () => {
      departure.onfinish = null;
      departure.oncancel = null;
      departure.cancel();
    };
  }, [detailClosing, requestedInlineItem]);

  useLayoutEffect(() => {
    const element = layout.current;
    if (!splitOpen || !element) {
      setSplitReady(false);
      return;
    }
    // Flush the new grid styles so the layout transitions are available to await.
    getComputedStyle(element).gridTemplateColumns;
    const transitions = element.getAnimations?.() ?? [];
    if (!transitions.length) {
      setSplitReady(true);
      return;
    }
    let active = true;
    void Promise.allSettled(transitions.map(transition => transition.finished)).then(() => {
      if (active) setSplitReady(true);
    });
    return () => { active = false; };
  }, [splitOpen]);

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

  function openCatalogItem(id: string, view?: ItemRecipeView, preview?: CatalogItem) {
    setOpenedItem(catalog && preview ? { catalog, preview } : undefined);
    navigation.onOpenItem(id, view);
  }

  const detail = visibleItem && <ItemDialog inline={inlineDetails} layoutReady={!inlineDetails || splitReady}
    closing={detailClosing} itemId={visibleItem.id} preview={preview} recipeView={visibleItem.view}
    ingredient={item?.ingredient} recipeStation={visibleItem.station}
    catalog={catalog} onClose={onCloseItem}
    recipePage={visibleItem.recipePage} onRecipePositionChange={onRecipePositionChange}
    onOpenIngredient={onOpenIngredient} onCloseIngredient={onCloseIngredient}
    itemHref={navigation.itemHref} onOpenItem={openCatalogItem}>
    {state.status === 'loading' ? <p role="status">{text.itemLoading}</p> : <div>
      <p role="status">{state.status === 'error' ? text.itemLoadError : text.itemCatalogUnavailable}</p>
      <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
    </div>}
  </ItemDialog>;

  return <>
    {showCatalog && <CatalogImportNotice status={importStatus} updating={!!catalog && !catalog.progress} partial={catalog?.progress} />}
    {showCatalog && <PageLayout>
      <div className="item-catalog-layout" ref={layout} data-wide={inlineDetails || undefined} data-split={splitOpen || undefined}>
        <InfoPanel>
          <h1 className="page-layout-title">{text.items}</h1>
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
          {catalog && <ItemList catalog={catalog} page={page} query={query} onPageChange={onPageChange}
            dialogOpen={!!item && !inlineDetails} itemHref={navigation.itemHref}
            onOpenItem={openCatalogItem} />}
        </InfoPanel>
        {detail}
      </div>
    </PageLayout>}
    {!showCatalog && detail}
  </>;
}

type InventoryPage = {
  key: string;
  source: string;
  number: number;
  items: CatalogItem[];
  total: number;
};

type PageTarget = { source: string; number: number };

function ItemList({ catalog, page, query, onPageChange, dialogOpen, ...navigation }: ItemNavigation & {
  catalog: Catalog;
  page: number;
  query: string;
  onPageChange: ServerItemsProps['onPageChange'];
  dialogOpen: boolean;
}) {
  const { language, text } = usePreferences();
  const [search, setSearch] = useState(query);
  const mod = catalogSearchTerms(search).mods.at(-1) ?? '';
  const selectedMod = catalog.mods.find(namespace => namespace.replaceAll('_', ' ') === mod) ?? mod;
  const [pendingPage, setPendingPage] = useState<PageTarget>();
  const pageIntent = useRef<PageTarget>(undefined);
  const source = JSON.stringify([catalog.key, language, query]);
  const targetPage = pendingPage?.source === source ? pendingPage.number : undefined;
  const [hovered, setHovered] = useState<TooltipTarget<HTMLAnchorElement> & { item: CatalogItem }>();
  const tooltipId = useId();
  const tooltip = dialogOpen ? undefined : hovered;
  const [shown, setShown] = useState<InventoryPage>();
  const inventory = useRef<HTMLDivElement>(null);
  const clearTarget = useCallback(() => {
    pageIntent.current = undefined;
    setPendingPage(undefined);
  }, []);

  useLayoutEffect(() => {
    setSearch(query);
  }, [query]);

  useEffect(() => {
    if (search === query) return;
    const timer = window.setTimeout(() => {
      setHovered(undefined);
      clearTarget();
      onPageChange(0, search);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, query, clearTarget, onPageChange]);

  useEffect(() => {
    if (targetPage === undefined || targetPage === page) return;
    const timer = window.setTimeout(() => onPageChange(targetPage), pageSelectionDelayMs);
    return () => window.clearTimeout(timer);
  }, [page, targetPage, onPageChange]);

  const loadPage = useMemo(() => (signal: AbortSignal) => catalog.getPage({ language, page, query }, signal),
    [catalog, language, page, query]);
  const { state, retry } = useRequest(loadPage, targetPage === undefined || targetPage === page);
  const result = state.status === 'ready' ? state.data : undefined;
  const lastAvailablePage = result && !catalog.progress ? Math.max(0, Math.ceil(result.total / pageSize) - 1) : undefined;
  const outOfBounds = lastAvailablePage !== undefined && page > lastAvailablePage;
  useEffect(() => {
    if (!outOfBounds) return;
    clearTarget();
    onPageChange(lastAvailablePage);
  }, [outOfBounds, lastAvailablePage, clearTarget, onPageChange]);
  const requested = useMemo<InventoryPage | undefined>(() => result && !outOfBounds ? ({
    ...result,
    key: JSON.stringify([source, page]),
    source,
    number: page,
  }) : undefined, [result, outOfBounds, source, page]);
  const displayed = shown ?? requested;
  const preparing = shown && requested?.items.length
    && shown.key !== requested.key ? requested : undefined;
  const loading = state.status === 'loading' || outOfBounds || preparing !== undefined;
  const displayedNumber = displayed?.number ?? page;
  const pageCount = Math.ceil((displayed?.total ?? 0) / pageSize);
  const selectedPage = targetPage ?? displayedNumber;
  const canNavigate = displayed?.source === source;

  const hasGrid = displayed !== undefined;
  useLayoutEffect(() => {
    const frame = inventory.current;
    if (!hasGrid || !frame || typeof ResizeObserver === 'undefined') return;
    const catalogLayout = frame.closest<HTMLElement>('.item-catalog-layout');
    let settledWidth = 0;

    const releaseGrid = () => {
      frame.removeAttribute('data-layout-resizing');
      frame.style.removeProperty('--inventory-frozen-width');
    };

    const resize = () => {
      const scroller = frame.querySelector<HTMLElement>('.item-inventory:not([data-preparing])');
      const grid = scroller?.firstElementChild;
      if (!grid || !scroller.clientWidth) return;
      // Preserve the previous slot geometry while the catalog clips or reveals the grid.
      if (settledWidth && catalogLayout?.getAnimations?.().some(animation =>
        'transitionProperty' in animation && animation.transitionProperty === 'grid-template-columns'
        && animation.playState === 'running')) {
        frame.setAttribute('data-layout-resizing', '');
        frame.style.setProperty('--inventory-frozen-width', `${settledWidth}px`);
        return;
      }
      releaseGrid();
      const { clientWidth: width, clientHeight: height } = scroller;
      settledWidth = width;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap);
      const compact = window.matchMedia('(max-width: 27rem)').matches;
      const preferred = (compact ? 2.75 : 3.25) * rem;
      const minimum = (compact || window.matchMedia('(pointer: coarse)').matches ? 2.75 : 2) * rem;
      const first = Math.max(1, Math.floor((width + gap) / (preferred + gap)));
      const last = Math.max(first, Math.floor((width + gap) / (minimum + gap)));
      let columns = first;
      for (; columns < last; columns++) {
        const rows = Math.ceil(pageSize / columns);
        const size = (width - (columns - 1) * gap) / columns;
        if (rows * size + (rows - 1) * gap <= height) break;
      }
      frame.style.setProperty('--inventory-tracks', `repeat(${columns}, minmax(0, 1fr))`);
    };

    function handleLayoutTransition(event: TransitionEvent) {
      if (event.target === catalogLayout && event.propertyName === 'grid-template-columns') resize();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    catalogLayout?.addEventListener('transitionrun', handleLayoutTransition);
    catalogLayout?.addEventListener('transitionend', handleLayoutTransition);
    catalogLayout?.addEventListener('transitioncancel', handleLayoutTransition);
    resize();
    return () => {
      observer.disconnect();
      catalogLayout?.removeEventListener('transitionrun', handleLayoutTransition);
      catalogLayout?.removeEventListener('transitionend', handleLayoutTransition);
      catalogLayout?.removeEventListener('transitioncancel', handleLayoutTransition);
      releaseGrid();
    };
  }, [hasGrid]);

  useLayoutEffect(() => {
    const intent = pageIntent.current;
    if (intent && intent.source !== source) clearTarget();
    if (intent?.source === source && requested?.number !== intent.number) return;
    if (!requested || preparing) return;
    setShown(requested);
    if (targetPage === requested.number) clearTarget();
  }, [requested, preparing, source, targetPage, clearTarget]);

  const showPreparedPage = useCallback(() => {
    const intent = pageIntent.current;
    if (!preparing || (intent?.source === source && intent.number !== preparing.number)) return;
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
    if (!hovered.pinned && !hovered.anchor.matches(':hover, :focus-visible')) hideTooltip(hovered.anchor);
  }

  const selectPage = useCallback((number: number) => {
    const target = { source, number };
    pageIntent.current = target;
    setHovered(undefined);
    setPendingPage(target);
  }, [source]);

  const movePage = useCallback((offset: number) => {
    if (!canNavigate) return false;
    const intent = pageIntent.current;
    const current = intent?.source === source ? intent.number : displayedNumber;
    const next = Math.max(0, Math.min(pageCount - 1, current + offset));
    if (next === current) return false;
    selectPage(next);
    return true;
  }, [canNavigate, displayedNumber, pageCount, selectPage, source]);

  useEffect(() => {
    const frame = inventory.current;
    if (!frame || !displayed || displayed.source !== source || dialogOpen) return;
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const scroller = event.target instanceof Element ? event.target.closest('.item-inventory') : null;
      if (!scroller) return;
      const forward = event.deltaY > 0;
      const canScroll = forward
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1
        : scroller.scrollTop > 1;
      if (canScroll) return;
      if (movePage(forward ? 1 : -1)) event.preventDefault();
    }

    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [dialogOpen, displayed, movePage, source]);

  return (
    <>
      <div className="item-filters">
        <label>
          {text.itemSearch}
          <input type="search" value={search} maxLength={256} onChange={event => setSearch(event.target.value)} />
        </label>
        <ModPicker mods={catalog.mods} value={selectedMod} onChange={value => {
          const next = catalogSearchWithMod(search, value);
          hideTooltip();
          clearTarget();
          setSearch(next);
          onPageChange(0, next);
        }} />
      </div>
      {state.status === 'error' ? <p role="status">{text.itemLoadError}</p>
        : !displayed ? <p role="status">{text.itemLoading}</p>
          : !pageCount && <p role="status">{text.itemEmpty}</p>}
      {state.status === 'error' && <button className="item-action" type="button" onClick={retry}>{text.retry}</button>}
      {displayed && (
        <div className="item-inventory-frame" aria-busy={loading} ref={inventory}>
          {loading && <div className="item-pagination-loading"><ItemLoadingHint label={text.itemLoading} /></div>}
          {[displayed, preparing].map(view => view && (
            <div key={view.key} className="item-inventory" data-preparing={view === preparing || undefined}
              inert={view === preparing} onScroll={event => updateTooltipOnScroll(event.currentTarget)}>
              <ItemGrid items={view.items}
                onReady={view === preparing ? showPreparedPage : undefined}
                description={view === displayed && tooltip ? { ...tooltip, id: tooltipId } : undefined}
                showTooltip={showTooltip} hideTooltip={hideTooltip} {...navigation} />
            </div>
          ))}
        </div>
      )}
      {tooltip && <ItemTooltip id={tooltipId} item={tooltip.item} target={tooltip} onDismiss={hideTooltip} />}
      {pageCount > 0 && <ItemPagination currentPage={selectedPage} displayedPage={displayedNumber} pageCount={pageCount}
        disabled={!canNavigate} onStep={movePage} onSelectPage={selectPage} />}
    </>
  );
}

function ItemPagination({ currentPage, displayedPage = currentPage, pageCount, disabled, onStep, onSelectPage }: {
  currentPage: number;
  displayedPage?: number;
  pageCount: number;
  disabled?: boolean;
  onStep: (offset: -1 | 1) => void;
  onSelectPage: (page: number) => void;
}) {
  const { text, language } = usePreferences();
  const input = useRef<HTMLInputElement>(null);
  const summary = useId();
  const format = new Intl.NumberFormat(language);

  useLayoutEffect(() => {
    if (input.current) input.current.value = String(currentPage + 1);
  }, [currentPage]);

  return <form className="item-pagination" onSubmit={event => {
    event.preventDefault();
    const number = Number(new FormData(event.currentTarget).get('page'));
    if (!disabled && Number.isSafeInteger(number) && number >= 1 && number <= pageCount) onSelectPage(number - 1);
  }}>
    <button className="item-action" data-previous type="button" aria-label={text.itemPrevious} title={text.itemPrevious}
      disabled={disabled || currentPage === 0} onClick={() => onStep(-1)}><PlayIcon /></button>
    <div className="item-pagination-page">
      <input ref={input} type="number" name="page" inputMode="numeric" enterKeyHint="go" min={1} max={pageCount} required
        aria-label={text.itemPageJump} aria-describedby={summary} defaultValue={currentPage + 1} disabled={disabled} />
      <span>{text.itemPageTotal(format.format(pageCount))}</span>
    </div>
    <button className="item-action" type="button" aria-label={text.itemNext} title={text.itemNext}
      disabled={disabled || currentPage + 1 >= pageCount} onClick={() => onStep(1)}><PlayIcon /></button>
    <span className="item-page-announcement" role="status" id={summary}>
      {text.itemPage(format.format(displayedPage + 1), format.format(pageCount))}
    </span>
  </form>;
}

type AtlasStatus = 'ready' | 'failed';

function catalogSprite(item: CatalogItem) {
  return item.fluidId ? undefined : item.sprite;
}

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

function ItemGrid({ items, onReady, ...links }: ItemLinkActions & {
  items: CatalogItem[];
  onReady?: () => void;
}) {
  const { text } = usePreferences();
  const grid = useRef<HTMLUListElement>(null);
  const [preloadPage] = useState(() => onReady !== undefined);
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
        const url = catalogSprite(item)?.url;
        if (!url || atlasRequests.has(url)) continue;
        atlasRequests.set(url, loadAtlas(url, status => {
          setAtlasStatuses(current => new Map(current).set(url, status));
        }));
      }
    }

    const observer = preloadPage || typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
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
  }, [items, preloadPage]);

  useEffect(() => {
    if (!onReady || !seenItems) return;
    for (const item of items) {
      if (!seenItems.has(item.id) || !item.icon) continue;
      const sprite = catalogSprite(item);
      const status = sprite && atlasStatuses.get(sprite.url);
      if (sprite && !status) return;
      if (status !== 'ready' && !settledImages.has(item.icon)) return;
    }
    onReady();
  }, [items, onReady, seenItems, atlasStatuses, settledImages]);

  return (
    <ul className="item-grid" ref={grid} aria-label={text.items}>
      {items.map(item => {
        const seen = seenItems?.has(item.id);
        const sprite = catalogSprite(item);
        const atlasStatus = seen && sprite ? atlasStatuses.get(sprite.url) : undefined;
        const pending = Boolean(item.icon && (!seen || (sprite && !atlasStatus)));
        return (
          <li className="item-slot" key={item.id}>
            <ItemLink item={item} {...links}>
              <ItemIcon icon={item.icon} sprite={atlasStatus === 'ready' ? sprite : undefined} bar={item.bar}
                useIconSprite={false} fluid={!!item.fluidId} pending={pending}
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

function ItemDialog({ inline, layoutReady, closing, itemId, preview, catalog, recipeView, onClose, children,
  ingredient, onOpenIngredient, onCloseIngredient, recipeStation, recipePage, onRecipePositionChange,
  itemHref, onOpenItem }: ItemNavigation & RecipeNavigation & {
  inline: boolean;
  layoutReady: boolean;
  closing: boolean;
  itemId: string;
  preview?: CatalogItem;
  catalog: Catalog | null;
  recipeView: ItemRecipeView;
  onClose: () => void;
  children: ReactNode;
}) {
  const { text, advancedItemTooltips: advanced } = usePreferences();
  const notify = useNotifications();
  const sceneContentReady = useSceneContentReady();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [detailReady, setDetailReady] = useState(false);
  const load = useMemo(() => (signal: AbortSignal) => preview || !catalog
    ? Promise.resolve(preview) : catalog.getItem(itemId, signal), [catalog, preview, itemId]);
  const { state, retry } = useRequest(load);
  const selected = preview ?? (state.status === 'ready' ? state.data : undefined);
  const itemName = selected?.id === itemId ? plainMinecraftText(selected.name).trim() : undefined;
  useEffect(() => {
    if (!closing && itemName) document.title = pageTitle(itemName);
  }, [closing, itemId, itemName]);
  const itemLoading = !!catalog && !selected && state.status === 'loading';
  const minecraftId = selected?.fluidId ?? selected?.id;
  const recipeLabel = recipeView === 'uses' ? text.itemRecipeUses : text.itemRecipes;
  const title = catalog && !selected && state.status === 'ready' ? text.itemNotFound
    : selected?.fluidId ? `${recipeLabel} · ${selected.name}` : recipeLabel;
  const loadDetails = useMemo(() => () => selected ? loadItemDetails(selected) : Promise.resolve(undefined), [selected]);
  const details = useRequest(loadDetails);
  const data = details.state.status === 'ready' ? details.state.data : undefined;
  const [selectedVariant, setSelectedVariant] = useState<{ itemId: string; id: string }>();
  const variant = advanced && selectedVariant?.itemId === itemId
    ? data?.variants.find(entry => entry.id === selectedVariant.id) : undefined;
  const payloads = variant ? variant.payloads : data?.payloads;
  const [previousHeader, setPreviousHeader] = useState({ title, minecraftId });
  const visibleTitle = itemLoading ? previousHeader.title : title;

  useLayoutEffect(() => {
    setSelectedVariant(undefined);
  }, [itemId]);

  useLayoutEffect(() => {
    if (!itemLoading) setPreviousHeader({ title, minecraftId });
  }, [itemLoading, title, minecraftId]);

  function openRecipeItem(nextId: string, view: ItemRecipeView = 'recipes', preview?: CatalogItem) {
    if (nextId !== itemId || view !== recipeView) {
      heading.current?.focus({ preventScroll: true });
      onOpenItem(nextId, view, preview);
    }
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
    if (!sceneContentReady || !layoutReady || !element) return;
    if (inline) element.setAttribute('open', '');
    else element.showModal();
    const arrival = animatePanelArrival(element.querySelector<HTMLElement>('.item-recipe-detail'));
    setDetailReady(true);
    return () => {
      arrival?.cancel();
      if (inline) element.removeAttribute('open');
      else element.close();
    };
  }, [inline, layoutReady, sceneContentReady]);

  return (
    <dialog className="item-detail-overlay" data-inline={inline || undefined} inert={closing} role={inline ? 'region' : undefined}
      ref={dialog} aria-label={plainMinecraftText(itemName && !selected?.fluidId ? `${visibleTitle} · ${itemName}` : visibleTitle)}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="item-detail item-recipe-detail">
        <div className="item-detail-heading">
          <h2 ref={heading} tabIndex={-1}><MinecraftItemText text={visibleTitle} /></h2>
          <div className="item-detail-heading-actions">
            {(minecraftId || (itemLoading && previousHeader.minecraftId)) && <button className="item-action item-detail-copy" type="button" disabled={!minecraftId}
              onClick={copyMinecraftId} aria-label={text.copyItemId} title={text.copyItemId}>
              <img src={copyIcon} width={22} height={22} alt="" />
            </button>}
            <button className="item-action item-detail-close" type="button" onClick={onClose} aria-label={text.close}>×</button>
          </div>
        </div>
        {sceneContentReady && detailReady && (!catalog ? children : selected ? (
          selected.detail && details.state.status === 'loading' ? <ItemDetailsLoading key={itemId} /> :
            details.state.status === 'error' ? <ItemRequestError retry={details.retry} /> :
              <ItemDetails key={itemId} item={selected} data={data} variant={variant}
                onVariantChange={id => setSelectedVariant({ itemId, id })}
                catalog={catalog} advanced={advanced} stackUrl={payloads?.stack} itemHref={itemHref} onOpenItem={openRecipeItem}
                ingredient={ingredient} onCloseIngredient={onCloseIngredient} onOpenIngredient={onOpenIngredient}
                recipeStation={recipeStation} recipePage={recipePage} onRecipePositionChange={onRecipePositionChange}
                recipeView={recipeView} recipeLabel={recipeLabel} />
        ) : (
          state.status === 'error' ? <ItemRequestError retry={retry} /> :
            state.status === 'loading' && <ItemDetailsLoading key={itemId} />
        ))}
      </div>
    </dialog>
  );
}

function ItemDetailsLoading() {
  const { text } = usePreferences();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), itemDetailsLoadingDelayMs);
    return () => window.clearTimeout(timer);
  }, []);
  return visible ? <p role="status">{text.itemDetailsLoading}</p> : null;
}

function ItemRequestError({ retry }: { retry: () => void }) {
  const { text } = usePreferences();
  return <div>
    <p role="status">{text.itemDetailsError}</p>
    <button className="item-action" type="button" onClick={retry}>{text.retry}</button>
  </div>;
}

type RecipeCatalog = ItemNavigation & RecipeNavigation & { catalog: Catalog; item: CatalogItem };
type IngredientSelection = { input: RecipeIngredient; findItem: (id: string) => CatalogItem | undefined };
type MachineOptions = { alternatives: MachineIngredient[]; fluidIcon: (ingredient: MachineIngredient) => string | undefined };

function machineIngredient({ alternatives, otherIngredients, alternativesTruncated }: MachineRecipeSlot): RecipeIngredient {
  return {
    items: alternatives.filter(option => option.kind === 'item').map(option => option.id),
    tags: [], custom: otherIngredients, truncated: alternativesTruncated,
  };
}

function machineOptions(slot: MachineRecipeSlot, item: CatalogItem, getIcon: Catalog['getIcon']): MachineOptions {
  return {
    alternatives: slot.alternatives,
    fluidIcon: ({ id, icon }) => (icon && getIcon?.(icon)) || (id === item.fluidId ? item.icon : undefined),
  };
}

type IngredientOption = MachineIngredient | { id: string; kind: 'item'; amount?: undefined };

function fluidCatalogAlias(id: string) {
  return id.replace(':', ':/fluids/');
}

function addIngredientLookups(ids: Set<string>, options: readonly IngredientOption[]) {
  for (const { id, kind } of options) {
    ids.add(id);
    if (kind === 'fluid') ids.add(fluidCatalogAlias(id));
  }
}

function findIngredientItem({ id, kind }: IngredientOption, findItem: IngredientSelection['findItem']) {
  const item = findItem(id);
  if (kind === 'item') return item?.fluidId ? undefined : item;
  if (item?.fluidId === id) return item;
  const alias = findItem(fluidCatalogAlias(id));
  return alias?.fluidId === id ? alias : undefined;
}

function ingredientOptions(input: RecipeIngredient, alternatives?: MachineIngredient[]): IngredientOption[] {
  return alternatives ?? input.items.map(id => ({ id, kind: 'item' }));
}

function formatFluidAmount(millibuckets: number) {
  const digits = String(millibuckets).padStart(4, '0');
  const fraction = digits.slice(-3).replace(/0+$/, '');
  return digits.slice(0, -3) + (fraction ? `.${fraction}` : '');
}

function ingredientOptionName(option: IngredientOption, item?: CatalogItem) {
  const { id, kind, amount } = option;
  if (kind === 'fluid') return `${item?.name ?? option.name ?? id} · ${formatFluidAmount(amount)}`;
  const name = item?.name ?? id;
  return amount === undefined ? name : `${amount} × ${name}`;
}

function ItemDetails({ item, data, variant, onVariantChange, catalog, advanced, stackUrl, recipeView, recipeLabel,
  ...navigation }: RecipeCatalog & {
  data?: Awaited<ReturnType<typeof loadItemDetails>>;
  variant?: ItemVariant;
  onVariantChange: (id: string) => void;
  advanced: boolean;
  stackUrl?: string;
  recipeView: ItemRecipeView;
  recipeLabel: string;
}) {
  const { text, language } = usePreferences();
  const variants = data?.variants ?? [];
  const legacyRecipes = useMemo(() => data?.recipes && readLegacyRecipes(data.recipes, item.id), [data?.recipes, item.id]);
  const recipeCatalog = { item, catalog, ...navigation };
  const { id, fluidId } = item;
  const loadUses = useMemo(() => (signal: AbortSignal) =>
    catalog.getRecipeUses?.(fluidId ?? id, signal, fluidId ? 'fluid' : undefined) ?? Promise.resolve(undefined), [catalog, fluidId, id]);
  const showUses = recipeView === 'uses';
  const uses = useRequest(loadUses, showUses && !!catalog.getRecipeUses);
  const usesData = showUses && uses.state.status === 'ready' ? uses.state.data : undefined;
  const publishedAt = usesData?.publishedAt ?? catalog.publishedAt;
  const recipes = data?.recipeFeed ? (
    <PayloadContent url={data.recipeFeed} render={feed => <RecipeTabs feed={feed} {...recipeCatalog} />} />
  ) : <RecipeTabs recipes={legacyRecipes} emptyLabel={legacyRecipes ? undefined : text.itemRecipesUnavailable} {...recipeCatalog} />;
  let content = recipes;
  if (showUses) {
    if (!catalog.getRecipeUses) content = <RecipeTabs emptyLabel={text.itemRecipesUnavailable} {...recipeCatalog} />;
    else if (uses.state.status === 'loading') content = <ItemDetailsLoading />;
    else if (uses.state.status === 'error') content = <ItemRequestError retry={uses.retry} />;
    else content = <RecipeTabs feed={usesData?.feed} emptyLabel={text.itemNoRecipeUses} {...recipeCatalog} />;
  }
  return (
    <>
      <div className="item-detail-section" data-section="recipes" key={recipeView} role="region" aria-label={recipeLabel} tabIndex={0}>
        {content}
      </div>
      {advanced && variants.length > 0 && (
        <div className="item-variants item-picker">
          <span>{text.itemVariants}</span>
          <HeaderPicker label={text.itemVariants} value={variant?.id ?? ''}
            options={[{ value: '', label: text.itemDefaultVariant }, ...variants.map(entry => ({ value: entry.id, label: entry.name }))]}
            onChange={onVariantChange} />
        </div>
      )}
      {advanced && stackUrl && <ItemPayload label={text.itemStackData}>
        <PayloadContent url={stackUrl} render={data => <pre>{JSON.stringify(data, null, 2)}</pre>} />
      </ItemPayload>}
      {publishedAt !== undefined && <p className="item-recipe-published">
        {text.itemRecipePublished} <time dateTime={new Date(publishedAt).toISOString()}>
          {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(publishedAt)}
        </time>
      </p>}
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
  const load = useMemo(() => (signal: AbortSignal) => loadItemPayload(url, signal), [url]);
  const { state, retry } = useRequest(load);
  if (state.status === 'loading') return <ItemDetailsLoading />;
  if (state.status === 'error') return <ItemRequestError retry={retry} />;
  return render(state.data);
}

function recipeStationIconId(station: string) {
  return station === 'immersiveengineering:bottling_buckets' ? 'minecraft:bucket' : station;
}

function RecipeTabs({ recipes, feed, emptyLabel, item, catalog, itemHref, onOpenItem,
  ingredient, onOpenIngredient, onCloseIngredient, recipeStation, recipePage, onRecipePositionChange }: RecipeCatalog & {
  recipes?: RecipeEntry[];
  feed?: unknown;
  emptyLabel?: string;
}) {
  const { text } = usePreferences();
  const id = useId();
  const tooltipId = useId();
  const tabStrip = useRef<HTMLDivElement>(null);
  const activePanel = useRef<HTMLDivElement>(null);
  const [tabScroll, setTabScroll] = useState({ overflow: false, previous: false, next: false });
  const [hovered, setHovered] = useState<TooltipTarget<HTMLAnchorElement> & { item: CatalogItem }>();
  const hideTooltip = useCallback((anchor?: HTMLElement) => {
    setHovered(current => !anchor || current?.anchor === anchor ? undefined : current);
  }, []);
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
  const requestedGroup = groups.find(group => group.station === recipeStation);
  const containsIngredient = (group: { recipes: RecipeEntry[] }) => ingredient && group.recipes.some(recipe => recipe.id === ingredient.recipe);
  const ingredientGroup = requestedGroup && containsIngredient(requestedGroup) ? requestedGroup : groups.find(containsIngredient);
  const ingredientRecipe = ingredientGroup?.recipes.find(recipe => recipe.id === ingredient?.recipe);
  const ingredientSlot = ingredient && ingredientRecipe?.machine?.slots[ingredient.slot];
  const machineInput = useMemo(() => ingredientSlot && machineIngredient(ingredientSlot), [ingredientSlot]);
  const input = machineInput ?? (ingredient && ingredientRecipe?.instructions?.inputs[ingredient.slot]);
  const loadStations = useCallback((signal: AbortSignal) => {
    const ids = new Set(groups.map(({ station }) => recipeStationIconId(station)).filter(isItemId));
    ids.delete(item.id);
    return catalog.getItems(ids, signal);
  }, [catalog, groups, item.id]);
  const { state: stations } = useRequest(loadStations);
  const findStation = (id: string) => id === item.id ? item : stations.status === 'ready' ? stations.data.get(id) : undefined;
  const group = ingredientGroup ?? requestedGroup ?? groups[0];
  const selected = group ? groups.indexOf(group) : 0;
  const activeStation = group?.station;
  const pageCount = Math.ceil((group?.recipes.length ?? 0) / recipesPerPage);
  const savedPage = requestedGroup || recipeStation === undefined ? recipePage ?? 0 : 0;
  const selectedPage = ingredientRecipe && ingredientGroup
    ? Math.floor(ingredientGroup.recipes.indexOf(ingredientRecipe) / recipesPerPage) : savedPage;
  const currentPage = Math.max(0, Math.min(selectedPage, pageCount - 1));
  const previousTab = useRef(selected);
  useLayoutEffect(() => {
    const previous = previousTab.current;
    previousTab.current = selected;
    if (previous === selected) return;
    const arrival = animatePanelArrival(activePanel.current, selected > previous ? 1 : -1);
    return () => arrival?.cancel();
  }, [selected]);
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
  const stationItem = activeStation === undefined ? undefined : findStation(activeStation);
  const showStationSlot = !!stationItem || (isItemId(activeStation) && stations.status === 'loading');
  const tooltip = hovered && <ItemTooltip id={tooltipId} target={hovered} item={hovered.item} onDismiss={links.hideTooltip} />;

  function resetRecipeScroll() {
    activePanel.current?.parentElement?.scrollTo(0, 0);
    tabStrip.current?.closest('.item-detail-section')?.scrollTo(0, 0);
  }

  function changePage(nextPage: number) {
    links.hideTooltip();
    if (activeStation !== undefined) onRecipePositionChange(activeStation, nextPage);
    resetRecipeScroll();
  }

  return <>
    {!groups.length && <p>{emptyLabel ?? text.itemNoRecipes}</p>}
    {!!groups.length && <div className="item-recipe-navigation">
      {pageCount > 0 && <ItemPagination key={activeStation} currentPage={currentPage} pageCount={pageCount}
        disabled={pageCount === 1} onSelectPage={changePage}
        onStep={offset => changePage(currentPage + offset)} />}
      <div className="item-recipe-tab-bar">
        {tabScroll.overflow && <button className="item-action item-recipe-tab-arrow" data-previous type="button"
          aria-label={text.itemRecipePreviousStationTabs} aria-controls={`${id}-tabs`} disabled={!tabScroll.previous}
          onClick={() => scrollTabs('previous')}><PlayIcon /></button>}
        <div className="item-recipe-tabs" role="tablist" aria-label={text.itemRecipes} id={`${id}-tabs`}
          ref={tabStrip} onScroll={updateTabScroll}>
          {groups.map(({ station, recipes }, index) => {
            const known = recipeStations.find(key => key === station);
            const preview = findStation(recipeStationIconId(station));
            const category = recipes.find(recipe => recipe.machine?.category === station)?.machine;
            const label = known ? text.itemRecipeStations[known] : findStation(station)?.name ?? category?.title ?? (station || text.itemRecipeOther);
            const showIcon = preview?.icon || (isItemId(station) && stations.status === 'loading');
            return <button key={station} id={`${id}-tab-${index}`} type="button" className="item-action" role="tab"
              aria-label={label} title={label}
              aria-selected={index === selected} aria-controls={`${id}-panel-${index}`} tabIndex={index === selected ? 0 : -1}
              onClick={() => {
                links.hideTooltip();
                if (index !== selected) onRecipePositionChange(station);
                resetRecipeScroll();
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
          onClick={() => scrollTabs('next')}><PlayIcon /></button>}
      </div>
    </div>}
    {groups.map(({ station, recipes }, index) => (
      <div className="item-recipe-tab-panel" key={station} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`}
        tabIndex={index === selected ? 0 : undefined} hidden={index !== selected}>
        {index === selected && <div className="item-recipe-panel" ref={activePanel}>
          {showStationSlot && <div className="item-recipe-station item-recipe-slot">
            {stationItem && <RecipeIcon item={stationItem} id={stationItem.id}
              label={text.itemRecipeMakeStation(stationItem.name)} links={links} />}
          </div>}
          <RecipeGroup key={currentPage} recipes={recipes} page={currentPage} item={item} catalog={catalog} links={links}
            panel={activePanel} onOpenIngredient={onOpenIngredient} />
        </div>}
      </div>
    ))}
    {ingredient ? <RecipeIngredientDialog key={`${ingredient.recipe}@${ingredient.slot}`} input={input || undefined} item={item} catalog={catalog}
      options={ingredientSlot && machineOptions(ingredientSlot, item, catalog.getIcon)}
      onClose={() => { links.hideTooltip(); onCloseIngredient(); }} links={links}>
      {tooltip}
    </RecipeIngredientDialog> : tooltip}
  </>;
}

function RecipeGroup({ recipes, page, item, catalog, links, panel, onOpenIngredient }: Pick<RecipeCatalog, 'item' | 'catalog' | 'onOpenIngredient'> & {
  recipes: RecipeEntry[];
  page: number;
  links: ItemLinkActions;
  panel: RefObject<HTMLDivElement | null>;
}) {
  const { text } = usePreferences();
  const [rotation, setRotation] = useState(0);
  const first = page * recipesPerPage;
  const visibleRecipes = useMemo(() => recipes.slice(first, first + recipesPerPage), [recipes, first]);
  const load = useMemo(() => (signal: AbortSignal) => {
    const ids = new Set<string>();
    for (const { instructions, machine } of visibleRecipes) {
      if (instructions) {
        ids.add(instructions.result.id);
        for (const input of instructions.inputs) input?.items.forEach(id => ids.add(id));
      }
      for (const slot of machine?.slots ?? []) {
        addIngredientLookups(ids, slot.alternatives);
      }
    }
    ids.delete(item.id);
    return catalog.getItems(ids, signal);
  }, [catalog, item.id, visibleRecipes]);
  const { state, retry } = useRequest(load);
  const findItem = (id: string) => id === item.id ? item : state.status === 'ready' ? state.data.get(id) : undefined;
  const rotates = state.status === 'ready' && visibleRecipes.some(
    recipe => recipe.instructions?.inputs.some(input => input && input.items.length > 1)
      || recipe.machine?.slots.some(slot => slot.bounds && slot.alternatives.length > 1),
  );

  useEffect(() => {
    if (!rotates) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setInterval(() => {
      if (motion.matches || panel.current?.querySelector(
        '.item-recipe-slot:hover, .item-recipe-ingredient:is(:focus-within, :active, [aria-describedby], [aria-expanded=true])',
      )) return;
      setRotation(current => current + 1);
    }, ingredientRotationMs);
    return () => window.clearInterval(timer);
  }, [panel, rotates]);

  return <div className="item-recipe-results">
    {state.status === 'loading' ? <ItemDetailsLoading /> :
      state.status === 'error' ? <ItemRequestError retry={retry} /> :
        <ul>
          {visibleRecipes.map(({ id, instructions, type, machine }, index) => {
            const openIngredient = (slot: number) => { links.hideTooltip(); onOpenIngredient({ recipe: id, slot }); };
            return <li className="item-recipe" key={first + index}>
              {machine ? <MachineRecipeCard recipe={machine} item={item} findItem={findItem} getIcon={catalog.getIcon}
                links={links} rotation={rotation} onOpenIngredient={openIngredient} />
                : instructions ? <Recipe instructions={instructions} findItem={findItem} links={links}
                rotation={rotation} onOpenIngredient={openIngredient} /> : <>
                {type && <strong>{type}</strong>}
                <p>{text.itemRecipeUnsupported}</p>
              </>}
            </li>;
          })}
        </ul>}
  </div>;
}

function MachineRecipeCard({ recipe: { title, frame, slotSize, slots }, item, findItem, getIcon, links, rotation, onOpenIngredient }: {
  recipe: MachineRecipe;
  item: CatalogItem;
  findItem: IngredientSelection['findItem'];
  getIcon: Catalog['getIcon'];
  links: ItemLinkActions;
  rotation: number;
  onOpenIngredient: (slot: number) => void;
}) {
  const { text } = usePreferences();
  const hasLayout = slots.some(slot => slot.bounds);
  const details = slots.filter(({ bounds, alternatives, otherIngredients, alternativesTruncated }) =>
    !bounds && (alternatives.length > 0 || otherIngredients || alternativesTruncated),
  );

  return <>
    {hasLayout && <div className="item-machine-recipe" role="group" aria-label={title}
      style={{ inlineSize: `calc(var(--item-recipe-slot-size) * ${frame.width / slotSize})`, aspectRatio: `${frame.width} / ${frame.height}` }}>
      {slots.map((slot, index) => {
        const { bounds, role, alternatives, otherIngredients, alternativesTruncated } = slot;
        if (!bounds) return null;
        const ingredient = alternatives[0];
        const grouped = alternatives.length > 1 || alternativesTruncated || (ingredient && otherIngredients);
        const fluid = !grouped && ingredient?.kind === 'fluid';
        const style = {
          insetInlineStart: `${100 * (bounds.x - frame.x) / frame.width}%`,
          insetBlockStart: `${100 * (bounds.y - frame.y) / frame.height}%`,
          inlineSize: `${100 * bounds.width / frame.width}%`,
          blockSize: `${100 * bounds.height / frame.height}%`,
        };
        return <div key={index} className="item-recipe-slot item-machine-slot" data-role={role}
          data-fluid={fluid || undefined} style={style}>
          {grouped && <RecipeInput input={machineIngredient(slot)} options={machineOptions(slot, item, getIcon)}
            findItem={findItem} links={links} rotation={rotation} onOpenIngredient={() => onOpenIngredient(index)} />}
          {!grouped && ingredient?.kind === 'item' && <RecipeIcon item={findItem(ingredient.id)} id={ingredient.id}
            count={ingredient.amount} links={links} />}
          {fluid && <RecipeFluidIcon ingredient={ingredient} item={findIngredientItem(ingredient, findItem)} links={links}
            icon={machineOptions(slot, item, getIcon).fluidIcon(ingredient)} />}
          {!grouped && !ingredient && otherIngredients && <span title={text.itemRecipeUnknownInput}>?</span>}
        </div>;
      })}
    </div>}
    {details.length > 0 && <details className="item-machine-details" open>
      <summary>{text.itemMachineRecipeDetails}</summary>
      {(['input', 'output', 'catalyst'] as const).map(role => {
        const group = details.filter(slot => slot.role === role);
        return group.length > 0 && <div key={role}>
          <strong>{text.itemMachineRecipeRoles[role]}</strong>
          <ul>
            {group.map(({ name, alternatives, otherIngredients, alternativesTruncated }, index) => (
              <li key={index}>
                {name && <strong>{name} · </strong>}
                {alternatives.map(option => ingredientOptionName(option, findIngredientItem(option, findItem))).join(' / ')}
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
    <ul className="item-recipe-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, var(--item-recipe-slot-size)))` }}>
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

function RecipeInput({ input, options, findItem, rotation, links, onOpenIngredient }: IngredientSelection & {
  options?: MachineOptions;
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
  if (!options && items.length === 1 && !custom && !truncated) {
    return <RecipeIcon item={findItem(first)} id={first} links={links} />;
  }

  const variants = ingredientOptions(input, options?.alternatives);
  const previews = variants.map(option => {
    const item = findIngredientItem(option, findItem);
    const icon = (option.kind === 'fluid' && options?.fluidIcon(option)) || item?.icon;
    return { option, item, icon };
  }).filter(({ icon, option }) => icon || option.kind === 'fluid');
  const current = previews.length ? previews[rotation % previews.length] : undefined;
  const previous = rotation && previews.length > 1 ? previews[(rotation - 1) % previews.length] : undefined;
  const preview = current?.item;
  const tagLabels = tags.map(tag => `#${tag}`).join(', ');
  const label = tagLabels ? `${text.itemRecipeAlternatives} · ${tagLabels}` : text.itemRecipeAlternatives;
  function renderPreview(variant: typeof current, slide?: 'in' | 'out') {
    return <span className="item-recipe-preview" key={slide === 'out' ? rotation - 1 : rotation} data-slide={slide}>
      <ItemIcon icon={variant?.icon} bar={variant?.item?.bar} fluid={variant?.option.kind === 'fluid'} />
      {variant?.option.amount !== undefined && <span className="item-recipe-count">
        {variant.option.kind === 'fluid' ? formatFluidAmount(variant.option.amount) : variant.option.amount}
      </span>}
    </span>;
  }
  const content = <>
    <span className="item-recipe-previews" aria-hidden="true">
      {renderPreview(current, previous ? 'in' : undefined)}
      {previous && renderPreview(previous, 'out')}
    </span>
    <span className="item-recipe-ingredient-mark" aria-hidden="true">{tags.length ? '#' : '…'}</span>
  </>;

  function openUses(item: CatalogItem) {
    hideIngredientTooltip();
    links.onOpenItem(item.id, 'uses', item);
  }

  return <>
    <button className="item-slot-button item-recipe-ingredient" type="button" aria-label={label} aria-haspopup="dialog"
      data-count={current?.option.amount !== undefined || undefined}
      aria-describedby={tooltip.active && !tooltip.pinned ? tooltipId : undefined}
      aria-expanded={!!tooltip.pinned} aria-controls={tooltip.pinned ? tooltipId : undefined}
      onPointerEnter={tooltip.onPointerEnter}
      onPointerLeave={tooltip.onPointerLeave}
      onFocus={tooltip.onFocus}
      onBlur={tooltip.onBlur}
      onKeyDown={event => {
        if (event.key === 'Escape' && tooltip.active) {
          event.preventDefault();
          hideIngredientTooltip(event.currentTarget);
        }
      }}
      onContextMenu={event => {
        if (!preview || event.button !== 2 || ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch')) return;
        event.preventDefault();
        openUses(preview);
      }}
      onClick={event => {
        const open = () => {
          hideIngredientTooltip();
          onOpenIngredient();
        };
        if (!tooltip.pin(event, { actions: [{ label: text.itemRecipeAlternatives, run: open }] })) open();
      }}>
      {content}
    </button>
    {target && <ItemTooltipPopover id={tooltipId} target={target} onDismiss={hideIngredientTooltip}>
      <strong>{tagLabels || text.itemRecipeAlternatives}</strong>
      <ul className="item-recipe-ingredient-tooltip-list">
        {variants.slice(0, ingredientTooltipLimit).map((option, index) => <li key={index}>
          <MinecraftItemText text={ingredientOptionName(option, findIngredientItem(option, findItem))} />
        </li>)}
      </ul>
      {variants.length > ingredientTooltipLimit && <div>{text.itemRecipeAdditionalOptions(variants.length - ingredientTooltipLimit)}</div>}
      <IngredientNotes input={input} count={variants.length} />
    </ItemTooltipPopover>}
  </>;
}

function IngredientNotes({ input, count }: { input: RecipeIngredient; count: number }) {
  const { text } = usePreferences();
  return <>
    {input.custom && <p>{text.itemRecipeCustomInput}</p>}
    {input.truncated && <p>{text.itemRecipeMoreExamples}</p>}
    {!count && !input.custom && <p>{text.itemRecipeUnknownInput}</p>}
  </>;
}

function RecipeIngredientDialog({ input, options, item, catalog, links, onClose, children }: Pick<RecipeCatalog, 'item' | 'catalog'> & {
  input?: RecipeIngredient;
  options?: MachineOptions;
  links: ItemLinkActions;
  onClose: () => void;
  children: ReactNode;
}) {
  const { text } = usePreferences();
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const [requestedPage, setPage] = useState(0);
  const alternatives = options?.alternatives;
  const variants = useMemo(() => input ? ingredientOptions(input, alternatives) : [], [input, alternatives]);
  const pageCount = Math.ceil(variants.length / ingredientVariantsPerPage);
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const pageStart = page * ingredientVariantsPerPage;
  const visibleVariants = useMemo(() => variants.slice(pageStart, pageStart + ingredientVariantsPerPage), [pageStart, variants]);
  const load = useMemo(() => async (signal: AbortSignal) => {
    const ids = new Set<string>();
    addIngredientLookups(ids, visibleVariants);
    ids.delete(item.id);
    const items = await catalog.getItems(ids, signal);
    const unlisted = new Set(visibleVariants.flatMap(({ id, kind }) =>
      kind === 'item' && id !== item.id && !items.has(id) ? [id] : [],
    ));
    const icons = unlisted.size ? await catalog.getRecipeItemIcons?.(unlisted, signal) : undefined;
    return { items, icons };
  }, [catalog, item.id, visibleVariants]);
  const { state, retry } = useRequest(load, visibleVariants.length > 0);
  const findItem = (id: string) => id === item.id ? item : state.status === 'ready' ? state.data.items.get(id) : undefined;

  function selectPage(nextPage: number) {
    if (nextPage === page) return;
    links.hideTooltip();
    const activeArrow = section.current?.querySelector('.item-pagination button:focus');
    if (activeArrow && (activeArrow.hasAttribute('data-previous') ? nextPage === 0 : nextPage === pageCount - 1)) {
      section.current?.querySelector<HTMLInputElement>('.item-pagination input')?.focus();
    }
    setPage(nextPage);
    section.current?.scrollTo(0, 0);
  }

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const arrival = animatePanelArrival(element.querySelector<HTMLElement>('.item-detail'));
    return () => {
      arrival?.cancel();
      element.close();
    };
  }, []);

  return <dialog className="item-detail-overlay" ref={dialog} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="item-detail item-ingredient-detail">
      <div className="item-detail-heading">
        <h2 id={headingId}>{text.itemRecipeAlternatives}</h2>
        <button className="item-action item-detail-close" type="button" onClick={onClose} aria-label={text.close}>×</button>
      </div>
      <div className="item-detail-section" ref={section} data-section="recipes" tabIndex={0}>
        {input?.tags.map(tag => <code key={tag}>#{tag}</code>)}
        {!input && <p>{text.itemRecipeIngredientUnavailable}</p>}
        {pageCount > 1 && <div className="item-recipe-navigation">
          <ItemPagination currentPage={page} pageCount={pageCount} onSelectPage={selectPage} onStep={offset => selectPage(page + offset)} />
        </div>}
        {visibleVariants.length > 0 && state.status === 'loading' && <ItemDetailsLoading />}
        {input && state.status === 'error' && <ItemRequestError retry={retry} />}
        {!!visibleVariants.length && <ul className="item-recipe-ingredient-list" aria-busy={state.status === 'loading'}>
          {visibleVariants.map((option, index) => {
            const { id, kind, amount } = option;
            const example = findIngredientItem(option, findItem);
            const fluid = kind === 'fluid';
            return <li key={pageStart + index} className="item-recipe-slot" data-fluid={fluid || undefined}>
              {state.status === 'loading' ? null
                : fluid ? <RecipeFluidIcon ingredient={option} item={example} icon={options?.fluidIcon(option)} links={links} />
                : <RecipeIcon item={example} id={id} count={amount} links={links} showMissingTooltip
                  icon={state.status === 'ready' ? state.data.icons?.get(id) : undefined} />}
            </li>;
          })}
        </ul>}
        {input && <IngredientNotes input={input} count={variants.length} />}
      </div>
    </div>
    {children}
  </dialog>;
}

function RecipeFluidIcon({ ingredient, item, icon, links }: {
  ingredient: MachineIngredient;
  item?: CatalogItem;
  icon?: string;
  links: ItemLinkActions;
}) {
  const { text } = usePreferences();
  const label = ingredientOptionName(ingredient, item);
  const content = <>
    <ItemIcon icon={icon ?? item?.icon} fluid lazy />
    <span className="item-recipe-count" aria-hidden="true">
      {formatFluidAmount(ingredient.amount)}
    </span>
  </>;
  return item ? <ItemLink item={item} label={label} {...links}>{content}</ItemLink>
    : <UnlistedRecipeIcon label={label} description={<>
      <strong><MinecraftItemText text={ingredient.name ?? ingredient.id} /></strong>
      <div>{text.itemFluid} · {formatFluidAmount(ingredient.amount)}</div>
    </>}>{content}</UnlistedRecipeIcon>;
}

function UnlistedRecipeIcon({ label, description, children }: { label: string; description: ReactNode; children: ReactNode }) {
  const tooltipId = useId();
  const [target, setTarget] = useState<TooltipTarget>();
  const hideTooltip = useCallback((anchor?: HTMLElement) => {
    setTarget(current => !anchor || current?.anchor === anchor ? undefined : current);
  }, []);
  const tooltip = useTooltipTrigger<HTMLButtonElement>(target, setTarget, hideTooltip);
  return <>
    <button className="item-slot-button" type="button" aria-label={plainMinecraftText(label)}
      aria-describedby={tooltip.active && !tooltip.pinned ? tooltipId : undefined}
      aria-expanded={!!tooltip.pinned} aria-controls={tooltip.pinned ? tooltipId : undefined}
      onPointerEnter={tooltip.onPointerEnter} onPointerLeave={tooltip.onPointerLeave}
      onFocus={tooltip.onFocus} onBlur={tooltip.onBlur} onClick={event => { tooltip.pin(event); }}
      onKeyDown={event => { if (event.key === 'Escape' && tooltip.active) { event.preventDefault(); hideTooltip(); } }}>
      {children}
    </button>
    {target && <ItemTooltipPopover id={tooltipId} target={target} onDismiss={hideTooltip}>
      {description}
    </ItemTooltipPopover>}
  </>;
}

function RecipeIcon({ item, id, count, label, links, icon, showMissingTooltip }: {
  item?: CatalogItem;
  id: string;
  count?: number;
  label?: string;
  links: ItemLinkActions;
  icon?: string;
  showMissingTooltip?: boolean;
}) {
  const name = item?.name ?? id;
  const accessibleName = label ?? (count ? `${count} × ${name}` : name);
  const content = <>
    <ItemIcon icon={item?.icon ?? icon} bar={item?.bar} lazy />
    {count !== undefined && <span className="item-recipe-count" aria-hidden="true">{count}</span>}
  </>;
  if (item) return <ItemLink item={item} label={accessibleName} {...links}>{content}</ItemLink>;
  if (showMissingTooltip) {
    return <UnlistedRecipeIcon label={accessibleName} description={<strong><MinecraftItemText text={accessibleName} /></strong>}>
      {content}
    </UnlistedRecipeIcon>;
  }
  return <span className="item-recipe-missing" role="img" aria-label={accessibleName} title={accessibleName}>{content}</span>;
}
