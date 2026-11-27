import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { InfoPanel } from './InfoPanel';
import { ServerCard, type MinecraftServer } from './ServerCard';
import { followPageLink, serverPath } from '../navigation';
import { PlayerRoster } from '../players/PlayerList';

export function ServerOverview({ servers, activeServer, compact = false }: {
  servers?: readonly MinecraftServer[]; activeServer?: string; compact?: boolean;
}) {
  const { text } = usePreferences();
  const directory = useServerDirectory();
  const rosterServer = !servers && (activeServer
    ? directory.servers.find(server => server.alias === activeServer && server.tabs.includes('players'))
    : directory.servers.find(server => server.tabs.includes('players')));
  const emptyMessage = directory.unavailable ? text.serverOverviewUnavailable
    : servers || directory.loaded ? text.serverOverviewEmpty : text.serverOverviewLoading;
  const cards = servers ?? directory.servers.map((server): MinecraftServer => ({
    alias: server.alias,
    name: server.name ?? server.alias,
    logo: server.logo,
    motd: server.motd,
    address: server.address,
    status: server.status,
    lastSeenAt: server.lastSeenAt,
    players: { current: server.playersOnline, lastKnown: server.lastKnownPlayersOnline, max: server.maxPlayers },
    uptimeMinutes: server.uptimeSeconds === undefined ? undefined : Math.floor(server.uptimeSeconds / 60),
    totalUptimeMinutes: server.totalUptimeSeconds === undefined ? undefined : Math.floor(server.totalUptimeSeconds / 60),
    worldGameTimeTicks: server.worldGameTimeTicks,
    performance: server.performance,
    modpack: [server.modpack?.name, server.modpack?.version].filter(Boolean).join(' '),
  }));

  if (compact) {
    const featured = cards.find(server => server.alias === activeServer)
      ?? cards.find(server => server.status === 'ready') ?? cards[0];
    return featured && <div className="home-server-summary">
      <ServerCard server={featured} compact titleHref={featured.alias ? serverPath(featured.alias) : undefined} />
    </div>;
  }

  return (
    <InfoPanel title={text.serverOverview}>
      {cards.length > 0 ? (
        <ul className="server-overview-list" role="list">
          {cards.map(server => <li key={server.alias ?? server.address ?? server.name}>
            <ServerCard server={server}
              titleHref={!servers && server.alias ? serverPath(server.alias) : undefined}
              active={!!activeServer && server.alias === activeServer}>
              {rosterServer && rosterServer.alias === server.alias && <div className="server-card-roster">
                <h4><a href={serverPath(rosterServer.alias, 'players')} onClick={followPageLink}>{text.players}</a></h4>
                <PlayerRoster key={rosterServer.alias} server={rosterServer.alias} compact />
              </div>}
            </ServerCard>
          </li>)}
        </ul>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </InfoPanel>
  );
}
