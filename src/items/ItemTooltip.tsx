import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { EquipmentItem } from '../equipment/contract.mts';
import { usePreferences } from '../PreferencesProvider';
import { parseMinecraftMotd, plainMinecraftText } from '../layout/minecraftMotd';
import { loadItemDetails, loadItemPayload, type CatalogItem, type ItemPayloads } from './catalogData';
import { readTooltipAlternatives, readTooltipLines, type TooltipTextSpan } from './catalogIndex.mjs';
import { ItemLoadingHint } from './ItemLoadingHint';
import { ItemTooltipTools } from './ItemTooltipTools';
import { useItemPonder } from '../ponder/ItemPonderLinks';

type TooltipContentProps = { item: CatalogItem; pinned?: boolean; advanced: boolean; shortcut?: string; data: ReturnType<typeof useItemTooltip> };

export type TooltipTarget<Element extends HTMLElement = HTMLElement> = {
  anchor: Element;
  triggerId: string;
  pinned?: boolean;
  keyboard?: boolean;
  recipeHelp?: boolean;
  actions?: readonly { label: string; run: () => void }[];
};

const recipeHelpText = {
  cs: { name: 'Nápověda k receptům', recipes: 'Pro zobrazení receptu vyberte ikonu předmětu ještě jednou.',
    mouse: 'Pravým kliknutím na ikonu otevřete použití v receptech.', touch: 'Podržením prstu na ikoně otevřete použití v receptech.' },
  en: { name: 'Recipe help', recipes: 'Select the item icon again to open its recipe.',
    mouse: 'Right-click the icon to see its recipe uses.', touch: 'Touch and hold the icon to see its recipe uses.' },
  de: { name: 'Rezepthilfe', recipes: 'Wähle das Gegenstandssymbol erneut aus, um sein Rezept zu öffnen.',
    mouse: 'Klicke mit der rechten Maustaste auf das Symbol, um seine Verwendung in Rezepten zu sehen.',
    touch: 'Halte das Symbol gedrückt, um seine Verwendung in Rezepten zu sehen.' },
  es: { name: 'Ayuda sobre recetas', recipes: 'Vuelve a seleccionar el icono del objeto para abrir su receta.',
    mouse: 'Haz clic derecho en el icono para ver sus usos en recetas.', touch: 'Mantén pulsado el icono para ver sus usos en recetas.' },
  fr: { name: 'Aide sur les recettes', recipes: 'Sélectionnez à nouveau l’icône de l’objet pour ouvrir sa recette.',
    mouse: 'Faites un clic droit sur l’icône pour voir ses utilisations dans les recettes.',
    touch: 'Maintenez le doigt sur l’icône pour voir ses utilisations dans les recettes.' },
  ja: { name: 'レシピのヘルプ', recipes: 'アイテムのアイコンをもう一度選ぶと、レシピが開きます。',
    mouse: 'アイコンを右クリックすると、レシピでの用途が表示されます。', touch: 'アイコンを長押しすると、レシピでの用途が表示されます。' },
  uk: { name: 'Довідка про рецепти', recipes: 'Виберіть піктограму предмета ще раз, щоб відкрити рецепт.',
    mouse: 'Клацніть піктограму правою кнопкою, щоб переглянути використання в рецептах.',
    touch: 'Натисніть і утримуйте піктограму, щоб переглянути використання в рецептах.' },
};

function RecipeGestureHelp({ id }: { id: string }) {
  const { language } = usePreferences();
  const button = useRef<HTMLButtonElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const [touch, setTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [open, setOpen] = useState(false);
  const copy = recipeHelpText[language];
  useEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(pointer.matches);
    pointer.addEventListener('change', update);
    update();
    return () => pointer.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const anchor = button.current;
    const message = hint.current;
    if (!anchor || !message) return;
    const viewport = window.visualViewport;
    let frame = 0;

    function schedulePosition() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    }

    function position() {
      if (!anchor || !message) return;
      const edge = 8;
      const gap = 8;
      const left = (viewport?.offsetLeft ?? 0) + edge;
      const top = (viewport?.offsetTop ?? 0) + edge;
      const right = left + (viewport?.width ?? window.innerWidth) - 2 * edge;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 2 * edge;
      message.style.setProperty('--item-help-available', `${Math.max(0, right - left)}px`);

      const bounds = anchor.getBoundingClientRect();
      const width = message.offsetWidth;
      const height = message.offsetHeight;
      const center = bounds.left + bounds.width / 2;
      const aligned = Math.max(left, Math.min(center - width / 2, right - width));
      message.style.setProperty('--item-help-offset', `${aligned + width / 2 - center}px`);
      const above = bounds.top - gap - top;
      const below = bottom - bounds.bottom - gap;
      message.toggleAttribute('data-below', above < height && below > above);
    }

    const observer = new ResizeObserver(schedulePosition);
    observer.observe(message);
    const panel = anchor.closest('.item-tooltip');
    if (panel) observer.observe(panel);
    schedulePosition();
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    viewport?.addEventListener('resize', schedulePosition);
    viewport?.addEventListener('scroll', schedulePosition);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
      viewport?.removeEventListener('resize', schedulePosition);
      viewport?.removeEventListener('scroll', schedulePosition);
    };
  }, []);

  return <span className="item-tooltip-help" data-open={open || undefined}>
    <button className="item-action item-tooltip-help-button" type="button" aria-label={copy.name} ref={button}
      aria-describedby={id} onClick={() => setOpen(value => !value)} onBlur={() => setOpen(false)}>?</button>
    <span className="item-tooltip-help-text" role="tooltip" id={id} ref={hint}>
      <span>{copy.recipes}</span>
      <span>{touch ? copy.touch : copy.mouse}</span>
    </span>
  </span>;
}

export function MinecraftItemText({ text }: { text: string }) {
  if (!text.includes('\u00a7')) return text;
  return parseMinecraftMotd(text).map(part => <span key={part.start} style={part.style}>{part.text}</span>);
}

function readComponents(stack: unknown) {
  if (!stack || typeof stack !== 'object' || !('components' in stack)) return;
  const { components } = stack;
  if (components && typeof components === 'object' && !Array.isArray(components)) return components as Record<string, unknown>;
}

function spanStyle(span: TooltipTextSpan): CSSProperties {
  const { color } = span;
  const decoration = [];
  if (span.underlined === true) decoration.push('underline');
  if (span.strikethrough === true) decoration.push('line-through');
  return {
    color: typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff
      ? `#${color.toString(16).padStart(6, '0')}` : undefined,
    fontWeight: span.bold === true ? 'bold' : undefined,
    fontStyle: span.italic === true ? 'italic' : undefined,
    textDecorationLine: decoration.join(' ') || undefined,
  };
}

function TooltipLine({ spans }: { spans: TooltipTextSpan[] }) {
  return <div>{spans.length === 0 ? '\u00a0' : spans.map((span, index) => (
    <span key={index} style={spanStyle(span)} data-obfuscated={span.obfuscated === true || undefined}>
      <MinecraftItemText text={span.text} />
    </span>
  ))}</div>;
}

const lineText = (spans: TooltipTextSpan[]) => plainMinecraftText(spans.map(span => span.text).join('')).trim();

function restoreEquipmentLine(text: string, catalogLines: TooltipTextSpan[][]) {
  const plain = plainMinecraftText(text).trim();
  if (!plain || text.includes('\u00a7')) return [{ text: text || '\u00a0' }];
  const match = catalogLines.find(line => lineText(line) === plain);
  if (match) return match;
  // Preserve the live amount and reuse the catalog's formatting for the label and value.
  const energy = catalogLines.find(line => line.length === 2 && line[0].text === 'Stored energy: ');
  if (energy && plain.startsWith(energy[0].text)) {
    return [energy[0], { ...energy[1], text: plain.slice(energy[0].text.length) }];
  }
  return [{ text }];
}

function EquipmentTooltipContent({ stack, pinned, advanced, shortcut, data }: {
  stack: EquipmentItem; pinned?: boolean; advanced: boolean; shortcut?: string; data: ReturnType<typeof useItemTooltip>;
}) {
  const catalogLines = data.lines ?? [];
  const alternative = data.shortcuts.find(entry => entry.id === shortcut)?.lines;
  const lastLine = catalogLines.at(-1);
  const catalogMod = lastLine?.length && lastLine.every(span => span.italic === true && span.color === 0x5555ff)
    ? lineText(lastLine) : undefined;
  const namespace = stack.id.split(':')[0];
  const modName = stack.modName || catalogMod || namespace.replace(/[_.-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const title = catalogLines[0] && lineText(catalogLines[0]) === plainMinecraftText(stack.name) ? catalogLines[0] : undefined;
  const catalogFallback = (alternative ?? catalogLines).slice(1)
    .filter(line => namespace !== 'mekanism' || !lineText(line).startsWith('Stored energy:'));
  const lines = alternative ? catalogFallback
    : stack.tooltipLines ?? stack.tooltip?.map(line => restoreEquipmentLine(line, catalogLines)) ?? catalogFallback;

  return <>
    <div className="item-tooltip-lines">
      {!pinned && <strong>{title ? title.map((span, index) => <span key={index} style={spanStyle(span)}>{span.text}</span>)
        : <MinecraftItemText text={stack.name} />}</strong>}
      {lines.map((line, index) => <TooltipLine key={index} spans={line} />)}
      {!lines.some(line => lineText(line) === modName) && <div className="equipment-item-mod">{modName}</div>}
    </div>
    {advanced && <div className="item-tooltip-meta"><code>{stack.id}</code></div>}
  </>;
}

function usePayload(url: string | undefined) {
  const [result, setResult] = useState<{ url: string; value: unknown }>();
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const { signal } = controller;
    void loadItemPayload(url, signal).then(
      value => { if (!signal.aborted) setResult({ url, value }); },
      () => { if (!signal.aborted) setResult({ url, value: null }); },
    );
    return () => controller.abort();
  }, [url]);
  return !url ? null : result?.url === url ? result?.value : undefined;
}

function useItemTooltip(item: CatalogItem | undefined) {
  const [loaded, setLoaded] = useState<{ item: CatalogItem; sources: ItemPayloads | null }>();

  useEffect(() => {
    if (!item?.detail) return;
    let active = true;
    void loadItemDetails(item).then(
      details => { if (active) setLoaded({ item, sources: details.payloads ?? null }); },
      () => { if (active) setLoaded({ item, sources: null }); },
    );
    return () => { active = false; };
  }, [item]);

  const sources = item?.detail ? (loaded?.item === item ? loaded.sources : undefined) : null;
  const payload = usePayload(sources?.tooltip);
  const lines = useMemo(() => readTooltipLines(payload), [payload]);
  const shortcuts = useMemo(() => readTooltipAlternatives(payload), [payload]);
  return { lines, shortcuts, stackUrl: sources?.stack, loading: sources === undefined || payload === undefined };
}

function ItemTooltipContent({ item, pinned, advanced, shortcut, data }: TooltipContentProps) {
  const { language, text } = usePreferences();
  const stack = usePayload(advanced ? data.stackUrl : undefined);
  const loading = data.loading || (advanced && stack === undefined);
  const exportedLines = data.shortcuts.find(entry => entry.id === shortcut)?.lines ?? data.lines;
  const firstLine = exportedLines?.[0];
  const lines = pinned && firstLine && lineText(firstLine) === plainMinecraftText(item.name).trim()
    ? exportedLines?.slice(1) : exportedLines;
  const components = advanced ? readComponents(stack) : undefined;
  const max = components?.['minecraft:max_damage'];
  const damage = components?.['minecraft:damage'] ?? 0;
  const format = new Intl.NumberFormat(language);

  return <>
    {!!lines?.length && <div className="item-tooltip-lines">
      {lines.map((line, index) => <TooltipLine key={index} spans={line} />)}
    </div>}
    {!lines && !pinned && <strong><MinecraftItemText text={item.name} /></strong>}
    {item.fluidId && <div>{text.itemFluid}</div>}
    {loading && !item.fluidId && <ItemLoadingHint label={text.itemTooltipLoading} />}
    {advanced && <div className="item-tooltip-meta">
      {typeof max === 'number' && Number.isSafeInteger(max) && max > 0 && typeof damage === 'number'
        && Number.isSafeInteger(damage) && damage >= 0 && damage <= max
        && <div>{text.itemTooltipDurability(format.format(max - damage), format.format(max))}</div>}
      <code>{item.fluidId ?? item.id}</code>
    </div>}
  </>;
}

type TooltipPopoverProps = {
  id: string;
  target?: TooltipTarget;
  onDismiss: (anchor: HTMLElement) => void;
};

export function ItemTooltip({ id, item, stack, target, onDismiss }: TooltipPopoverProps & {
  item?: CatalogItem;
  stack?: EquipmentItem;
}) {
  if (!target) return null;
  return <ItemTooltipPanel key={target.triggerId} {...{ id, item, stack, target, onDismiss }} />;
}

function ItemTooltipPanel({ id, item, stack, target, onDismiss }: Required<Pick<TooltipPopoverProps, 'target'>>
  & Omit<TooltipPopoverProps, 'target'> & { item?: CatalogItem; stack?: EquipmentItem }) {
  const { text, advancedItemTooltips, update } = usePreferences();
  const [selectedShortcut, setSelectedShortcut] = useState<string>();
  const data = useItemTooltip(item);
  const name = stack?.name ?? item?.name;
  const ponder = useItemPonder(item?.id ?? stack?.id);
  const ponderShortcut = ponder && ['W', 'P'].find(key => !data.shortcuts.some(({ id }) =>
    id === 'key.keyboard.' + key.toLowerCase()));
  function openPonder() {
    ponder?.(target.anchor, name);
    onDismiss(target.anchor);
  }
  const shortcut = target.pinned ? selectedShortcut : undefined;
  const canShowAdvanced = !!(item || stack);
  const selectShortcut = (id: string) => setSelectedShortcut(current => current === id ? undefined : id);
  const toggleAdvanced = () => update({ advancedItemTooltips: !advancedItemTooltips });

  function onShortcut(event: KeyboardEvent) {
    if (event.repeat || event.isComposing || event.defaultPrevented) return;
    if (ponderShortcut && event.key.toUpperCase() === ponderShortcut && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      openPonder();
      return;
    }
    const shortcut = data.shortcuts.find(({ id }) => matchesTooltipShortcut(id, event));
    if (shortcut) {
      event.preventDefault();
      selectShortcut(shortcut.id);
    }
  }

  return <ItemTooltipPopover id={id} target={target} title={name} onDismiss={onDismiss} onShortcut={onShortcut}
    extraActions={ponder && <button type="button" className="item-action" aria-haspopup="dialog"
      aria-keyshortcuts={ponderShortcut} onClick={openPonder}>
      <span>{text.ponder}</span>{ponderShortcut && <kbd>{ponderShortcut}</kbd>}
    </button>}
    modes={canShowAdvanced && <ItemTooltipTools advanced={advancedItemTooltips} shortcut={shortcut} shortcuts={data.shortcuts}
      onAdvanced={toggleAdvanced} onShortcut={selectShortcut} />}>
      {stack ? <EquipmentTooltipContent stack={stack} pinned={target.pinned} advanced={advancedItemTooltips} shortcut={shortcut} data={data} />
        : item && <ItemTooltipContent item={item} pinned={target.pinned} advanced={advancedItemTooltips} shortcut={shortcut} data={data} />}
    </ItemTooltipPopover>;
}

function matchesTooltipShortcut(id: string, event: KeyboardEvent) {
  const keys = id.split('+').map(key => key.replace(/^key\.keyboard\.(?:(?:left|right)\.)?/, ''));
  const modifiers = ['control', 'shift', 'alt', 'meta'];
  const activeModifiers = [event.ctrlKey, event.shiftKey, event.altKey, event.metaKey];
  const key = event.key.toLowerCase();
  return keys.includes(key) && modifiers.every((modifier, index) => keys.includes(modifier) === activeModifiers[index])
    && keys.filter(key => !modifiers.includes(key)).every(entry => entry === key);
}

export function ItemTooltipPopover({ id, target, title, onDismiss, onShortcut, extraActions, modes, children }: TooltipPopoverProps & {
  children: ReactNode;
  title?: string;
  extraActions?: ReactNode;
  modes?: ReactNode;
  onShortcut?: (event: KeyboardEvent) => void;
}) {
  const { text } = usePreferences();
  const tooltip = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const { anchor, pinned, keyboard, recipeHelp } = target ?? {};
  const dismiss = useEffectEvent(onDismiss);
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => onShortcut?.(event));

  function close() {
    if (!anchor) return;
    if (tooltip.current?.contains(document.activeElement)) anchor.focus({ preventScroll: true });
    onDismiss(anchor);
  }

  useEffect(() => {
    const panel = tooltip.current;
    const trigger = anchor;
    if (!trigger || !panel) return;
    const inside = (node: EventTarget | null) => node instanceof Node && (trigger.contains(node) || panel.contains(node));
    const dismissOutside = (event: PointerEvent) => {
      if (!inside(event.target)) dismiss(trigger);
    };
    function dismissOnOtherSlot(event: PointerEvent) {
      if (!pinned && event.pointerType !== 'touch' && event.target instanceof Element && event.target.closest('.item-slot-button')) {
        dismissOutside(event);
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pinned || !inside(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
        dismiss(trigger);
      } else if (event.key === 'Tab' && !event.shiftKey && event.target === trigger && recipeHelp) {
        const help = header.current?.querySelector<HTMLButtonElement>('.item-tooltip-help-button');
        if (help) {
          event.preventDefault();
          help.focus({ preventScroll: true });
        }
      } else {
        handleShortcut(event);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (pinned && !inside(event.target)) dismiss(trigger);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('pointerover', dismissOnOtherSlot, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('pointerover', dismissOnOtherSlot, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [anchor, pinned, recipeHelp]);

  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!element || !anchor) return;

    if (pinned) element.showPopover?.();
    const viewport = window.visualViewport;

    const position = () => {
      const edge = pinned ? 12 : 8;
      const gap = pinned ? 10 : 6;
      const bounds = anchor.getBoundingClientRect();
      const screen = {
        top: (viewport?.offsetTop ?? 0) + edge,
        left: (viewport?.offsetLeft ?? 0) + edge,
        bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - edge,
        right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - edge,
      };
      if (!anchor.isConnected || !anchor.getClientRects().length || bounds.bottom <= screen.top - edge
        || bounds.top >= screen.bottom + edge) {
        dismiss(anchor);
        return;
      }

      const screenHeight = Math.max(0, screen.bottom - screen.top);
      if (pinned) element.style.maxInlineSize = Math.max(0, screen.right - screen.left) + 'px';
      const { width } = element.getBoundingClientRect();
      const height = pinned ? (header.current?.offsetHeight ?? 0) + (scroll.current?.scrollHeight ?? 0) + 2
        : element.scrollHeight + 2;
      const above = bounds.top - gap - screen.top;
      const below = screen.bottom - bounds.bottom - gap;
      const side = pinned && height > Math.max(above, below)
        && (screen.right - bounds.right - gap >= width ? 'right' : bounds.left - gap - screen.left >= width ? 'left' : undefined);
      const putAbove = above >= height || (below < height && above >= below);
      if (pinned) {
        const minimum = (header.current?.offsetHeight ?? 0) + 80;
        const available = side ? screenHeight : Math.min(screenHeight, Math.max(minimum, putAbove ? above : below));
        element.style.maxBlockSize = Math.min(available, screenHeight * 0.9) + 'px';
      }
      const panelHeight = element.getBoundingClientRect().height;
      const left = side === 'right' ? bounds.right + gap : side === 'left' ? bounds.left - gap - width
        : bounds.left + (bounds.width - width) / 2;
      const top = side ? bounds.top : putAbove ? bounds.top - panelHeight - gap : bounds.bottom + gap;
      element.style.left = Math.max(screen.left, Math.min(left, screen.right - width)) + 'px';
      element.style.top = Math.max(screen.top, Math.min(top, screen.bottom - panelHeight)) + 'px';
    };

    position();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
    observer?.observe(element);
    if (scroll.current) observer?.observe(scroll.current);
    if (header.current) observer?.observe(header.current);
    const visibility = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) dismiss(anchor);
    });
    visibility?.observe(anchor);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      if (pinned && element.hidePopover && element.matches(':popover-open')) element.hidePopover();
      observer?.disconnect();
      visibility?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [anchor, pinned]);

  useLayoutEffect(() => {
    if (pinned && keyboard && !recipeHelp) {
      const firstAction = scroll.current?.querySelector<HTMLElement>('button, a');
      (firstAction ?? header.current?.querySelector('button'))?.focus({ preventScroll: true });
    }
  }, [anchor, pinned, keyboard, recipeHelp]);

  const name = title || anchor?.getAttribute('aria-label') || text.items;
  return (
    <div className="item-tooltip" role={pinned ? 'dialog' : 'tooltip'} id={id} ref={tooltip} hidden={!anchor}
      popover={pinned ? 'manual' : undefined} data-pinned={pinned || undefined} tabIndex={pinned ? -1 : undefined}
      aria-labelledby={pinned ? id + '-title' : undefined}>
      {pinned ? <>
        <div className="item-tooltip-header" ref={header}>
          <strong id={id + '-title'}><MinecraftItemText text={name} /></strong>
          <div className="item-tooltip-header-actions">
            {target?.recipeHelp && <RecipeGestureHelp id={id + '-recipe-help'} />}
            <button type="button" className="item-action item-tooltip-close" onClick={close} aria-label={text.close}>×</button>
          </div>
        </div>
        <div className="item-tooltip-scroll" ref={scroll}>
          {(!!target?.actions?.length || extraActions) && <div className="item-tooltip-actions">
            {target?.actions?.map(({ label, run }, index) => <button className="item-action" type="button"
              data-primary={index === 0 || undefined} key={label} onClick={run}>
              <span>{label}</span>
            </button>)}
            {extraActions}
          </div>}
          <div className="item-tooltip-content">{children}</div>
          {modes}
        </div>
      </> : children}
    </div>
  );
}
