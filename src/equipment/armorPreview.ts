import type { EquipmentLoadout } from './contract.mts';
import { createArmorScene } from './armor-geometry.mjs';
import type { PortraitSkin } from '../portrait/skinGeometry';

const armorSlots = ['legs', 'feet', 'chest', 'head'] as const;
const textureHash = /^[a-f0-9]{64}$/;
const honeyBeeLeggings = new Set(['the_bumblezone:honey_bee_leggings_1', 'the_bumblezone:honey_bee_leggings_2']);
const honeyBeeFallbackDye = 0xd89a35;

type Layer = { texture: string; tint?: number };
type Piece = { id: string; slot: string; layers: Layer[]; profile: string };
type Trim = { material: string; pattern: string; texture: string; decal?: boolean };
type ArmorDesign = { version: number; pieces: Piece[]; profiles: Record<string, Trim[]> };

function surface(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.imageSmoothingEnabled = false;
  return context;
}

// WebCraft's geometry uses independent left limbs, including for legacy skins.
function skinAtlas(skin: PortraitSkin) {
  const atlas = surface(64, 64);
  atlas.putImageData(new ImageData(new Uint8ClampedArray(skin.pixels), 64, 64), 0, 0);
  if (skin.model === 'legacy') {
    const source = surface(64, 64);
    source.drawImage(atlas.canvas, 0, 0);
    for (const [x, y, toX, width, height] of [
      [4, 16, 20, 4, 4], [8, 16, 24, 4, 4], [0, 20, 24, 4, 12], [4, 20, 20, 4, 12],
      [8, 20, 16, 4, 12], [12, 20, 28, 4, 12], [44, 16, 36, 4, 4], [48, 16, 40, 4, 4],
      [40, 20, 40, 4, 12], [44, 20, 36, 4, 12], [48, 20, 32, 4, 12], [52, 20, 44, 4, 12],
    ]) {
      atlas.save();
      atlas.translate(toX + width, y + 32);
      atlas.scale(-1, 1);
      atlas.drawImage(source.canvas, x, y, width, height, 0, 0, width, height);
      atlas.restore();
    }
  }
  return atlas.canvas;
}

function armorFrameWidth(image: HTMLImageElement) {
  const width = image.height * 2;
  // The baked mesh uses a 2:1 atlas. Some resource packs place multiple such frames side by side.
  return image.width % width === 0 ? width : image.width;
}

function drawLayer(atlas: CanvasRenderingContext2D, image: HTMLImageElement, tint?: number) {
  const { width, height } = atlas.canvas;
  const frameWidth = armorFrameWidth(image);
  if (tint === undefined) {
    atlas.drawImage(image, 0, 0, frameWidth, image.height, 0, 0, width, height);
    return;
  }
  const layer = surface(width, height);
  layer.drawImage(image, 0, 0, frameWidth, image.height, 0, 0, width, height);
  const pixels = layer.getImageData(0, 0, width, height);
  const red = (tint >>> 16) / 255;
  const green = ((tint >>> 8) & 255) / 255;
  const blue = (tint & 255) / 255;
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] *= red;
    pixels.data[index + 1] *= green;
    pixels.data[index + 2] *= blue;
  }
  layer.putImageData(pixels, 0, 0);
  atlas.drawImage(layer.canvas, 0, 0);
}

export async function loadArmorPreview(canvas: HTMLCanvasElement, server: string, player: string,
  skin: PortraitSkin, slots: EquipmentLoadout['slots'], signal: AbortSignal) {
  if (!armorSlots.some(slot => slots[slot])) return;

  async function fetchAsset(equipment: string, hash?: string) {
    const query = new URLSearchParams({ server, player, equipment });
    if (hash) query.set('hash', hash);
    const response = await fetch(`/api/players?${query}`, { signal });
    if (!response.ok) throw new Error('Armor asset unavailable');
    return response;
  }

  const [design, geometry] = await Promise.all([
    fetchAsset('armor-data').then(response => response.json() as Promise<ArmorDesign>),
    fetchAsset('armor-geometry').then(response => response.json() as Promise<unknown>),
  ]);
  if (design.version !== 1) return;

  const textures = new Map<string, Promise<HTMLImageElement>>();
  function texture(hash: string) {
    if (!textureHash.test(hash)) throw new Error('Invalid armor texture');
    let pending = textures.get(hash);
    if (!pending) {
      pending = fetchAsset('armor-texture', hash).then(async response => {
        const url = URL.createObjectURL(await response.blob());
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (image.width > 1024 || image.height > 1024) throw new Error('Invalid armor texture size');
          return image;
        } finally {
          URL.revokeObjectURL(url);
        }
      });
      textures.set(hash, pending);
    }
    return pending;
  }

  const layers = await Promise.all(armorSlots.map(async slot => {
    const item = slots[slot];
    if (!item) return;
    const exact = design.pieces.find(piece => piece.id === item.id && piece.slot === slot);
    const useHoneyBeeFallback = !exact && slot === 'legs' && honeyBeeLeggings.has(item.id);
    const piece = useHoneyBeeFallback
      ? design.pieces.find(piece => piece.id === 'minecraft:leather_leggings' && piece.slot === slot)
      : exact;
    if (!piece?.layers.length) return;
    try {
      const trim = item.trim && design.profiles[piece.profile]?.find(entry =>
        entry.material === item.trim?.material && entry.pattern === item.trim?.pattern);
      const [base, decoration] = await Promise.all([
        Promise.all(piece.layers.map(layer => texture(layer.texture))),
        trim && texture(trim.texture).catch(() => undefined),
      ]);
      const atlas = surface(Math.max(...base.map(armorFrameWidth), decoration ? armorFrameWidth(decoration) : 0),
        Math.max(...base.map(image => image.height), decoration?.height ?? 0));
      base.forEach((image, index) => {
        const tint = piece.layers[index].tint;
        drawLayer(atlas, image, tint === undefined ? undefined : item.dye ?? (useHoneyBeeFallback ? honeyBeeFallbackDye : tint));
      });
      if (decoration) {
        atlas.globalCompositeOperation = trim?.decal ? 'source-atop' : 'source-over';
        drawLayer(atlas, decoration);
      }
      return [slot, atlas.canvas] as const;
    } catch {
      return undefined;
    }
  }));
  const equipped = layers.filter(layer => layer !== undefined);
  if (signal.aborted || equipped.length === 0) return;
  const atlas = skinAtlas(skin);
  const scene = createArmorScene(canvas, geometry);
  if (!scene) return;
  try {
    scene.setSkin({ image: atlas, slim: skin.model === 'slim' });
    scene.equip(equipped);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
}
