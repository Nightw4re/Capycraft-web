import { useEffect, useState } from 'react';
import { InfoPanel } from '../layout/InfoPanel';
import { PageError } from '../layout/PageError';
import { PageLayout } from '../layout/PageLayout';
import { usePreferences } from '../PreferencesProvider';
import { useOnlinePlayersSubscription, useServerDirectory } from '../ServerDirectoryProvider';
import { readOnlinePlayersState, type OnlinePlayer, type OnlinePlayersState } from '../onlinePlayers.mts';
import './players.css';

type PlayerListState =
  | { status: 'loading' | 'error' }
  | { status: 'restricted'; code: 401 | 403 }
  | { status: 'ready'; names: string[] };

async function fetchPlayerList(server: string, signal: AbortSignal): Promise<PlayerListState> {
  const response = await fetch(`/api/players?${new URLSearchParams({ server })}`, { signal });
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

function PlayerHistory({ server }: { server: string }) {
  const { text } = usePreferences();
  const [state, setState] = useState<PlayerListState>({ status: 'loading' });

  useEffect(() => {
    const request = new AbortController();
    void fetchPlayerList(server, request.signal).then(
      result => { if (!request.signal.aborted) setState(result); },
      () => { if (!request.signal.aborted) setState({ status: 'error' }); },
    );
    return () => request.abort();
  }, [server]);

  if (state.status === 'restricted') {
    return <PageError code={state.code} />;
  }

  return (
    <PageLayout title={text.players}>
      <InfoPanel>
        {state.status === 'loading' && <p role="status">{text.playersLoading}</p>}
        {state.status === 'error' && <p role="status">{text.playersLoadError}</p>}
        {state.status === 'ready' && (state.names.length === 0 ? (
          <p>{text.playersEmpty}</p>
        ) : (
          <ul>
            {state.names.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}
          </ul>
        ))}
      </InfoPanel>
    </PageLayout>
  );
}

function PlayerHead({ name, server }: { name: string; server: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const skin = `/api/players?${new URLSearchParams({ server, online: '1', skin: name })}`;
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

function PlayerRow({ player, server, format }: { player: OnlinePlayer; server: string; format: Intl.NumberFormat }) {
  const { text } = usePreferences();
  const { name, pingMillis } = player;
  const quality = pingMillis <= 75 ? 'good' : pingMillis <= 150 ? 'fair' : 'high';
  const qualityText = { good: text.playerPingGood, fair: text.playerPingFair, high: text.playerPingHigh };
  return (
    <li className="online-player" data-quality={quality}>
      <PlayerHead name={name} server={server} />
      <strong className="online-player-name">{name}</strong>
      <div className="online-player-latency">
        <span className="online-player-bars" aria-hidden="true"><i /><i /><i /></span>
        <div className="online-player-latency-text">
          <span className="online-player-ping"><span className="online-player-sr">{text.playerPing} </span>{format.format(pingMillis)} <small>ms</small></span>
          <span className="online-player-quality">{qualityText[quality]}</span>
        </div>
      </div>
    </li>
  );
}

type RosterView = OnlinePlayersState | { status: 'denied'; code: 401 | 403 };

export function PlayerList({ server }: { server: string }) {
  const { text, language } = usePreferences();
  const { servers } = useServerDirectory();
  const subscribe = useOnlinePlayersSubscription();
  const [state, setState] = useState<RosterView>({ status: 'loading' });
  const format = new Intl.NumberFormat(language);
  const serverName = servers.find(entry => entry.alias === server)?.name ?? server;

  useEffect(() => {
    const request = new AbortController();
    let receivedLive = false;
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
      setState(roster);
    }, () => {
      setState(current => receivedLive && (current.status === 'ready' || current.status === 'loading')
        ? { status: 'unavailable' } : current);
    });
    return () => {
      request.abort();
      unsubscribe();
    };
  }, [server, subscribe]);

  if (state.status === 'disabled') return <PlayerHistory server={server} />;
  if (state.status === 'denied') return <PageError code={state.code} />;
  const players = state.status === 'ready' ? state.players : undefined;
  const message = {
    loading: text.playersLoading,
    offline: text.onlinePlayersOffline,
    unavailable: text.onlinePlayersUnavailable,
    restricted: text.onlinePlayersRestricted,
    ready: text.onlinePlayersEmpty,
  }[state.status];

  return (
    <PageLayout header={<div className="online-players-heading">
      <p>{serverName}</p>
      <h1 className="page-layout-title">{text.onlinePlayers}</h1>
    </div>}>
      <InfoPanel>
        <div className="online-players">
          {players && <div className="online-players-summary">
            {text.onlinePlayersListed} <span className="online-players-count">{format.format(players.length)}</span>
          </div>}
          {players?.length ? (
            <ul className="online-players-grid" role="list" aria-label={text.onlinePlayers}>
              {players.map(player => <PlayerRow key={player.name} player={player} server={server} format={format} />)}
            </ul>
          ) : <p className="online-players-message" role="status" data-state={state.status}>{message}</p>}
        </div>
      </InfoPanel>
    </PageLayout>
  );
}
