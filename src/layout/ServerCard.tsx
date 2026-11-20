import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import copyIcon from '../../assets/pixel-copy-papers.png';
import { useNotifications } from '../notifications/Notifications';
import { usePreferences } from '../PreferencesProvider';
import type { Language } from '../preferences';
import type { ServerStatus } from '../serverDirectoryTypes';
import { parseMinecraftMotd } from './minecraftMotd';
import './server-card.css';

export type MinecraftServer = {
  name: string;
  alias?: string;
  logo?: string;
  motd?: string;
  address?: string;
  players?: { current?: number; max?: number };
  uptimeMinutes?: number;
  totalUptimeMinutes?: number;
  worldAgeDays?: number;
  worldAgeMinutes?: number;
  status?: ServerStatus;
  lastSeenAt?: number;
  modpack?: string;
};

const unavailableStat = '—';

function formatDuration(minutes: number, language: Language) {
  const parts = [
    { unit: 'day', value: Math.floor(minutes / 1440) },
    { unit: 'hour', value: Math.floor(minutes / 60) % 24 },
    { unit: 'minute', value: minutes % 60 },
  ];
  const visible = minutes < 60 ? parts.slice(1) : parts.filter(({ value }) => value > 0).slice(0, 2);
  return visible
    .map(({ unit, value }) => new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value))
    .join(' ');
}

export function ServerCard({ server }: { server: MinecraftServer }) {
  const { language, text } = usePreferences();
  const { address, motd, name, players, uptimeMinutes, totalUptimeMinutes, worldAgeDays, worldAgeMinutes,
    status, lastSeenAt, modpack } = server;
  const nameId = useId();
  const statusId = useId();
  const [statusHint, setStatusHint] = useState<'hover' | 'focus' | 'pinned'>();
  const statusTooltip = useRef<HTMLSpanElement>(null);
  const statusText = status && text.serverStatus[status];
  const notify = useNotifications();
  const formatNumber = new Intl.NumberFormat(language);
  const copyLabel = text.copyServerAddress(name);
  const motdParts = motd ? parseMinecraftMotd(motd) : [];
  const logo = server.logo && <img className="server-card-logo-art" src={server.logo} width={44} height={44} alt="" loading="lazy" />;
  const lastSeen = lastSeenAt !== undefined && (status === 'offline' || status === 'unavailable') ? new Date(lastSeenAt) : undefined;
  const worldAge = worldAgeDays !== undefined
    ? new Intl.NumberFormat(language, { style: 'unit', unit: 'day', unitDisplay: 'narrow' }).format(worldAgeDays)
    : worldAgeMinutes === undefined ? undefined : formatDuration(worldAgeMinutes, language);

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
  }, [language, lastSeenAt, name, statusHint, statusText]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      notify(text.addressCopied(address), 'success');
    } catch {
      notify(text.addressCopyFailed, 'error');
    }
  }

  return (
    <article className="server-card" aria-labelledby={nameId}>
      <div className="server-card-header">
        {logo && (address ? (
          <button className="server-card-logo" type="button" aria-label={copyLabel} title={copyLabel} onClick={copyAddress}>
            {logo}
            <span className="server-card-logo-copy" aria-hidden="true">
              <img src={copyIcon} width={24} height={24} alt="" loading="lazy" />
            </span>
          </button>
        ) : <span className="server-card-logo">{logo}</span>)}
        <div>
          <div className="server-card-title">
            <h3 id={nameId}>{name}</h3>
            {status && <div className="server-card-status"
              onPointerEnter={event => {
                if (event.pointerType === 'mouse') setStatusHint(current => current ?? 'hover');
              }}
              onPointerLeave={() => setStatusHint(current => current === 'hover' ? undefined : current)}>
              <button className="server-card-status-button" type="button" data-status={status}
                aria-label={text.serverStatusLabel} aria-describedby={statusId}
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
                }} />
              <span className="server-card-status-tooltip" id={statusId} ref={statusTooltip} role="tooltip" hidden={!statusHint}>
                {statusText}
                {lastSeen && <span className="server-card-last-seen">{text.serverLastSeen}{' '}
                  <time dateTime={lastSeen.toISOString()}>{new Intl.DateTimeFormat(language, {
                    dateStyle: 'short', timeStyle: 'short',
                  }).format(lastSeen)}</time>
                </span>}
              </span>
            </div>}
          </div>
          {motdParts.some(part => part.text.trim()) && <p className="server-card-motd">
            {motdParts.map(part => <span key={part.start} style={part.style}>{part.text}</span>)}
          </p>}
          {modpack && <p className="server-card-modpack"><span>{text.serverModpack}</span> {modpack}</p>}
        </div>
      </div>

      <dl className="server-card-stats">
        <div>
          <dt>{text.serverPlayers}</dt>
          <dd>{players?.current === undefined ? unavailableStat : formatNumber.format(players.current)}
            {players?.max !== undefined && ` / ${formatNumber.format(players.max)}`}</dd>
        </div>
        <div>
          <dt>{text.serverUptime}</dt>
          <dd>{uptimeMinutes === undefined ? unavailableStat : formatDuration(uptimeMinutes, language)}</dd>
        </div>
        <div>
          <dt>{text.serverTotalUptime}</dt>
          <dd>{totalUptimeMinutes === undefined ? unavailableStat : formatDuration(totalUptimeMinutes, language)}</dd>
        </div>
        {worldAge !== undefined && <div>
          <dt>{text.serverWorldAge}</dt>
          <dd>{worldAge}</dd>
        </div>}
      </dl>

      {address && <div className="server-card-connection" role="group" aria-labelledby={nameId + '-address'}>
        <span className="server-card-address-label" id={nameId + '-address'}>{text.serverAddress}</span>
        <div className="server-card-address">
          <code dir="ltr">
            <span>{address.split(/(?<=[.:])/).map((part, index) => (
              <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>
            ))}</span>
          </code>
          <button className="server-card-copy" type="button" aria-label={copyLabel} title={copyLabel} onClick={copyAddress}>
            <img src={copyIcon} width={24} height={24} alt="" loading="lazy" />
          </button>
        </div>
      </div>}
    </article>
  );
}
