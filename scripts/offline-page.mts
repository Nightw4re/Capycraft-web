import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, normalizePath, type Plugin } from 'vite';
import { sceneBackdropPath, sceneLogoPath } from './scene-webp.mts';

export function offlinePage(root: string): Plugin {
  const pagePath = resolve(root, 'offline/offline.html');
  const entryPath = resolve(root, 'offline/FallbackPage.tsx');
  const gamePath = resolve(root, 'offline/mine-maze.js');
  const stylePath = resolve(root, 'offline/fallback.css');
  const workerPath = resolve(root, 'offline/service-worker.js');
  const faviconPath = resolve(root, 'public/favicon.png');
  const logoPath = resolve(root, 'assets/capycraft-winter-logo.png');
  const watchedPaths = new Set([pagePath, entryPath, gamePath, stylePath, workerPath, faviconPath, logoPath,
    resolve(root, 'assets/capycraft-capybara-electric-transparent.webp'),
    resolve(root, 'assets/dragon-battle-background.png')]);

  async function bundlePage(logo: string) {
    // Embed the shared React components and their styles so the cached page can run offline.
    const result = await build({
      root,
      configFile: false,
      publicDir: false,
      logLevel: 'warn',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      oxc: { jsx: { runtime: 'automatic', development: false } },
      resolve: { alias: [{ find: '../../assets/capycraft-winter-logo.png', replacement: logo }] },
      build: {
        lib: { entry: entryPath, name: 'CapycraftFallback', formats: ['iife'] },
        write: false,
        reportCompressedSize: false,
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const files = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : []);
    const script = files.find(file => file.type === 'chunk' && file.isEntry);
    const styles = files.find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
    if (script?.type !== 'chunk' || styles?.type !== 'asset' || files.length !== 2) {
      throw new Error('The fallback page must contain one script and one stylesheet with embedded assets.');
    }
    return { script: script.code.replace(/<\/script/gi, '<\\/script'), styles: styles.source.toString() };
  }

  async function assets() {
    const [backdropPath, logoWebpPath] = await Promise.all([sceneBackdropPath(root), sceneLogoPath(root)]);
    const [template, game, worker, backdrop, favicon, { script, styles }] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(gamePath, 'utf8'),
      readFile(workerPath, 'utf8'),
      readFile(backdropPath),
      readFile(faviconPath),
      bundlePage(logoWebpPath),
    ]);
    const page = template
      .replace('__BACKDROP__', backdrop.toString('base64'))
      .replace('__FAVICON__', favicon.toString('base64'))
      .replace('__FALLBACK_STYLES__', () => styles)
      .replace('__FALLBACK_SCRIPT__', () => script)
      .replace('__MINE_MAZE__', () => game);
    const offline = page.replaceAll('__HEADING__', 'Server offline')
      .replace('__FALLBACK_KIND__', 'offline');
    const revision = createHash('sha256').update(offline).update(worker).digest('hex').slice(0, 16);
    return {
      'offline.html': {
        source: offline,
        type: 'text/html',
      },
      'error.html': {
        source: page.replaceAll('__HEADING__', 'Something went wrong')
          .replace('__FALLBACK_KIND__', 'error'),
        type: 'text/html',
      },
      'service-worker.js': { source: worker.replace('__OFFLINE_REVISION__', revision), type: 'text/javascript' },
    };
  }

  return {
    name: 'capycraft-offline-page',
    configureServer(server) {
      let generated: ReturnType<typeof assets> | undefined;
      server.watcher.add([...watchedPaths]);
      server.watcher.on('change', file => {
        if (watchedPaths.has(resolve(file)) || normalizePath(file).startsWith(`${normalizePath(resolve(root, 'src'))}/`)) {
          generated = undefined;
        }
      });
      server.middlewares.use(async (request, response, next) => {
        const fileName = request.url?.split('?', 1)[0].slice(1);
        if (fileName !== 'offline.html' && fileName !== 'error.html' && fileName !== 'service-worker.js') return next();

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
