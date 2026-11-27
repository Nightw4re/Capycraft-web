import { navigatePage, pageUrl } from '../navigation';

type ProgressView = 'board' | 'list';
type ProgressLocation = { view: ProgressView; group: string; entry: string };

export function useProgressLocation(url: string, kind: 'achievement' | 'quest', defaultView: ProgressView) {
  const entryKey = kind;
  const viewKey = `${kind}View`;
  const groupKey = kind === 'quest' ? 'chapter' : 'achievementGroup';
  const params = new URL(url, window.location.origin).searchParams;
  const view = params.get(viewKey);
  const location: ProgressLocation = {
    view: view === 'board' || view === 'list' ? view : defaultView,
    group: params.get(groupKey) ?? '',
    entry: params.get(entryKey) ?? '',
  };

  function change(next: Partial<ProgressLocation>) {
    const target = { ...location, ...next };
    const current = new URL(pageUrl(window.location), window.location.origin);
    current.searchParams.set(viewKey, target.view);
    for (const [key, value] of [[groupKey, target.group], [entryKey, target.entry]]) {
      if (value) current.searchParams.set(key, value);
      else current.searchParams.delete(key);
    }
    navigatePage(current.pathname + current.search);
  }

  return [location, change] as const;
}
