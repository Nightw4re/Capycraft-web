import { useEffect, useState } from 'react';
import { InfoPanel } from '../layout/InfoPanel';
import { PageError } from '../layout/PageError';
import { PageLayout } from '../layout/PageLayout';
import { usePreferences } from '../PreferencesProvider';

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

export function PlayerList({ server }: { server: string }) {
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
