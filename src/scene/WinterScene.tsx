import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import type { Page, PlayerProfileTab } from '../navigation';
import { isServerPage } from '../minecraftServers.mjs';
import { usePreferences } from '../PreferencesProvider';
import { SceneBackground, SceneIslands } from './SceneBackground';
import { SceneEntrance } from './SceneEntrance';

type WinterSceneProps = {
  animate?: boolean;
  children?: ReactNode;
  page?: Page;
  server?: string;
  playerProfile?: { name: string; tab: PlayerProfileTab };
  onClearServer?: () => void;
  panelsRef?: Ref<HTMLDivElement>;
};

export function WinterScene({ animate = true, children, page, server, playerProfile, onClearServer, panelsRef }: WinterSceneProps) {
  const { text } = usePreferences();
  const label = isServerPage(page) ? text[page]
    : page === 'notFound' ? text.pageErrors[404].title : text.information;
  const content = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [page, server, playerProfile?.name]);

  return (
    <SceneEntrance animate={animate} onNavigateHome={() => {
      if (!page || page === 'home') content.current?.scrollTo(0, 0);
    }}
      page={page} server={server} playerProfile={playerProfile} onClearServer={onClearServer}>
      <SceneBackground />
      <main className="scene-content" data-page={page} data-profile-tab={playerProfile?.tab}
        aria-label={label} ref={content} tabIndex={0}>
        <div className="scene-panels" ref={panelsRef}>{children}</div>
        <SceneIslands animate={animate} />
      </main>
    </SceneEntrance>
  );
}
