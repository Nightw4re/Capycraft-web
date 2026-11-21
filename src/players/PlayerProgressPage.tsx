import { useEffect, useState, type ReactNode } from 'react';
import { InfoPanel } from '../layout/InfoPanel';
import { PageLayout } from '../layout/PageLayout';
import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import './achievements.css';

type Failure = 'offline' | 'unavailable' | 'restricted' | 'unknown' | 'disabled' | 'noProgress';
type Load<T> = { status: 'ready'; data: T } | { status: Failure | 'loading' };
const pageSize = 48;

async function get<T>(url: string, signal: AbortSignal, parse: (data: unknown) => T | undefined): Promise<Load<T>> {
  try {
    const response = await fetch(url, { signal });
    const data: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const parsed = parse(data);
      if (parsed !== undefined) return { status: 'ready', data: parsed };
    }
    if (response.status === 401 || response.status === 403) return { status: 'restricted' };
    if (response.status === 503) return { status: 'offline' };
    if (response.status === 404 && data && typeof data === 'object' && 'error' in data) {
      if (data.error === 'player_not_found') return { status: 'unknown' };
      if (data.error === 'team_progress_unavailable') return { status: 'noProgress' };
      if (data.error === 'achievements_disabled' || data.error === 'quests_disabled') return { status: 'disabled' };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'offline' };
  }
}

function readNames(data: unknown): string[] | undefined {
  if (data && typeof data === 'object' && 'players' in data && Array.isArray(data.players)
    && data.players.every(name => typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name))) return data.players;
}

type Catalog = { total: number };
type Progress = { player: string; completed: number; completedIds: string[] };

export function PlayerProgressPage<C extends Catalog>({ server, page, path, readCatalog, readProgress, renderCatalog }: {
  server: string;
  page: 'achievements' | 'quests';
  path: string;
  readCatalog: (data: unknown) => C | undefined;
  readProgress: (data: unknown, player: string) => (C & Progress) | undefined;
  renderCatalog: (catalog: C, completed: ReadonlySet<string> | undefined, limit: number) => ReactNode;
}) {
  const { language, text } = usePreferences();
  const labels = page === 'quests' ? text.quest : text.achievement;
  const { servers } = useServerDirectory();
  const serverName = servers.find(entry => entry.alias === server)?.name ?? server;
  const [catalog, setCatalog] = useState<Load<C>>({ status: 'loading' });
  const [roster, setRoster] = useState<Load<string[]>>({ status: 'loading' });
  const [player, setPlayer] = useState('');
  const [progress, setProgress] = useState<Load<C & Progress>>({ status: 'loading' });
  const [limit, setLimit] = useState(pageSize);
  const number = new Intl.NumberFormat(language);

  useEffect(() => {
    const request = new AbortController();
    const query = new URLSearchParams({ server });
    void get(`${path}?${query}`, request.signal, readCatalog)
      .then(result => { if (!request.signal.aborted) setCatalog(result); });
    query.set('roster', '1');
    void get(`/api/players?${query}`, request.signal, readNames)
      .then(result => { if (!request.signal.aborted) setRoster(result); });
    return () => request.abort();
  }, [path, readCatalog, server]);

  useEffect(() => {
    if (!player) return;
    const request = new AbortController();
    const query = new URLSearchParams({ server, player });
    void get(`${path}?${query}`, request.signal, data => readProgress(data, player))
      .then(result => { if (!request.signal.aborted) setProgress(result); });
    return () => request.abort();
  }, [path, player, readProgress, server]);

  const selected = player && progress.status === 'ready' && progress.data.player.toLowerCase() === player.toLowerCase()
    ? progress.data : undefined;
  const visibleCatalog = selected ?? (catalog.status === 'ready' ? catalog.data : undefined);
  const completed = selected && new Set(selected.completedIds);
  const message = (status: Failure | 'loading') => status === 'noProgress' ? text.quest.noProgress : labels[status];

  return (
    <PageLayout header={<div className="achievements-heading">
      <p>{serverName}</p>
      <h1 className="page-layout-title">{text[page]}</h1>
    </div>}>
      <InfoPanel>
        {visibleCatalog ? <>
          <div className="achievements-controls">
            <dl className="achievements-counts" aria-live="polite">
              <div><dt>{labels.total}</dt><dd>{number.format(visibleCatalog.total)}</dd></div>
              {selected && <div><dt>{labels.completed}</dt><dd>{number.format(selected.completed)} / {number.format(selected.total)}</dd></div>}
            </dl>
            {roster.status === 'ready' && roster.data.length > 0 && (
              <label className="achievements-player">
                <span>{labels.player}</span>
                <select value={player} onChange={event => {
                  setProgress({ status: 'loading' });
                  setPlayer(event.target.value);
                  setLimit(pageSize);
                }}>
                  <option value="">{labels.everyone}</option>
                  {roster.data.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
          </div>
          {page === 'quests' && <p className="achievements-team">{text.quest.team}</p>}
          {roster.status !== 'ready' && <p role="status" className="achievements-message">
            {roster.status === 'loading' ? labels.loadingPlayers : labels.rosterError}
          </p>}
          {roster.status === 'ready' && !roster.data.length && <p className="achievements-message">{labels.noPlayers}</p>}
          {player && !selected && <p role="status" className="achievements-message">
            {progress.status === 'loading' || progress.status === 'ready' ? labels.loadingProgress : message(progress.status)}
          </p>}
          {visibleCatalog.total === 0 ? <p className="achievements-message">{labels.empty}</p> : (
            renderCatalog(visibleCatalog, completed, limit)
          )}
          {limit < visibleCatalog.total && <button className="achievements-more" type="button"
            onClick={() => setLimit(current => current + pageSize)}>{labels.more}</button>}
        </> : <p role="status" className="achievements-message">{catalog.status === 'ready' ? labels.empty : message(catalog.status)}</p>}
      </InfoPanel>
    </PageLayout>
  );
}
