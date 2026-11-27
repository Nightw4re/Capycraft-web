type Point = { x: number; y: number };
type Size = { width: number; height: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function projectCaptionAnchor(anchor: Float32Array | undefined, matrix: Float32Array, frame: Size): Point | undefined {
  if (!anchor) return;
  const [x, y, z] = anchor;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (w <= 0) return;
  const u = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / (w * frame.width);
  const v = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / (w * frame.height);
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { x: u, y: v };
}

export function placeCaption(view: Size, bubble: Size, anchor?: Point) {
  const margin = 8;
  const gap = 16;
  const maxLeft = view.width - bubble.width - margin;
  const maxTop = view.height - bubble.height - margin;
  if (!anchor) return { left: clamp((view.width - bubble.width) / 2, margin, maxLeft), top: Math.max(margin, maxTop) };

  const tip = { x: anchor.x * view.width, y: anchor.y * view.height };
  const sideGap = clamp(view.width * 0.07, gap, 48);
  const right = tip.x + sideGap;
  const left = tip.x - sideGap - bubble.width;
  if (right <= maxLeft || left >= margin) {
    const onRight = right <= maxLeft;
    const top = clamp(tip.y - bubble.height / 2, margin, maxTop);
    return { left: onRight ? right : left, top, tip, tail: {
      x: onRight ? right : left + bubble.width, y: clamp(tip.y, top, top + bubble.height),
    } };
  }

  const fitsAbove = tip.y >= bubble.height + margin + 4;
  const above = fitsAbove || tip.y > view.height / 2;
  const top = clamp(above ? tip.y - gap - bubble.height : tip.y + gap, margin, maxTop);
  const boxLeft = clamp(tip.x - bubble.width / 2, margin, maxLeft);
  return { left: boxLeft, top, tip,
    tail: { x: clamp(tip.x, boxLeft, boxLeft + bubble.width), y: above ? top + bubble.height : top } };
}
