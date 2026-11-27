import { useEffect, useState } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { useSceneContentReady } from '../scene/SceneEntrance';
import { homeHighlightFacts } from './homeHighlightFacts';
import { PauseIcon, PlayIcon, StepIcon } from './PlayIcon';
import './home-highlight.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

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
  const sceneContentReady = useSceneContentReady();
  const [position, setPosition] = useState<FactPosition>({ current: 0, previous: -1, step: 1 });
  const [rotationEnabled, setRotationEnabled] = useState(() => !window.matchMedia(reducedMotionQuery).matches);
  const rotationLabel = rotationEnabled ? text.homeHighlightPause : text.homeHighlightPlay;

  useEffect(() => {
    const motion = window.matchMedia(reducedMotionQuery);
    function respectReducedMotion() {
      if (motion.matches) setRotationEnabled(false);
    }
    motion.addEventListener('change', respectReducedMotion);
    return () => motion.removeEventListener('change', respectReducedMotion);
  }, []);

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
            <StepIcon direction="previous" />
          </button>
          <button type="button" aria-label={text.homeHighlightNext} title={text.homeHighlightNext} onClick={() => moveFact(1)}>
            <StepIcon direction="next" />
          </button>
          <button className="home-highlight-rotation" type="button" aria-label={rotationLabel} title={rotationLabel}
            data-rotating={rotationEnabled && sceneContentReady}
            onClick={() => setRotationEnabled(enabled => !enabled)}>
            <svg className="home-highlight-progress" viewBox="0 0 44 44" aria-hidden="true">
              <path className="home-highlight-progress-track" d="M22 4H40V40H4V4Z" />
              <path key={position.current} className="home-highlight-progress-fill" d="M22 4H40V40H4V4Z" pathLength="100"
                onAnimationEnd={() => setPosition(current => advanceFact(current, 1))} />
            </svg>
            {rotationEnabled ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      </div>
    </section>
  );
}
