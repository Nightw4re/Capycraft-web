import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, normalizePath } from 'vite';
import { sceneWebp } from './scripts/scene-webp.mts';
import { itemSearchPath } from './server/itemSearch.mts';
import { itemRecipeUsesPath } from './server/itemRecipeUses.mts';
import { instanceDirectory } from './server/instances.mts';
import { catalogPrefix } from './server/itemCatalog.mts';
import { serverDirectoryPath } from './server/serverDirectory.mts';
import { liveUpdatesPath } from './src/liveUpdates.mts';

const apiOrigin = 'http://127.0.0.1:8787';
const apiPaths = [serverDirectoryPath, '/api/players', itemSearchPath, itemRecipeUsesPath];
const proxy = {
  [`^${liveUpdatesPath}$`]: { target: apiOrigin, ws: true },
  [catalogPrefix]: apiOrigin,
  [`^(?:${apiPaths.join('|')})(?:\\?|$)`]: apiOrigin,
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'CAPYCRAFT_');
  const instancesRoot = instanceDirectory(env.CAPYCRAFT_INSTANCE_DIR, import.meta.dirname);
  const inbox = resolve(import.meta.dirname, env.CAPYCRAFT_ITEM_IMPORT_DIR?.trim() || 'data/item-imports');
  const databaseDirectory = resolve(import.meta.dirname, 'data/item-catalog-databases');
  const privatePatterns = [inbox, instancesRoot, databaseDirectory]
    .map(path => `${normalizePath(path).replace(/[[\]{}()*?!+@]/g, '\\$&')}/**`);
  const databaseFiles = ['**/*.sqlite', '**/*.sqlite-*'];
  return {
    base: './',
    plugins: [react(), sceneWebp(import.meta.dirname)],
    server: {
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
        ...databaseFiles, ...privatePatterns] },
      proxy,
      watch: { ignored: ['**/public/item-catalog/**', ...databaseFiles, ...privatePatterns] },
    },
    build: {
      rolldownOptions: {
        input: [resolve(import.meta.dirname, 'index.html'), resolve(import.meta.dirname, 'auth-redirect.html')],
      },
    },
  };
});
