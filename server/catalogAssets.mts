import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { StatementSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const databaseName = 'catalog.sqlite';
export const catalogStorage = 'sqlite';
export const catalogPublishedAtHeader = 'X-Catalog-Published-At';

export async function catalogPublishedAt(directory: string, manifest: { revision?: string; publishedAt?: number }) {
  const { revision, publishedAt } = manifest;
  if (typeof publishedAt === 'number' && Number.isFinite(new Date(publishedAt).getTime()) && publishedAt > 0) {
    return new Date(publishedAt).toISOString();
  }
  const path = revision && /^[a-f0-9]{64}$/.test(revision)
    ? join(directory, 'revisions', revision, 'catalog.json') : join(directory, 'catalog.json');
  const metadata = await stat(path).catch(() => undefined);
  return metadata?.mtime.toISOString();
}

export function catalogDatabasePath(revisionRoot: string) {
  const served = ['public', 'dist'].some(folder => {
    const fromStatic = relative(join(root, folder), revisionRoot);
    return !isAbsolute(fromStatic) && fromStatic !== '..' && !fromStatic.startsWith(`..${sep}`);
  });
  if (!served) return join(revisionRoot, databaseName);
  const catalog = dirname(dirname(revisionRoot));
  const key = createHash('sha256').update(relative(root, catalog)).digest('hex');
  return join(root, 'data', 'item-catalog-databases', key, `${basename(revisionRoot)}.sqlite`);
}

export async function createCatalogDatabase(revisionRoot: string, progressive = false) {
  return createAssetDatabase(catalogDatabasePath(revisionRoot), progressive);
}

export async function createAssetDatabase(path: string, progressive = false) {
  await mkdir(dirname(path), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (progressive) db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE assets (
        folder TEXT NOT NULL,
        name TEXT NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (folder, name)
      ) WITHOUT ROWID;
      BEGIN;
    `);
    const insert = db.prepare('INSERT OR REPLACE INTO assets (folder, name, data) VALUES (?, ?, ?)');
    const insertNew = db.prepare('INSERT OR IGNORE INTO assets (folder, name, data) VALUES (?, ?, ?)');
    const select = db.prepare('SELECT data FROM assets WHERE folder = ? AND name = ?');
    let writes = 0;
    let writtenBytes = 0;
    return {
      read: (folder: string, name: string) => asset(select, folder, name),
      write(folder: string, name: string, data: string | Uint8Array, options?: { flag?: string }) {
        const bytes = typeof data === 'string' ? Buffer.from(data) : data;
        const statement = options?.flag === 'wx' ? insertNew : insert;
        if (statement.run(folder, name, bytes).changes) {
          writes++;
          writtenBytes += bytes.byteLength;
        }
      },
      checkpoint() { db.exec('COMMIT; BEGIN'); },
      finish() { db.exec('COMMIT'); },
      close() { db.close(); },
      stats: () => ({ writes, writtenBytes }),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function asset(select: StatementSync, folder: string, name: string) {
  const row = select.get(folder, name);
  if (row?.data instanceof Uint8Array) return Buffer.from(row.data);
  throw Object.assign(new Error(`Missing catalog asset ${folder}/${name}`), { code: 'ENOENT' });
}

export function hasCatalogDatabase(revisionRoot: string) {
  return existsSync(catalogDatabasePath(revisionRoot));
}

export async function readCatalogAsset(revisionRoot: string, folder: string, name: string) {
  const path = catalogDatabasePath(revisionRoot);
  if (!existsSync(path)) return readFile(join(revisionRoot, folder, name));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 1000');
    const select = db.prepare('SELECT data FROM assets WHERE folder = ? AND name = ?');
    return asset(select, folder, name);
  } finally {
    db.close();
  }
}
