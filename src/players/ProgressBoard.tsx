import { useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePreferences } from '../PreferencesProvider';
import { layoutProgress, type ProgressDecoration, type ProgressNode } from '../progressLayout.mts';
import { ItemIcon } from '../items/ItemCatalog';
import { useProgressItems } from './useProgressIcons';
import './progress-board.css';

const zoomLabels = {
  en: ['Zoom out', 'Zoom in'], cs: ['Oddálit', 'Přiblížit'], de: ['Verkleinern', 'Vergrößern'],
  fr: ['Zoom arrière', 'Zoom avant'], es: ['Alejar', 'Acercar'], ja: ['縮小', '拡大'],
  uk: ['Зменшити', 'Збільшити'],
} as const;

const missingLayoutLabels = {
  en: 'The server has not provided the in-game layout yet.',
  cs: 'Rozložení ze hry zatím není k dispozici.',
  de: 'Das Layout aus dem Spiel ist noch nicht verfügbar.',
  fr: 'La disposition du jeu n’est pas encore disponible.',
  es: 'La disposición del juego aún no está disponible.',
  ja: 'ゲーム内の配置はまだ取得できていません。',
  uk: 'Розташування з гри ще недоступне.',
} as const;

const noDecorations: readonly ProgressDecoration[] = [];

export function ProgressBoard<T extends ProgressNode>({ server, label, entries, completed, doneLabel, pendingLabel,
  selectedId, onSelect, tooltip, renderFrame, decorations = noDecorations }: {
  server: string; label: string; entries: readonly T[]; completed?: ReadonlySet<string>;
  doneLabel: string; pendingLabel: string; selectedId: string; onSelect: (id: string) => void;
  tooltip?: (entry: T) => ReactNode; decorations?: readonly ProgressDecoration[];
  renderFrame?: (frame: ReactNode) => ReactNode;
}) {
  const id = useId();
  const { language } = usePreferences();
  const { width, height, nodes, edges, concealedEdges, focus, images } = useMemo(
    () => layoutProgress(entries, decorations), [entries, decorations]);
  const artwork = useProgressItems(server, [...entries, ...decorations]);
  const icons = artwork?.icons;
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const anchorButton = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef('');
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number }>(undefined);
  const highlighted = (id: string) => id === selectedId || id === hovered;
  const visibleEdges = [...edges, ...concealedEdges.filter(({ source, target }) =>
    (!target.entry.hideDependencyLines || target.entry.id === hovered)
    && (highlighted(source.entry.id) || highlighted(target.entry.id)))];
  const selected = tooltip && !selectedId && nodes.find(node => node.entry.id === hovered);
  const [out, into] = zoomLabels[language];
  const placeTooltip = () => {
    const view = viewport.current;
    const button = anchorButton.current;
    const panel = tooltipRef.current;
    if (!view || !button || !panel) return;
    const bounds = view.getBoundingClientRect();
    const node = button.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(Math.max(gap, node.left - bounds.left + (node.width - panel.offsetWidth) / 2),
      Math.max(gap, view.clientWidth - panel.offsetWidth - gap));
    const below = node.bottom - bounds.top + gap;
    const above = node.top - bounds.top - panel.offsetHeight - gap;
    const top = below + panel.offsetHeight <= view.clientHeight ? below : above;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(Math.max(gap, top), Math.max(gap, view.clientHeight - panel.offsetHeight - gap))}px`;
  };
  const reposition = useEffectEvent(placeTooltip);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !focus) return;
    const layoutKey = `${width}:${height}:${focus.x}:${focus.y}`;
    if (initialScroll.current === layoutKey) return;
    initialScroll.current = layoutKey;
    element.scrollLeft = focus.x * zoom - element.clientWidth / 2;
    element.scrollTop = focus.y * zoom - element.clientHeight / 2;
  }, [width, height, focus, zoom]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !selectedButton.current) return;
    const bounds = element.getBoundingClientRect();
    const button = selectedButton.current.getBoundingClientRect();
    if (button.left < bounds.left || button.right > bounds.left + element.clientWidth) {
      element.scrollLeft += button.left - bounds.left + (button.width - element.clientWidth) / 2;
    }
    if (button.top < bounds.top || button.bottom > bounds.top + element.clientHeight) {
      element.scrollTop += button.top - bounds.top + (button.height - element.clientHeight) / 2;
    }
  }, [selectedId, zoom]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    reposition();
    if (!tooltipRef.current) return;
    const observer = new ResizeObserver(() => reposition());
    observer.observe(element);
    observer.observe(tooltipRef.current);
    return () => observer.disconnect();
  }, [selectedId, hovered, zoom]);

  const frame = <div className="progress-board-frame">
      <div className="progress-board-viewport" ref={viewport} role="region" aria-label={label} tabIndex={0}
        onScroll={placeTooltip}
        onDragStart={event => event.preventDefault()}
        onPointerDown={event => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          const viewport = event.currentTarget;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            left: viewport.scrollLeft, top: viewport.scrollTop };
        }}
        onPointerMove={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          const { x, y, left, top } = drag.current;
          const viewport = event.currentTarget;
          const dx = x - event.clientX;
          const dy = y - event.clientY;
          if (!viewport.hasPointerCapture(event.pointerId)) {
            if (Math.hypot(dx, dy) < 5) return;
            viewport.setPointerCapture(event.pointerId);
          }
          event.preventDefault();
          viewport.scrollLeft = left + dx;
          viewport.scrollTop = top + dy;
        }}
        onPointerLeave={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) drag.current = undefined;
        }}
        onPointerUp={() => { drag.current = undefined; }}
        onPointerCancel={() => { drag.current = undefined; }}
        onLostPointerCapture={() => { drag.current = undefined; }}>
        <div className="progress-board-plane" style={{ width: width * zoom, height: height * zoom }}>
          {images.map(({ decoration, x, y, width, height }) => {
            const src = decoration.iconImage ?? (decoration.iconItemId && icons?.get(decoration.iconItemId));
            return src && <img key={decoration.id} src={src} alt="" className="progress-board-decoration" loading="lazy" draggable={false}
              data-foreground={decoration.foreground} style={{ left: x * zoom, top: y * zoom, width: width * zoom,
                height: height * zoom, rotate: `${decoration.rotation ?? 0}deg`, opacity: decoration.opacity }} />;
          })}
          {visibleEdges.map(({ source, target, length, angle }) =>
            <span key={`${source.entry.id}:${target.entry.id}`} className="progress-board-edge" aria-hidden="true"
              data-completed={!!completed?.has(source.entry.id) && completed.has(target.entry.id)}
              data-selected={highlighted(source.entry.id) || highlighted(target.entry.id)}
              style={{ left: source.x * zoom, top: source.y * zoom, width: length * zoom, rotate: `${angle}rad` }} />)}
          {nodes.map(({ entry, x, y }) => {
            const done = completed?.has(entry.id);
            const sprite = !entry.iconImage && entry.iconItemId ? artwork?.items?.get(entry.iconItemId)?.sprite : undefined;
            const icon = entry.iconImage ?? (!sprite && entry.iconItemId ? icons?.get(entry.iconItemId) : undefined);
            const title = entry.title || entry.id;
            const size = Math.max(32, Math.min(92, (entry.size ?? 1) * 48)) * zoom;
            const active = selectedId === entry.id;
            const showing = selected && hovered === entry.id;
            return <button key={entry.id} type="button" className="progress-board-node"
              ref={active || showing ? element => {
                if (active) selectedButton.current = element;
                if (showing) anchorButton.current = element;
              } : undefined}
              data-shape={entry.shape} data-completed={done} data-selected={active || undefined}
              aria-haspopup="dialog" aria-describedby={showing ? id : undefined}
              aria-label={done === undefined ? title : `${title}, ${done ? doneLabel : pendingLabel}`}
              title={tooltip ? undefined : title} style={{ left: x * zoom, top: y * zoom, width: size, height: size }}
              onFocus={() => setHovered(entry.id)}
              onBlur={() => setHovered('')}
              onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(entry.id); }}
              onPointerLeave={() => setHovered('')}
              onClick={() => onSelect(entry.id)}>
              <span className="progress-board-face" aria-hidden="true">
                {icon || sprite ? <ItemIcon icon={icon} sprite={sprite} lazy /> : title.slice(0, 1)}
              </span>
              {done && <span className="progress-board-check" aria-hidden="true">✓</span>}
            </button>;
          })}
        </div>
      </div>
      {selected && tooltip && <div className="progress-tooltip progress-board-tooltip"
        ref={tooltipRef} id={id} role="tooltip">
        <h3>{selected.entry.title || selected.entry.id}</h3>
        {tooltip(selected.entry)}
      </div>}
    </div>;

  return <div className="progress-board">
    {!focus && <p className="progress-board-message">{missingLayoutLabels[language]}</p>}
    <div className="progress-board-toolbar">
      <button type="button" aria-label={out} title={out} disabled={zoom <= 0.5}
        onClick={() => setZoom(current => current - 0.25)}>−</button>
      <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label={into} title={into} disabled={zoom >= 1.75}
        onClick={() => setZoom(current => current + 0.25)}>+</button>
    </div>
    {renderFrame ? renderFrame(frame) : frame}
  </div>;
}
