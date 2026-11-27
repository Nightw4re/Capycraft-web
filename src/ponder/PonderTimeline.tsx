import { useId } from 'react';
import { usePreferences } from '../PreferencesProvider';

const sectionLabels = { en: 'Section', cs: 'Část', de: 'Abschnitt', es: 'Sección', fr: 'Section', ja: 'セクション', uk: 'Розділ' };
const pumpSections = {
  en: ['Pump range', 'Rotation and flow', 'Combining pumps', 'Pump direction'],
  cs: ['Dosah pumpy', 'Otáčky a průtok', 'Kombinace pump', 'Směr čerpání'],
} as const;

function time(tick: number, ticksPerSecond: number) {
  const tenths = Math.floor(tick * 10 / ticksPerSecond);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

export function PonderTimeline({ min, max, position, rate, keyframes, pumpSpeed, disabled, onSeek }: {
  min: number; max: number; position: number; rate: number; keyframes: readonly number[];
  pumpSpeed: boolean; disabled: boolean; onSeek: (tick: number) => void;
}) {
  const { language, text: { ponderPlayer: labels } } = usePreferences();
  const id = useId();
  const active = keyframes.filter(tick => tick <= position).length - 1;
  const chapter = (index: number) => (pumpSpeed ? pumpSections[language === 'cs' ? 'cs' : 'en'][index] : undefined)
    ?? `${sectionLabels[language]} ${index + 1}`;
  const elapsed = `${time(position, rate)} / ${time(max, rate)}`;

  return <div className="ponder-timeline">
    <label htmlFor={id}>{labels.timeline}</label>
    <output>{elapsed}</output>
    <input id={id} type="range" min={min} max={max} value={position} disabled={disabled}
      aria-valuetext={active < 0 ? elapsed : `${elapsed} · ${chapter(active)}`}
      onChange={event => onSeek(event.currentTarget.valueAsNumber)} />
    {max > min && !!keyframes.length && <>
      <div className="ponder-timeline-markers" role="group" aria-label={labels.keyframes}>
        {keyframes.map((tick, index) => {
          const label = `${chapter(index)} · ${time(tick, rate)}`;
          const offset = (tick - min) / (max - min) * 100;
          return <button key={tick} type="button" disabled={disabled} title={label} aria-label={label}
            aria-current={index === active ? 'step' : undefined} tabIndex={index === Math.max(0, active) ? 0 : -1}
            style={{ insetInlineStart: `${offset}%` }} onClick={() => onSeek(tick)}
            onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const neighbor = event.key === 'ArrowLeft' ? event.currentTarget.previousElementSibling
                : event.currentTarget.nextElementSibling;
              if (neighbor instanceof HTMLButtonElement) {
                neighbor.click();
                neighbor.focus();
              }
            }} />;
        })}
      </div>
      <span className="ponder-timeline-chapter">{active >= 0 ? chapter(active) : undefined}</span>
    </>}
  </div>;
}
