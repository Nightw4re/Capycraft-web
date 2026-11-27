import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import diamond from '../../assets/leaderboard-diamond.webp';
import goldIngot from '../../assets/leaderboard-gold-ingot.webp';
import ironIngot from '../../assets/leaderboard-iron-ingot.webp';
import { achievementsPath } from '../achievements.mts';
import { followPageLink, playerProfilePath } from '../navigation';
import { PlayerHead } from '../players/PlayerList';
import { fetchPlayerProgress, fetchProfileProgress, readPlayerNames, type Load } from '../players/PlayerProgressPage';
import { usePreferences } from '../PreferencesProvider';
import { questsPath } from '../quests.mts';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { InfoPanel } from './InfoPanel';
import './home-leaderboard.css';

const categories = ['achievements', 'quests'] as const;
const rankIcons = [diamond, goldIngot, ironIngot];
type Category = typeof categories[number];
type Score = { player: string; completed: number };

async function loadScores(server: string, category: Category, signal: AbortSignal): Promise<Load<Score[]>> {
  const query = new URLSearchParams({ server, roster: '1' });
  const roster = await fetchPlayerProgress(`/api/players?${query}`, signal, readPlayerNames);
  if (roster.status !== 'ready') return roster;

  const scores: Score[] = [];
  const path = category === 'achievements' ? achievementsPath : questsPath;
  const batchSize = 6;
  for (let start = 0; start < roster.data.length; start += batchSize) {
    if (signal.aborted) return { status: 'unavailable' };
    const batch = await Promise.all(roster.data.slice(start, start + batchSize)
      .map(player => fetchProfileProgress(path, server, player, signal)));
    for (const progress of batch) {
      if (progress.status === 'unknown' || progress.status === 'noProgress') continue;
      if (progress.status !== 'ready') return progress;
      const { player, completed } = progress.data;
      scores.push({ player, completed });
    }
  }

  scores.sort((a, b) => b.completed - a.completed || a.player.localeCompare(b.player, 'en'));
  return { status: 'ready', data: scores.slice(0, rankIcons.length) };
}

function LeaderboardScores({ server, category, enabled }: { server: string; category: Category; enabled: boolean }) {
  const { text, language } = usePreferences();
  const [result, setResult] = useState<Load<Score[]>>({ status: 'loading' });
  const labels = category === 'achievements' ? text.achievement : text.quest;

  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    void loadScores(server, category, request.signal).then(scores => {
      if (!request.signal.aborted) setResult(scores);
    });
    return () => request.abort();
  }, [server, category, enabled]);

  const scores = enabled && result.status === 'ready' ? result.data : [];
  const message = !enabled ? labels.disabled
    : result.status === 'ready' ? (scores.length ? undefined : text.leaderboardEmpty)
    : result.status === 'noProgress' ? text.leaderboardEmpty : labels[result.status];

  const format = new Intl.NumberFormat(language);
  return <>
    {category === 'quests' && scores.length > 0 && <p className="home-leaderboard-team">{labels.completed}</p>}
    <ol className="home-leaderboard-scores" role="list">
      {rankIcons.map((icon, index) => {
        const score = scores[index];
        return <li key={icon}>
          <span className="home-leaderboard-place" aria-hidden="true">{format.format(index + 1)}.</span>
          <img className="home-leaderboard-rank" src={icon} alt="" width={32} height={32} />
          {score ? <>
            <PlayerHead key={score.player} name={score.player} />
            <a href={playerProfilePath(server, score.player, category)} onClick={followPageLink}>{score.player}</a>
            <span className="home-leaderboard-score">{format.format(score.completed)}</span>
          </> : <span className="home-leaderboard-vacant">{text.leaderboardVacant}</span>}
        </li>;
      })}
    </ol>
    {message && <p className="home-leaderboard-status" role="status">{message}</p>}
  </>;
}

function LeaderboardTabs<T extends string>({ label, options, selected, onSelect, renderPanel, position }: {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  renderPanel: () => ReactNode;
  position: 'top' | 'bottom';
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const id = useId();

  const tabList = (
    <div className="home-leaderboard-tabs" data-position={position} role="tablist" aria-label={label}>
      {options.map(({ value, label: tabLabel }, index) => <button key={value} id={`${id}-${value}`} type="button" role="tab"
        ref={button => {
          if (button) buttons.current.set(value, button);
          else buttons.current.delete(value);
        }}
        aria-selected={selected === value} aria-controls={`${id}-${value}-panel`} tabIndex={selected === value ? 0 : -1}
        onClick={() => onSelect(value)}
        onKeyDown={event => {
          const count = options.length;
          const indices: Record<string, number> = {
            ArrowLeft: (index + count - 1) % count,
            ArrowRight: (index + 1) % count,
            Home: 0,
            End: count - 1,
          };
          const next = options[indices[event.key]];
          if (!next) return;
          event.preventDefault();
          onSelect(next.value);
          buttons.current.get(next.value)?.focus();
        }}>{tabLabel}</button>)}
    </div>
  );

  return <>
    {position === 'top' && tabList}
    {options.map(({ value }) => <div key={value} id={`${id}-${value}-panel`} role="tabpanel"
      aria-labelledby={`${id}-${value}`} hidden={value !== selected} tabIndex={0}>
      {value === selected && renderPanel()}
    </div>)}
    {position === 'bottom' && tabList}
  </>;
}

export function HomeLeaderboard() {
  const { text } = usePreferences();
  const { servers } = useServerDirectory();
  const [serverAlias, setServerAlias] = useState<string>();
  const [selectedCategory, setCategory] = useState<Category>();
  const server = servers.find(entry => entry.alias === serverAlias)
    ?? servers.find(entry => categories.some(category => entry.tabs.includes(category))) ?? servers[0];
  if (!server) return null;

  const category = selectedCategory ?? categories.find(option => server.tabs.includes(option)) ?? 'achievements';
  const enabled = server.tabs.includes(category);
  return <InfoPanel title={text.leaderboard}>
    <LeaderboardTabs label={text.selectServer} position="top" selected={server.alias} onSelect={setServerAlias}
      options={servers.map(({ alias, name }) => ({ value: alias, label: name ?? alias }))}
      renderPanel={() => <LeaderboardTabs label={text.leaderboard} position="bottom" selected={category} onSelect={setCategory}
        options={categories.map(value => ({ value, label: text[value] }))}
        renderPanel={() => <LeaderboardScores key={`${server.alias}/${category}/${enabled}`}
          server={server.alias} category={category} enabled={enabled} />} />} />
  </InfoPanel>;
}
