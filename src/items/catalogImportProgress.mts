import { catalogImportStages, type CatalogImportStage, type ImportStatus } from '../liveUpdates.mts';

const visibleStages = catalogImportStages.filter(id => id !== 'preparing');
export type VisibleImportStage = typeof visibleStages[number];
const archiveStages = ['preparing', 'reading'] as const;
const catalogPlan = [...archiveStages, 'items', 'recipe-index', 'publishing'] as const;

function currentStage(status: ImportStatus): NonNullable<ImportStatus['stage']> {
  if (status.stage) return status.stage;
  if (status.phase === 'publishing') return 'publishing';
  if (status.phase !== 'processing') return 'preparing';
  if (status.recipeIndexProgress || (status.progress?.expected && status.progress.loaded === status.progress.expected)) {
    return 'recipe-index';
  }
  return 'items';
}

export function catalogImportProgress(status: ImportStatus, extraElapsedMs = 0) {
  const stage = currentStage(status);
  const ponderOnly = stage === 'publishing-ponder';
  const activeStage = ponderOnly ? 'publishing' : stage;
  const current = activeStage === 'preparing' ? 'reading' : activeStage;
  const planned: readonly CatalogImportStage[] | undefined = status.stagePlan
    ?? (ponderOnly ? [...archiveStages, 'publishing'] : undefined)
    ?? (current === 'items' || current === 'recipe-index' || current === 'publishing' ? catalogPlan : undefined);
  const plan = planned ?? catalogImportStages;
  const included = (id: VisibleImportStage) => plan.includes(id) || (id === 'reading' && plan.includes('preparing'));
  const applicable = visibleStages.filter(included);
  const position = applicable.indexOf(current) + 1;
  const history = status.lastStageDurations;
  const duration = history?.[activeStage];
  const timed = duration !== undefined && status.stageElapsedMs !== undefined
    && (activeStage === 'preparing' || activeStage === 'reading' || activeStage === 'publishing');
  const counts = (stage === 'items' || stage === 'ponder-scenes' || stage === 'ponder-definitions') && status.progress?.expected
    ? { done: status.progress.loaded, total: status.progress.expected }
    : stage === 'recipe-index' && status.recipeIndexProgress
      ? { done: status.recipeIndexProgress.indexed, total: status.recipeIndexProgress.total }
      : undefined;
  let fraction = 0;
  if (counts) {
    fraction = Math.min(0.999, counts.done / counts.total);
  } else {
    const elapsed = timed ? (status.stageElapsedMs ?? 0) + extraElapsedMs : 0;
    fraction = timed ? Math.min(0.98, elapsed / duration) : 0;
    if (current === 'reading' && plan.includes('preparing') && plan.includes('reading')) {
      const split = history?.preparing && history.reading
        ? history.preparing / (history.preparing + history.reading)
        : 0.5;
      fraction = activeStage === 'preparing' ? split * fraction : split + (1 - split) * fraction;
    }
  }
  const totalPercent = Math.floor((position - 1 + fraction) * 100 / applicable.length);
  const currentIndex = visibleStages.indexOf(current);
  return {
    current,
    counts,
    timed,
    position,
    stepCount: planned ? applicable.length : undefined,
    totalPercent,
    steps: visibleStages.map((id, index) => {
      if (id === current) return { id, state: 'active' } as const;
      if (!included(id)) return { id, state: 'skipped' } as const;
      if (index < currentIndex) return { id, state: 'complete' } as const;
      return { id, state: 'pending' } as const;
    }),
  };
}
