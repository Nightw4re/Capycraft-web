import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { instanceDirectory } from './instances.mts';

export const ponderIndexPath = 'ponder/index.json';
export const ponderIndexLimit = 2 * 1024 ** 2;
export const ponderRevision = /^[a-f0-9]{64}$/;

export function ponderStorage(root: string, server: string) {
  return join(instanceDirectory(process.env.CAPYCRAFT_INSTANCE_DIR, root), '.ponder', server);
}

function readRevision(value: { revision?: unknown; previous?: unknown; sourceHash?: unknown } | null | undefined) {
  if (typeof value?.revision !== 'string' || !ponderRevision.test(value.revision)) return;
  return {
    revision: value.revision,
    previous: typeof value.previous === 'string' && ponderRevision.test(value.previous) ? value.previous : undefined,
    sourceHash: typeof value.sourceHash === 'string' ? value.sourceHash : undefined,
  };
}

export async function activePonder(directory: string) {
  try {
    const value = JSON.parse(await readFile(join(directory, 'active.json'), 'utf8'));
    const playback = readRevision(value);
    const definitions = readRevision(value?.definitions);
    if (playback || definitions) return { ...playback, layoutChunks: playback && value.layoutChunks === true,
      pickingChunks: playback && value.pickingChunks === true, definitions };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
