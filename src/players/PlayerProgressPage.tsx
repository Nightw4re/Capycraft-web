import { useEffect, useState } from 'react';

type Failure = 'offline' | 'unavailable' | 'restricted' | 'unknown' | 'disabled' | 'noProgress';
export type Load<T> = { status: 'ready'; data: T } | { status: Failure | 'loading' };

export async function fetchPlayerProgress<T>(url: string, signal: AbortSignal, parse: (data: unknown) => T | undefined): Promise<Load<T>> {
  try {
    const response = await fetch(url, { signal });
    const data: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const parsed = parse(data);
      if (parsed !== undefined) return { status: 'ready', data: parsed };
    }
    if (response.status === 401 || response.status === 403) return { status: 'restricted' };
    if (response.status === 503) return { status: 'offline' };
    if (response.status === 404 && data && typeof data === 'object' && 'error' in data) {
      if (data.error === 'player_not_found') return { status: 'unknown' };
      if (data.error === 'team_progress_unavailable') return { status: 'noProgress' };
      if (data.error === 'achievements_disabled' || data.error === 'quests_disabled') return { status: 'disabled' };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'offline' };
  }
}

type ProfileCompletion = { player: string; total: number; completed: number; completedIds: string[];
  completedAt?: Record<string, number> };

export function fetchProfileProgress(path: string, server: string, player: string, signal: AbortSignal) {
  const query = new URLSearchParams({ server, player, view: 'progress' });
  return fetchPlayerProgress(`${path}?${query}`, signal, data => {
    const entry = data as Partial<ProfileCompletion> | null;
    if (entry && typeof entry.player === 'string' && entry.player.toLowerCase() === player.toLowerCase()
      && typeof entry.total === 'number' && Array.isArray(entry.completedIds)
      && entry.completed === entry.completedIds.length) return entry as ProfileCompletion;
  });
}

export function useProfileProgress(path: string, server: string, player: string) {
  const key = JSON.stringify([path, server, player.toLowerCase()]);
  const [progress, setProgress] = useState<{ key: string; result: Load<ProfileCompletion> }>();
  useEffect(() => {
    if (!player) return;
    const request = new AbortController();
    void fetchProfileProgress(path, server, player, request.signal)
      .then(result => { if (!request.signal.aborted) setProgress({ key, result }); });
    return () => request.abort();
  }, [key, path, server, player]);
  return progress?.key === key ? progress.result : { status: 'loading' } as const;
}

export function useProfileCatalog<T>(path: string, server: string, parse: (data: unknown) => T | undefined,
  enabled = true): Load<T> {
  const key = JSON.stringify([path, server]);
  const [catalog, setCatalog] = useState<{ key: string; result: Load<T> }>();
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    void fetchPlayerProgress(`${path}?${new URLSearchParams({ server })}`, request.signal, parse)
      .then(result => { if (!request.signal.aborted) setCatalog({ key, result }); });
    return () => request.abort();
  }, [enabled, key, parse, path, server]);
  return enabled && catalog?.key === key ? catalog.result : { status: 'loading' };
}

export function readPlayerNames(data: unknown): string[] | undefined {
  if (data && typeof data === 'object' && 'players' in data && Array.isArray(data.players)
    && data.players.every(name => typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name))) return data.players;
}
