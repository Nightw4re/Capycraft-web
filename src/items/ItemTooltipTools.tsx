import { usePreferences } from '../PreferencesProvider';
import type { TooltipShortcut } from './catalogIndex.mjs';

export function ItemTooltipTools({ advanced, shortcut, shortcuts, onAdvanced, onShortcut }: {
  advanced: boolean;
  shortcut?: string;
  shortcuts: readonly TooltipShortcut[];
  onAdvanced: () => void;
  onShortcut: (id: string) => void;
}) {
  const { text } = usePreferences();
  return <div className="item-tooltip-modes" role="group" aria-label={text.itemTooltipModes}>
    <button className="item-action" type="button" aria-pressed={advanced} onClick={onAdvanced}>
      <span>{text.itemTooltipAdvanced}</span><kbd>F3 + H</kbd>
    </button>
    {shortcuts.map(({ id, label }) => <button className="item-action" type="button"
      key={id} aria-pressed={shortcut === id} onClick={() => onShortcut(id)}>{label}</button>)}
  </div>;
}
