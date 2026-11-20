import { blockScene } from './blockScene';
import { soloFrames } from './nugwaAnimation';
import type { PortraitFrame, TimedFrame } from './portraitScene';

export function createPortraitAnimation(players: string[]): TimedFrame<PortraitFrame>[] {
  const [first] = players;
  const solo = soloFrames.map(({ frame, duration }) => ({ duration, frame: { actors: [{ ...frame, player: first }] } }));
  if (players.length === 1) return solo;

  return [...solo, ...players.flatMap((player, index) => blockScene(player, players[(index + 1) % players.length]))];
}
