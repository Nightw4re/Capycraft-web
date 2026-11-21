import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';
import { lookupSlot } from '../src/items/catalogIndex.mjs';
import layout from '../src/items/catalogLayout.json' with { type: 'json' };
import { isItemId, parsePublicItemPath, publicItemPath, publicItemPathPattern } from '../src/items/itemRoutes.mts';
import { plainMinecraftText } from '../src/minecraftText.mts';

const sitemapPath = '/sitemap.xml';
const robotsPath = '/robots.txt';
const sitemapPartPath = '/sitemap-items-([a-z0-9-]+)-([1-9][0-9]*)\\.xml';
const sitemapPartPattern = new RegExp(`^${sitemapPartPath}$`);
export const itemPageProxyPattern =
  `^(?:${publicItemPathPattern}(?:/icon\\.png)?|${sitemapPartPath}|/sitemap\\.xml|/robots\\.txt)(?:\\?|$)`;
const itemPagePattern = new RegExp(itemPageProxyPattern);
const sitemapPageSize = 25_000;
const resourceHash = /^[a-f0-9]{64}$/;
const imageName = /^[a-f0-9]{64}\.(png|webp)$/;
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
const sitemapNamespace = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

type Item = { id: string; name: string; icon?: string };
type Manifest =
  | { version: 1 | 2; items: Item[] }
  | { version: typeof layout.version; revision: string; state: string; total: number; lookup: (string | null)[] };

type ReadAsset = (server: string, path: string) => Promise<Buffer>;
type Catalog = { manifest: Manifest; read: (path: string) => Promise<Buffer> };

const entities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeMarkup(value: string) {
  return value.replace(/[&<>"']/g, char => entities[char]);
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function loadCatalog(read: Catalog['read']): Promise<Catalog | undefined> {
  let bytes: Buffer;
  try {
    bytes = await read('catalog.json');
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const manifest = JSON.parse(bytes.toString('utf8')) as Manifest;
  if ('items' in manifest) {
    if ((manifest.version === 1 || manifest.version === 2) && Array.isArray(manifest.items)) {
      return { manifest, read };
    }
  } else if (manifest.version === layout.version && resourceHash.test(manifest.revision)
    && Number.isSafeInteger(manifest.total) && manifest.total >= 0
    && Array.isArray(manifest.lookup) && manifest.lookup.length === 256
    && manifest.lookup.every(hash => hash === null || resourceHash.test(hash))) {
    return { manifest, read: path => read(`revisions/${manifest.revision}/${path}`) };
  }
  throw new Error('Invalid item catalog manifest.');
}

async function readBucket(read: Catalog['read'], hash: string | null): Promise<Item[]> {
  if (!hash) return [];
  const data = await read(`lookup/${hash}.json`);
  return JSON.parse(data.toString('utf8'));
}

async function findItem({ manifest, read }: Catalog, id: string) {
  const items = 'items' in manifest ? manifest.items : await readBucket(read, manifest.lookup[lookupSlot(id)]);
  return items.find(item => item.id === id);
}

function getIconName(item: Item, version: number) {
  if (!item.icon) return;
  if (version === 1 && resourceHash.test(item.icon)) return `${item.icon}.png`;
  if (version !== 1 && imageName.test(item.icon)) return item.icon;
}

function requestOrigin(request: IncomingMessage) {
  const scheme = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = request.headers.host;
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return;
  const origin = `${scheme}://${host}`;
  if (URL.canParse(origin)) return new URL(origin).origin;
}

function renderItemPage(shell: string, origin: string, server: string, item: Item, icon?: string) {
  const name = escapeMarkup(plainMinecraftText(item.name).trim() || item.id);
  const description = `Explore recipes and uses for ${name} in the ${server} Minecraft item catalog.`;
  const url = escapeMarkup(origin + publicItemPath(server, item.id));
  const image = icon ? `${url}/icon.png?v=${icon.split('.')[0]}` : `${origin}/favicon.png`;
  const size = icon ? 256 : 512;
  const head = `<title>${name} | Capycraft</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Capycraft">
  <meta property="og:title" content="${name}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${size}">
  <meta property="og:image:height" content="${size}">
  <noscript><style>#root > .scene-loader { display: none; }</style></noscript>`;
  const summary = `<noscript>
      <main style="padding:1.5rem;color:#f5f0ff;font:1rem system-ui,sans-serif">
        <img src="${image}" width="96" height="96" alt="" style="image-rendering:pixelated">
        <h1>${name}</h1>
        <p>${description}</p>
        <p><code>${escapeMarkup(item.id)}</code></p>
        <a href="/server/${server}/items" style="color:inherit">Browse the item catalog</a>
      </main>
    </noscript>`;
  return shell.replace('<title>Capycraft</title>', () => head)
    .replace('<div id="root">', root => `${root}\n    ${summary}`);
}

function send(request: IncomingMessage, response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
  }).end(request.method === 'HEAD' ? undefined : body);
}

function sitemap(tag: 'sitemapindex' | 'urlset', locations: string[]) {
  const entry = tag === 'sitemapindex' ? 'sitemap' : 'url';
  return `${xmlDeclaration}\n<${tag} ${sitemapNamespace}>\n${locations.map(url =>
    `  <${entry}><loc>${escapeMarkup(url)}</loc></${entry}>\n`).join('')}</${tag}>\n`;
}

function sitemapPart(server: string, page: number) {
  return `/sitemap-items-${server}-${page}.xml`;
}

export function createItemPages(aliases: Iterable<string>, readAsset: ReadAsset, loadShell: () => Promise<string>) {
  const servers = new Set(aliases);
  const idsByServer = new Map<string, { revision: string; ids: Promise<string[]> }>();

  function getCatalog(server: string) {
    if (servers.has(server)) return loadCatalog(path => readAsset(server, path));
  }

  function getSitemapIds(server: string, { manifest, read }: Catalog) {
    if ('items' in manifest) return manifest.items.map(item => item.id).filter(isItemId).sort();
    const cached = idsByServer.get(server);
    if (cached?.revision === manifest.revision) return cached.ids;

    const ids = (async () => {
      const all = new Set<string>();
      for (const hash of manifest.lookup) {
        for (const item of await readBucket(read, hash)) if (isItemId(item.id)) all.add(item.id);
      }
      return [...all].sort();
    })();
    idsByServer.set(server, { revision: manifest.revision, ids });
    void ids.catch(() => {
      if (idsByServer.get(server)?.ids === ids) idsByServer.delete(server);
    });
    return ids;
  }

  async function serve(request: IncomingMessage, response: ServerResponse, path: string) {
    const text = 'text/plain; charset=utf-8';
    const xml = 'application/xml; charset=utf-8';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const origin = requestOrigin(request);
    if (!origin) return send(request, response, 400, text, 'Invalid host.');
    try {
      if (path === robotsPath) return send(request, response, 200, text, `Sitemap: ${origin}${sitemapPath}\n`);
      if (path === sitemapPath) {
        const parts = [];
        for (const server of servers) {
          const catalog = await getCatalog(server);
          if (!catalog) continue;
          const { manifest } = catalog;
          const total = 'items' in manifest ? manifest.items.length : manifest.state === 'ready' ? manifest.total : 0;
          for (let page = 1; page <= Math.ceil(total / sitemapPageSize); page++) {
            parts.push(origin + sitemapPart(server, page));
          }
        }
        return send(request, response, 200, xml,
          parts.length ? sitemap('sitemapindex', parts) : sitemap('urlset', [`${origin}/`]));
      }
      const part = sitemapPartPattern.exec(path);
      if (part) {
        const [, server, page] = part;
        const catalog = await getCatalog(server);
        if (catalog && (!('state' in catalog.manifest) || catalog.manifest.state === 'ready')) {
          const start = (Number(page) - 1) * sitemapPageSize;
          const total = 'items' in catalog.manifest ? catalog.manifest.items.length : catalog.manifest.total;
          if (start < total) {
            const ids = await getSitemapIds(server, catalog);
            const locations = ids.slice(start, start + sitemapPageSize).map(id => origin + publicItemPath(server, id));
            return send(request, response, 200, xml, sitemap('urlset', locations));
          }
        }
        return send(request, response, 404, text, 'Sitemap not found.');
      }

      const iconRequest = path.endsWith('/icon.png');
      const route = parsePublicItemPath(iconRequest ? path.slice(0, -'/icon.png'.length) : path);
      const catalog = route && await getCatalog(route.server);
      const item = route && catalog && await findItem(catalog, route.id);
      if (!route || !catalog || !item) {
        if (catalog && 'state' in catalog.manifest && catalog.manifest.state === 'importing') {
          return send(request, response, 503, text, 'The item catalog is being published.');
        }
        return send(request, response, 404, text, 'Item not found.');
      }
      const icon = getIconName(item, catalog.manifest.version);
      if (iconRequest) {
        if (!icon) return send(request, response, 404, text, 'Icon not found.');
        const png = await sharp(await catalog.read(`icons/${icon}`))
          .resize(256, 256, { fit: 'contain', kernel: 'nearest', background: 'transparent' }).png().toBuffer();
        return send(request, response, 200, 'image/png', png);
      }
      const html = renderItemPage(await loadShell(), origin, route.server, item, icon);
      return send(request, response, 200, 'text/html; charset=utf-8', html);
    } catch {
      return send(request, response, 503, text, 'Item catalog temporarily unavailable.');
    }
  }

  return function handleItemPage(request: IncomingMessage, response: ServerResponse, path: string | undefined) {
    if (!path || !itemPagePattern.test(path)) return false;
    void serve(request, response, path);
    return true;
  };
}
