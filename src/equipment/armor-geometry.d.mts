type ArmorScene = {
  equip(layers: readonly (readonly [string, HTMLCanvasElement])[]): void;
  setSkin(skin: { image: HTMLCanvasElement; slim: boolean }): void;
  draw(angle: number, elevation: number): void;
  dispose(): void;
};

export function createArmorScene(canvas: HTMLCanvasElement, geometry: unknown): ArmorScene | null;
