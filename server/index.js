import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createShowEngine } from './show/engine.js';
import { createAccountStore } from './show/accounts.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const DATA_DIR = join(ROOT, 'server', 'data');
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ico': 'image/x-icon',
};

// ------------------------------------------------------------- static files --

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Keep requests inside dist: no climbing out with ../
  const file = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // Unknown path: hand back index.html so the game boots anyway.
    try {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(await readFile(join(DIST, 'index.html')));
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}

// ----------------------------------------------------------- show engine ----

const accounts = await createAccountStore(DATA_DIR);
const show = createShowEngine({ now: Date.now, accounts });
/** peerId -> ws */
const sockets = new Map();

/** Sends the engine's pending messages. `to` is '*' (everyone), one peer id,
 *  or an array of peer ids (TV-only traffic). Each payload is stringified once. */
function flush() {
  for (const { to, msg } of show.drain()) {
    const text = JSON.stringify({ type: 'show', msg });
    const targets = to === '*' ? sockets.values() : Array.isArray(to) ? to.map((id) => sockets.get(id)) : [sockets.get(to)];
    for (const ws of targets) if (ws) sendRaw(ws, text);
  }
}

setInterval(() => {
  try {
    show.tick();
    flush();
  } catch (err) {
    console.error('show.tick failed:', err);
    flush();
  }
}, 250).unref?.();

const server = createServer((req, res) => {
  void serveStatic(req, res);
});

// -------------------------------------------------------------- websockets --

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
/** roomName -> Set<ws> */
const rooms = new Map();

/** A busy port must read as an instruction, not as a stack trace.
 *
 *  Both the http server and the WebSocketServer have to be covered: `ws`
 *  forwards the http error to itself, and it registers that listener when it is
 *  constructed — so a handler added later, on the http server alone, never gets
 *  the chance to run. */
function onListenError(err) {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\n  Port ${PORT} is already in use — a server is already running somewhere.`);
  console.error('  Stop that run (Ctrl+C in its window) or kill the process:\n');
  console.error(`      lsof -ti tcp:${PORT} | xargs kill\n`);
  console.error('  Or just use a different port:\n');
  console.error(`      PORT=8081 npm run lan\n`);
  console.error('  Do not leave it as is: players would get the new client talking to the old');
  console.error('  server, and the LAN match would never come together.\n');
  process.exit(1);
}

server.on('error', onListenError);
wss.on('error', onListenError);

const sendRaw = (ws, text) => {
  if (ws.readyState === ws.OPEN) ws.send(text);
};
const send = (ws, msg) => sendRaw(ws, JSON.stringify(msg));

function broadcast(room, msg, except) {
  for (const peer of rooms.get(room) ?? []) {
    if (peer !== except) send(peer, msg);
  }
}

// ---------------------------------------------------------------- rooms ----

let nextPeerId = 1;

wss.on('connection', (ws) => {
  ws.peerId = `p${nextPeerId++}`;
  ws.room = null;

  sockets.set(ws.peerId, ws);
  show.connect(ws.peerId);

  send(ws, { type: 'welcome', id: ws.peerId, features: ['show'] });

  // A socket error (e.g. a message over maxPayload) closes that socket; without
  // a listener it would be an unhandled 'error' event and take the server down.
  ws.on('error', (err) => console.error('socket error from', ws.peerId, err.message));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // `null`, numbers, strings and arrays parse fine but are not messages.
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;

    try {
      switch (msg.type) {
        case 'join': {
          const room = String(msg.room ?? 'lobby').slice(0, 32);
          rooms.get(ws.room)?.delete(ws);
          ws.room = room;
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(ws);
          send(ws, { type: 'joined', room });
          break;
        }

        case 'show':
          void show.handle(ws.peerId, msg.msg).then(flush, (err) => {
            console.error('show.handle failed:', err);
            flush();
          }).catch((err) => console.error('show flush failed:', err));
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('bad message from', ws.peerId, err);
    }
  });

  ws.on('close', () => {
    sockets.delete(ws.peerId);
    show.disconnect(ws.peerId);
    flush();

    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (rooms.get(room)?.size === 0) {
      rooms.delete(room);
    }
  });
});

// ------------------------------------------------------------------- boot --

function localAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  const addresses = localAddresses();
  console.log('');
  console.log('  ARCOQUIZ — LAN server');
  console.log('  ---------------------------------------');
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('  WARNING: no dist folder. Build the game: npm run build');
    console.log('');
  }
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`  On the LAN:        http://${address}:${PORT}`);
  }
  if (!addresses.length) {
    console.log('  No network addresses found — check your Wi-Fi connection.');
  }
  console.log('');
  console.log('  Stop: Ctrl+C');
  console.log('');
});
