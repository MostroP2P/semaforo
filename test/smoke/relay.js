// A minimal Nostr relay for the smoke test: it keeps the events it is
// given, answers REQ with the matching ones and an EOSE, and nothing else.
// Not a relay to run anywhere but here.

import { WebSocketServer } from 'ws';
import { matchFilters } from 'nostr-tools';

/** Starts a relay on a free local port. Returns `{ url, add, close }`. */
export async function startRelay(events = []) {
  const stored = [...events];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!Array.isArray(message) || message[0] !== 'REQ') return;
      const [, id, ...filters] = message;
      for (const event of stored.filter((e) => matchFilters(filters, e))) {
        socket.send(JSON.stringify(['EVENT', id, event]));
      }
      socket.send(JSON.stringify(['EOSE', id]));
    });
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    add: (event) => stored.push(event),
    close: () => new Promise((resolve) => {
      for (const client of server.clients) client.terminate();
      server.close(resolve);
    }),
  };
}
