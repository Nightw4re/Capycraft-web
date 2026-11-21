import { useEffect, useState } from 'react';
import { InfoPanel } from '../layout/InfoPanel';
import { PageLayout } from '../layout/PageLayout';
import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { readPonderIndex } from './format.mts';
import { PonderPlayer } from './PonderPlayer';
import { PonderUnavailable, readPonderResponse } from './source';
import '../players/achievements.css';
import './ponder.css';

type PonderIndex = NonNullable<ReturnType<typeof readPonderIndex>>;
type LoadState = { status: 'loading' | 'unavailable' | 'invalid' } | { status: 'ready'; index: PonderIndex };

export function PonderPage({ server }: { server: string }) {
  const { text, language } = usePreferences();
  const labels = text.ponderPlayer;
  const serverName = useServerDirectory().servers.find(entry => entry.alias === server)?.name ?? server;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    void readPonderResponse(server, request.signal).then(async response => {
      const index = readPonderIndex(await response.json());
      if (!request.signal.aborted) setState(index ? { status: 'ready', index } : { status: 'invalid' });
    }).catch(error => {
      if (!request.signal.aborted) setState({ status: error instanceof PonderUnavailable ? 'unavailable' : 'invalid' });
    });
    return () => request.abort();
  }, [attempt, server]);

  const query = search.trim().toLocaleLowerCase(language);
  const scenes = state.status === 'ready' ? state.index.scenes : [];
  const filtered = scenes.filter(scene =>
    [scene.title, scene.id, scene.schematic, ...scene.items].some(value => value.toLocaleLowerCase(language).includes(query)));
  const scene = filtered.find(entry => entry.manifest === selected) ?? filtered[0];

  return (
    <PageLayout header={<div className="achievements-heading">
      <p>{serverName}</p>
      <h1 className="page-layout-title">{text.ponder}</h1>
    </div>}>
      <InfoPanel>
        {state.status !== 'ready' ? <div className="ponder-message" role="status">
          <p>{state.status === 'loading' ? labels.loadingCatalog : labels[state.status]}</p>
          {state.status !== 'loading' && <button type="button" onClick={() => {
            setState({ status: 'loading' });
            setAttempt(current => current + 1);
          }}>{labels.retry}</button>}
        </div> : !scenes.length ? <p className="ponder-message">{labels.empty}</p> : <>
          <div className="ponder-pickers">
            <label>{labels.filter}
              <input type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} />
            </label>
            <label>{labels.scene}
              <select value={scene?.manifest ?? ''} disabled={!scene} onChange={event => setSelected(event.currentTarget.value)}>
                {filtered.map(entry => <option key={entry.manifest} value={entry.manifest}>{entry.title || entry.id}</option>)}
              </select>
            </label>
          </div>
          {scene ? <PonderPlayer key={scene.manifest} server={server} scene={scene} />
            : <p className="ponder-message" role="status">{labels.noMatch}</p>}
        </>}
      </InfoPanel>
    </PageLayout>
  );
}
