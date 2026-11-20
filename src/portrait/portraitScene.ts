import type { Point, SkinPose } from './skinGeometry';

export const stageWidth = 560;
export const stageHeight = 192;
export const groundY = 164;
export const cameraYaw = 0.58;

const scale = 4.65;
const elevationCos = Math.cos(0.28);
const elevationSin = Math.sin(0.28);

export type PortraitPlayer = { name: string; model: 'classic' | 'slim'; skin: URL };

export type Figure = {
  pose: SkinPose;
  x: number;
  yaw: number;
  y?: number;
  headOnly?: boolean;
};

export type Actor = Figure & { player: string };

export type GrassBlock = { x: number; y: number; yaw: number; spin: number; depth?: number };

export type PortraitFrame = { actors: Actor[]; block?: GrassBlock };

export type TimedFrame<T> = { duration: number; frame: T };

export function projectFigure({ x: offsetX, y: offsetY = 0, yaw }: Pick<Figure, 'x' | 'y' | 'yaw'>) {
  const viewCos = Math.cos(cameraYaw - yaw);
  const viewSin = Math.sin(cameraYaw - yaw);
  return ([x, y, z]: Point): Point => {
    const depth = x * viewSin + z * viewCos;
    return [
      (x * viewCos - z * viewSin) * scale + offsetX,
      (y * elevationCos + depth * elevationSin) * scale + groundY + offsetY,
      (depth * elevationCos - y * elevationSin) * scale,
    ];
  };
}
