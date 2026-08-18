/* Shared plumbing for the Drop In tests: a static file server, a browser
   with a fake camera in it, and a way to say what passed. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css'
};

/* Playwright is usually installed globally in these containers rather than
   in the repo, which has no package.json and shouldn't grow one for this. */
export async function playwright() {
  let mod;
  try { mod = await import('playwright'); }
  catch {
    const root = execSync('npm root -g').toString().trim();
    mod = await import(pathToFileURL(path.join(root, 'playwright', 'index.js')).href);
  }
  // A globally installed Playwright comes through as CommonJS, so the real
  // exports hang off .default rather than off the namespace.
  return mod.chromium ? mod : mod.default;
}

export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, rel);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () =>
    resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/' })));
}

export async function browser(pw) {
  return pw.chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required']
  });
}

export function reporter(title) {
  const rows = [];
  console.log('\n' + title + '\n');
  return {
    note: t => console.log('  · ' + t),
    ok(cond, msg, extra = '') {
      rows.push(!!cond);
      console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra ? '  — ' + extra : ''));
    },
    done() {
      const bad = rows.filter(r => !r).length;
      console.log('');
      return { total: rows.length, failed: bad };
    }
  };
}
