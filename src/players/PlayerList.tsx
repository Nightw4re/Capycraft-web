import { useEffect, useState, type ReactNode } from 'react';
import { InfoPanel } from '../layout/InfoPanel';
import { PageError } from '../layout/PageError';
import { PageLayout } from '../layout/PageLayout';
import { StatusDot } from '../layout/StatusDot';
import { usePreferences } from '../PreferencesProvider';
import { useOnlinePlayersSubscription, useServerDirectory } from '../ServerDirectoryProvider';
import { offlinePlayers, readOnlinePlayersState, type OnlinePlayer, type OnlinePlayersState, type PlayerPlayTime } from '../onlinePlayers.mts';
import { followPageLink, playerProfilePath, serverPath } from '../navigation';
import { achievementsPath } from '../achievements.mts';
import { questsPath } from '../quests.mts';
import { HeaderPicker } from '../scene/HeaderPicker';
import { fetchProfileProgress } from './PlayerProgressPage';
import './players.css';

function PlayTime({ minutes }: { minutes?: number }) {
  const { language, text } = usePreferences();
  if (minutes === undefined) return <span>{text.playerPlayTime} —</span>;
  const format = (value: number, unit: 'hour' | 'minute') =>
    new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
  const hours = Math.floor(minutes / 60);
  return <span>{text.playerPlayTime} {hours > 0 && `${format(hours, 'hour')} `}{format(minutes % 60, 'minute')}</span>;
}

type PlayerListState =
  | { status: 'loading' | 'error' }
  | { status: 'restricted'; code: 401 | 403 }
  | { status: 'ready'; names: string[] };

async function fetchPlayerList(server: string, signal: AbortSignal): Promise<PlayerListState> {
  const response = await fetch(`/api/players?${new URLSearchParams({ server, roster: '1' })}`, { signal });
  if (response.status === 401 || response.status === 403) {
    return { status: 'restricted', code: response.status };
  }
  if (!response.ok) throw new Error('The player list is unavailable.');

  const data: { players?: unknown } | null = await response.json();
  if (!Array.isArray(data?.players) || !data.players.every(name => typeof name === 'string')) {
    throw new Error('Invalid player list.');
  }
  return { status: 'ready', names: data.players };
}

export function PlayerHead({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const skin = `/api/players?${new URLSearchParams({ profile: '1', skin: name.toLowerCase() })}`;
  return (
    <span className="online-player-head" aria-hidden="true" data-loaded={loaded && !failed}>
      <span>{name.slice(0, 2).toUpperCase()}</span>
      {!failed && <>
        <img className="online-player-face" src={skin} alt="" loading="lazy"
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        <img className="online-player-hat" src={skin} alt="" loading="lazy" />
      </>}
    </span>
  );
}

function PlayerSignal({ pingMillis, compact = false }: { pingMillis: number; compact?: boolean }) {
  const { text, language } = usePreferences();
  const quality = pingMillis <= 75 ? 'good' : pingMillis <= 150 ? 'fair' : 'high';
  const qualityText = { good: text.playerPingGood, fair: text.playerPingFair, high: text.playerPingHigh }[quality];
  const ping = new Intl.NumberFormat(language).format(pingMillis);
  return <span className="online-player-latency" data-quality={quality} title={`${qualityText}, ${ping} ms`}>
    <span className="online-player-bars" aria-hidden="true"><i /><i /><i /></span>
    <span className={compact ? 'online-player-sr' : 'online-player-ping'}>{text.playerPing} {ping} ms · {qualityText}</span>
  </span>;
}

type PlayerEntry = OnlinePlayer | (Partial<PlayerPlayTime> & { name: string });

const modeIcons = { survival: '⚔', creative: '✦', adventure: '◆', spectator: '◉' };

function LastSeenTime({ timestamp }: { timestamp: number }) {
  const { language } = usePreferences();
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()}>
    {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(date)}
  </time>;
}

export function PlayerStatus({ player, live }: { player: PlayerEntry; live: boolean }) {
  const { text } = usePreferences();
  const online = 'pingMillis' in player;
  const lastSeen = online ? undefined : player.lastSeenAt;
  const status = online ? 'ready' : live ? 'offline' : 'unavailable';
  const label = online ? text.playerOnline : live ? text.playerOffline : text.serverStatus.unavailable;
  return <StatusDot status={status} label={label} statusText={label} details={lastSeen !== undefined && <>
    {text.playerLastSeen} <LastSeenTime timestamp={lastSeen} />
  </>} />;
}

function PlayerRow({ player, server, live, summary }: {
  player: PlayerEntry; server: string; live: boolean; summary?: ReactNode;
}) {
  return <li className="player-detail-row">
    <div className="player-detail-summary">
      <PlayerHead name={player.name} />
      <div className="player-detail-identity">
        <div className="player-name-status">
          <PlayerStatus player={player} live={live} />
          <a className="online-player-name" data-player={player.name.toLowerCase()}
            href={playerProfilePath(server, player.name)} onClick={followPageLink}>{player.name}{'pingMillis' in player && player.operator === true && ' (OP)'}</a>
        </div>
        {summary ?? <PlayTime minutes={player.playTimeMinutes} />}
      </div>
    </div>
  </li>;
}

export function PlayerDetails({ player }: { player: PlayerEntry }) {
  const { text, language } = usePreferences();
  const { playTimeMinutes } = player;
  const online = 'pingMillis' in player;
  const lastSeenAt = 'lastSeenAt' in player ? player.lastSeenAt : undefined;
  return <div className="online-player-details">
    {online && <PlayerSignal pingMillis={player.pingMillis} />}
    {player.gameMode && <span className="player-game-state">
      <span aria-hidden="true" title={text.playerGameModes[player.gameMode]}>{modeIcons[player.gameMode]}</span>
      {online ? text.playerGameMode : text.playerLastGameMode} {text.playerGameModes[player.gameMode]}
    </span>}
    {player.operator && <span>{online ? text.playerOperator : text.playerLastOperator}</span>}
    {player.seenCreative && <span>{text.playerSeenCreative}</span>}
    {online && player.maxHealth !== undefined &&
      <span>{text.playerMaxHealth} {new Intl.NumberFormat(language).format(player.maxHealth)}</span>}
    {playTimeMinutes !== undefined && <PlayTime minutes={playTimeMinutes} />}
    {!online && playTimeMinutes === undefined && lastSeenAt === undefined && <span>{text.playerStatsUnavailable}</span>}
  </div>;
}

function CompactPlayerRow({ player, server }: { player: OnlinePlayer; server: string }) {
  return <li className="compact-player-row">
    <a href={playerProfilePath(server, player.name)} onClick={followPageLink}>
      <PlayerHead name={player.name} />
      <span>{player.name}{player.operator === true && ' (OP)'}</span>
      <PlayerSignal pingMillis={player.pingMillis} compact />
    </a>
  </li>;
}

type RosterView = OnlinePlayersState | { status: 'denied'; code: 401 | 403 };

export function PlayerServerSelection() {
  const { text } = usePreferences();
  const { servers, loaded, unavailable } = useServerDirectory();
  const options = servers.filter(server => server.access !== 'pending' && server.tabs.includes('players'));
  const message = options.length > 0 ? text.playersSelectServer
    : unavailable ? text.serverOverviewUnavailable
    : loaded ? text.playersNoServers : text.serverOverviewLoading;

  return <PageLayout>
    <InfoPanel>
      <h1 className="page-layout-title">{text.players}</h1>
      <p>{message}</p>
      {options.length > 0 && <ul>
        {options.map(server => <li key={server.alias}>
          <a href={serverPath(server.alias, 'players')} onClick={followPageLink}>{server.name ?? server.alias}</a>
        </li>)}
      </ul>}
    </InfoPanel>
  </PageLayout>;
}

export function PlayerList({ server }: { server: string }) {
  return <PageLayout>
    <InfoPanel>
      <PlayerRoster server={server} />
    </InfoPanel>
  </PageLayout>;
}

export function usePlayerRoster(server: string, compact = false) {
  const { language } = usePreferences();
  const subscribe = useOnlinePlayersSubscription();
  const [state, setState] = useState<RosterView>({ status: 'loading' });
  const [history, setHistory] = useState<PlayerListState>({ status: 'loading' });

  useEffect(() => {
    if (compact) return;
    const request = new AbortController();
    void fetchPlayerList(server, request.signal).then(
      result => { if (!request.signal.aborted) setHistory(result); },
      () => { if (!request.signal.aborted) setHistory({ status: 'error' }); },
    );
    return () => request.abort();
  }, [compact, server, state.status]);

  useEffect(() => {
    const request = new AbortController();
    let receivedLive = false;
    let lastRosterAt: number | undefined;
    function applyBaseline(result: RosterView) {
      if (!request.signal.aborted && !receivedLive) setState(result);
    }
    void fetch(`/api/players?${new URLSearchParams({ server, online: '1' })}`, { signal: request.signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) {
          applyBaseline({ status: 'denied', code: response.status });
          return;
        }
        const roster = response.ok ? readOnlinePlayersState(await response.json()) : undefined;
        applyBaseline(roster ?? { status: 'unavailable' });
      })
      .catch(() => applyBaseline({ status: 'unavailable' }));
    const unsubscribe = subscribe(server, roster => {
      receivedLive = true;
      if (roster.status === 'ready') lastRosterAt = Date.now();
      setState(roster);
    }, () => {
      setState(current => {
        if (!receivedLive || (current.status !== 'ready' && current.status !== 'loading')) return current;
        const previousPlayers = [...current.previousPlayers ?? []];
        if (current.status === 'ready') {
          for (const { name, playTimeMinutes, gameMode, operator, seenCreative } of current.players) {
            if (playTimeMinutes !== undefined) previousPlayers.push({ name, playTimeMinutes, lastSeenAt: lastRosterAt,
              gameMode, operator, seenCreative });
          }
        }
        return { status: 'unavailable', previousPlayers };
      });
    });
    return () => {
      request.abort();
      unsubscribe();
    };
  }, [server, subscribe]);

  const players = state.status === 'ready' ? state.players : [];
  const previous = compact || state.status === 'denied' || state.status === 'restricted' ? [] : offlinePlayers(
    players, history.status === 'ready' ? history.names : [], state.previousPlayers ?? [], language,
  );
  return { state, history, players, previous };
}

type PlayerSort = 'lastSeen' | 'time' | 'achievements' | 'quests';
const progressPaths = { achievements: achievementsPath, quests: questsPath };

function PlayerDirectory({ server, entries, live, message }: {
  server: string; entries: PlayerEntry[]; live: boolean; message?: ReactNode;
}) {
  const { text, language } = usePreferences();
  const { servers } = useServerDirectory();
  const instance = servers.find(entry => entry.alias === server);
  const tabs = instance?.tabs;
  const options: { value: PlayerSort; label: string }[] = [
    { value: 'lastSeen', label: text.playerLastSeen.replace(/[:：]\s*$/, '') },
    { value: 'time', label: text.playerPlayTime.replace(/[:：]\s*$/, '') },
  ];
  if (tabs?.includes('achievements')) options.push({ value: 'achievements', label: text.achievements });
  if (tabs?.includes('quests')) options.push({ value: 'quests', label: text.quests });
  const [selectedSort, setSort] = useState<PlayerSort>('lastSeen');
  const sort = options.find(option => option.value === selectedSort)?.value ?? 'lastSeen';
  const path = sort === 'achievements' || sort === 'quests' ? progressPaths[sort] : undefined;
  const namesKey = [...entries.map(player => player.name.toLowerCase())].sort().join(',');
  const [progress, setProgress] = useState<{ key: string; counts: Map<string, number> }>();
  const key = JSON.stringify([server, path, namesKey]);

  useEffect(() => {
    if (!path) return;
    const request = new AbortController();
    const progressPath = path;
    const names = namesKey.split(',');
    const counts = new Map<string, number>();
    let next = 0;
    async function load() {
      while (!request.signal.aborted && next < names.length) {
        const name = names[next++];
        const result = await fetchProfileProgress(progressPath, server, name, request.signal);
        if (result.status === 'ready') counts.set(name, result.data.completed);
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, names.length) }, load)).then(() => {
      if (!request.signal.aborted) setProgress({ key, counts });
    });
    return () => request.abort();
  }, [key, namesKey, path, server]);

  const counts = progress?.key === key ? progress.counts : undefined;
  const collator = new Intl.Collator(language, { sensitivity: 'base' });
  const number = new Intl.NumberFormat(language);
  const current = instance?.playersOnline;
  const capacity = instance?.maxPlayers;
  const value = (player: PlayerEntry) => {
    if (sort === 'lastSeen') return 'pingMillis' in player ? Number.MAX_SAFE_INTEGER : player.lastSeenAt;
    if (sort === 'time') return player.playTimeMinutes;
    return counts?.get(player.name.toLowerCase());
  };
  const sorted = [...entries].sort((left, right) =>
    (value(right) ?? -1) - (value(left) ?? -1) || collator.compare(left.name, right.name));
  const progressLabel = sort === 'achievements' || sort === 'quests' ? text[sort] : undefined;

  return <>
    <div className="online-players-toolbar">
      <div className="online-players-heading">
        <h1 className="page-layout-title" tabIndex={-1}>{text.players}</h1>
        <div className="online-players-server">
          {instance && <StatusDot status={instance.status} label={text.serverStatusLabel}
            statusText={text.serverStatus[instance.status]} />}
          <span>{instance?.name ?? server}</span>
        </div>
      </div>
      <div className="online-players-summary">
        {current !== undefined && text.playerOnline}
        <span className="online-players-count">
          {current === undefined ? '—' : number.format(current)}
          {capacity !== undefined && ` / ${number.format(capacity)}`}
        </span>
      </div>
      {entries.length > 0 && <div className="player-directory-sort player-picker">
        <span>{text.playerSort}</span>
        <HeaderPicker label={text.playerSort} value={sort} options={options} onChange={setSort} />
      </div>}
    </div>
    {message}
    {entries.length > 0 && <ul className="online-players-grid" role="list" aria-label={text.players}>
      {sorted.map(player => {
        const count = counts?.get(player.name.toLowerCase());
        const lastSeenAt = 'lastSeenAt' in player ? player.lastSeenAt : undefined;
        let summary: ReactNode;
        if (sort === 'lastSeen') {
          summary = 'pingMillis' in player ? <span>{text.playerOnline}</span> : <span>
            {text.playerLastSeen} {lastSeenAt === undefined ? '—' : <LastSeenTime timestamp={lastSeenAt} />}
          </span>;
        } else if (progressLabel) {
          summary = <span>{progressLabel}: {count !== undefined ? number.format(count) : counts ? '—' : '…'}</span>;
        }
        return <PlayerRow key={player.name.toLowerCase()} player={player} server={server} live={live} summary={summary} />;
      })}
    </ul>}
  </>;
}

export function PlayerRoster({ server, compact = false }: { server: string; compact?: boolean }) {
  const { text } = usePreferences();
  const { state, history, players, previous } = usePlayerRoster(server, compact);

  if (state.status === 'denied' || history.status === 'restricted') {
    const code = state.status === 'denied' ? state.code : history.status === 'restricted' ? history.code : 403;
    return compact ? <p role="status">{text.onlinePlayersRestricted}</p> : <PageError code={code} />;
  }
  const message = {
    loading: text.playersLoading,
    offline: text.onlinePlayersOffline,
    unavailable: text.onlinePlayersUnavailable,
    restricted: text.onlinePlayersRestricted,
    ready: text.onlinePlayersEmpty,
    disabled: compact ? text.onlinePlayersUnavailable : history.status === 'loading' ? text.playersLoading
      : history.status === 'error' ? text.playersLoadError : text.playersEmpty,
  }[state.status];

  const hasRows = players.length > 0 || previous.length > 0;
  const notice = (state.status !== 'ready' && state.status !== 'disabled' || !hasRows)
    ? <p className="online-players-message" role="status" data-state={state.status}>{message}</p> : undefined;
  return <div className="online-players" data-compact={compact}>
    {compact ? <>
      {notice}
      {hasRows && <div className="players-scroll" tabIndex={0} role="region" aria-label={text.onlinePlayers}>
        <ul className="online-players-grid" role="list" aria-label={text.onlinePlayers}>
          {players.map(player => <CompactPlayerRow key={player.name.toLowerCase()} player={player} server={server} />)}
        </ul>
      </div>}
    </> : <PlayerDirectory key={server} server={server} entries={[...players, ...previous]}
      live={state.status === 'ready' || state.status === 'offline'} message={notice} />}
  </div>;
}
