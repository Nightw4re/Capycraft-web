import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(file => file && existsSync(join(root, file)));
const paths = new Set(['.']);
for (const file of files) {
  paths.add(file);
  for (let dir = posix.dirname(file); !paths.has(dir); dir = posix.dirname(dir)) paths.add(dir);
}

function markdown(file) {
  const headings = new Set();
  const links = [];
  let fence;
  const body = readFileSync(join(root, file), 'utf8');
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const slug = heading[1].toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
      let id = slug;
      for (let suffix = 1; headings.has(id); suffix++) id = `${slug}-${suffix}`;
      headings.add(id);
    }
    for (const match of line.matchAll(/\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ target: match[1] ?? match[2], line: index + 1 });
    }
  }
  return { headings, links };
}

const docs = new Map(files.filter(file => /\.md$/i.test(file)).map(file => [file, markdown(file)]));
let failures = 0;
let checked = 0;
for (const [file, { links }] of docs) {
  for (const { target, line } of links) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)) continue;
    checked++;
    const [raw, fragment] = target.split('#', 2);
    let issue;
    try {
      const path = raw ? posix.join(posix.dirname(file), decodeURIComponent(raw.split('?')[0])).replace(/\/$/, '') : file;
      if (!paths.has(path)) issue = 'path is missing, ignored, or has incorrect case';
      else if (fragment && docs.has(path) && !docs.get(path).headings.has(decodeURIComponent(fragment))) issue = 'heading is missing';
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      issue = 'invalid URL encoding';
    }
    if (!issue) continue;
    failures++;
    console.error(`${file}:${line} ${target} (${issue})`);
  }
}

console.log(`Checked ${checked} local links in ${docs.size} Markdown files. ${failures} failed.`);
process.exitCode = failures ? 1 : 0;
