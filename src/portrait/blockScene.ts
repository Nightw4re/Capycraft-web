import { animate, blendPose, ease, entranceX, exitX, hold, leftYaw, mix, seatX, seatedFigure,
  sittingDown, standing, standingUp, turn, viewerYaw, walk } from './nugwaAnimation';
import { cameraYaw, projectFigure, type Figure, type GrassBlock, type PortraitFrame } from './portraitScene';
import { grassContactY } from './grassBlock';
import { nugwaPose } from './nugwaPose';
import type { Point, SkinPose } from './skinGeometry';

const blockYaw = cameraYaw - 0.61;
const blockOnGround: GrassBlock = { x: 29, y: grassContactY(blockYaw, 0), yaw: blockYaw, spin: 0, depth: 8 };
const examineX = 73;
const rightYaw = cameraYaw + 1.07;
const examine: Figure = { pose: standing, x: examineX, yaw: leftYaw };

const handToHead: SkinPose = {
  ...nugwaPose,
  head: [[0.45, -21.1, -0.2], nugwaPose.head[1]],
  headYaw: 0.08,
  leftArm: [nugwaPose.leftArm[0], [8, -17.1, 4.7], [4.3, -21.1, 1.5]],
};

function rubHead(progress: number): Figure {
  const rub = Math.sin(progress * 4 * Math.PI);
  const [shoulder, elbow, hand] = handToHead.leftArm;
  const rubbing: SkinPose = {
    ...handToHead,
    leftArm: [shoulder, elbow, [hand[0] + 0.24 * rub, hand[1] + 0.72 * rub, hand[2] + 0.58 * rub]],
  };
  const raise = ease(Math.min(1, progress * 6, (1 - progress) * 5));
  return { ...seatedFigure, pose: blendPose(nugwaPose, rubbing, raise) };
}

const studying: SkinPose = {
  ...standing,
  head: [[0, -30.6, 3.05], [0, -23.25, 0.45]],
};

const startled: SkinPose = {
  ...standing,
  head: [[0.32, -31.65, -1], standing.head[1]],
  leftArm: [standing.leftArm[0], [8.3, -18.6, 0.95], [9.4, -14.3, 3.9]],
  rightArm: [standing.rightArm[0], [-8.3, -18.6, 0.95], [-9.4, -14.3, 3.9]],
  leftLeg: [standing.leftLeg[0], [2.5, -6.7, 2.45], [2.8, -1.7, -0.2]],
  rightLeg: [standing.rightLeg[0], [-2.5, -6.7, 2.45], [-2.8, -1.7, -0.2]],
};

const shrugged: SkinPose = {
  ...standing,
  head: [[0.9, -31.65, 0.16], standing.head[1]],
  leftArm: [[6.05, -24.65, 0], [9.85, -20.25, 1.05], [13.1, -20.95, 5.55]],
  rightArm: [[-6.05, -24.65, 0], [-9.85, -20.25, 1.05], [-13.1, -20.95, 5.55]],
};

const reaching: SkinPose = {
  head: [[0, -19.6, 11.65], [0, -13.15, 7.15]],
  headYaw: 0,
  torso: [[0, -13.2, 7], [0, -6.2, -2.25]],
  leftArm: [[5.9, -12.95, 6.8], [5.5, -7.25, 8.1], [4.5, -1.6, 9.75]],
  rightArm: [[-5.9, -12.95, 6.8], [-5.9, -8.2, 3.75], [-3.75, -6.3, 7.2]],
  leftLeg: [[2.1, -6.2, -2.25], [2.65, -4.9, 3.2], [2.7, -0.5, 6.15]],
  rightLeg: [[-2.1, -6.2, -2.25], [-2.55, -5.2, 3.45], [-2.65, -0.4, 4.9]],
};

const carryingArm: SkinPose['leftArm'] = [standing.leftArm[0], [6.25, -18.16, 1.9], [5.6, -13.6, 5.55]];
const carrying: SkinPose = { ...standing, leftArm: carryingArm };

function grip(figure: Figure): GrassBlock {
  const hand = figure.pose.leftArm[2];
  const [x, y, depth] = projectFigure(figure)([hand[0], hand[1] - 3.8, hand[2] + 1.7]);
  return { x, y, depth: depth + 2, yaw: blockYaw, spin: 0 };
}

function carryWhileWalking(figure: Figure): Figure {
  const from = carryingArm[0];
  const shoulder = figure.pose.leftArm[0];
  const shift = (joint: Point): Point => [joint[0] + shoulder[0] - from[0], joint[1] + shoulder[1] - from[1],
    joint[2] + shoulder[2] - from[2]];
  return { ...figure, pose: { ...figure.pose, leftArm: [shoulder, shift(carryingArm[1]), shift(carryingArm[2])] } };
}

export function blockScene(outgoing: string, incoming: string) {
  function scene(figure: Figure, block?: GrassBlock, visitor?: Figure): PortraitFrame {
    const actors = [{ ...figure, player: outgoing }];
    if (visitor) actors.push({ ...visitor, player: incoming });
    return { actors, block };
  }

  const byBlock = (pose: SkinPose, yaw = leftYaw): Figure => ({ ...examine, pose, yaw });
  const study = byBlock(studying);
  const bounceX = 270;
  const hitX = seatX - 1;
  const hitY = 48;

  return [
    ...hold(4100, scene(seatedFigure)),
    ...animate(680, progress => scene(seatedFigure, {
      x: mix(589, hitX, progress), y: mix(28, hitY, progress) - 15 * Math.sin(Math.PI * progress),
      yaw: blockYaw + (1 - progress) * 1.45, spin: (progress - 1) * Math.PI * 2,
      depth: 34,
    })),
    ...animate(760, progress => {
      const recoil = Math.sin(Math.PI * Math.min(1, progress * 3.8));
      const [top, neck] = nugwaPose.head;
      const pose: SkinPose = {
        ...nugwaPose,
        head: [[top[0] - 1.5 * recoil, top[1] + 0.65 * recoil, top[2] + 1.35 * recoil], neck],
      };
      return scene({ ...seatedFigure, pose }, {
        x: mix(hitX, bounceX, progress), y: mix(hitY, blockOnGround.y, progress) - 50 * Math.sin(Math.PI * progress),
        yaw: blockYaw, spin: progress * Math.PI * 2, depth: mix(34, 8, progress),
      });
    }),
    ...animate(1340, progress => {
      const roll = 1 - (1 - Math.min(1, progress / 0.83)) ** 2;
      const spin = roll * Math.PI * 6;
      return scene(rubHead(progress), { ...blockOnGround, x: mix(bounceX, blockOnGround.x, roll), y: grassContactY(blockYaw, spin), spin });
    }),
    ...standingUp.map(({ duration, frame }) => ({ duration, frame: scene(frame, blockOnGround) })),
    ...animate(560, progress => scene(turn(seatX, 0, leftYaw, progress), blockOnGround)),
    ...animate(3400, progress => {
      const entry = Math.max(0, (progress - 0.53) / 0.47);
      return scene(walk(seatX, examineX, 3.8, progress), blockOnGround, walk(entranceX, seatX, 1.7, entry));
    }),
    ...animate(560, progress => scene(byBlock(blendPose(standing, studying, ease(progress))), blockOnGround,
      turn(seatX, leftYaw, 0, progress))),
    ...sittingDown.map(({ duration, frame }) => ({ duration, frame: scene(study, blockOnGround, frame) })),
    ...hold(260, scene(study, blockOnGround, seatedFigure)),
    ...animate(260, progress => scene(byBlock(blendPose(studying, standing, ease(progress))), blockOnGround, seatedFigure)),
    ...animate(620, progress => scene(turn(examineX, leftYaw, rightYaw, progress), blockOnGround, seatedFigure)),
    ...animate(470, progress => {
      const jump = Math.sin(Math.PI * progress) ** 2;
      return scene({ ...byBlock(blendPose(standing, startled, jump), rightYaw), y: -14 * jump }, blockOnGround, seatedFigure);
    }),
    ...hold(170, scene(byBlock(standing, rightYaw), blockOnGround, seatedFigure)),
    ...animate(540, progress => scene(turn(examineX, rightYaw, viewerYaw, progress), blockOnGround, seatedFigure)),
    ...animate(850, progress => scene(byBlock(blendPose(standing, shrugged,
      ease(Math.min(1, progress * 3, (1 - progress) * 3))), viewerYaw), blockOnGround, seatedFigure)),
    ...animate(550, progress => scene(turn(examineX, viewerYaw, leftYaw, progress), blockOnGround, seatedFigure)),
    ...animate(620, progress => scene(byBlock(blendPose(standing, reaching, ease(progress))), blockOnGround, seatedFigure)),
    ...animate(660, progress => {
      const figure = byBlock(blendPose(reaching, carrying, ease(progress)));
      const block = grip(figure);
      const attach = ease(Math.min(1, progress * 5));
      return scene(figure, { ...block, x: mix(blockOnGround.x, block.x, attach), y: mix(blockOnGround.y, block.y, attach),
        depth: mix(blockOnGround.depth ?? 0, block.depth ?? 0, attach) }, seatedFigure);
    }),
    ...animate(1280, progress => {
      const figure = carryWhileWalking(walk(examineX, exitX, 1.38, progress));
      return scene(figure, grip(figure), seatedFigure);
    }),
    ...hold(260, { actors: [{ ...seatedFigure, player: incoming }] }),
  ];
}
