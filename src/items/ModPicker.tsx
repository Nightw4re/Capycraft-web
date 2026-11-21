import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { useHeaderDisclosure } from '../scene/useHeaderDisclosure';
import { searchText } from './catalogIndex.mjs';

function modSearchText(text: string) {
  return searchText(text).replace(/\s+/g, '');
}

export function ModPicker({ mods, value, onChange }: {
  mods: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { text } = usePreferences();
  const { open, setOpen, root, onBlur } = useHeaderDisclosure();
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState<string>();
  const selected = value || text.itemAllMods;
  const options = useMemo(() => [
    { value: '', label: text.itemAllMods },
    ...mods.map(mod => ({ value: mod, label: mod })),
  ].map(option => ({ ...option, search: modSearchText(option.label) })), [mods, text.itemAllMods]);
  const matches = useMemo(() => {
    const term = modSearchText(query);
    return term ? options.filter(option => option.search.includes(term)) : options;
  }, [options, query]);
  const activeIndex = matches.length ? Math.max(0, matches.findIndex(option => option.value === highlighted)) : -1;
  const activeId = open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  useLayoutEffect(() => {
    if (!open) {
      if (document.activeElement === input.current) input.current?.select();
      return;
    }
    if (!activeId || !popup.current) return;
    const activeOption = document.getElementById(activeId);
    if (!activeOption) return;
    const bounds = activeOption.getBoundingClientRect();
    const visible = popup.current.getBoundingClientRect();
    if (bounds.top < visible.top) popup.current.scrollTop += bounds.top - visible.top;
    else if (bounds.bottom > visible.bottom) popup.current.scrollTop += bounds.bottom - visible.bottom;
  }, [activeId, matches, open]);

  function openList() {
    setQuery('');
    setHighlighted(value);
    setOpen(true);
  }

  function choose(mod: string) {
    onChange(mod);
    input.current?.focus();
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      input.current?.focus({ preventScroll: true });
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = matches[Math.max(0, Math.min(matches.length - 1, activeIndex + direction))];
      if (next) setHighlighted(next.value);
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      choose(matches[activeIndex].value);
    }
  }

  return (
    <div className="item-picker">
      <span>{text.itemMod}</span>
      <div className="header-picker item-mod-combobox" ref={root} onBlur={onBlur}>
        <div className="header-picker-trigger" data-expanded={open || undefined}>
          <input className="item-mod-input" ref={input} type="text" role="combobox"
            aria-label={text.itemMod} aria-autocomplete="list" aria-expanded={open}
            aria-controls={open ? listId : undefined} aria-activedescendant={activeId}
            autoComplete="off" spellCheck={false} value={open ? query : selected}
            placeholder={selected}
            onFocus={() => { if (!open) openList(); }}
            onClick={() => { if (!open) openList(); }}
            onChange={event => {
              setQuery(event.currentTarget.value);
              setHighlighted(undefined);
              setOpen(true);
            }}
            onKeyDown={onKeyDown} />
          <button className="item-mod-toggle" type="button" tabIndex={-1} aria-label={text.itemModList}
            aria-expanded={open} aria-controls={open ? listId : undefined}
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              input.current?.focus();
              if (open) setOpen(false);
              else openList();
            }}>
            <span className="header-picker-arrow" aria-hidden="true" />
          </button>
        </div>
        {open && (
          <div className="header-picker-options header-popup" ref={popup} tabIndex={-1} onKeyDown={onKeyDown}
            onPointerDown={event => {
              if (event.target === event.currentTarget) event.currentTarget.focus({ preventScroll: true });
            }}>
            <div className="item-mod-options" id={listId} role="listbox" aria-label={text.itemModList}>
              {matches.map((option, index) => (
                <button key={option.value} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1}
                  aria-selected={option.value === value} data-highlighted={index === activeIndex || undefined}
                  onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            {!matches.length && <p className="item-mod-empty" role="status">{text.itemModsNoMatch}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
