import { ponderFramePath, ponderResource, ponderUrl, readPonderFrame, readPonderManifest, type PonderScene } from './format.mts';

export class PonderUnavailable extends Error {}

export async function readPonderResponse(server: string, signal: AbortSignal, path?: string) {
  const resource = path === undefined ? { mime: 'application/json', limit: 2 * 1024 ** 2 } : ponderResource(path);
  if (!resource) throw new Error('Invalid Ponder resource');
  let response: Response;
  try {
    response = await fetch(ponderUrl(server, path), { signal });
  } catch {
    throw new PonderUnavailable();
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 503) throw new PonderUnavailable();
    throw new Error('Ponder resource rejected');
  }
  if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== resource.mime
    || Number(response.headers.get('content-length')) > resource.limit) throw new Error('Invalid Ponder response');
  return response;
}

export function createPonderSource(server: string, scene: PonderScene, signal: AbortSignal) {
  const frames = new Map<number, Promise<NonNullable<ReturnType<typeof readPonderFrame>>>>();
  const assets = new Map<string, Promise<ArrayBuffer>>();
  let speculativeFrames = 0;

  function frame(tick: number) {
    const cached = frames.get(tick);
    if (cached) {
      frames.delete(tick);
      frames.set(tick, cached);
      return cached;
    }
    while (frames.size >= 32) frames.delete(frames.keys().next().value!);
    const load = readPonderResponse(server, signal, ponderFramePath(scene, tick))
      .then(async response => {
        const frame = readPonderFrame(await response.json());
        if (!frame) throw new Error('Invalid Ponder frame');
        return frame;
      }).catch(error => {
        if (frames.get(tick) === load) frames.delete(tick);
        throw error;
      });
    frames.set(tick, load);
    return load;
  }

  return {
    frame,
    prefetch(first: number, end: number) {
      for (let tick = first; tick < end && speculativeFrames < 4; tick++) {
        if (frames.has(tick)) continue;
        speculativeFrames++;
        void frame(tick).catch(() => {}).finally(() => { speculativeFrames--; });
      }
    },
    asset(path: string) {
      const cached = assets.get(path);
      if (cached) return cached;
      const load = readPonderResponse(server, signal, path)
        .then(response => response.arrayBuffer())
        .finally(() => { assets.delete(path); });
      assets.set(path, load);
      return load;
    },
    async manifest() {
      const data = await readPonderResponse(server, signal, scene.manifest);
      const manifest = readPonderManifest(await data.json());
      if (!manifest) throw new Error('Invalid Ponder manifest');
      return manifest;
    },
  };
}
