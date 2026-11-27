export type ProgressPosition = { x: number; y: number };

export function readProgressPosition(x: unknown, y: unknown): ProgressPosition | undefined {
  if (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 8192
    && typeof y === 'number' && Number.isFinite(y) && Math.abs(y) <= 8192) return { x, y };
}

export type ProgressNode = {
  id: string;
  title: string;
  iconItemId?: string;
  iconImage?: string;
  position?: ProgressPosition;
  size?: number;
  shape?: string;
  dependencyIds?: readonly string[];
  hideDependencyLines?: boolean;
  hideDependentLines?: boolean;
};

export type ProgressDecoration = {
  id: string;
  position: ProgressPosition;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  foreground?: boolean;
  iconItemId?: string;
  iconImage?: string;
};

const noDecorations: readonly ProgressDecoration[] = [];

const margin = 62;
const spacing = 82;

export function layoutProgress<T extends ProgressNode>(entries: readonly T[], decorations = noDecorations) {
  const positions = new Map<string, ProgressPosition>();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const entry of entries) {
    const position = entry.position;
    if (!position) continue;
    positions.set(entry.id, position);
    left = Math.min(left, position.x);
    right = Math.max(right, position.x);
    top = Math.min(top, position.y);
    bottom = Math.max(bottom, position.y);
  }
  for (const decoration of decorations) {
    const { x, y } = decoration.position;
    const radius = decoration.rotation ? Math.hypot(decoration.width, decoration.height) / 2 : undefined;
    left = Math.min(left, x - (radius ?? decoration.width / 2));
    right = Math.max(right, x + (radius ?? decoration.width / 2));
    top = Math.min(top, y - (radius ?? decoration.height / 2));
    bottom = Math.max(bottom, y + (radius ?? decoration.height / 2));
  }
  if (!positions.size && !decorations.length) left = right = top = bottom = 0;

  // Keep author coordinates and scale distant outliers into a scrollable area.
  const unit = Math.min(spacing, 24_000 / Math.max(1, right - left, bottom - top));
  let unpositioned = 0;
  let width = 2 * margin + (right - left) * unit;
  let height = 2 * margin + (bottom - top) * unit;
  const nodes = entries.map(entry => {
    const position = positions.get(entry.id);
    let x: number;
    let y: number;
    if (position) {
      x = margin + (position.x - left) * unit;
      y = margin + (position.y - top) * unit;
    } else {
      x = margin + unpositioned % 4 * spacing;
      y = margin + (positions.size || decorations.length ? (bottom - top) * unit + spacing : 0)
        + Math.floor(unpositioned / 4) * spacing;
      unpositioned++;
    }
    width = Math.max(width, x + margin);
    height = Math.max(height, y + margin);
    return { entry, x, y };
  });

  const lookup = new Map(nodes.map(node => [node.entry.id, node]));
  const allEdges = nodes.flatMap(target => (target.entry.dependencyIds ?? []).flatMap(id => {
    const source = lookup.get(id);
    if (!source || source === target) return [];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (!dx && !dy) return [];
    return [{ source, target, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) }];
  }));
  const hidden = ({ source, target }: typeof allEdges[number]) =>
    source.entry.hideDependentLines || target.entry.hideDependencyLines;
  const edges = allEdges.filter(edge => !hidden(edge));
  const concealedEdges = allEdges.filter(hidden);
  const centerX = margin + (right - left) * unit / 2;
  const centerY = margin + (bottom - top) * unit / 2;
  let focus: ProgressPosition | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (!node.entry.position) continue;
    const distance = (node.x - centerX) ** 2 + (node.y - centerY) ** 2;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    focus = { x: node.x, y: node.y };
  }
  const images = decorations.map(decoration => ({
    decoration,
    x: margin + (decoration.position.x - left) * unit,
    y: margin + (decoration.position.y - top) * unit,
    width: decoration.width * unit,
    height: decoration.height * unit,
  }));
  return { width, height, nodes, edges, concealedEdges,
    focus: focus ?? (images.length ? { x: centerX, y: centerY } : undefined), images };
}
