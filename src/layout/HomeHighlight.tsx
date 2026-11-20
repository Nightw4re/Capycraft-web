import { useEffect, useState } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { homeHighlightFacts } from './homeHighlightFacts';
import './home-highlight.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const rotationDelay = 20_000;

type FactPosition = {
  current: number;
  previous: number;
  step: -1 | 1;
};

function advanceFact({ current }: FactPosition, step: FactPosition['step']): FactPosition {
  const count = homeHighlightFacts.length;
  return { current: (current + step + count) % count, previous: current, step };
}

export function HomeHighlight() {
  const { language, text } = usePreferences();
  const [position, setPosition] = useState<FactPosition>({ current: 0, previous: -1, step: 1 });
  const [rotationEnabled, setRotationEnabled] = useState(() => !window.matchMedia(reducedMotionQuery).matches);
  const [hovered, setHovered] = useState(false);
  const rotationLabel = rotationEnabled ? text.homeHighlightPause : text.homeHighlightPlay;

  useEffect(() => {
    const motion = window.matchMedia(reducedMotionQuery);
    function respectReducedMotion() {
      if (motion.matches) setRotationEnabled(false);
    }
    motion.addEventListener('change', respectReducedMotion);
    return () => motion.removeEventListener('change', respectReducedMotion);
  }, []);

  useEffect(() => {
    if (!rotationEnabled || hovered) return;
    const timer = window.setInterval(() => {
      setPosition(current => advanceFact(current, 1));
    }, rotationDelay);
    return () => window.clearInterval(timer);
  }, [hovered, rotationEnabled]);

  function moveFact(step: FactPosition['step']) {
    setRotationEnabled(false);
    setPosition(current => advanceFact(current, step));
  }

  function slideState(index: number) {
    if (index === position.current) return position.previous < 0 ? 'initial' : 'current';
    return index === position.previous ? 'previous' : 'hidden';
  }

  return (
    <section
      className="home-highlight"
      aria-labelledby="home-highlight-title"
      data-direction={position.step === 1 ? 'next' : 'previous'}
      onFocus={event => {
        if (event.target.matches(':focus-visible')) setRotationEnabled(false);
      }}
      onPointerEnter={event => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={event => {
        if (event.pointerType === 'mouse') setHovered(false);
      }}
    >
      <div className="home-highlight-art" aria-hidden="true">
        {homeHighlightFacts.map(({ id, image }, index) => (
          <div key={id} className="home-highlight-slide" data-state={slideState(index)}>
            <img src={image.src} className={image.className} alt="" />
          </div>
        ))}
      </div>
      <div className="home-highlight-copy">
        <h1 id="home-highlight-title">{text.homeHighlightTitle}</h1>
        <div className="home-highlight-facts" aria-live={rotationEnabled ? 'off' : 'polite'} aria-atomic="true">
          {homeHighlightFacts.map(({ id, [language]: { title, body } }, index) => (
            <div key={id} className="home-highlight-slide" data-state={slideState(index)} aria-hidden={index !== position.current}>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <div className="home-highlight-controls">
          <button type="button" aria-label={text.homeHighlightPrevious} title={text.homeHighlightPrevious} onClick={() => moveFact(-1)}>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M3 4h2v12H3zM17 3v14L7 10z" />
            </svg>
          </button>
          <button type="button" aria-label={text.homeHighlightNext} title={text.homeHighlightNext} onClick={() => moveFact(1)}>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M15 4h2v12h-2zM3 3l10 7-10 7z" />
            </svg>
          </button>
          <button className="home-highlight-rotation" type="button" aria-label={rotationLabel} title={rotationLabel}
            onClick={() => setRotationEnabled(enabled => !enabled)}>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={rotationEnabled ? 'M5 4h3v12H5zM12 4h3v12h-3z' : 'M6 3l10 7-10 7z'} />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
