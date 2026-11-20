import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { loadItemDetails, loadItemPayload, type CatalogItem, type ItemPayloads } from './catalogData';
import { ItemLoadingHint } from './ItemLoadingHint';
import type { TooltipModes, TooltipShortcut } from './ItemTooltipTools';

type TextSpan = Record<string, unknown> & { text: string };
type TooltipAlternative = TooltipShortcut & { lines: TextSpan[][] };
type TooltipContentProps = { item: CatalogItem; modes: TooltipModes; data: ReturnType<typeof useItemTooltip> };
const shortcutCache = new Map<string, TooltipShortcut[]>();
const shortcutRequestLimit = 6;

function isTextSpan(span: unknown): span is TextSpan {
  return !!span && typeof span === 'object' && 'text' in span && typeof span.text === 'string';
}

function readTooltipLines(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('lines' in payload) || !Array.isArray(payload.lines)) return;
  const lines = payload.lines.filter(Array.isArray).map(line => line.filter(isTextSpan));
  if (lines.some(line => line.some(span => span.text.trim()))) return lines;
}

function readAlternatives(payload: unknown): TooltipAlternative[] {
  if (!payload || typeof payload !== 'object' || !('alternatives' in payload) || !Array.isArray(payload.alternatives)) return [];
  const alternatives = new Map<string, TooltipAlternative>();
  for (const entry of payload.alternatives) {
    if (!entry || typeof entry !== 'object') continue;
    const { keys, label } = entry;
    if (!Array.isArray(keys) || !keys.length || !keys.every(key => typeof key === 'string' && /^key\.[a-z0-9_.-]+$/.test(key))
        || typeof label !== 'string' || !label.trim()) continue;
    const lines = readTooltipLines(entry);
    if (!lines) continue;
    const id = [...new Set(keys)].sort().join('+');
    if (!alternatives.has(id)) alternatives.set(id, { id, label, lines });
  }
  return [...alternatives.values()];
}

export async function loadPageTooltipShortcuts(items: readonly CatalogItem[], signal: AbortSignal) {
  const detailed = items.filter(item => item.detail);
  const pendingPayloads = new Map<string, Promise<TooltipShortcut[]>>();
  const byPosition: TooltipShortcut[][] = [];
  let next = 0;

  async function readItems() {
    while (next < detailed.length && !signal.aborted) {
      const position = next++;
      try {
        const url = (await loadItemDetails(detailed[position])).payloads?.tooltip;
        if (!url || signal.aborted) continue;
        const cached = shortcutCache.get(url);
        if (cached) {
          byPosition[position] = cached;
          continue;
        }
        let request = pendingPayloads.get(url);
        if (!request) {
          request = loadItemPayload(url, signal).then(payload => {
            const shortcuts = readAlternatives(payload).map(({ id, label }) => ({ id, label }));
            shortcutCache.set(url, shortcuts);
            return shortcuts;
          });
          pendingPayloads.set(url, request);
        }
        byPosition[position] = await request;
      } catch {
        // Other items can still supply shortcuts when a resource fails.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(shortcutRequestLimit, detailed.length) }, readItems));
  const shortcuts = new Map<string, TooltipShortcut & { itemIds: Set<string> }>();
  for (const [position, item] of detailed.entries()) {
    for (const shortcut of byPosition[position] ?? []) {
      const known = shortcuts.get(shortcut.id);
      if (known) known.itemIds.add(item.id);
      else shortcuts.set(shortcut.id, { ...shortcut, itemIds: new Set([item.id]) });
    }
  }
  return [...shortcuts.values()];
}

function readComponents(stack: unknown) {
  if (!stack || typeof stack !== 'object' || !('components' in stack)) return;
  const { components } = stack;
  if (components && typeof components === 'object' && !Array.isArray(components)) return components as Record<string, unknown>;
}

function spanStyle(span: TextSpan): CSSProperties {
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

export function useItemTooltip(item: CatalogItem | undefined, payloads?: ItemPayloads | null) {
  const [loaded, setLoaded] = useState<{ item: CatalogItem; sources: ItemPayloads | null }>();

  useEffect(() => {
    if (payloads !== undefined || !item?.detail) return;
    let active = true;
    void loadItemDetails(item).then(
      details => { if (active) setLoaded({ item, sources: details.payloads ?? null }); },
      () => { if (active) setLoaded({ item, sources: null }); },
    );
    return () => { active = false; };
  }, [item, payloads]);

  const sources = payloads === undefined && item?.detail ? (loaded?.item === item ? loaded.sources : undefined) : payloads ?? null;
  const payload = usePayload(sources?.tooltip);
  const lines = useMemo(() => readTooltipLines(payload), [payload]);
  const shortcuts = useMemo(() => readAlternatives(payload), [payload]);
  return { lines, shortcuts, stackUrl: sources?.stack, loading: sources === undefined || payload === undefined };
}

function ItemTooltipContent({ item, modes, data }: TooltipContentProps) {
  const { language, text } = usePreferences();
  const stack = usePayload(modes.advanced ? data.stackUrl : undefined);
  const loading = data.loading || stack === undefined;
  const lines = data.shortcuts.find(shortcut => shortcut.id === modes.shortcut)?.lines ?? data.lines;
  const components = modes.advanced ? readComponents(stack) : undefined;
  const max = components?.['minecraft:max_damage'];
  const damage = components?.['minecraft:damage'] ?? 0;
  const format = new Intl.NumberFormat(language);

  return <>
    {lines ? <div className="item-tooltip-lines">
      {lines.map((line, index) => (
        <div key={index}>{line.length === 0 ? '\u00a0' : line.map((span, position) => (
          <span key={position} style={spanStyle(span)} data-obfuscated={span.obfuscated === true || undefined}>{span.text}</span>
        ))}</div>
      ))}
    </div> : <strong>{item.name}</strong>}
    {item.fluidId && <div>{text.itemFluid}</div>}
    {loading && !item.fluidId && <ItemLoadingHint label={text.itemTooltipLoading} />}
    {modes.advanced && <div className="item-tooltip-meta">
      {typeof max === 'number' && Number.isSafeInteger(max) && max > 0 && typeof damage === 'number'
        && Number.isSafeInteger(damage) && damage >= 0 && damage <= max
        && <div>{text.itemTooltipDurability(format.format(max - damage), format.format(max))}</div>}
      <code>{item.fluidId ?? item.id}</code>
    </div>}
  </>;
}

type TooltipPopoverProps = { id: string; anchor?: HTMLElement; onDismiss: (anchor: HTMLElement) => void };

export function ItemTooltip({ id, item, anchor, modes, data, onDismiss }: Omit<TooltipContentProps, 'item'> & TooltipPopoverProps & {
  item?: CatalogItem;
}) {
  return <ItemTooltipPopover id={id} anchor={anchor} onDismiss={onDismiss}>
    {item && <ItemTooltipContent item={item} modes={modes} data={data} />}
  </ItemTooltipPopover>;
}

export function ItemTooltipPopover({ id, anchor, onDismiss, children }: TooltipPopoverProps & { children: ReactNode }) {
  const tooltip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const dismissOutside = ({ target }: PointerEvent) => {
      if (target instanceof Element && !anchor.contains(target) && !target.closest('.item-tooltip-tools')) {
        onDismiss(anchor);
      }
    };
    function dismissOnOtherSlot(event: PointerEvent) {
      if (event.pointerType !== 'touch' && event.target instanceof Element && event.target.closest('.item-slot-button')) {
        dismissOutside(event);
      }
    }
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('pointerover', dismissOnOtherSlot, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('pointerover', dismissOnOtherSlot, true);
    };
  }, [anchor, onDismiss]);

  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!element || !anchor) return;

    const position = () => {
      const edge = 8;
      const gap = 6;
      const bounds = anchor.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      const left = bounds.left + (bounds.width - width) / 2;
      const above = bounds.top - height - gap;
      const below = bounds.bottom + gap;
      const top = above >= edge || bounds.top >= window.innerHeight - bounds.bottom ? above : below;
      element.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      element.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`;
    };

    position();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
    observer?.observe(element);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [anchor]);

  return (
    <div className="item-tooltip" role="tooltip" id={id} ref={tooltip} hidden={!anchor}>
      {children}
    </div>
  );
}
