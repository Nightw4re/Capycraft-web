import type { CSSProperties } from 'react';
import logo from '../../assets/capycraft-winter-logo.png';
import { homeHash, serverHash, type Page } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { HeaderControls } from './HeaderControls';
import { HeaderPicker } from './HeaderPicker';
import './scene-header.css';

type SceneHeaderProps = {
  navigationEnabled?: boolean;
  onNavigateHome?: () => void;
  page?: Page;
  server?: string;
  onClearServer?: () => void;
};

export function SceneHeader({ navigationEnabled = true, onNavigateHome = () => window.scrollTo(0, 0), page, server, onClearServer }: SceneHeaderProps) {
  const { text } = usePreferences();
  const servers = useServerDirectory().servers.filter(server => server.access !== 'pending');
  const selectedServer = servers.find(entry => entry.alias === server);
  const section = page === 'items' || page === 'players' ? page : undefined;

  return (
    <header className="scene-header" data-navigation={page ? 'visible' : undefined}>
      <a
        className="scene-logo"
        href={homeHash}
        aria-label={text.home}
        aria-current={page === undefined ? 'page' : undefined}
        inert={!navigationEnabled}
        onClick={onNavigateHome}
      >
        <img src={logo} width={2172} height={724} alt="Capycraft" />
      </a>
      <div className="scene-header-panel" inert={!navigationEnabled}>
        {page && (
          <nav className="scene-header-navigation" aria-label={text.mainNavigation}>
            <a href={homeHash} aria-current={page === 'home' ? 'page' : undefined} onClick={onNavigateHome}>{text.homeNav}</a>
            {servers.length > 0 && (
              <div className="scene-server-picker">
                <HeaderPicker label={text.serverPicker} value={selectedServer?.alias ?? ''}
                  options={[{ value: '', label: text.selectServer, placeholder: true }, ...servers.map(entry => ({
                    value: entry.alias,
                    label: entry.name ?? entry.alias,
                    iconSrc: entry.logo,
                  }))]}
                  onChange={value => {
                    if (!value) {
                      onClearServer?.();
                      window.location.hash = homeHash;
                      return;
                    }
                    const nextSection = section && servers.find(entry => entry.alias === value)?.tabs.includes(section) ? section : undefined;
                    window.location.hash = serverHash(value, nextSection);
                  }} />
              </div>
            )}
            {selectedServer?.tabs.map((entry, index) => (
              <a className="scene-server-tab" key={`${selectedServer.alias}:${entry}`} href={serverHash(selectedServer.alias, entry)}
                aria-current={page === entry ? 'page' : undefined} style={{ '--tab-order': index } as CSSProperties}>
                {text[entry]}
              </a>
            ))}
          </nav>
        )}
        <HeaderControls />
      </div>
    </header>
  );
}
