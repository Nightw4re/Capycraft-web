import { useEffect, useState } from 'react';
import type { ImportStatus } from '../liveUpdates.mts';
import { usePreferences } from '../PreferencesProvider';
import { catalogImportLabels } from './catalogImportLabels';
import { catalogImportProgress } from './catalogImportProgress.mts';
import './items.css';

export function CatalogImportNotice({ status, updating, partial }: {
  status?: ImportStatus | null;
  updating: boolean;
  partial?: { failed: boolean };
}) {
  const { language, text } = usePreferences();
  const [clock, setClock] = useState<{ status: ImportStatus; elapsed: number }>();
  const running = status?.state === 'running' ? status : undefined;
  const progress = running && catalogImportProgress(running, clock?.status === running ? clock.elapsed : 0);
  const timed = progress?.timed;
  useEffect(() => {
    if (!running || !timed) return;
    const started = performance.now();
    const timer = window.setInterval(() => setClock({ status: running, elapsed: performance.now() - started }), 1000);
    return () => window.clearInterval(timer);
  }, [running, timed]);

  if (progress) {
    const labels = catalogImportLabels[language];
    const { current, counts, totalPercent, position, stepCount, steps } = progress;
    const numbers = new Intl.NumberFormat(language);
    const percentages = new Intl.NumberFormat(language, { style: 'percent' });
    const activeCount = counts && `${numbers.format(counts.done)} / ${numbers.format(counts.total)}`;
    const currentStep = labels.step(numbers.format(position), stepCount === undefined ? '…' : numbers.format(stepCount));
    return (
      <div className="item-import-notice">
        <section className="item-import-progress" aria-label={labels.title}>
          <div className="item-import-progress-heading">
            <strong>{labels.title}</strong>
            <span title={labels.total}>≈ {percentages.format(totalPercent / 100)}</span>
          </div>
          <progress max={100} value={totalPercent} aria-label={labels.total} />
          <details>
            <summary>
              <span role="status">{labels.stages[current]} <span className="item-import-summary-value">{currentStep}</span></span>
            </summary>
            <ol className="item-import-steps">
              {steps.map(step => (
                <li key={step.id} aria-current={step.state === 'active' ? 'step' : undefined}>
                  <span>{labels.stages[step.id]}</span>
                  <span className="item-import-step-value">
                    {step.state === 'active' && activeCount ? activeCount : labels[step.state]}
                  </span>
                </li>
              ))}
            </ol>
            {running?.progress && (!running.stage || running.stage === 'items') && (
              <p>{updating ? text.itemUpdateRunning : text.itemImportStarting}</p>
            )}
          </details>
        </section>
      </div>
    );
  }
  const failure = partial?.failed ? text.itemImportFailed : status?.state === 'failed' ? text.itemImportStopped : '';
  return <div className="item-import-notice"><p role="status" aria-atomic="true">{failure}</p></div>;
}
