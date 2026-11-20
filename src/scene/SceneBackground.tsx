import { useEffect, useRef } from 'react';
import backdrop from '../../assets/dragon-battle-background.png';
import islands from '../../assets/capybara-snow-islands.png';
import { usePreferences } from '../PreferencesProvider';
import './scene-background.css';

export function SceneBackground() {
  const { text } = usePreferences();
  return <img className="scene-backdrop" src={backdrop} alt={text.backdrop} />;
}

export function SceneIslands({ animate = true }: { animate?: boolean }) {
  const eyelidRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const eyelid = eyelidRef.current;
    if (!animate || !eyelid) return;

    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let timeout: number | undefined;
    let blink: Animation | undefined;

    const scheduleBlink = () => {
      timeout = window.setTimeout(() => {
        blink = eyelid.animate(
          [
            { transform: 'translateY(-100%)', easing: 'ease-in' },
            { transform: 'translateY(0)', offset: 0.3 },
            { transform: 'translateY(0)', offset: 0.46, easing: 'ease-out' },
            { transform: 'translateY(-100%)' },
          ],
          180,
        );
        scheduleBlink();
      }, 5000 + Math.random() * 7000);
    };

    function stopBlinking() {
      window.clearTimeout(timeout);
      blink?.cancel();
    }

    function syncMotion() {
      stopBlinking();
      if (motion.matches) scheduleBlink();
    }

    syncMotion();
    motion.addEventListener('change', syncMotion);
    return () => {
      stopBlinking();
      motion.removeEventListener('change', syncMotion);
    };
  }, [animate]);

  return (
    <div className="scene-islands" aria-hidden="true">
      <img className="scene-island scene-garden" src={islands} alt="" />
      <div className="scene-island scene-capybara">
        <img src={islands} alt="" />
        <span className="scene-capybara-eye">
          <span className="scene-capybara-eyelid" ref={eyelidRef} />
        </span>
      </div>
    </div>
  );
}
