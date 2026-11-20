import type { CSSProperties } from 'react';
import { usePreferences } from '../PreferencesProvider';

export type TooltipShortcut = { id: string; label: string };
export type TooltipModes = { advanced: true; shortcut?: undefined } | { advanced: false; shortcut?: string };

const shortcutColors = new Map([
  ['key.keyboard.left.control', '#5edcff'],
  ['key.keyboard.left.control+key.keyboard.left.shift', '#f78bd6'],
  ['key.keyboard.left.shift', '#8bee99'],
  ['key.keyboard.left.alt', '#ff9b68'],
  ['key.keyboard.left.alt+key.keyboard.left.control', '#ae9bff'],
  ['key.keyboard.left.alt+key.keyboard.left.shift', '#ff868b'],
  ['key.keyboard.left.alt+key.keyboard.left.control+key.keyboard.left.shift', '#98efdc'],
]);

export function tooltipShortcutColor(id: string) {
  const color = shortcutColors.get(id);
  if (color) return color;
  let hash = 0;
  for (const char of id) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  return `oklch(80% 0.16 ${(hash >>> 0) % 360})`;
}

function shortcutStyle(id: string) {
  return { '--item-shortcut-color': tooltipShortcutColor(id) } as CSSProperties;
}

export function ItemTooltipTools({ modes, onChange, shortcuts = [] }: {
  modes: TooltipModes;
  onChange: (modes: TooltipModes) => void;
  shortcuts?: readonly TooltipShortcut[];
}) {
  const { text } = usePreferences();

  return (
    <div className="item-tooltip-tools" role="group" aria-label={text.itemTooltipModes}>
      <button type="button" className="item-action" aria-pressed={modes.advanced} title={text.itemTooltipAdvanced}
        onClick={() => onChange({ advanced: !modes.advanced })}>F3 + H</button>
      {shortcuts.map(({ id, label }) => (
        <button key={id} type="button" className="item-action item-tooltip-alternative"
          aria-pressed={modes.shortcut === id} style={shortcutStyle(id)}
          onClick={() => onChange({ advanced: false, shortcut: modes.shortcut === id ? undefined : id })}>{label}</button>
      ))}
    </div>
  );
}
