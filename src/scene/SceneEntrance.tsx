import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Page, PlayerProfileTab } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { animatePageArrival } from './pageMotion';
import { SceneHeader } from './SceneHeader';
import './scene-entrance.css';
import './scene-loader.css';

type IntroState =
  | { phase: 'pending' | 'failed'; progress: number }
  | { phase: 'running' | 'complete' };

type SceneEntranceProps = {
  animate?: boolean;
  children?: ReactNode;
  onNavigateHome?: () => void;
  page?: Page;
  server?: string;
  playerProfile?: { name: string; tab: PlayerProfileTab };
  onClearServer?: () => void;
};

const sceneContentReadyContext = createContext(true);

export function useSceneContentReady() {
  return useContext(sceneContentReadyContext);
}

export function SceneEntrance({ animate = true, children, onNavigateHome, page, server, playerProfile, onClearServer }: SceneEntranceProps) {
  return <SceneEntranceLayout animate={animate} renderHeader={ready => (
    <SceneHeader navigationEnabled={ready} onNavigateHome={onNavigateHome}
      page={page} server={server} playerProfile={playerProfile} onClearServer={onClearServer} />
  )}>{children}</SceneEntranceLayout>;
}

export function SceneEntranceLayout({ animate, children, renderHeader }: {
  animate: boolean;
  children?: ReactNode;
  renderHeader: (ready: boolean) => ReactNode;
}) {
  const { text, introAnimation } = usePreferences();
  const sceneRef = useRef<HTMLDivElement>(null);
  const [playOnLoad] = useState(introAnimation);
  const [intro, setIntro] = useState<IntroState>({ phase: 'pending', progress: 0 });
  const [pageArrived, setPageArrived] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!animate || !scene) return;

    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let active = true;
    let frame = 0;

    function finishRunningIntro() {
      setIntro(current => current.phase === 'running' ? { phase: 'complete' } : current);
    }

    setIntro({ phase: 'pending', progress: 0 });
    motion.addEventListener('change', finishRunningIntro);

    const imagesBySource = new Map<string, Promise<void>[]>();
    for (const image of scene.querySelectorAll<HTMLImageElement>('img:not([loading="lazy"])')) {
      const source = image.currentSrc || image.src;
      const decodes = imagesBySource.get(source) ?? [];
      decodes.push(image.decode());
      imagesBySource.set(source, decodes);
    }

    let loaded = 0;
    const sources = Array.from(imagesBySource.values(), async decodes => {
      await Promise.all(decodes);
      if (!active) return;
      loaded += 1;
      const progress = Math.round(100 * loaded / imagesBySource.size);
      setIntro(current => current.phase === 'pending' ? { phase: 'pending', progress } : current);
    });

    void Promise.all(sources).then(
      () => {
        if (!active) return;
        // Give the filled square a frame before revealing the scene.
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => {
            const playIntro = playOnLoad && motion.matches && CSS.supports('backdrop-filter: blur(1px)');
            setIntro({ phase: playIntro ? 'running' : 'complete' });
          });
        });
      },
      () => {
        if (active) setIntro(current => current.phase === 'pending' ? { ...current, phase: 'failed' } : current);
      },
    );

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      motion.removeEventListener('change', finishRunningIntro);
    };
  }, [animate, playOnLoad]);

  const loading = animate && (intro.phase === 'pending' || intro.phase === 'failed');
  const introPhase = loading ? 'pending' : animate ? intro.phase : 'complete';

  useLayoutEffect(() => {
    if (!animate || introPhase !== 'complete') {
      setPageArrived(false);
      return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const panels = sceneRef.current?.querySelector<HTMLElement>('.scene-panels');
    if (!motion.matches || !panels?.animate) {
      setPageArrived(true);
      return;
    }

    let active = true;
    const arrival = animatePageArrival(panels);
    function markPageArrived() {
      if (active) setPageArrived(true);
    }
    void arrival.finished.then(markPageArrived, markPageArrived);

    function cancelIfReduced() {
      if (!motion.matches) arrival.cancel();
    }

    motion.addEventListener('change', cancelIfReduced);
    return () => {
      active = false;
      motion.removeEventListener('change', cancelIfReduced);
      arrival.cancel();
    };
  }, [animate, introPhase]);

  return (
    <>
      {loading && (
        <div className="scene-loader">
          <div
            className="scene-loader-meter"
            role={intro.phase === 'pending' ? 'progressbar' : undefined}
            aria-label={intro.phase === 'pending' ? text.sceneLoading : undefined}
            aria-valuenow={intro.phase === 'pending' ? intro.progress : undefined}
          >
            <div className="scene-loader-fill" style={{ blockSize: `${intro.progress}%` }} />
          </div>
          {intro.phase === 'failed' && (
            <>
              <p role="status">{text.sceneLoadError}</p>
              <button type="button" onClick={() => window.location.reload()}>{text.retry}</button>
            </>
          )}
        </div>
      )}
      <div
        className="scene-entrance"
        data-intro={introPhase}
        inert={loading}
        ref={sceneRef}
        onAnimationEnd={({ animationName, target, currentTarget }) => {
          if (animationName === 'focus-scene' && target === currentTarget) setIntro({ phase: 'complete' });
        }}
      >
        {renderHeader(introPhase === 'complete')}
        <sceneContentReadyContext.Provider value={!animate || (introPhase === 'complete' && pageArrived)}>
          {children}
        </sceneContentReadyContext.Provider>
      </div>
    </>
  );
}
