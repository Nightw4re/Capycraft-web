export type Point = [x: number, y: number, z: number];
type UV = [u: number, v: number];
type Part = [start: Point, end: Point];
type Limb = [start: Point, joint: Point, end: Point];

export type PortraitSkin = { pixels: Uint8ClampedArray; model: 'classic' | 'slim' | 'legacy' };

export type SkinPose = {
  head: Part;
  headYaw: number;
  torso: Part;
  rightArm: Limb;
  leftArm: Limb;
  rightLeg: Limb;
  leftLeg: Limb;
};

export type Face = {
  corners: [Point, Point, Point];
  texture: UV;
  width: number;
  height: number;
  flipU?: boolean;
};

function normalize([x, y, z]: Point): Point {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

type Segment = {
  joints: Part;
  from: number;
  to: number;
};

function skinPart(
  [width, height, depth]: Point,
  base: UV,
  overlay: UV | undefined,
  segments: Segment[],
  overlayExpansion: number,
  yaw = 0,
  mirror = false,
): Face[] {
  const faces: Face[] = [];
  for (const { joints: [start, end], from, to } of segments) {
    const down = normalize([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
    const lateral: Point = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const slant = lateral[0] * down[0] + lateral[2] * down[2];
    const across = normalize([lateral[0] - slant * down[0], -slant * down[1], lateral[2] - slant * down[2]]);
    const forward: Point = [
      across[1] * down[2] - across[2] * down[1],
      across[2] * down[0] - across[0] * down[2],
      across[0] * down[1] - across[1] * down[0],
    ];

    // The split preserves each limb's UVs. Exposed joint caps use the adjacent row of skin.
    const rows = to - from;
    const strip = depth + from;
    const sides = [
      [0, 4, 2, 0, strip, depth, rows],
      [4, 5, 6, depth, strip, width, rows],
      [5, 1, 7, depth + width, strip, depth, rows],
      [1, 0, 3, 2 * depth + width, strip, width, rows],
      [0, 1, 4, depth, from === 0 ? 0 : strip, width, from === 0 ? depth : 1],
      [6, 7, 2, to === height ? depth + width : depth, to === height ? 0 : strip + rows - 1, width, to === height ? depth : 1],
    ];

    // As in Armor Preview, the outer skin uses expanded geometry and its own atlas region.
    for (const [texture, expansion] of [[base, 0], [overlay, overlayExpansion]] as const) {
      if (!texture) continue;
      const x = width / 2 + expansion;
      const z = depth / 2 + expansion;
      const top = -expansion - (from > 0 ? 0.4 : 0);
      const bottom = expansion + (to < height ? 0.4 : 0);
      const corner = (origin: Point, x: number, y: number, z: number): Point => [
        origin[0] + across[0] * x + down[0] * y + forward[0] * z,
        origin[1] + across[1] * x + down[1] * y + forward[1] * z,
        origin[2] + across[2] * x + down[2] * y + forward[2] * z,
      ];
      const corners = [
        corner(start, -x, top, -z), corner(start, x, top, -z),
        corner(end, -x, bottom, -z), corner(end, x, bottom, -z),
        corner(start, -x, top, z), corner(start, x, top, z),
        corner(end, -x, bottom, z), corner(end, x, bottom, z),
      ];
      for (const [index, [origin, right, down, u, v, width, height]] of sides.entries()) {
        // Legacy skins mirror the right limb onto the left, swapping the two side textures.
        const sourceU = mirror && index === 0 ? sides[2][3] : mirror && index === 2 ? sides[0][3] : u;
        faces.push({
          corners: [corners[origin], corners[right], corners[down]],
          texture: [texture[0] + sourceU, texture[1] + v],
          width,
          height,
          flipU: mirror,
        });
      }
    }
  }
  return faces;
}

function skinLimb([start, joint, end]: Limb, base: UV, overlay: UV | undefined, width = 4, mirror = false): Face[] {
  return skinPart([width, 12, 4], base, overlay, [
    { joints: [start, joint], from: 0, to: 6 },
    { joints: [joint, end], from: 6, to: 12 },
  ], 0.25, 0, mirror);
}

export function skinFaces(pose: SkinPose, headOnly: boolean, model: PortraitSkin['model']): Face[] {
  const head = skinPart([8, 8, 8], [0, 0], [32, 0], [{ joints: pose.head, from: 0, to: 8 }], 0.5, pose.headYaw);
  if (headOnly) return head;

  const legacy = model === 'legacy';
  const slim = model === 'slim';
  const insetArm = (limb: Limb, offset: number): Limb => {
    const shift = ([x, y, z]: Point): Point => [x + offset, y, z];
    return [shift(limb[0]), shift(limb[1]), shift(limb[2])];
  };

  return [
    ...head,
    ...skinPart([8, 12, 4], [16, 16], legacy ? undefined : [16, 32], [{ joints: pose.torso, from: 0, to: 12 }], 0.25),
    ...skinLimb(slim ? insetArm(pose.rightArm, 0.5) : pose.rightArm, [40, 16], legacy ? undefined : [40, 32], slim ? 3 : 4),
    ...skinLimb(slim ? insetArm(pose.leftArm, -0.5) : pose.leftArm, legacy ? [40, 16] : [32, 48], legacy ? undefined : [48, 48], slim ? 3 : 4, legacy),
    ...skinLimb(pose.rightLeg, [0, 16], legacy ? undefined : [0, 32]),
    ...skinLimb(pose.leftLeg, legacy ? [0, 16] : [16, 48], legacy ? undefined : [0, 48], 4, legacy),
  ];
}
