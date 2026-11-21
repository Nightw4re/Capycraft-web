import { achievementsPath, readAchievementCatalog } from '../achievements.mts';
import { usePreferences } from '../PreferencesProvider';
import { PlayerProgressPage } from './PlayerProgressPage';

export function AchievementsPage({ server }: { server: string }) {
  const labels = usePreferences().text.achievement;
  return <PlayerProgressPage server={server} page="achievements" path={achievementsPath}
    readCatalog={readAchievementCatalog} readProgress={readAchievementCatalog}
    renderCatalog={(visibleCatalog, completed, limit) => (
      <ul className="achievements-grid" role="list">
        {visibleCatalog.advancements.slice(0, limit).map(entry => {
          const done = completed?.has(entry.id);
          return <li className="achievement-card" key={entry.id} data-frame={entry.frame}>
            <div className="achievement-details">
              <span>{labels[entry.frame]}</span>
              {done !== undefined && <span data-completed={done}>{done ? labels.completed : labels.incomplete}</span>}
            </div>
            <h2>{entry.title}</h2>
            {entry.description && <p>{entry.description}</p>}
          </li>;
        })}
      </ul>
    )} />;
}
