import { Fragment, useId, type ReactNode } from 'react';
import copyIcon from '../../assets/pixel-copy-papers.png';
import { useNotifications } from '../notifications/Notifications';
import { usePreferences } from '../PreferencesProvider';
import type { Language } from '../preferences';
import type { ServerPerformance, ServerStatus } from '../serverDirectoryTypes';
import { worldGameTimeTenthsOfDay } from '../directoryUpdates.mts';
import { parseMinecraftMotd } from './minecraftMotd';
import { followPageLink } from '../navigation';
import { StatusDot } from './StatusDot';
import './server-card.css';

export type MinecraftServer = {
  name: string;
  alias?: string;
  logo?: string;
  motd?: string;
  address?: string;
  players?: { current?: number; lastKnown?: number; max?: number };
  uptimeMinutes?: number;
  totalUptimeMinutes?: number;
  worldGameTimeTicks?: number;
  performance?: ServerPerformance;
  status?: ServerStatus;
  lastSeenAt?: number;
  modpack?: string;
};

const unavailableStat = '—';

const tickPerformanceHelp = {
  cs: 'MSPT je průměrný čas zpracování jednoho ticku. Hodnota p95 říká, že 95 % měřených ticků trvalo nejvýš tolik. Pro běžných 20 TPS má server 50 ms na každý tick.',
  en: 'MSPT is the average processing time per tick. The p95 is the time that 95% of sampled ticks took at most. At the standard 20 TPS, the server has 50 ms per tick.',
  de: 'MSPT ist die durchschnittliche Verarbeitungszeit pro Tick. 95 % der gemessenen Ticks dauerten höchstens so lange wie der p95-Wert. Bei 20 TPS stehen pro Tick 50 ms zur Verfügung.',
  es: 'MSPT es el tiempo medio de procesamiento por tick. El 95 % de los ticks medidos tardó como máximo el valor p95. A 20 TPS hay 50 ms disponibles por tick.',
  fr: 'Le MSPT mesure le temps de traitement moyen par tick. 95 % des ticks mesurés ont duré au plus la valeur p95. À 20 TPS, le serveur dispose de 50 ms par tick.',
  ja: 'MSPT は 1 ティックあたりの平均処理時間です。測定したティックの 95% は p95 の値以下でした。通常の 20 TPS では、1 ティックに使える時間は 50 ms です。',
  uk: 'MSPT — середній час обробки одного тіку. Тривалість 95 % виміряних тіків не перевищувала значення p95. За стандартних 20 TPS на один тік припадає 50 мс.',
} satisfies Record<Language, string>;

function formatDuration(value: number, language: Language) {
  const format = (amount: number, unit: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'narrow' }).format(amount);
  return value < 1440
    ? `${format(Math.floor(value / 60), 'hour')} ${format(value % 60, 'minute')}`
    : `${format(Math.floor(value / 1440), 'day')} ${format(Math.floor(value / 60) % 24, 'hour')}`;
}

export function ServerCard({ server, titleHref, active, children, compact = false }: {
  server: MinecraftServer; titleHref?: string; active?: boolean; children?: ReactNode; compact?: boolean;
}) {
  const { language, text } = usePreferences();
  const { address, motd, name, players, uptimeMinutes, totalUptimeMinutes, worldGameTimeTicks,
    performance, status, lastSeenAt, modpack } = server;
  const nameId = useId();
  const notify = useNotifications();
  const formatNumber = new Intl.NumberFormat(language);
  const formatMetric = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  const copyLabel = text.copyServerAddress(name);
  const motdParts = motd ? parseMinecraftMotd(motd) : [];
  const logo = server.logo && <img className="server-card-logo-art" src={server.logo} width={44} height={44} alt="" loading="lazy" />;
  const lastSeen = lastSeenAt !== undefined && (status === 'offline' || status === 'unavailable') ? new Date(lastSeenAt) : undefined;
  const displayedUptime = totalUptimeMinutes ?? uptimeMinutes;
  const displayedPlayers = players?.current ?? (compact ? undefined : players?.lastKnown);
  const Heading = compact ? 'h2' : 'h3';
  const worldGameDays = worldGameTimeTicks === undefined ? undefined
    : new Intl.NumberFormat(language, { style: 'unit', unit: 'day', unitDisplay: 'narrow', maximumFractionDigits: 1 })
      .format(worldGameTimeTenthsOfDay(worldGameTimeTicks) / 10);
  const showPerformance = !compact && status === 'ready' && performance
    && (performance.tps !== undefined || performance.mspt !== undefined || performance.msptP95 !== undefined);

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
    <article className="server-card" data-compact={compact || undefined} aria-labelledby={nameId}>
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
            {status && <StatusDot status={status} label={text.serverStatusLabel} statusText={text.serverStatus[status]}
              details={lastSeen && <>{text.serverLastSeen}{' '}
                <time dateTime={lastSeen.toISOString()}>{new Intl.DateTimeFormat(language, {
                  dateStyle: 'short', timeStyle: 'short',
                }).format(lastSeen)}</time>
              </>} />}
            <Heading id={nameId}>{titleHref
              ? <a href={titleHref} onClick={followPageLink} aria-current={active ? 'true' : undefined}>{name}</a>
              : name}</Heading>
          </div>
          {!compact && motdParts.some(part => part.text.trim()) && <p className="server-card-motd">
            {motdParts.map(part => <span key={part.start} style={part.style}>{part.text}</span>)}
          </p>}
          {!compact && modpack && <p className="server-card-modpack"><span>{text.serverModpack}</span> {modpack}</p>}
        </div>
      </div>

      <dl className="server-card-stats">
        <div>
          <dt>{text.serverPlayers}</dt>
          <dd>{displayedPlayers === undefined ? unavailableStat : formatNumber.format(displayedPlayers)}
            {players?.max !== undefined && ` / ${formatNumber.format(players.max)}`}</dd>
        </div>
        {!compact && <div>
          <dt>{totalUptimeMinutes === undefined ? text.serverUptime : text.serverTotalUptime}</dt>
          <dd>{displayedUptime === undefined ? unavailableStat : formatDuration(displayedUptime, language)}</dd>
        </div>}
        {!compact && worldGameDays !== undefined && <div>
          <dt>{text.serverWorldPlayTime}</dt>
          <dd>{worldGameDays}</dd>
        </div>}
      </dl>
      {showPerformance && <div className="server-card-performance">
        <dl className="server-card-stats">
          {performance.tps !== undefined && <div><dt>TPS</dt><dd>{formatMetric.format(performance.tps)}</dd></div>}
          {performance.mspt !== undefined && <div><dt>MSPT</dt><dd>{formatMetric.format(performance.mspt)} ms</dd></div>}
          {performance.msptP95 !== undefined && <div><dt>MSPT p95</dt><dd>{formatMetric.format(performance.msptP95)} ms</dd></div>}
        </dl>
        {(performance.mspt !== undefined || performance.msptP95 !== undefined) &&
          <details className="server-card-performance-help">
            <summary aria-label={`${text.information} · MSPT`}>?</summary>
            <p>{tickPerformanceHelp[language]}</p>
          </details>}
      </div>}

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
      {children}
    </article>
  );
}
