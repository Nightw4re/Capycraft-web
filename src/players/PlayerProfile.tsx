import { InfoPanel } from '../layout/InfoPanel';
import { PageLayout } from '../layout/PageLayout';
import { followPageLink, playerProfilePath, serverPath, type PlayerProfileTab } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { AchievementsPage } from './AchievementsPage';
import { PlayerDetails, PlayerHead, PlayerStatus, usePlayerRoster } from './PlayerList';
import { PlayerQuests, type QuestItemNavigation } from './QuestsPage';
import { PlayerEquipment, usePlayerEquipment, type EquipmentItemNavigation } from './PlayerEquipment';
import { achievementsPath } from '../achievements.mts';
import { questsPath } from '../quests.mts';
import { useProfileProgress } from './PlayerProgressPage';

export function PlayerProfile({ server, name, tab, tabs, progressUrl, itemHref, onOpenItem, questItems }: EquipmentItemNavigation & {
  server: string; name: string; tab: PlayerProfileTab;
  tabs: readonly PlayerProfileTab[];
  progressUrl: string;
  questItems: QuestItemNavigation;
}) {
  const { text, language } = usePreferences();
  const { servers } = useServerDirectory();
  const instance = servers.find(entry => entry.alias === server);
  const { state, history, players, previous } = usePlayerRoster(server);
  const matches = (player: { name: string }) => player.name.toLowerCase() === name.toLowerCase();
  const player = players.find(matches) ?? previous.find(matches);
  const hasAchievements = tabs.includes('achievements');
  const hasQuests = tabs.includes('quests');
  const achievements = useProfileProgress(achievementsPath, server, hasAchievements ? name : '');
  const quests = useProfileProgress(questsPath, server, hasQuests ? name : '');
  const equipment = usePlayerEquipment(server, name, 'loadout');
  const inventory = usePlayerEquipment(server, name, 'inventory', tab === 'inventory');
  const format = new Intl.NumberFormat(language);
  const progressCount = (progress: ReturnType<typeof useProfileProgress>, labels: typeof text.achievement | typeof text.quest) => {
    if (progress.status === 'ready') return `${format.format(progress.data.completed)} / ${format.format(progress.data.total)}`;
    if (progress.status === 'noProgress') return text.quest.noProgress;
    return labels[progress.status];
  };
  const message = state.status === 'denied' || state.status === 'restricted' || history.status === 'restricted'
    ? text.onlinePlayersRestricted
    : history.status === 'loading' || state.status === 'loading' ? text.playersLoading
    : history.status === 'error' ? text.playersLoadError : text.playerNoServerData;
  return <PageLayout>
    <div className="player-profile-actions">
      <a className="player-profile-back" href={serverPath(server, 'players')} onClick={followPageLink}>
        <span aria-hidden="true">‹</span> {text.playerBackToList}
      </a>
    </div>
    <InfoPanel>
      <div className="player-profile-summary">
        <div className="player-profile-overview">
          <div className="player-profile-title">
            <PlayerHead key={name.toLowerCase()} name={player?.name ?? name} />
            <div>
              <div className="player-name-status">
                <h1 className="page-layout-title" tabIndex={-1}>{player?.name ?? name}</h1>
                {player && <PlayerStatus player={player} live={state.status === 'ready' || state.status === 'offline'} />}
              </div>
              <p>{instance?.name ?? server}</p>
            </div>
          </div>
          {player ? <PlayerDetails player={player} /> : <p role="status">{message}</p>}
          {(hasAchievements || hasQuests) && <dl className="achievements-counts">
            {hasAchievements && <div><dt>{text.achievements}</dt><dd data-status={achievements.status}>{progressCount(achievements, text.achievement)}</dd></div>}
            {hasQuests && <div><dt>{text.quests}</dt><dd data-status={quests.status}>{progressCount(quests, text.quest)}</dd></div>}
          </dl>}
        </div>
        <section className="player-profile-equipment">
          <PlayerEquipment server={server} player={name} view="loadout" equipment={equipment}
            itemHref={itemHref} onOpenItem={onOpenItem} />
        </section>
      </div>
    </InfoPanel>
    <nav className="player-profile-tabs" aria-label={text.playerProfileNavigation}>
      {tabs.map(section => <a key={section} href={playerProfilePath(server, name, section)} onClick={followPageLink}
        aria-current={tab === section ? 'page' : undefined}>{section === 'inventory' ? text.playerInventory : text[section]}</a>)}
    </nav>
    {tab === 'quests' && hasQuests && <PlayerQuests server={server} playerKnown={!!player} progress={quests}
      url={progressUrl} itemNavigation={questItems} />}
    {tab === 'achievements' && hasAchievements && <AchievementsPage server={server} progress={achievements} url={progressUrl} />}
    {tab === 'inventory' && <InfoPanel><PlayerEquipment server={server} player={name} view="inventory" inventory={inventory}
      itemHref={itemHref} onOpenItem={onOpenItem} /></InfoPanel>}
  </PageLayout>;
}
