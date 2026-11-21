import { webcraftToken, type Exposure, type Instance } from './instances.mts';
import { subscribeWebcraftFeeds, type FeedResult } from './webcraftSocket.mts';

export type DirectoryFeed = 'server-info' | 'server-status';

export function subscribeWebcraftDirectory(
  webcraft: NonNullable<Instance['webcraft']>,
  onResults: (results: ReadonlyMap<DirectoryFeed, FeedResult>) => void,
) {
  const groups = new Map<Exposure, DirectoryFeed[]>();
  const feeds = [['server-info', webcraft.info], ['server-status', webcraft.status]] as const;
  for (const [feed, exposure] of feeds) {
    const group = groups.get(exposure) ?? [];
    group.push(feed);
    groups.set(exposure, group);
  }
  const stops = Array.from(groups, ([exposure, group]) => subscribe(exposure, group));
  return () => { for (const stop of stops) stop(); };

  function subscribe(exposure: Exposure, group: DirectoryFeed[]) {
    const internal = exposure === 'internal';
    const token = internal ? webcraftToken(webcraft.tokenEnv) : undefined;
    if (internal && !token) {
      onResults(new Map(group.map(feed => [feed, { reachable: true }])));
      return () => {};
    }
    const prefix = internal ? '/api/v1/internal/' : '/api/v1/';
    const commands = group.map(id => ({ id, path: `${prefix}${id}${id === 'server-info' ? '?iconFormat=webp' : ''}` }));
    return subscribeWebcraftFeeds(webcraft.origin, `${prefix}ws`, commands, token, onResults);
  }
}
