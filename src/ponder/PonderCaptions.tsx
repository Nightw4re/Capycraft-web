import { useId, useLayoutEffect, useRef, useState } from 'react';
import { placeCaption, projectCaptionAnchor } from './captionLayout.mts';
import type { PonderCaption, PonderManifest } from './format.mts';

function SceneCaption({ caption, matrix, frame }: {
  caption: PonderCaption; matrix: Float32Array; frame: PonderManifest;
}) {
  const arrowId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const [bounds, setBounds] = useState<{ view: { width: number; height: number }; bubble: { width: number; height: number } }>();

  useLayoutEffect(() => {
    const box = text.current;
    const stage = layer.current;
    if (!box || !stage) return;
    const measure = () => {
      setBounds({ view: { width: stage.clientWidth, height: stage.clientHeight },
        bubble: { width: box.offsetWidth, height: box.offsetHeight } });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const anchor = projectCaptionAnchor(caption.anchor, matrix, frame);
  const placement = bounds && placeCaption(bounds.view, bounds.bubble, anchor);
  const { tip, tail } = placement ?? {};
  const color = `#${(caption.color & 0xffffff).toString(16).padStart(6, '0')}`;
  return <div className="ponder-caption" ref={layer} style={{ opacity: caption.opacity }}>
    {tip && tail && Math.hypot(tip.x - tail.x, tip.y - tail.y) > 2 &&
      <svg className="ponder-caption-leader" aria-hidden="true">
        <defs><marker id={arrowId} viewBox="0 0 10 8" markerWidth="8" markerHeight="8"
          refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 0L10 4 0 8Z" fill={color} />
        </marker></defs>
        <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} stroke={color} strokeWidth="2"
          markerEnd={`url(#${arrowId})`} />
      </svg>}
    <p ref={text} style={{ left: placement?.left, top: placement?.top, borderColor: color }}>{caption.text}</p>
  </div>;
}

export function PonderCaptions({ captions, matrix, frame }: {
  captions?: readonly PonderCaption[]; matrix?: Float32Array; frame?: PonderManifest;
}) {
  return <div className="ponder-captions" aria-live="polite" aria-atomic="true">
    {matrix && frame && captions?.filter(caption => caption.opacity > 0 && caption.text.trim()).map((caption, index) =>
      <SceneCaption key={index} caption={caption} matrix={matrix} frame={frame} />)}
  </div>;
}
