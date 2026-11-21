import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { sceneBackdropPath } from './scene-webp.mts';

export function offlinePage(root: string): Plugin {
  const pagePath = resolve(root, 'offline/offline.html');
  const workerPath = resolve(root, 'offline/service-worker.js');
  const capybaraPath = resolve(root, 'assets/capycraft-capybara-electric-transparent.webp');
  const faviconPath = resolve(root, 'public/favicon.png');
  const watchedPaths = new Set([pagePath, workerPath, capybaraPath, faviconPath]);

  async function assets() {
    const backdropPath = await sceneBackdropPath(root);
    const [template, worker, backdrop, capybara, favicon] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(workerPath, 'utf8'),
      readFile(backdropPath),
      readFile(capybaraPath),
      readFile(faviconPath),
    ]);
    const page = template
      .replace('__BACKDROP__', backdrop.toString('base64'))
      .replace('__CAPYBARA__', capybara.toString('base64'))
      .replace('__FAVICON__', favicon.toString('base64'));
    const revision = createHash('sha256').update(page).update(worker).digest('hex').slice(0, 16);
    return {
      'offline.html': { source: page, type: 'text/html' },
      'service-worker.js': { source: worker.replace('__OFFLINE_REVISION__', revision), type: 'text/javascript' },
    };
  }

  return {
    name: 'capycraft-offline-page',
    configureServer(server) {
      let generated: ReturnType<typeof assets> | undefined;
      server.watcher.add([...watchedPaths]);
      server.watcher.on('change', file => {
        if (watchedPaths.has(resolve(file))) generated = undefined;
      });
      server.middlewares.use(async (request, response, next) => {
        const fileName = request.url?.split('?', 1)[0].slice(1);
        if (fileName !== 'offline.html' && fileName !== 'service-worker.js') return next();

        try {
          const { source, type } = (await (generated ??= assets()))[fileName];
          response.setHeader('Content-Type', `${type}; charset=utf-8`);
          response.setHeader('Cache-Control', 'no-cache');
          response.end(source);
        } catch (error) {
          generated = undefined;
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const path of watchedPaths) this.addWatchFile(path);
      for (const [fileName, { source }] of Object.entries(await assets())) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}
