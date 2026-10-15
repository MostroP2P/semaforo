// Serves the repository as the published site would, with the smoke test's
// own config.json and trusted.json and a Content-Security-Policy that admits
// the local relay. Everything else comes from the working tree.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

/**
 * Starts the server on a free local port. `overrides` maps a path such as
 * `/config.json` to the body served instead of the file. Returns
 * `{ url, close }`.
 */
export async function startSite(overrides) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://x').pathname;
    const file = path === '/' ? '/index.html' : path;
    try {
      const body = overrides[file] ?? await readFile(join(ROOT, normalize(file).replace(/^(\.\.[/\\])+/, '')));
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
