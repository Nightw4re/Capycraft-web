import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../PreferencesProvider';
import type { PonderCaption, PonderManifest, PonderScene } from './format.mts';
import { createPonderRenderer, PonderWebGlUnavailable } from './renderer';
import { createPonderSource, PonderUnavailable } from './source';

type Failure = 'unavailable' | 'invalid' | 'webgl';
type Playback = { toggle: () => void; restart: () => void; seek: (tick: number) => void };
type Display = { tick: number; captions: PonderCaption[]; omitted: number; staticTextures: boolean };

function time(tick: number, ticksPerSecond: number) {
  const tenths = Math.floor(tick * 10 / ticksPerSecond);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

export function PonderPlayer({ server, scene }: { server: string; scene: PonderScene }) {
  const labels = usePreferences().text.ponderPlayer;
  const canvas = useRef<HTMLCanvasElement>(null);
  const playback = useRef<Playback>(undefined);
  const [manifest, setManifest] = useState<PonderManifest>();
  const [display, setDisplay] = useState<Display>();
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState<Failure>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const request = new AbortController();
    const { signal } = request;
    const source = createPonderSource(server, scene, signal);
    let renderer: ReturnType<typeof createPonderRenderer> | undefined;
    let timer: number | undefined;
    let running = false;
    let processing = false;
    let generation = 0;
    let pending: number | undefined;
    let currentTick = 0;
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

    async function pump() {
      if (processing) return;
      processing = true;
      try {
        while (pending !== undefined && !signal.aborted) {
          const target = pending;
          const version = generation;
          pending = undefined;
          const current = () => !signal.aborted && generation === version;
          const started = performance.now();
          try {
            const frame = await source.frame(target);
            if (!current()) continue;
            if (running) source.prefetch(target + 1, Math.min(lastTick + 1, target + 5));
            const result = await renderer!.render(frame, current);
            if (!result || !current()) continue;
            currentTick = target;
            setPosition(target);
            setDisplay({ tick: target, captions: frame.captions, ...result });
            setBusy(false);
            setFailure(undefined);
            if (running && currentTick < lastTick) {
              timer = window.setTimeout(() => queue(currentTick + 1), Math.max(0, interval - (performance.now() - started)));
            } else if (running) stop();
          } catch (error) {
            if (current()) report(error);
          }
        }
      } finally {
        processing = false;
      }
    }

    function queue(tick: number) {
      pending = Math.max(0, Math.min(lastTick, tick));
      generation++;
      void pump();
    }

    setManifest(undefined);
    setDisplay(undefined);
    setPlaying(false);
    setBusy(true);
    setFailure(undefined);
    setPosition(0);
    void source.manifest().then(info => {
      if (signal.aborted) return;
      lastTick = info.frameCount - 1;
      interval = 1000 / info.ticksPerSecond;
      element.width = info.width;
      element.height = info.height;
      setManifest(info);
      renderer = createPonderRenderer(element, info, source.asset);
      playback.current = {
        toggle() {
          if (running) {
            stop();
            generation++;
            pending = undefined;
            setBusy(false);
            setPosition(currentTick);
          } else if (lastTick > 0) {
            running = true;
            setPlaying(true);
            queue(currentTick >= lastTick ? 0 : currentTick + 1);
          }
        },
        restart() {
          window.clearTimeout(timer);
          running = lastTick > 0;
          setPlaying(running);
          setPosition(0);
          setBusy(true);
          queue(0);
        },
        seek(tick) {
          stop();
          setPosition(tick);
          setBusy(true);
          queue(tick);
        },
      };
      queue(0);
    }).catch(report);

    element.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      generation++;
      pending = undefined;
      playback.current = undefined;
      report(new PonderWebGlUnavailable());
    }, { signal });
    return () => {
      request.abort();
      window.clearTimeout(timer);
      playback.current = undefined;
      renderer?.dispose();
    };
  }, [attempt, scene, server]);

  const max = Math.max(0, (manifest?.frameCount ?? 1) - 1);
  const rate = manifest?.ticksPerSecond ?? 20;
  const canSeek = !!manifest && failure !== 'webgl' && max > 0;
  const prev = manifest?.keyframes.filter(tick => tick < position).at(-1);
  const next = manifest?.keyframes.find(tick => tick > position);
  return (
    <div className="ponder-player">
      <div className="ponder-viewport" style={manifest ? { aspectRatio: manifest.width / manifest.height } : undefined}>
        <canvas ref={canvas} data-tick={display?.tick} aria-label={scene.title || scene.id} role="img" />
        {busy && <p className="ponder-buffering" role="status">{labels.loadingFrame}</p>}
      </div>
      <div className="ponder-transport">
        <button type="button" disabled={!display || !canSeek} onClick={() => playback.current?.toggle()}>
          {playing ? labels.pause : labels.play}
        </button>
        <button type="button" disabled={!manifest || failure === 'webgl'} onClick={() => playback.current?.restart()}>
          {labels.restart}
        </button>
        <label className="ponder-timeline">
          <span>{labels.timeline}</span>
          <input type="range" min={0} max={max} value={position} disabled={!canSeek}
            aria-label={labels.timeline}
            aria-valuetext={`${time(position, rate)} / ${time(max, rate)}`}
            onChange={event => playback.current?.seek(event.currentTarget.valueAsNumber)} />
          <output>{time(position, rate)} / {time(max, rate)}</output>
        </label>
      </div>
      {!!manifest?.keyframes.length && <div className="ponder-keyframes" role="group" aria-label={labels.keyframes}>
        <button type="button" disabled={prev === undefined || !canSeek} onClick={() => prev !== undefined && playback.current?.seek(prev)}>
          {labels.previousKeyframe}
        </button>
        <button type="button" disabled={next === undefined || !canSeek} onClick={() => next !== undefined && playback.current?.seek(next)}>
          {labels.nextKeyframe}
        </button>
      </div>}
      {failure && <div className="ponder-message" role="status">
        <p>{labels[failure]}</p>
        <button type="button" onClick={() => setAttempt(current => current + 1)}>{labels.retry}</button>
      </div>}
      {!!display?.omitted && <p className="ponder-message" role="status">{labels.unsupported}</p>}
      {display?.staticTextures && <p className="ponder-message">{labels.staticTextures}</p>}
      {display?.captions.some(caption => caption.opacity > 0) && <div className="ponder-captions" aria-live="polite" aria-atomic="true">
        {display.captions.filter(caption => caption.opacity > 0).map((caption, index) => (
          <p key={index} style={{ borderInlineStartColor: `#${(caption.color & 0xffffff).toString(16).padStart(6, '0')}` }}>
            {caption.text}
          </p>
        ))}
      </div>}
    </div>
  );
}
