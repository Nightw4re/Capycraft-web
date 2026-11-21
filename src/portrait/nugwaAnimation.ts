import { nugwaPose } from './nugwaPose';
import { cameraYaw, stageWidth, type Figure, type TimedFrame } from './portraitScene';
import type { Point, SkinPose } from './skinGeometry';

export const seatX = 449;
export const exitX = -48;
export const entranceX = stageWidth + 48;
export const leftYaw = cameraYaw - 1.23;
export const viewerYaw = cameraYaw - 0.08;
const peekX = stageWidth + 2;
const waveX = 73;

export const mix = (a: number, b: number, progress: number) => a + (b - a) * progress;
export const ease = (progress: number) => progress * progress * (3 - 2 * progress);

export function blendPose(from: SkinPose, to: SkinPose, progress: number): SkinPose {
  const point = (a: Point, b: Point): Point => [mix(a[0], b[0], progress), mix(a[1], b[1], progress), mix(a[2], b[2], progress)];
  const part = <T extends Point[]>(a: T, b: T): T => a.map((joint, index) => point(joint, b[index])) as T;
  return {
    head: part(from.head, to.head),
    headYaw: mix(from.headYaw, to.headYaw, progress),
    torso: part(from.torso, to.torso),
    rightArm: part(from.rightArm, to.rightArm),
    leftArm: part(from.leftArm, to.leftArm),
    rightLeg: part(from.rightLeg, to.rightLeg),
    leftLeg: part(from.leftLeg, to.leftLeg),
  };
}

function walkingPose(cycles: number, stride: number): SkinPose {
  const phase = cycles * 2 * Math.PI;
  const sway = stride * 0.32 * Math.sin(phase);
  const hip = -12 + stride * (1.15 + 0.22 * Math.cos(phase * 2));
  const shoulder = hip - 11.6;
  const lean = stride * 0.85;

  function leg(x: number, offset: number): SkinPose['leftLeg'] {
    const step = (cycles + offset) % 1;
    const stance = 0.57;
    const swing = Math.max(0, (step - stance) / (1 - stance));
    const reach = stride * 5.1;
    const forward = step < stance ? mix(reach, -reach, step / stance) : mix(-reach, reach, ease(swing));
    const foot = -0.15 - stride * 2.25 * Math.sin(Math.PI * swing) ** 2;
    const drop = foot - hip;
    const length = Math.hypot(drop, forward);
    const bend = Math.sqrt(Math.max(0, 6 ** 2 - (length / 2) ** 2));
    const knee: Point = [x + sway / 2, hip + drop / 2 - bend * forward / length, forward / 2 + bend * drop / length];
    return [[x + sway, hip, 0], knee, [x, foot, forward]];
  }

  function arm(x: number, offset: number): SkinPose['leftArm'] {
    const swing = -Math.cos(phase + offset) * stride * 3.6;
    return [
      [x + sway, shoulder, lean],
      [x * 1.02 + sway, shoulder + 5.85, lean + swing * 0.48],
      [x * 1.05 + sway, shoulder + 11.5 - Math.abs(swing) * 0.11, lean + swing + 0.35],
    ];
  }

  return {
    head: [[sway, shoulder - 7.9, lean + 0.1], [sway, shoulder, lean]],
    headYaw: -sway * 0.14,
    torso: [[sway, shoulder, lean], [sway, hip, 0]],
    rightArm: arm(-5.95, 0),
    leftArm: arm(5.95, Math.PI),
    rightLeg: leg(-2.08, 0),
    leftLeg: leg(2.08, 0.5),
  };
}

export const standing = walkingPose(0, 0);
const plantedHand: Point = [-9.2, -0.55, 5.2];
const braced: SkinPose = {
  head: [[-1.6, -20, 4.95], [-1.25, -12.6, 2.7]],
  headYaw: 0.02,
  torso: [[-1.2, -12.7, 2.55], [0, -2.7, -1.2]],
  rightArm: [[-6.9, -11.5, 2.8], [-8.2, -6, 4.4], plantedHand],
  leftArm: [[4.6, -12.2, 2.7], [6.7, -7.5, 5.25], [3.45, -6.5, 3.3]],
  rightLeg: [[-2.15, -2.7, -1.1], [-2.6, -2.4, 4.2], [-2.8, -0.6, 9.2]],
  leftLeg: [[2.1, -2.7, -1.15], [2.75, -7, 2.5], [3.3, -0.7, 5.05]],
};
const pushing: SkinPose = {
  head: [[-1.15, -19.4, 9.3], [-0.7, -12, 7.05]],
  headYaw: 0.02,
  torso: [[-0.7, -12.2, 6.9], [0, -6.05, -2.8]],
  rightArm: [[-6.4, -11.45, 7], [-7.9, -6.1, 6.5], plantedHand],
  leftArm: [[5.1, -11.75, 7], [5.9, -7.65, 4.35], [3.55, -6.75, 3.7]],
  rightLeg: [[-2.1, -6.05, -2.8], [-2.5, -4.6, 2.8], [-2.65, -0.35, 6.95]],
  leftLeg: [[2.1, -6.05, -2.8], [2.5, -6, 2.8], [2.65, -0.3, 4.55]],
};
const crouch: SkinPose = {
  head: [[0, -25.8, 2.1], [0, -18, 1.05]],
  headYaw: 0.08,
  torso: [[0, -18.1, 1.2], [0, -7, -1.3]],
  rightArm: [[-5.9, -17.6, 1.05], [-7.2, -12.1, 1.7], [-8.3, -6.2, 2.6]],
  leftArm: [[5.9, -17.6, 1.05], [6.8, -12.45, 3.15], [5.7, -7.4, 3.8]],
  rightLeg: [[-2.1, -7, -1.3], [-2.5, -5.3, 4.25], [-2.65, -0.3, 6.95]],
  leftLeg: [[2.1, -7, -1.3], [2.45, -5.7, 3.75], [2.65, -0.3, 4.55]],
};

type Gaze = { yaw: number; roll: number; pitch: number; lift: number };

const restingGaze = { yaw: nugwaPose.headYaw, roll: 0, pitch: 0, lift: 0 };
const leftGaze = { yaw: -0.57, roll: -0.17, pitch: 0.09, lift: -0.12 };
const rightGaze = { yaw: 0.74, roll: 0.15, pitch: -0.1, lift: 0.32 };

function look({ yaw, roll, pitch, lift }: Gaze): SkinPose {
  const [top, neck] = nugwaPose.head;
  const rise = neck[1] - top[1];
  const forward = top[2] - neck[2];
  const length = Math.hypot(rise, forward);
  const lean = Math.atan2(forward, rise) + pitch;
  const planar = length * Math.cos(roll);
  const sideways = length * Math.sin(roll);
  const fore = planar * Math.sin(lean);
  const heading = yaw - restingGaze.yaw;
  const height = neck[1] - lift;
  return {
    ...nugwaPose,
    head: [
      [neck[0] + sideways * Math.cos(heading) + fore * Math.sin(heading), height - planar * Math.cos(lean),
        neck[2] + fore * Math.cos(heading) - sideways * Math.sin(heading)],
      [neck[0], height, neck[2]],
    ],
    headYaw: yaw,
  };
}

export function turn(x: number, from: number, to: number, progress: number): Figure {
  const body = ease(progress);
  const head = ease(Math.min(1, progress * 1.8));
  return { pose: { ...standing, headYaw: (to - from) * (head - body) }, x, yaw: mix(from, to, body) };
}

export function walk(from: number, to: number, cycles: number, progress: number): Figure {
  const stride = ease(Math.min(1, progress * cycles * 3, (1 - progress) * cycles * 3));
  const position = progress - Math.sin(2 * Math.PI * progress) * 0.05;
  return { pose: walkingPose(progress * cycles, stride), x: mix(from, to, position), yaw: leftYaw };
}

function wave(raise: number, swing = 0): Figure {
  const [shoulder, elbow, hand] = standing.leftArm;
  function lift(from: Point, to: Point, origin: Point, angle: number, depth: number): Point {
    const x = to[0] - from[0];
    const y = to[1] - from[1];
    return [origin[0] + x * Math.cos(angle) + y * Math.sin(angle), origin[1] + y * Math.cos(angle) - x * Math.sin(angle),
      origin[2] + to[2] - from[2] + depth];
  }
  const liftedElbow = lift(shoulder, elbow, shoulder, raise * 1.29, raise * 1.2);
  const liftedHand = lift(elbow, hand, liftedElbow, raise * (2.9 + swing * 0.47), raise * 0.6);
  return { pose: { ...standing, leftArm: [shoulder, liftedElbow, liftedHand] }, x: waveX, yaw: viewerYaw };
}

function peek(progress: number): Figure {
  const pose: SkinPose = {
    ...standing,
    head: [[-3.05 * progress, -31.2, 0.65 * progress], [0.35 * progress, -23.8, 0]],
    headYaw: 0.12,
  };
  return { pose, x: mix(entranceX, peekX, progress), y: 35 - 9 * progress, yaw: cameraYaw - 0.23, headOnly: true };
}

const seatedAt = (pose: SkinPose): Figure => ({ pose, x: seatX, yaw: 0 });
export const seatedFigure = seatedAt(nugwaPose);
const emptyFrame: Figure = { pose: standing, x: entranceX, yaw: leftYaw };
export const hold = <T>(duration: number, frame: T): TimedFrame<T>[] => [{ duration, frame }];

export function animate<T>(duration: number, sample: (progress: number) => T): TimedFrame<T>[] {
  const frames = [];
  for (let index = 0, time = 0; time < duration; index++) {
    const next = Math.min(duration, Math.round((index + 1) * 1000 / 30));
    frames.push({ duration: next - time, frame: sample(time / duration) });
    time = next;
  }
  return frames;
}

type PoseKeyframe = { time: number; pose: SkinPose };

function poseSequence(keyframes: PoseKeyframe[]) {
  const last = keyframes[keyframes.length - 1];
  return animate(last.time, progress => {
    const time = progress * last.time;
    const end = keyframes.findIndex(key => key.time > time);
    const [from, to] = [keyframes[end - 1], keyframes[end]];
    const before = keyframes[end - 2] ?? from;
    const after = keyframes[end + 1] ?? to;
    const duration = to.time - from.time;
    const t = (time - from.time) / duration;
    const slope = (a: number, b: number) => a * b > 0 ? 2 * a * b / (a + b) : 0;

    // Match velocity at each shared pose while keeping each joint within its keyframe range.
    function interpolate(a: number, b: number, c: number, d: number) {
      const speed = (c - b) / duration;
      const start = before === from ? 0 : slope((b - a) / (from.time - before.time), speed);
      const finish = after === to ? 0 : slope(speed, (d - c) / (after.time - to.time));
      return mix(b, c, ease(t)) + duration * t * (1 - t) * ((1 - t) * start - t * finish);
    }

    function part<T extends Point[]>(name: Exclude<keyof SkinPose, 'headYaw'>): T {
      return from.pose[name].map((point, joint) => point.map((value, axis) => interpolate(
        before.pose[name][joint][axis], value, to.pose[name][joint][axis], after.pose[name][joint][axis],
      ))) as T;
    }

    return seatedAt({
      head: part('head'),
      headYaw: interpolate(before.pose.headYaw, from.pose.headYaw, to.pose.headYaw, after.pose.headYaw),
      torso: part('torso'),
      rightArm: part('rightArm'),
      leftArm: part('leftArm'),
      rightLeg: part('rightLeg'),
      leftLeg: part('leftLeg'),
    });
  });
}

function glance(duration: number, from: Gaze, to: Gaze, lift: number) {
  return animate(duration, progress => {
    const body = ease(progress);
    const arc = Math.sin(Math.PI * progress) ** 2;
    return seatedAt(look({
      yaw: mix(from.yaw, to.yaw, body),
      roll: mix(from.roll, to.roll, body),
      pitch: mix(from.pitch, to.pitch, body) - lift * 0.3 * arc,
      lift: mix(from.lift, to.lift, body) + lift * arc,
    }));
  });
}

export const standingUp = poseSequence([
  { time: 0, pose: nugwaPose },
  { time: 490, pose: braced },
  { time: 820, pose: pushing },
  { time: 1160, pose: crouch },
  { time: 1710, pose: standing },
]);

export const sittingDown = poseSequence([
  { time: 0, pose: standing },
  { time: 530, pose: crouch },
  { time: 840, pose: pushing },
  { time: 1190, pose: braced },
  { time: 1650, pose: nugwaPose },
]);

export const departureFrames = [
  ...hold(6600, seatedFigure),
  ...glance(510, restingGaze, leftGaze, 0.25),
  ...hold(450, seatedAt(look(leftGaze))),
  ...glance(780, leftGaze, rightGaze, 0.83),
  ...hold(520, seatedAt(look(rightGaze))),
  ...glance(450, rightGaze, restingGaze, 0.16),
  ...hold(260, seatedFigure),
  ...standingUp,
  ...animate(560, progress => turn(seatX, 0, leftYaw, progress)),
  ...animate(3400, progress => walk(seatX, waveX, 3.8, progress)),
  ...animate(570, progress => turn(waveX, leftYaw, viewerYaw, progress)),
  ...animate(410, progress => wave(ease(progress))),
  ...animate(1120, progress => wave(1, Math.sin(progress * 4 * Math.PI))),
  ...animate(400, progress => wave(1 - ease(progress))),
  ...animate(560, progress => turn(waveX, viewerYaw, leftYaw, progress)),
  ...animate(1260, progress => walk(waveX, exitX, 1.35, progress)),
];

export const arrivalFrames = [
  ...hold(2400, emptyFrame),
  ...animate(440, progress => peek(ease(progress))),
  ...hold(520, peek(1)),
  ...animate(400, progress => peek(1 - ease(progress))),
  ...hold(400, emptyFrame),
  ...animate(1580, progress => walk(entranceX, seatX, 1.7, progress)),
  ...animate(560, progress => turn(seatX, leftYaw, 0, progress)),
  ...sittingDown,
];
