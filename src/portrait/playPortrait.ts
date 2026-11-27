import { createPortraitAnimation, createPortraitTransition, distinctPlayerNames, type PortraitArrival } from './portraitAnimation';
import { portraitCast } from './portraitCast';
import { createPortraitRenderer } from './renderPortrait';
import { createWebGLPortraitRenderer } from './renderPortraitWebGL';
import type { PortraitSkin } from './skinGeometry';
import { stageWidth, type Actor, type PortraitFrame, type TimedFrame } from './portraitScene';

export async function loadVisitorNames(server: string | undefined, signal: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({ roster: '1' });
  if (server) params.set('server', server);
  try {
    const response = await fetch(`/api/players?${params}`, { signal });
    if (!response.ok) return [];
    const { players } = await response.json() as { players?: unknown };
    return Array.isArray(players) ? players.filter(name => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function nameHash(name: string) {
  let hash = 0x811c9dc5;
  for (const letter of name.toLowerCase()) hash = Math.imul(hash ^ letter.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

export async function loadPortraitSkin(name: string, signal: AbortSignal, profile = false): Promise<PortraitSkin> {
  const texture = document.createElement('canvas');
  texture.width = texture.height = 64;
  const textureContext = texture.getContext('2d');
  if (!textureContext) throw new Error('Canvas is unavailable');

  const bundled = portraitCast.find(player => player.name.toLowerCase() === name.toLowerCase());
  let source = bundled?.skin.href;
  let model = bundled?.model;
  let objectUrl: string | undefined;
  if (!source) {
    const params = new URLSearchParams({ skin: name });
    if (profile) params.set('profile', '1');
    const response = await fetch(`/api/players?${params}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(6_000)]),
    });
    if (!response.ok) throw new Error(`Skin unavailable for ${name}`);
    model = response.headers.get('X-Minecraft-Skin-Model') === 'slim' ? 'slim' : 'classic';
    objectUrl = URL.createObjectURL(await response.blob());
    source = objectUrl;
  }
  try {
    const skin = new Image();
    skin.src = source;
    await skin.decode();
    const legacy = skin.naturalHeight === 32;
    if (skin.naturalWidth !== 64 || (!legacy && skin.naturalHeight !== 64)) throw new Error(`Invalid Java skin for ${name}`);
    textureContext.clearRect(0, 0, 64, 64);
    textureContext.drawImage(skin, 0, 0);
    return { pixels: textureContext.getImageData(0, 0, 64, 64).data, model: legacy ? 'legacy' : model ?? 'classic' };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function playPortrait(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  webGLCanvas: HTMLCanvasElement,
  players: readonly string[],
  arrival: PortraitArrival | undefined,
  signal: AbortSignal,
  onError: () => void,
  onActor: (name: string, fallback: boolean) => void,
  rotateRoster = false,
) {
  const loadSkin = (name: string) => loadPortraitSkin(name, signal);
  const texture = document.createElement('canvas');
  texture.width = texture.height = 64;
  const textureContext = texture.getContext('2d');
  if (!textureContext) throw new Error('Canvas is unavailable');
  const names = distinctPlayerNames(players);
  const rolling = rotateRoster && names.length > 0;
  const active = new Map<string, PortraitSkin>();
  const cache = new Map<string, PortraitSkin>();
  let fallback: PortraitSkin | undefined;
  let scene = arrival === 'same' ? -1 : 0;
  let timeline: { frame: PortraitFrame; end: number }[];
  let cycleDuration = 0;
  function loadTimeline(frames: TimedFrame<PortraitFrame>[]) {
    cycleDuration = 0;
    timeline = frames.map(({ frame, duration }) => ({ frame, end: cycleDuration += duration }));
  }

  function missingSkin(): PortraitSkin {
    textureContext!.clearRect(0, 0, 64, 64);
    textureContext!.fillStyle = '#7f9b9e';
    textureContext!.fillRect(0, 0, 32, 16);
    textureContext!.fillStyle = '#455963';
    textureContext!.fillRect(0, 16, 64, 16);
    textureContext!.fillStyle = '#24323a';
    textureContext!.fillRect(10, 11, 1, 1);
    textureContext!.fillRect(13, 11, 1, 1);
    return { pixels: textureContext!.getImageData(0, 0, 64, 64).data, model: 'legacy' };
  }

  async function prefetch(name: string) {
    const cached = cache.get(name);
    if (cached) {
      cache.delete(name);
      cache.set(name, cached);
      return;
    }
    const skin = await loadSkin(name).catch(() => fallback!);
    if (signal.aborted) return;
    if (cache.size >= 6) cache.delete(cache.keys().next().value!);
    cache.set(name, skin);
  }

  function loadScene() {
    const outgoing = names[Math.max(scene, 0) % names.length];
    const incoming = names[(scene + 1) % names.length];
    const outgoingSkin = active.get(outgoing) ?? cache.get(outgoing) ?? fallback!;
    const incomingSkin = cache.get(incoming) ?? fallback!;
    active.clear();
    active.set(outgoing, outgoingSkin);
    if (incoming !== outgoing) active.set(incoming, incomingSkin);
    loadTimeline(createPortraitTransition(outgoing, incoming, arrival ?? 'next', scene));
    const following = names[(scene + 2) % names.length];
    if (following !== outgoing && following !== incoming) void prefetch(following);
  }

  if (rolling) {
    names.sort((a, b) => nameHash(a) - nameHash(b) || a.localeCompare(b, 'en'));
    fallback = missingSkin();
    await Promise.all(names.slice(0, 2).map(prefetch));
    if (signal.aborted) return;
    loadScene();
  } else {
    const attempts = await Promise.allSettled(names.map(async name => [name, await loadSkin(name)] as const));
    if (signal.aborted) return;
    for (const result of attempts) if (result.status === 'fulfilled') active.set(...result.value);
    const useBundledCast = active.size === 0;
    if (useBundledCast) {
      for (const { name } of portraitCast) active.set(name, await loadSkin(name));
    }
    if (signal.aborted) return;
    loadTimeline(createPortraitAnimation([...active.keys()], arrival ?? (useBundledCast ? 'same' : 'next')));
  }

  const seatedFrame = timeline![0].frame;
  const options = new URLSearchParams(window.location.search);
  const measure = options.has('portraitPerf');
  let samples: number[] = [];
  let webGL: ReturnType<typeof createWebGLPortraitRenderer> | undefined;
  if (options.get('portraitRenderer') !== '2d') {
    try {
      webGL = createWebGLPortraitRenderer(webGLCanvas, active);
    } catch {
      // The paired 2D canvas is available even after WebGL acquired its own context.
    }
  }
  signal.addEventListener('abort', () => webGL?.dispose(), { once: true });
  let render2D: ((frame: PortraitFrame) => void) | undefined;
  function draw2D(frame: PortraitFrame) {
    if (!render2D) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable');
      const render = createPortraitRenderer(active);
      const raster = context.createImageData(canvas.width, canvas.height);
      render2D = next => {
        if (context.isContextLost?.()) throw new Error('Canvas 2D context was lost');
        render(next, raster);
        context.putImageData(raster, 0, 0);
      };
    }
    render2D(frame);
  }

  function switchTo2D() {
    webGL?.dispose();
    webGL = undefined;
    samples = [];
  }

  let announced: string | undefined;
  const draw = (frame: typeof seatedFrame) => {
    let started = measure ? performance.now() : 0;
    if (webGL) {
      try {
        webGL.render(frame);
      } catch {
        switchTo2D();
        if (measure) started = performance.now();
      }
    }
    if (!webGL) draw2D(frame);
    canvas.hidden = !!webGL;
    webGLCanvas.hidden = !webGL;
    if (measure) {
      samples.push(performance.now() - started);
      if (samples.length === 120) {
        samples.sort((a, b) => a - b);
        console.info(`Portrait ${webGL ? 'WebGL2' : 'Canvas 2D'} CPU draw time (ms)`, {
          median: (samples[59] + samples[60]) / 2,
          p95: samples[113],
        });
        samples = [];
      }
    }
    const actor = frame.actors.reduce<Actor | undefined>((seen, next) =>
      next.x > -24 && next.x < stageWidth + 24 ? next : seen, undefined);
    if (actor && actor.player !== announced) {
      const name = actor.player;
      announced = name;
      onActor(name, !!fallback && active.get(name) === fallback);
    }
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
    try {
      if (rolling && now - startedAt >= cycleDuration) {
        scene++;
        loadScene();
        startedAt = now;
      }
      const elapsed = (now - startedAt) % cycleDuration;
      const entry = timeline.find(({ end }) => end > elapsed)!;
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
      pausedAt = rolling ? Math.min(now - startedAt, cycleDuration) : (now - startedAt) % cycleDuration;
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
  canvas.addEventListener('contextlost', () => { if (!webGL) onError(); }, { signal });
  webGLCanvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (!webGL) return;
    switchTo2D();
    try {
      draw(painted);
    } catch {
      onError();
    }
  }, { signal });
  document.addEventListener('visibilitychange', syncVisibility, { signal });
  window.addEventListener('blur', () => { focused = false; syncVisibility(); }, { signal });
  window.addEventListener('focus', () => { focused = true; syncVisibility(); }, { signal });
  syncVisibility();
  return true;
}
