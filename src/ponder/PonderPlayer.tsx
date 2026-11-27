import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { PauseIcon, PlayIcon, RestartIcon, StepIcon } from '../layout/PlayIcon';
import type { PonderFrame, PonderManifest, PonderScene } from './format.mts';
import { PonderCaptions } from './PonderCaptions';
import { PonderItemReferences, type PonderItemNavigation } from './PonderItemReferences';
import { PonderTimeline } from './PonderTimeline';
import { ponderPart, ponderPartFilter } from './parts';
import { pickPonderBlock, type PonderBlockHit, type PonderPickingGroup } from './picking.mts';
import { createPonderRenderer, PonderWebGlUnavailable } from './renderer';
import { createPonderSource, PonderUnavailable } from './source';

type Failure = 'unavailable' | 'invalid' | 'webgl';
type Playback = { toggle: () => void; pause: () => void; restart: () => void; seek: (tick: number) => void };
type Display = Pick<PonderFrame, 'captions' | 'sceneToGui' | 'picking'> & { tick: number };
type PlaybackNotices = { omitted?: true; staticTextures?: true };

const controls = {
  en: { inspect: 'Click a part to see its role.', parts: 'Parts in this frame' },
  cs: { inspect: 'Klikni na součástku a zobrazí se její úloha.', parts: 'Součástky v tomto snímku' },
  de: { inspect: 'Klicke auf ein Teil, um seine Funktion zu sehen.', parts: 'Teile in diesem Bild' },
  es: { inspect: 'Haz clic en una pieza para ver su función.', parts: 'Piezas de este fotograma' },
  fr: { inspect: 'Cliquez sur une pièce pour voir son rôle.', parts: 'Pièces de cette image' },
  ja: { inspect: '部品をクリックすると役割が表示されます。', parts: 'このフレームの部品' },
  uk: { inspect: 'Натисніть на деталь, щоб побачити її роль.', parts: 'Деталі в цьому кадрі' },
} as const;

function sameOutline(a: PonderBlockHit | undefined, b: PonderBlockHit | undefined) {
  if (!a || !b) return a === b;
  return a.block === b.block && a.outline.length === b.outline.length
    && a.outline.every(([x, y], index) => x === b.outline[index][0] && y === b.outline[index][1]);
}

export function PonderPlayer({ server, scene, revision, autoplayReady, itemNavigation }: {
  server: string; scene: PonderScene; revision: string; autoplayReady: boolean; itemNavigation?: PonderItemNavigation;
}) {
  const { text, language } = usePreferences();
  const labels = text.ponderPlayer;
  const messages = controls[language];
  const pumpSpeed = scene.schematic === 'create:mechanical_pump/speed';
  const viewport = useRef<HTMLDivElement>(null);
  const autoplay = useRef(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const softwareCanvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<[number, number]>(undefined);
  const inspection = useRef(0);
  const playback = useRef<Playback>(undefined);
  const pickingSource = useRef<ReturnType<typeof createPonderSource>>(undefined);
  const [manifest, setManifest] = useState<PonderManifest>();
  const [display, setDisplay] = useState<Display>();
  const [notices, setNotices] = useState<PlaybackNotices>();
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState<Failure>();
  const [software, setSoftware] = useState(false);
  const [picking, setPicking] = useState<{ path: string; tick: number; groups: PonderPickingGroup[] | undefined }>();
  const [hovering, setHovering] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [hover, setHover] = useState<PonderBlockHit>();
  const [part, setPart] = useState<{ block: string; item?: string; outline?: PonderBlockHit['outline']; tick: number }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = canvas.current;
    const softwareElement = softwareCanvas.current;
    if (!element || !softwareElement) return;
    const request = new AbortController();
    const { signal } = request;
    const source = createPonderSource(server, scene, signal, revision);
    pickingSource.current = source;
    let renderer: ReturnType<typeof createPonderRenderer> | undefined;
    let sceneInfo: PonderManifest | undefined;
    let fallback: Promise<void> | undefined;
    let timer: number | undefined;
    let running = false;
    let processing = false;
    let generation = 0;
    let pending: number | undefined;
    let currentTick = 0;
    let firstTick = 0;
    let lastTick = 0;
    let interval = 50;

    function stop() {
      running = false;
      window.clearTimeout(timer);
      setPlaying(false);
    }

    function report(error: unknown) {
      if (signal.aborted) return;
      stop();
      setBusy(false);
      setFailure(error instanceof PonderWebGlUnavailable ? 'webgl' : error instanceof PonderUnavailable ? 'unavailable' : 'invalid');
    }

    function useCanvas2d(info: PonderManifest, output: HTMLCanvasElement) {
      fallback ??= import('./renderer2d').then(({ createPonderRenderer2d }) => {
        if (signal.aborted) return;
        const next = createPonderRenderer2d(output, info, source.asset);
        renderer?.dispose();
        renderer = next;
        setSoftware(true);
      });
      return fallback;
    }

    function recover(tick: number) {
      const output = softwareCanvas.current;
      if (!sceneInfo || !output || fallback || signal.aborted) return false;
      window.clearTimeout(timer);
      generation++;
      pending = undefined;
      renderer?.dispose();
      renderer = undefined;
      void useCanvas2d(sceneInfo, output).then(() => { if (!signal.aborted) queue(pending ?? tick); })
        .catch(() => report(new PonderWebGlUnavailable()));
      return true;
    }

    async function pump() {
      if (processing || !renderer) return;
      processing = true;
      try {
        while (pending !== undefined && !signal.aborted) {
          const activeRenderer = renderer;
          if (!activeRenderer) break;
          const target = pending;
          const version = generation;
          pending = undefined;
          const current = () => !signal.aborted && generation === version;
          const started = performance.now();
          try {
            const frame = await source.frame(target);
            if (!current()) continue;
            if (running) source.prefetch(target + 1, Math.min(lastTick + 1, target + 5));
            const result = await activeRenderer.render(frame, current, target);
            if (!result || !current()) continue;
            currentTick = target;
            setPosition(target);
            setDisplay({ tick: target, captions: frame.captions, sceneToGui: frame.sceneToGui, picking: frame.picking });
            if (result.omitted || result.staticTextures) {
              setNotices(previous => {
                const omitted = previous?.omitted || (result.omitted ? true : undefined);
                const staticTextures = previous?.staticTextures || (result.staticTextures ? true : undefined);
                return previous?.omitted === omitted && previous?.staticTextures === staticTextures ? previous : { omitted, staticTextures };
              });
            }
            setBusy(false);
            setFailure(undefined);
            if (running && currentTick < lastTick) {
              timer = window.setTimeout(() => queue(currentTick + 1), Math.max(0, interval - (performance.now() - started)));
            } else if (running) stop();
          } catch (error) {
            if (current() && (!(error instanceof PonderWebGlUnavailable) || !recover(target))) report(error);
          }
        }
      } finally {
        processing = false;
      }
    }

    function pause() {
      autoplay.current = false;
      if (!running) return;
      stop();
      generation++;
      pending = undefined;
      setBusy(false);
      setPosition(currentTick);
    }

    function redraw() {
      if (!running && !processing && renderer && playback.current) queue(currentTick);
    }
    const resize = new ResizeObserver(redraw);
    resize.observe(element);
    window.addEventListener('resize', redraw, { signal });

    function queue(tick: number) {
      pending = Math.max(firstTick, Math.min(lastTick, tick));
      generation++;
      void pump();
    }

    setManifest(undefined);
    setDisplay(undefined);
    setNotices(undefined);
    setPlaying(false);
    setBusy(true);
    setFailure(undefined);
    setSoftware(false);
    setPicking(undefined);
    setHovering(false);
    setHover(undefined);
    pointer.current = undefined;
    setPart(undefined);
    setPosition(0);
    void source.manifest().then(async info => {
      if (signal.aborted) return;
      sceneInfo = info;
      lastTick = info.frameCount - 1;
      // The pump capture starts with only the GUI shadow. The base appears on the next tick.
      firstTick = pumpSpeed ? Math.min(1, lastTick) : 0;
      interval = 1000 / info.ticksPerSecond;
      setManifest(info);
      try {
        renderer = createPonderRenderer(element, info, source.asset);
      } catch (error) {
        if (!(error instanceof PonderWebGlUnavailable)) throw error;
        try { await useCanvas2d(info, softwareElement); }
        catch { throw new PonderWebGlUnavailable(); }
      }
      if (signal.aborted) return;
      playback.current = {
        pause,
        toggle() {
          autoplay.current = false;
          if (running) pause();
          else if (lastTick > 0) {
            setPart(undefined);
            running = true;
            setPlaying(true);
            queue(currentTick >= lastTick ? firstTick : currentTick + 1);
          }
        },
        restart() {
          autoplay.current = false;
          setPart(undefined);
          setHover(undefined);
          window.clearTimeout(timer);
          running = lastTick > 0;
          setPlaying(running);
          setPosition(firstTick);
          setBusy(true);
          queue(firstTick);
        },
        seek(tick) {
          autoplay.current = false;
          setPart(undefined);
          setHover(undefined);
          stop();
          setPosition(tick);
          setBusy(true);
          queue(tick);
        },
      };
      queue(firstTick);
    }).catch(report);

    element.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      recover(currentTick);
    }, { signal });
    return () => {
      request.abort();
      resize.disconnect();
      window.clearTimeout(timer);
      playback.current = undefined;
      pickingSource.current = undefined;
      renderer?.dispose();
    };
  }, [attempt, pumpSpeed, scene, server, revision]);

  const pickingPath = display?.picking;
  const pickingTick = display?.tick;
  useEffect(() => {
    if ((!hovering && !partsOpen) || !pickingPath || pickingTick === undefined) return;
    let active = true;
    void pickingSource.current?.picking(pickingPath, pickingTick).then(groups => {
      if (active) setPicking({ path: pickingPath, tick: pickingTick, groups });
    });
    return () => { active = false; };
  }, [hovering, partsOpen, pickingPath, pickingTick, attempt, scene, server, revision]);

  const itemOpen = itemNavigation?.itemOpen;
  useEffect(() => {
    if (itemOpen) playback.current?.pause();
  }, [itemOpen]);

  const max = Math.max(0, (manifest?.frameCount ?? 1) - 1);
  const min = pumpSpeed ? Math.min(1, max) : 0;
  const rate = manifest?.ticksPerSecond ?? 20;
  const canSeek = !!manifest && failure !== 'webgl' && max > 0;
  const canPlay = !!display && canSeek;
  useEffect(() => {
    const element = viewport.current;
    if (!element || !autoplayReady || !canPlay || itemOpen || !autoplay.current) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    function start() {
      if (!visible || !autoplay.current || reducedMotion.matches || document.visibilityState !== 'visible') return;
      observer.disconnect();
      playback.current?.toggle();
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.intersectionRatio >= 0.25;
      start();
    }, { threshold: 0.25 });
    observer.observe(element);
    document.addEventListener('visibilitychange', start);
    reducedMotion.addEventListener('change', start);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', start);
      reducedMotion.removeEventListener('change', start);
    };
  }, [autoplayReady, canPlay, itemOpen]);

  const prev = manifest?.keyframes.filter(tick => tick < position).at(-1);
  const next = manifest?.keyframes.find(tick => tick > position);
  const keyframes = manifest?.keyframes ?? [];
  const pickingReady = pickingPath && picking?.path === pickingPath && picking.tick === pickingTick;
  const groups = pickingReady ? picking.groups : undefined;
  const listedGroups = pickingPath ? picking?.groups : undefined;
  const isPart = useMemo(() => ponderPartFilter(scene), [scene]);
  const availableParts = useMemo(() => new Map(listedGroups?.flatMap(group =>
    group.blocks.filter(isPart).map(block => [block.block, block] as const))), [listedGroups, isPart]);
  const marker = hover?.outline ?? (part?.tick === display?.tick ? part?.outline : undefined);
  const selectedPart = part && ponderPart(part.block, language, pumpSpeed);

  function locationOf(event: MouseEvent<HTMLCanvasElement>): [number, number] {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height];
  }

  function hitAt([x, y]: [number, number]) {
    if (!manifest || !display || !groups) return;
    return pickPonderBlock(display.sceneToGui, groups, x * manifest.width, y * manifest.height, isPart);
  }

  useLayoutEffect(() => {
    if (!pointer.current || !pickingPath || (pickingReady && !groups)) {
      setHover(undefined);
    } else if (groups && manifest && display) {
      const [x, y] = pointer.current;
      const hit = pickPonderBlock(display.sceneToGui, groups, x * manifest.width, y * manifest.height, isPart);
      setHover(current => sameOutline(current, hit) ? current : hit);
    }
  }, [display, groups, isPart, manifest, pickingPath, pickingReady]);

  function inspect(hit: { block: string; item?: string; outline?: PonderBlockHit['outline'] }, tick = display?.tick) {
    if (tick === undefined) return;
    playback.current?.pause();
    setPart({ ...hit, tick });
  }
  function surface(visible: boolean) {
    return {
      'data-tick': visible ? display?.tick : undefined,
      'data-pickable': visible && !!hover || undefined,
      'aria-hidden': !visible || undefined,
      'aria-label': scene.title || scene.id,
      role: 'img',
      onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
        if (event.pointerType !== 'mouse') return;
        pointer.current = locationOf(event);
        setHovering(true);
        if (!groups) return;
        const hit = hitAt(pointer.current);
        setHover(current => sameOutline(current, hit) ? current : hit);
      },
      onPointerLeave() {
        pointer.current = undefined;
        setHovering(false);
        setHover(undefined);
      },
      async onClick(event: MouseEvent<HTMLCanvasElement>) {
        const request = ++inspection.current;
        const source = pickingSource.current;
        if (!source || !manifest || !display || !pickingPath) return;
        const [x, y] = locationOf(event);
        const clickedGroups = groups ?? await source.picking(pickingPath, display.tick);
        if (!clickedGroups || request !== inspection.current || source !== pickingSource.current) return;
        const hit = pickPonderBlock(display.sceneToGui, clickedGroups, x * manifest.width, y * manifest.height, isPart);
        if (hit) inspect(hit, display.tick);
      },
    };
  }
  return (
    <div className="ponder-player">
      <div className="ponder-viewport" ref={viewport} data-renderer={software ? 'canvas2d' : 'webgl2'}
        style={manifest ? { aspectRatio: manifest.width / manifest.height } : undefined}>
        <canvas ref={canvas} {...surface(!software)} />
        <canvas ref={softwareCanvas} className="ponder-software-canvas" {...surface(software)} />
        {marker?.length && manifest ? <svg className="ponder-part-outline" aria-hidden="true"
          viewBox={`0 0 ${manifest.width} ${manifest.height}`} preserveAspectRatio="none">
          <polygon points={marker.map(([x, y]) => `${x},${y}`).join(' ')} />
        </svg> : null}
        <PonderCaptions captions={display?.captions} matrix={display?.sceneToGui} frame={manifest} />
        {busy && <p className="ponder-buffering" role="status">{labels.loadingFrame}</p>}
      </div>
      <div className="ponder-transport">
        <div className="ponder-transport-buttons">
          <button type="button" aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play}
            disabled={!canPlay} onClick={() => playback.current?.toggle()}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" aria-label={labels.restart} title={labels.restart}
            disabled={!canPlay} onClick={() => playback.current?.restart()}>
            <RestartIcon />
          </button>
          <button type="button" aria-label={labels.previousKeyframe} title={labels.previousKeyframe}
            disabled={prev === undefined || !canPlay} onClick={() => prev !== undefined && playback.current?.seek(prev)}>
            <StepIcon direction="previous" />
          </button>
          <button type="button" aria-label={labels.nextKeyframe} title={labels.nextKeyframe}
            disabled={next === undefined || !canPlay} onClick={() => next !== undefined && playback.current?.seek(next)}>
            <StepIcon direction="next" />
          </button>
        </div>
        <PonderTimeline min={min} max={max} position={Math.max(min, position)} rate={rate} keyframes={keyframes}
          pumpSpeed={pumpSpeed} disabled={!canPlay} onSeek={tick => playback.current?.seek(tick)} />
      </div>
      <div className="ponder-parts">
        <p>{messages.inspect}</p>
        <details onToggle={event => setPartsOpen(event.currentTarget.open)}>
          <summary>{messages.parts}</summary>
          <div className="ponder-parts-list" aria-busy={Boolean(partsOpen && pickingPath && !pickingReady)}>
            {[...availableParts.values()].map(block => <button key={block.block} type="button" disabled={!groups}
            aria-pressed={part?.block === block.block} onClick={() => inspect(block)}>
            {ponderPart(block.block, language)[0]}
            </button>)}
          </div>
        </details>
      </div>
      {part && selectedPart && <div className="ponder-part-detail" aria-live="polite">
        <button type="button" aria-label={text.close} onClick={() => setPart(undefined)}>×</button>
        <PonderItemReferences ids={[part.item ?? part.block]} navigation={itemNavigation} fallbackName={selectedPart[0]} />
        {selectedPart[1] && <p>{selectedPart[1]}</p>}
      </div>}
      {failure && <div className="ponder-message" role="status">
        <p>{labels[failure]}</p>
        <button type="button" onClick={() => setAttempt(current => current + 1)}>{labels.retry}</button>
      </div>}
      {notices && <div className="ponder-playback-notices">
        {notices.omitted && <p role="status">{labels.unsupported}</p>}
        {notices?.staticTextures && <p>{labels.staticTextures}</p>}
      </div>}
    </div>
  );
}
