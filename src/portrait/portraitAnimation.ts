import { blockScene } from './blockScene';
import { arrivalFrames, departureFrames } from './nugwaAnimation';
import type { Figure, PortraitFrame, TimedFrame } from './portraitScene';

export type PortraitArrival = 'same' | 'next';

export function distinctPlayerNames(players: readonly string[]) {
  const distinct = new Map<string, string>();
  for (const player of players) {
    const key = player.toLowerCase();
    if (!distinct.has(key)) distinct.set(key, player);
  }
  return [...distinct.values()];
}

function withPlayer(frames: TimedFrame<Figure>[], player: string): TimedFrame<PortraitFrame>[] {
  return frames.map(({ frame, duration }) => ({ duration, frame: { actors: [{ ...frame, player }] } }));
}

function departureAndArrival(outgoing: string, incoming: string) {
  return [...withPlayer(departureFrames, outgoing), ...withPlayer(arrivalFrames, incoming)];
}

export function createPortraitAnimation(players: readonly string[], arrival: PortraitArrival = 'same'): TimedFrame<PortraitFrame>[] {
  const cast = distinctPlayerNames(players);
  const [first] = cast;
  if (!first) return [];
  if (cast.length === 1) return departureAndArrival(first, first);

  const scenes = cast.flatMap((outgoing, index) => {
    const incoming = cast[(index + 1) % cast.length];
    return arrival === 'next' && index % 2 === 0
      ? departureAndArrival(outgoing, incoming)
      : blockScene(outgoing, incoming);
  });
  return arrival === 'same' ? [...departureAndArrival(first, first), ...scenes] : scenes;
}
