import { groundY, projectFigure, type GrassBlock } from './portraitScene';
import type { Face, Point } from './skinGeometry';

const tile = 12;
const palette = {
  a: [164, 192, 89], b: [132, 173, 71], c: [104, 150, 59], d: [76, 122, 52],
  e: [148, 103, 68], f: [123, 81, 52], g: [101, 66, 44], h: [175, 129, 88],
};

const topTile = [
  'bbcabbcddcbc', 'babbbccdcbac', 'abccbbbbcbba', 'bbdbacbbcbbc',
  'ccdcbbbaacbd', 'cdbcababbccd', 'bbbccbcbcdcb', 'cbacddbbbabb',
  'cabccbcbabbc', 'bbccbabccdcb', 'cdbcbbacddbc', 'bdccbcbbccba',
];
const sideTile = [
  'abcbacbbcdcb', 'bbcbbccdcbab', 'cbdbccdbbbcd', 'dfcdffcdcddf',
  'ffgceffgcdge', 'egfffehefgff', 'gfheefffheeg', 'ffeffghfefgf',
  'efgheefghffe', 'fheefgfefhff', 'effgffheefgf', 'gffefgeffgfe',
];
const bottomTile = [
  'effefghfegfe', 'gffgffeeheff', 'efhefgfefegf', 'ffeefghffefe',
  'fghfffefgfee', 'heefgeehffgf', 'fegfffgfheef', 'ggfehffeffge',
  'feffehfeegff', 'efhgfegffeff', 'fgefefgheefg', 'effgfeeffhff',
];

// The three tiles are the grass top, the soil-and-grass sides, and the soil bottom.
export const grassTexture = new Uint8ClampedArray(64 * 64 * 4);
for (const [side, rows] of [topTile, sideTile, bottomTile].entries()) {
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      const color = palette[rows[y][x] as keyof typeof palette];
      grassTexture.set([...color, 255], (y * 64 + side * tile + x) * 4);
    }
  }
}

const size = 3.55;
const vertices: Point[] = [
  [-size, -size, -size], [size, -size, -size], [-size, size, -size], [size, size, -size],
  [-size, -size, size], [size, -size, size], [-size, size, size], [size, size, size],
];
const sides = [[0, 4, 2, 1], [4, 5, 6, 1], [5, 1, 7, 1], [1, 0, 3, 1], [0, 1, 4, 0], [6, 7, 2, 2]];

function projectedVertices(yaw: number, spin: number): Point[] {
  const project = projectFigure({ x: 0, y: -groundY, yaw });
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  return vertices.map((vertex): Point => {
    const [u, v, z] = project(vertex);
    return [u * cos - v * sin, u * sin + v * cos, z];
  });
}

export function grassContactY(yaw: number, spin: number): number {
  return groundY + 4 - Math.max(...projectedVertices(yaw, spin).map(point => point[1]));
}

export function grassFaces({ x, y, yaw, spin, depth = 0 }: GrassBlock): Face[] {
  const points = projectedVertices(yaw, spin).map(([u, v, z]): Point => [x + u, y + v, z + depth]);
  return sides.map(([a, b, c, tileIndex]) => ({
    corners: [points[a], points[b], points[c]], texture: [tileIndex * tile, 0], width: tile, height: tile,
  }));
}
