import type { SkinPose } from './skinGeometry';

// Joint positions are in skin texels. Y grows downward, the ground is at Y = 0, and Z points forward.
export const nugwaPose: SkinPose = {
  head: [[-0.15, -21.6, -0.5], [-0.15, -13.7, -1.55]],
  headYaw: 0.14,
  torso: [[-0.15, -13.8, -1.7], [0, -2.2, 0]],
  // Supporting hand beside the hip, and the opposite hand laid across the raised knee.
  rightArm: [[-5.85, -13.3, -1.55], [-8.55, -7.2, -1.8], [-11.75, -1.05, -0.6]],
  leftArm: [[5.85, -13.3, -1.15], [7.85, -9.45, 3.75], [2.8, -7.8, 3.5]],
  rightLeg: [[-2.25, -2.15, 0], [-2.5, -2.1, 5.45], [-2.9, -2.05, 11.35]],
  leftLeg: [[2.05, -2.15, 0.05], [2.75, -7.5, 2.65], [3.3, -1.1, 5.35]],
};
