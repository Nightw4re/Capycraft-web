import { createPortraitAnimation } from './portraitAnimation';
import { portraitCast } from './portraitCast';
import type { PortraitPlayer } from './portraitScene';
import { createPortraitRenderer } from './renderPortrait';
import type { PortraitSkin } from './skinGeometry';

const portraitFrames = createPortraitAnimation(portraitCast.map(player => player.name));
const seatedFrame = portraitFrames[0].frame;
let cycleDuration = 0;
const timeline = portraitFrames.map(({ frame, duration }) => ({ frame, end: cycleDuration += duration }));

export async function playPortrait(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onError: () => void,
) {
  const context = canvas.getContext('2d');
  if (!context || context.isContextLost?.()) throw new Error('Canvas is unavailable');

  const texture = document.createElement('canvas');
  texture.width = texture.height = 64;
  const textureContext = texture.getContext('2d');
  if (!textureContext) throw new Error('Canvas is unavailable');

  const loadSkin = async ({ name, skin: source, model }: PortraitPlayer): Promise<[string, PortraitSkin]> => {
    const skin = new Image();
    skin.src = source.href;
    await skin.decode();
    const legacy = skin.naturalHeight === 32;
    if (skin.naturalWidth !== 64 || (!legacy && skin.naturalHeight !== 64)) throw new Error(`Invalid Java skin for ${name}`);
    textureContext.clearRect(0, 0, 64, 64);
    textureContext.drawImage(skin, 0, 0);
    return [name, { pixels: textureContext.getImageData(0, 0, 64, 64).data, model: legacy ? 'legacy' : model }];
  };

  const loaded = await Promise.all(portraitCast.map(loadSkin));
  if (signal.aborted) return;

  const render = createPortraitRenderer(new Map(loaded));
  const raster = context.createImageData(canvas.width, canvas.height);
  const draw = (frame: typeof seatedFrame) => {
    if (context.isContextLost?.()) throw new Error('Canvas context was lost');
    render(frame, raster);
    context.putImageData(raster, 0, 0);
  };

  draw(seatedFrame);
  const canObserve = typeof IntersectionObserver !== 'undefined';
  let visible = !canObserve;
  let focused = true;
  let running = false;
  let startedAt = 0;
  let pausedAt = 0;
  let timeout: number | undefined;
  let animationFrame: number | undefined;
  let painted = seatedFrame;

  function cancelDraw() {
    window.clearTimeout(timeout);
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  }

  function drawNext() {
    if (!running || signal.aborted) return;
    const now = performance.now();
    const elapsed = (now - startedAt) % cycleDuration;
    const entry = timeline.find(({ end }) => end > elapsed)!;
    try {
      if (entry.frame !== painted) {
        draw(entry.frame);
        painted = entry.frame;
      }
      const delay = now + entry.end - elapsed - performance.now();
      if (delay > 50) {
        timeout = window.setTimeout(() => {
          animationFrame = window.requestAnimationFrame(drawNext);
        }, delay - 16);
      } else {
        animationFrame = window.requestAnimationFrame(drawNext);
      }
    } catch {
      onError();
    }
  }

  function syncVisibility() {
    const shouldRun = visible && focused && !document.hidden;
    if (signal.aborted || running === shouldRun) return;
    const now = performance.now();
    running = shouldRun;
    cancelDraw();
    if (running) {
      startedAt = now - pausedAt;
      drawNext();
    } else {
      pausedAt = (now - startedAt) % cycleDuration;
    }
  }

  const observer = canObserve ? new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncVisibility();
  }) : undefined;

  signal.addEventListener('abort', () => {
    cancelDraw();
    observer?.disconnect();
  }, { once: true });

  observer?.observe(stage);
  canvas.addEventListener('contextlost', onError, { signal });
  document.addEventListener('visibilitychange', syncVisibility, { signal });
  window.addEventListener('blur', () => { focused = false; syncVisibility(); }, { signal });
  window.addEventListener('focus', () => { focused = true; syncVisibility(); }, { signal });
  syncVisibility();
}
