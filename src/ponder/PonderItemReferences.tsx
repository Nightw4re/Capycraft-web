import { useId, useState } from 'react';
import { ItemIcon, ItemLink, type TooltipTarget } from '../items/ItemCatalog';
import { ItemTooltip, MinecraftItemText } from '../items/ItemTooltip';
import type { CatalogItem } from '../items/catalogData';
import type { ItemRecipeView } from '../navigation';
import { useProgressItems } from '../players/useProgressIcons';
import { usePreferences } from '../PreferencesProvider';

export type PonderItemNavigation = {
  server: string;
  itemOpen: boolean;
  itemHref: (id: string) => string;
  onOpenItem: (id: string, view?: ItemRecipeView) => void;
};

export function PonderItemReferences({ ids, navigation, fallbackName }: {
  ids: readonly string[]; navigation?: PonderItemNavigation; fallbackName?: string;
}) {
  const { text } = usePreferences();
  const refs = [...new Set(ids)];
  const previews = useProgressItems(navigation?.server, refs.map(itemId => ({ itemId })));
  const tooltipId = useId();
  const [hovered, setHovered] = useState<{ item: CatalogItem; target: TooltipTarget }>();
  const activeTooltip = hovered && !navigation?.itemOpen && refs.includes(hovered.item.id)
    && previews?.items?.get(hovered.item.id) === hovered.item ? hovered : undefined;

  function hideTooltip(anchor?: HTMLElement) {
    setHovered(current => !anchor || current?.target.anchor === anchor ? undefined : current);
  }

  return <>
    <ul className="ponder-item-references" role="list" aria-label={text.items}>
      {refs.map(id => {
        const item = previews?.items?.get(id);
        return <li key={id}>{item && navigation
          ? <ItemLink className="ponder-item-reference" item={item} itemHref={navigation.itemHref}
            onOpenItem={navigation.onOpenItem} showTooltip={(item, target) => setHovered({ item, target })}
            hideTooltip={hideTooltip} description={activeTooltip && { ...activeTooltip.target, id: tooltipId }}>
            {(item.icon || item.sprite) && <ItemIcon icon={item.icon} sprite={item.sprite} />}
            <span><MinecraftItemText text={item.name} /></span>
          </ItemLink>
          : <>{fallbackName && <strong>{fallbackName}</strong>}<code>{id}</code></>}</li>;
      })}
    </ul>
    {activeTooltip && <ItemTooltip id={tooltipId} target={activeTooltip.target} item={activeTooltip.item}
      onDismiss={hideTooltip} />}
  </>;
}
