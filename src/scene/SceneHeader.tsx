import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import logo from '../../assets/capycraft-winter-logo.png';
import { followPageLink, homePath, navigatePage, playerProfilePath, serverPath, type Page, type PlayerProfileTab } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { isServerPage } from '../minecraftServers.mjs';
import { playersPath } from '../pageMetadata.mts';
import { HeaderControls } from './HeaderControls';
import { ServerPicker } from './ServerPicker';
import './scene-header.css';

type SceneHeaderProps = {
  navigationEnabled?: boolean;
  onNavigateHome?: () => void;
  page?: Page;
  server?: string;
  playerProfile?: { name: string; tab: PlayerProfileTab };
  onClearServer?: () => void;
};

export function SceneHeaderFrame({ ready, navigation, logo, children }: {
  ready: boolean;
  navigation?: boolean;
  logo: ReactNode;
  children: ReactNode;
}) {
  return <header className="scene-header" data-navigation={navigation ? 'visible' : undefined}>
    {logo}
    <div className="scene-header-panel" inert={!ready}>{children}</div>
  </header>;
}

export function SceneHeaderLogo({ ready, current, onClick, target }: {
  ready: boolean;
  current?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  target?: string;
}) {
  const { text } = usePreferences();
  return <a className="scene-logo" href={homePath} target={target} aria-label={text.home}
    aria-current={current ? 'page' : undefined} inert={!ready} onClick={onClick}>
    <img src={logo} width={2172} height={724} alt="Capycraft" />
  </a>;
}

export function SceneHeader({ navigationEnabled = true, onNavigateHome = () => window.scrollTo(0, 0),
  page, server, playerProfile, onClearServer }: SceneHeaderProps) {
  const { text } = usePreferences();
  const servers = useServerDirectory().servers.filter(entry => entry.access !== 'pending' || entry.alias === server);
  const selectedServer = servers.find(entry => entry.alias === server);
  const section = page === 'achievements' ? 'players' : isServerPage(page) ? page : undefined;
  const tabs = selectedServer?.tabs.filter(entry => entry !== 'achievements' && entry !== 'quests' && entry !== 'ponder') ?? [];
  if (!tabs.includes('players')) tabs.push('players');

  function navigateHome(event: MouseEvent<HTMLAnchorElement>) {
    if (followPageLink(event)) onNavigateHome();
  }

  return (
    <SceneHeaderFrame ready={navigationEnabled} navigation={Boolean(page)} logo={
      <SceneHeaderLogo ready={navigationEnabled} current={page === undefined} onClick={navigateHome} />
    }>
        {page && (
          <nav className="scene-header-navigation" aria-label={text.mainNavigation}>
            <a href={homePath} aria-current={page === 'home' ? 'page' : undefined} onClick={navigateHome}>{text.homeNav}</a>
            {servers.length > 0 && (
              <div className="scene-server-picker">
                <ServerPicker label={text.serverPicker} value={selectedServer?.alias ?? ''}
                  servers={servers} placeholder={text.selectServer}
                  onChange={value => {
                    if (!value) {
                      onClearServer?.();
                      navigatePage(section === 'players' ? playersPath : homePath);
                      return;
                    }
                    const nextServer = servers.find(entry => entry.alias === value);
                    if (playerProfile && nextServer?.tabs.includes('players')) {
                      navigatePage(playerProfilePath(value, playerProfile.name, playerProfile.tab));
                      return;
                    }
                    const nextSection = section && nextServer?.tabs.includes(section) ? section : undefined;
                    navigatePage(serverPath(value, nextSection));
                  }} />
              </div>
            )}
            {tabs.map((entry, index) => (
              <a className="scene-server-tab" key={entry} href={selectedServer?.tabs.includes(entry)
                ? serverPath(selectedServer.alias, entry) : playersPath}
                onClick={followPageLink}
                aria-current={section === entry ? 'page' : undefined} style={{ '--tab-order': index } as CSSProperties}>
                {text[entry]}
              </a>
            ))}
          </nav>
        )}
        <HeaderControls />
    </SceneHeaderFrame>
  );
}
