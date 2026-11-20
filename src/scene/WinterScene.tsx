import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import type { Page } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { SceneBackground, SceneIslands } from './SceneBackground';
import { SceneEntrance } from './SceneEntrance';

type WinterSceneProps = {
  animate?: boolean;
  children?: ReactNode;
  page?: Page;
  server?: string;
  onClearServer?: () => void;
  panelsRef?: Ref<HTMLDivElement>;
};

export function WinterScene({ animate = true, children, page, server, onClearServer, panelsRef }: WinterSceneProps) {
  const { text } = usePreferences();
  const label = page === 'items' || page === 'players' ? text[page]
    : page === 'notFound' ? text.pageErrors[404].title : text.information;
  const content = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <SceneEntrance animate={animate} onNavigateHome={() => {
      if (!page || page === 'home') content.current?.scrollTo(0, 0);
    }}
      page={page} server={server} onClearServer={onClearServer}>
      <SceneBackground />
      <main className="scene-content" data-page={page} aria-label={label} ref={content} tabIndex={0}>
        <div className="scene-panels" ref={panelsRef}>{children}</div>
        <SceneIslands animate={animate} />
      </main>
    </SceneEntrance>
  );
}
