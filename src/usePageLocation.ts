import { useEffect, useEffectEvent, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { pageUrl, routeFromUrl, type Page } from './navigation';
import { profileName } from './pageMetadata.mts';
import { animatePageArrival, animatePageDeparture } from './scene/pageMotion';

const pageOrder: readonly Page[] = ['home', 'items', 'players', 'achievements', 'notFound'];

function readLocationUrl() {
  const location = window.location;
  const url = pageUrl(location);
  if (location.hash.startsWith('#/') || url !== location.pathname + location.search) {
    window.history.replaceState(window.history.state, '', url);
  }
  return url;
}

function pageLocation(url: string, isKnownServer: (alias: string) => boolean) {
  const { page } = routeFromUrl(url, isKnownServer);
  const params = new URL(url, window.location.origin).searchParams;
  return { page, player: profileName(page, params)?.toLowerCase() };
}

export function usePageLocation(panelsRef: RefObject<HTMLDivElement | null>, isKnownServer: (alias: string) => boolean) {
  const [url, setUrl] = useState(() => pageUrl(window.location));
  const getCurrentPage = useEffectEvent(() => pageLocation(url, isKnownServer));
  const getPage = useEffectEvent((value: string) => pageLocation(value, isKnownServer));

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    let departure: Animation | undefined;
    let arrival: Animation | undefined;

    function updateLocation() {
      const next = readLocationUrl();
      const currentPage = getCurrentPage();
      const nextPage = getPage(next);
      const panels = panelsRef.current;

      if ((nextPage.page === currentPage.page && nextPage.player === currentPage.player) || !motion.matches || !panels?.animate ||
          !panels.closest('.scene-entrance[data-intro="complete"]') || panels.querySelector(':modal')) {
        departure?.cancel();
        departure = undefined;
        setUrl(next);
        return;
      }

      if (departure) return;

      const forward = nextPage.page === currentPage.page ? nextPage.player !== undefined
        : pageOrder.indexOf(nextPage.page) > pageOrder.indexOf(currentPage.page);
      const direction = forward ? 1 : -1;
      const animation = animatePageDeparture(panels, direction);
      arrival?.cancel();
      departure = animation;

      void animation.finished.then(() => {
        if (departure !== animation) return;
        departure = undefined;

        // A second navigation can update the destination while the current page leaves.
        flushSync(() => setUrl(readLocationUrl()));
        animation.cancel();
        arrival = animatePageArrival(panels, direction);
      }, () => {});
    }

    function updateMotion() {
      if (motion.matches) return;
      arrival?.cancel();
      updateLocation();
    }

    updateLocation();
    window.addEventListener('hashchange', updateLocation);
    window.addEventListener('popstate', updateLocation);
    motion.addEventListener('change', updateMotion);
    return () => {
      window.removeEventListener('hashchange', updateLocation);
      window.removeEventListener('popstate', updateLocation);
      motion.removeEventListener('change', updateMotion);
      departure?.cancel();
      arrival?.cancel();
      departure = undefined;
    };
  }, [panelsRef]);

  return [url, setUrl] as const;
}
