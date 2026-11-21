import { questsPath, readQuestCatalog, readQuestProgress, type QuestCatalog } from '../quests.mts';
import { usePreferences } from '../PreferencesProvider';
import { PlayerProgressPage } from './PlayerProgressPage';
import './quests.css';

function visibleChapters(catalog: QuestCatalog, limit: number) {
  const visible = [];
  let remaining = limit;
  for (const chapter of catalog.chapters) {
    if (!remaining) break;
    if (!chapter.quests.length) continue;
    const quests = chapter.quests.slice(0, remaining);
    visible.push({ ...chapter, quests });
    remaining -= quests.length;
  }
  return visible;
}

export function QuestsPage({ server }: { server: string }) {
  const labels = usePreferences().text.quest;
  return <PlayerProgressPage server={server} page="quests" path={questsPath}
    readCatalog={readQuestCatalog} readProgress={readQuestProgress}
    renderCatalog={(catalog, completed, limit) => (
      <div className="quests-chapters">
        {visibleChapters(catalog, limit).map(chapter => (
          <section key={chapter.id} className="quests-chapter" aria-labelledby={`quest-chapter-${chapter.id}`}>
            <h2 id={`quest-chapter-${chapter.id}`}>{chapter.title || labels.chapter}</h2>
            <ul className="achievements-grid" role="list">
              {chapter.quests.map(quest => {
                const done = completed?.has(quest.id);
                return <li className="achievement-card" key={quest.id}>
                  {done !== undefined && <div className="achievement-details">
                    <span data-completed={done}>{done ? labels.done : labels.incomplete}</span>
                  </div>}
                  <h3>{quest.title || labels.untitled}</h3>
                  {quest.description && <p>{quest.description}</p>}
                </li>;
              })}
            </ul>
          </section>
        ))}
      </div>
    )} />;
}
