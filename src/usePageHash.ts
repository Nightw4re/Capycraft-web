import { useEffect, useEffectEvent, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { canonicalHash, routeFromHash, type Page } from './navigation';
import { animatePageArrival, animatePageDeparture } from './scene/pageMotion';

const pageOrder: readonly Page[] = ['home', 'items', 'players', 'notFound'];

function readLocationHash() {
  const next = canonicalHash(window.location.hash);
  if (next !== window.location.hash) window.history.replaceState(window.history.state, '', next);
  return next;
}

export function usePageHash(panelsRef: RefObject<HTMLDivElement | null>, isKnownServer: (alias: string) => boolean) {
  const [hash, setHash] = useState(() => canonicalHash(window.location.hash));
  const getCurrentPage = useEffectEvent(() => routeFromHash(hash, isKnownServer).page);
  const getPage = useEffectEvent((value: string) => routeFromHash(value, isKnownServer).page);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let departure: Animation | undefined;
    let arrival: Animation | undefined;

    function updateHash() {
      const next = readLocationHash();
      const currentPage = getCurrentPage();
      const nextPage = getPage(next);
      const panels = panelsRef.current;

      if (nextPage === currentPage || !motion.matches || !panels?.animate ||
          !panels.closest('.scene-entrance[data-intro="complete"]') || panels.querySelector(':modal')) {
        departure?.cancel();
        departure = undefined;
        setHash(next);
        return;
      }

      if (departure) return;

      const direction = pageOrder.indexOf(nextPage) > pageOrder.indexOf(currentPage) ? 1 : -1;
      const animation = animatePageDeparture(panels, direction);
      arrival?.cancel();
      departure = animation;

      void animation.finished.then(() => {
        if (departure !== animation) return;
        departure = undefined;

        // A second navigation can update the destination while the current page leaves.
        flushSync(() => setHash(readLocationHash()));
        animation.cancel();
        arrival = animatePageArrival(panels, direction);
      }, () => {});
    }

    function updateMotion() {
      if (motion.matches) return;
      arrival?.cancel();
      updateHash();
    }

    updateHash();
    window.addEventListener('hashchange', updateHash);
    motion.addEventListener('change', updateMotion);
    return () => {
      window.removeEventListener('hashchange', updateHash);
      motion.removeEventListener('change', updateMotion);
      departure?.cancel();
      arrival?.cancel();
      departure = undefined;
    };
  }, [panelsRef]);

  return [hash, setHash] as const;
}
