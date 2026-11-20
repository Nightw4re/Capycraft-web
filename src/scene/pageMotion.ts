const slideDistance = 2.5;

export function animatePageDeparture(panels: HTMLElement, direction: number) {
  const { left, opacity } = getComputedStyle(panels);

  // A relative offset keeps fixed tooltips and controls anchored to the viewport.
  return panels.animate(
    [{ left: left === 'auto' ? '0px' : left, opacity }, { left: `${-direction * slideDistance}rem`, opacity: 0 }],
    { duration: 150, easing: 'ease-in', fill: 'forwards' },
  );
}

export function animatePageArrival(panels: HTMLElement, direction = 1) {
  return panels.animate(
    [{ left: `${direction * slideDistance}rem`, opacity: 0 }, { left: '0px', opacity: 1 }],
    { duration: 220, easing: 'ease-out' },
  );
}
