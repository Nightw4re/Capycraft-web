import { useEffect, useRef, useState } from 'react';
import animated from '../../assets/nugwa-animated.png?no-inline';
import still from '../../assets/nugwa-seated.png?no-inline';
import { usePreferences } from '../PreferencesProvider';
import type { PortraitArrival } from './portraitAnimation';
import { portraitCast } from './portraitCast';
import { stageHeight, stageWidth } from './portraitScene';
import { loadVisitorNames, playPortrait } from './playPortrait';
import './player-portrait.css';

const bundledNames = portraitCast.map(({ name }) => name);

export function NugwaPortrait({ players, server, arrival }: {
  players?: readonly string[];
  server?: string;
  arrival?: PortraitArrival;
}) {
  const { text } = usePreferences();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'still' | 'canvas' | 'image'>('still');
  const [actor, setActor] = useState({ name: bundledNames[0], fallback: false });
  const shown = mode === 'canvas' ? actor : { name: bundledNames[0], fallback: false };
  const label = mode === 'image' ? text.portraitPlayers(bundledNames.join(', '))
    : shown.fallback ? text.portraitFallback(shown.name) : text.portraitCharacter(shown.name);

  useEffect(() => {
    const container = stage.current;
    const element = canvas.current;
    if (!container || !element) return;

    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let playback: AbortController | undefined;

    const syncMotion = () => {
      playback?.abort();
      setMode('still');
      if (!motion.matches) return;

      const controller = new AbortController();
      playback = controller;
      function showImage() {
        if (controller.signal.aborted) return;
        controller.abort();
        setMode('image');
      }

      const start = async () => {
        const names = players ?? await loadVisitorNames(server, controller.signal);
        if (controller.signal.aborted) return;
        const loaded = await playPortrait(container, element, names, arrival, controller.signal, showImage,
          (name, fallback) => { if (!controller.signal.aborted) setActor({ name, fallback }); }, players === undefined);
        if (!loaded || controller.signal.aborted) return;
        setMode('canvas');
      };
      void start().catch(showImage);
    };

    syncMotion();
    motion.addEventListener('change', syncMotion);
    return () => {
      playback?.abort();
      motion.removeEventListener('change', syncMotion);
    };
  }, [players, server, arrival]);

  return (
    <div className="player-portrait" ref={stage} role="img" aria-label={label}>
      <canvas ref={canvas} width={stageWidth} height={stageHeight} hidden={mode !== 'canvas'} aria-hidden="true" />
      {mode !== 'canvas' && (
        <picture>
          {mode === 'image' && <source media="(prefers-reduced-motion: no-preference)" srcSet={animated} />}
          <img src={still} width={stageWidth} height={stageHeight} alt="" onError={() => {
            if (mode === 'image') setMode('still');
          }} />
        </picture>
      )}
      {mode !== 'image' && <span className="player-portrait-name" aria-hidden="true">
        {shown.name}{shown.fallback && <small>{text.portraitSkinUnavailable}</small>}
      </span>}
    </div>
  );
}
