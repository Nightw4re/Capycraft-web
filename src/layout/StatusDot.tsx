import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ServerStatus } from '../serverDirectoryTypes';
import './server-card.css';

export function ServerStatusIndicator({ status }: { status: ServerStatus }) {
  return <span className="server-status-dot" data-status={status} aria-hidden="true" />;
}

export function StatusDot({ status, label, statusText, details }: {
  status: ServerStatus;
  label: string;
  statusText: string;
  details?: ReactNode;
}) {
  const statusId = useId();
  const [statusHint, setStatusHint] = useState<'hover' | 'focus' | 'pinned'>();
  const statusTooltip = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const tooltip = statusTooltip.current;
    const anchor = tooltip?.parentElement;
    if (!statusHint || !tooltip || !anchor) return;

    const positionTooltip = () => {
      const edge = 8;
      const bounds = anchor.getBoundingClientRect();
      const width = tooltip.offsetWidth;
      const centered = bounds.left + (bounds.width - width) / 2;
      const left = Math.max(edge, Math.min(centered, document.documentElement.clientWidth - width - edge));
      tooltip.style.left = `${left - bounds.left}px`;
      tooltip.dataset.placement = bounds.top >= tooltip.offsetHeight + edge ? 'above' : 'below';
    };

    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  }, [details, statusHint, statusText]);

  return <div className="server-card-status"
    onPointerEnter={event => {
      if (event.pointerType === 'mouse') setStatusHint(current => current ?? 'hover');
    }}
    onPointerLeave={() => setStatusHint(current => current === 'hover' ? undefined : current)}>
    <button className="server-card-status-button" type="button" data-status={status}
      aria-label={label} aria-describedby={statusId}
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) setStatusHint('focus');
      }}
      onBlur={() => setStatusHint(current => current === 'hover' ? current : undefined)}
      onClick={() => setStatusHint(current => current === 'pinned' ? undefined : 'pinned')}
      onKeyDown={event => {
        if (event.key === 'Escape' && statusHint) {
          event.stopPropagation();
          setStatusHint(undefined);
        }
      }}>
      <ServerStatusIndicator status={status} />
    </button>
    <span className="server-card-status-tooltip" id={statusId} ref={statusTooltip} role="tooltip" hidden={!statusHint}>
      {statusText}
      {details && <span className="server-card-last-seen">{details}</span>}
    </span>
  </div>;
}
