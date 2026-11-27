import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { languageOptions } from '../preferences';
import type { ServerStatus } from '../serverDirectoryTypes';
import { ServerStatusIndicator } from '../layout/StatusDot';
import { useHeaderDisclosure } from './useHeaderDisclosure';

type Option<Value extends string> = {
  value: Value;
  label: string;
  lang?: string;
  flag?: typeof languageOptions[number]['flag'];
  swatchColor?: string;
  iconSrc?: string;
  status?: { value: ServerStatus; label: string };
  placeholder?: boolean;
};

type HeaderPickerProps<Value extends string> = {
  label: string;
  value: Value;
  options: readonly Option<Value>[];
  swatches?: boolean;
  disabled?: boolean;
  onChange: (value: Value) => void;
};

export function HeaderPicker<Value extends string>({ label, value, options, swatches = false, disabled = false,
  onChange }: HeaderPickerProps<Value>) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const { open, setOpen, root, trigger, closeAndFocus, onBlur, onKeyDown } = useHeaderDisclosure();
  const selected = options.find(option => option.value === value);
  const selectedLabel = selected?.status ? `${selected.label} (${selected.status.label})` : selected?.label;
  const triggerLabel = selectedLabel ? `${label}: ${selectedLabel}` : label;

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled, setOpen]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      closeAndFocus();
      return;
    }

    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const position = buttons.findIndex(button => button === document.activeElement);
    const row = swatches ? Number(getComputedStyle(event.currentTarget).getPropertyValue('--swatch-columns')) : 1;
    const positions: Record<string, number> = {
      ArrowDown: position + row,
      ArrowUp: position - row,
      ArrowRight: position + 1,
      ArrowLeft: position - 1,
      Home: 0,
      End: buttons.length - 1,
    };
    const next = positions[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
  }

  return (
    <div className="header-picker" data-swatches={swatches} ref={root} onBlur={onBlur} onKeyDown={onKeyDown}>
      <button
        className="header-picker-trigger"
        data-compact={swatches || Boolean(selected?.flag)}
        type="button"
        ref={trigger}
        disabled={disabled}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        title={triggerLabel}
        onClick={() => setOpen(!open)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {swatches ? (
          <span className="header-color-swatch" style={{ backgroundColor: selected?.swatchColor }} aria-hidden="true" />
        ) : selected?.flag ? (
          <span className="header-language-flag" data-flag={selected.flag} aria-hidden="true" />
        ) : (
          <>
            {selected?.status && <ServerStatusIndicator status={selected.status.value} />}
            {selected?.iconSrc && <img className="header-picker-option-icon" src={selected.iconSrc} alt="" width={20} height={20} />}
            <span className="header-picker-label" lang={selected?.lang}>{selected?.label}</span>
          </>
        )}
        <span className="header-picker-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className="header-picker-options header-popup" id={id} ref={list} role="listbox" aria-label={label} onKeyDown={moveFocus}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              data-placeholder={option.placeholder || undefined}
              aria-selected={option.value === value}
              aria-label={swatches ? option.label : option.status ? `${option.label} (${option.status.label})` : undefined}
              lang={option.lang}
              title={swatches ? option.label : option.status?.label}
              tabIndex={-1}
              onClick={() => { onChange(option.value); closeAndFocus(); }}
            >
              {swatches ? (
                <span className="header-color-swatch" style={{ backgroundColor: option.swatchColor }} aria-hidden="true" />
              ) : (
                <>
                  {option.flag && <span className="header-language-flag" data-flag={option.flag} aria-hidden="true" />}
                  {option.status && <ServerStatusIndicator status={option.status.value} />}
                  {option.iconSrc && <img className="header-picker-option-icon" src={option.iconSrc} alt="" width={20} height={20} />}
                  {option.placeholder && <span aria-hidden="true">›</span>}
                  {option.label}
                  {option.placeholder && <span aria-hidden="true">‹</span>}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
