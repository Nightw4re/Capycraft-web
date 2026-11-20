import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import sharp from 'sharp';
import { normalizePath, type Plugin } from 'vite';

const sceneImages = [
  { name: 'dragon-battle-background', quality: 90 },
  { name: 'capybara-snow-islands', quality: 92 },
  { name: 'capycraft-winter-logo', quality: 94 },
];

async function sceneImage(root: string, { name, quality }: typeof sceneImages[number]) {
  const source = `assets/${name}.png`;
  const input = await readFile(resolve(root, source));
  const options = { quality, alphaQuality: 100, effort: 5 };
  const hash = createHash('sha256').update(input)
    .update(JSON.stringify(options)).update(JSON.stringify(sharp.versions)).digest('hex').slice(0, 16);
  const directory = resolve(root, 'node_modules/.cache/capycraft-scene', hash);
  const output = normalizePath(resolve(directory, `${name}.webp`));

  try {
    await access(output);
  } catch {
    await mkdir(directory, { recursive: true });
    const temporary = resolve(directory, `${randomUUID()}.webp`);
    try {
      await sharp(input).webp(options).toFile(temporary);
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return { source, output, href: normalizePath(relative(root, output)) };
}

export function sceneWebp(root: string): Plugin {
  let images: Awaited<ReturnType<typeof sceneImage>>[] = [];
  const sources = new Set(sceneImages.map(({ name }) => normalizePath(resolve(root, `assets/${name}.png`))));

  return {
    name: 'capycraft-scene-webp',
    apply: (_, environment) => !environment.isPreview,
    async config() {
      images = await Promise.all(sceneImages.map(image => sceneImage(root, image)));
      return {
        resolve: {
          alias: images.map(({ source, output }) => ({ find: `../../${source}`, replacement: output })),
        },
      };
    },
    configureServer(server) {
      server.watcher.add([...sources]);
      server.watcher.on('change', file => {
        if (sources.has(normalizePath(file))) void server.restart();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        for (const { source, href } of images) html = html.replaceAll(`href="./${source}"`, `href="./${href}"`);
        return html;
      },
    },
  };
}
