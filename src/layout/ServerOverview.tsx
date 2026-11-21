import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { InfoPanel } from './InfoPanel';
import { ServerCard, type MinecraftServer } from './ServerCard';

export function ServerOverview({ servers }: { servers?: readonly MinecraftServer[] }) {
  const { text } = usePreferences();
  const directory = useServerDirectory();
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
    players: { current: server.playersOnline, max: server.maxPlayers },
    uptimeMinutes: server.uptimeSeconds === undefined ? undefined : Math.floor(server.uptimeSeconds / 60),
    totalUptimeMinutes: server.totalUptimeSeconds === undefined ? undefined : Math.floor(server.totalUptimeSeconds / 60),
    worldAgeDays: server.worldAgeDays,
    worldAgeMinutes: server.worldAgeMinutes,
    modpack: [server.modpack?.name, server.modpack?.version].filter(Boolean).join(' '),
  }));

  return (
    <InfoPanel title={text.serverOverview}>
      {cards.length > 0 ? (
        <ul className="server-overview-list" role="list">
          {cards.map(server => <li key={server.alias ?? server.address ?? server.name}><ServerCard server={server} /></li>)}
        </ul>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </InfoPanel>
  );
}
