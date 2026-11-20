import { useEffect, useRef, useState } from 'react';
import animated from '../../assets/nugwa-animated.png?no-inline';
import still from '../../assets/nugwa-seated.png?no-inline';
import { usePreferences } from '../PreferencesProvider';
import { portraitCast } from './portraitCast';
import { stageHeight, stageWidth } from './portraitScene';
import { playPortrait } from './playPortrait';
import './player-portrait.css';

export function NugwaPortrait() {
  const { text } = usePreferences();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'still' | 'canvas' | 'image'>('still');
  const label = mode === 'still'
    ? text.portraitCharacter(portraitCast[0].name)
    : text.portraitPlayers(portraitCast.map(({ name }) => name).join(', '));

  useEffect(() => {
    const container = stage.current;
    const element = canvas.current;
    if (!container || !element) return;

    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let playback: AbortController | undefined;

    const syncMotion = () => {
      playback?.abort();
      if (!motion.matches) {
        setMode('still');
        return;
      }

      const controller = new AbortController();
      playback = controller;
      function showImage() {
        if (controller.signal.aborted) return;
        controller.abort();
        setMode('image');
      }

      void playPortrait(container, element, controller.signal, showImage)
        .then(() => {
          if (!controller.signal.aborted) setMode('canvas');
        })
        .catch(showImage);
    };

    syncMotion();
    motion.addEventListener('change', syncMotion);
    return () => {
      playback?.abort();
      motion.removeEventListener('change', syncMotion);
    };
  }, []);

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
    </div>
  );
}
