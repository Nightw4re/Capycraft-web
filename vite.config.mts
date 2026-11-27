import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, normalizePath } from 'vite';
import { sceneWebp } from './scripts/scene-webp.mts';
import { offlinePage } from './scripts/offline-page.mts';
import { itemSearchPath } from './server/itemSearch.mts';
import { itemRecipeUsesPath } from './server/itemRecipeUses.mts';
import { instanceDirectory, loadInstances } from './server/instances.mts';
import { catalogPrefix } from './server/itemCatalog.mts';
import { createItemPages, itemPageProxyPattern } from './server/itemPages.mts';
import { serverDirectoryPath } from './server/serverDirectory.mts';
import { liveUpdatesPath } from './src/liveUpdates.mts';
import { achievementsPath } from './src/achievements.mts';
import { questsPath } from './src/quests.mts';
import { ponderPath } from './src/ponder/format.mts';
import { catalogSubdirectory } from './src/minecraftServers.mjs';
import { accountPath } from './src/auth/account.mts';

const apiOrigin = 'http://127.0.0.1:8787';
const apiPaths = [serverDirectoryPath, '/api/players', achievementsPath, questsPath, ponderPath, itemSearchPath, itemRecipeUsesPath];
const proxy = {
  [`^${accountPath}(?:\\?|$)`]: { target: apiOrigin, xfwd: true },
  [`^${liveUpdatesPath}$`]: { target: apiOrigin, ws: true },
  [catalogPrefix]: apiOrigin,
  [`^(?:${apiPaths.join('|')})(?:\\?|$)`]: apiOrigin,
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'CAPYCRAFT_');
  const instancesRoot = instanceDirectory(env.CAPYCRAFT_INSTANCE_DIR, import.meta.dirname);
  const inbox = resolve(import.meta.dirname, env.CAPYCRAFT_ITEM_IMPORT_DIR?.trim() || 'data/item-imports');
  const databaseDirectory = resolve(import.meta.dirname, 'data/item-catalog-databases');
  const importLogDirectory = resolve(import.meta.dirname, 'data/item-import-logs');
  const privatePatterns = [inbox, instancesRoot, databaseDirectory, importLogDirectory]
    .map(path => `${normalizePath(path).replace(/[[\]{}()*?!+@]/g, '\\$&')}/**`);
  const databaseFiles = ['**/*.sqlite', '**/*.sqlite-*'];
  return {
    base: '/',
    plugins: [react(), sceneWebp(import.meta.dirname), offlinePage(import.meta.dirname), {
      name: 'capycraft-item-pages',
      configureServer(server) {
        const instances = loadInstances(instancesRoot);
        const handleItemPage = createItemPages(instances.keys(), async (alias, path) => {
          const response = await fetch(`${apiOrigin}${catalogPrefix}${catalogSubdirectory(alias)}${path}`);
          if (!response.ok) {
            throw Object.assign(new Error(`Catalog asset request failed with HTTP ${response.status}.`),
              { code: response.status === 404 ? 'ENOENT' : undefined });
          }
          return Buffer.from(await response.arrayBuffer());
        }, async () => {
          const shell = await readFile(resolve(import.meta.dirname, 'index.html'), 'utf8');
          return server.transformIndexHtml('/', shell);
        });
        server.middlewares.use((request, response, next) => {
          if (!handleItemPage(request, response, request.url?.split('?', 1)[0])) next();
        });
      },
    }],
    server: {
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
        ...databaseFiles, ...privatePatterns] },
      proxy,
      watch: { ignored: ['**/public/item-catalog/**', ...databaseFiles, ...privatePatterns] },
    },
    preview: { proxy: { ...proxy, [itemPageProxyPattern]: { target: apiOrigin, xfwd: true } } },
    build: {
      rolldownOptions: {
        input: [resolve(import.meta.dirname, 'index.html')],
      },
    },
  };
});
