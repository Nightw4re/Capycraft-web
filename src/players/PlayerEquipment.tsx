import { useEffect, useId, useState, type ReactNode } from 'react';
import { equipmentItemBar, equipmentSlots, hotbarSlots, inventorySlots, type EquipmentItem, type EquipmentLoadout } from '../equipment/contract.mts';
import { loadCatalog, type CatalogItem } from '../items/catalogData';
import { ItemTooltip } from '../items/ItemTooltip';
import { ItemIcon, ItemLink, type TooltipTarget } from '../items/ItemCatalog';
import type { ItemRecipeView } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { StandingPlayerPortrait } from '../portrait/StandingPlayerPortrait';
import { useHeaderDisclosure } from '../scene/useHeaderDisclosure';
import '../items/items.css';
import '../equipment/equipment-preview.css';

type EquipmentView = 'loadout' | 'inventory';
type EquipmentData = { loadout: EquipmentLoadout | null; items?: ReadonlyMap<string, CatalogItem> };

export function usePlayerEquipment(server: string, player: string, view: EquipmentView, enabled = true) {
  const query = new URLSearchParams({ server, player, equipment: view }).toString();
  const [result, setResult] = useState<EquipmentData & { query: string }>();
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/players?${query}`, { signal: request.signal });
        const data: EquipmentLoadout | null = response.ok ? await response.json() : null;
        const equipment = data?.slots && typeof data.slots === 'object' ? data : null;
        if (request.signal.aborted) return;
        setResult({ query, loadout: equipment });
        if (!equipment) return;
        const ids = new Set(Object.values(equipment.slots).flatMap(item => item ? [item.id] : []));
        if (!ids.size) return;
        const catalog = await loadCatalog(server, request.signal);
        const found = await catalog?.getItems(ids, request.signal);
        if (request.signal.aborted) return;
        setResult({ query, loadout: equipment, items: found });
      } catch {
        if (!request.signal.aborted) {
          setResult(current => current?.query === query ? current : { query, loadout: null });
        }
      }
    })();
    return () => request.abort();
  }, [server, query, enabled]);
  return result?.query === query ? result : undefined;
}

export type EquipmentItemNavigation = {
  itemHref: (id: string) => string;
  onOpenItem: (id: string, view?: ItemRecipeView) => void;
};

function EquipmentStatus({ messages }: { messages: string[] }) {
  const { text } = usePreferences();
  const id = useId();
  const { open, setOpen, root, trigger, onBlur, onKeyDown } = useHeaderDisclosure();

  return <div className="equipment-status" ref={root} onBlur={onBlur} onKeyDown={onKeyDown}>
    <button type="button" className="item-action" ref={trigger} aria-label={text.information} title={text.information}
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 9v5m0-8v1" />
      </svg>
    </button>
    {open && <div className="equipment-status-message header-popup" id={id} role="status">
      {messages.map(message => <p key={message}>{message}</p>)}
    </div>}
  </div>;
}

export function PlayerEquipment({ server, player, view, equipment, inventory, itemHref, onOpenItem }: EquipmentItemNavigation & {
  server: string; player: string; view: EquipmentView; equipment?: EquipmentData; inventory?: EquipmentData;
}) {
  const { text } = usePreferences();
  const data = view === 'loadout' ? equipment : inventory;
  const equippedSlots = equipment?.loadout?.slots;
  const selectedSlot = data?.loadout?.selectedSlot;
  const showSaved = data?.loadout?.savedAt !== undefined;
  const status = (source?: EquipmentData) => source ? text.playerEquipmentUnavailable : text.playerEquipmentLoading;
  const messages: string[] = [];
  if (showSaved) messages.push(text.playerInventorySaved);
  if (!data?.loadout) messages.push(status(data));
  if (!messages.length) messages.push(text.playerEquipmentCurrent);
  const renderSlot = (slot: string, slotLabel: string) => {
    const item = data?.loadout?.slots[slot];
    const catalogItem = item && data?.items?.get(item.id);
    const icon = item?.icon ?? catalogItem?.icon;
    const label = item ? `${slotLabel}: ${item.name}${item.count > 1 ? ` ×${item.count}` : ''}`
      : `${slotLabel}: ${data?.loadout ? text.playerEquipmentEmpty : status(data)}`;
    const selected = slot === String(selectedSlot) || undefined;
    return <li key={slot} data-selected={selected} data-hotbar={view === 'inventory' && hotbarSlots.includes(slot) || undefined}
      aria-current={selected}>
      {item ? <EquipmentItemSlot item={item} catalogItem={catalogItem || undefined} label={label}
        itemHref={itemHref} onOpenItem={onOpenItem}>
        <ItemIcon icon={icon} sprite={item.icon ? undefined : catalogItem?.sprite} />
        <EquipmentChargeBar bar={equipmentItemBar(item, catalogItem?.bar)} />
        {item.count > 1 && <small aria-hidden="true">{item.count}</small>}
      </EquipmentItemSlot> : <span className="equipment-icon-slot" title={label} role="img" aria-label={label} />}
    </li>;
  };

  return <>
    <div className="equipment-heading">
      <h2>{view === 'loadout' ? text.playerEquipment : text.playerInventory}</h2>
      <div className="equipment-heading-actions">
        <EquipmentStatus messages={messages} />
      </div>
    </div>
    {view === 'loadout' && <div className="equipment-loadout">
      <ul className="equipment-armor" role="list" aria-label={text.playerEquipment}>
        {equipmentSlots.slice(0, 4).map((slot, index) => renderSlot(slot, text.playerEquipmentSlots[index]))}
      </ul>
      <StandingPlayerPortrait key={player.toLowerCase()} name={player} server={server} slots={equippedSlots} />
      <ul className="equipment-hands" role="list" aria-label={text.playerEquipment}>
        {renderSlot('offhand', text.playerEquipmentSlots[5])}
      </ul>
    </div>}
    {view === 'inventory' && inventory?.loadout && <ul className="equipment-icon-grid" data-view={view} role="list" aria-label={text.playerInventory}>
      {inventorySlots.map(slot => renderSlot(slot, text.playerInventorySlot(Number(slot) + 1)))}
    </ul>}
  </>;
}

function EquipmentChargeBar({ bar }: { bar: ReturnType<typeof equipmentItemBar> }) {
  return bar && <span className="equipment-item-bar" aria-hidden="true"><span style={{
    inlineSize: `${bar.width / 13 * 100}%`, backgroundColor: `#${bar.color.toString(16).padStart(6, '0')}`,
  }} /></span>;
}

function EquipmentItemSlot({ item, catalogItem, label, children, itemHref, onOpenItem }: EquipmentItemNavigation & {
  item: EquipmentItem; catalogItem?: CatalogItem; label: string; children: ReactNode;
}) {
  const id = useId();
  const [target, setTarget] = useState<TooltipTarget>();
  function hideTooltip(anchor?: HTMLElement) {
    setTarget(current => !anchor || current?.anchor === anchor ? undefined : current);
  }
  function showUnlinkedTooltip(anchor: HTMLElement, pinned = false, keyboard = false) {
    if (pinned || !document.querySelector('.item-tooltip[data-pinned]')) setTarget({ anchor, triggerId: id, pinned, keyboard });
  }
  return <>
    {catalogItem ? <ItemLink className="equipment-icon-slot equipment-item-link" item={catalogItem} label={label}
      itemHref={itemHref} onOpenItem={onOpenItem} description={target && { ...target, id }}
      showTooltip={(_, next) => setTarget(next)} hideTooltip={hideTooltip}>{children}</ItemLink>
      : <button className="equipment-icon-slot equipment-item-link" type="button" aria-label={label}
        onPointerEnter={event => { if (event.pointerType !== 'touch') showUnlinkedTooltip(event.currentTarget); }}
        onPointerLeave={event => { if (event.pointerType !== 'touch' && !target?.pinned) hideTooltip(event.currentTarget); }}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) showUnlinkedTooltip(event.currentTarget); }}
        onBlur={event => { if (!target?.pinned) hideTooltip(event.currentTarget); }}
        onClick={event => showUnlinkedTooltip(event.currentTarget, true, event.detail === 0)}
        onKeyDown={event => { if (event.key === 'Escape') hideTooltip(event.currentTarget); }}
        aria-describedby={target && !target.pinned ? id : undefined}
        aria-expanded={!!target?.pinned} aria-controls={target?.pinned ? id : undefined}>{children}</button>}
    <ItemTooltip id={id} target={target} onDismiss={hideTooltip} stack={item} item={catalogItem} />
  </>;
}
