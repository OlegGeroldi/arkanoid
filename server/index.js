import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createTeamQuiz } from './teamQuiz.js';
import { createJeopardyStore, JeopardyValidationError } from './jeopardyStore.js';

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

const server = createServer((req, res) => {
  if (req.url === '/api/jeopardy') {
    void handleJeopardyApi(req, res);
    return;
  }
  void serveStatic(req, res);
});

// -------------------------------------------------------------- websockets --

const wss = new WebSocketServer({ server });
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
  console.error(`\n  Порт ${PORT} уже занят — сервер уже где-то запущен.`);
  console.error('  Остановите тот запуск (Ctrl+C в его окне) или закройте процесс:\n');
  console.error(`      lsof -ti tcp:${PORT} | xargs kill\n`);
  console.error('  Можно и просто занять другой порт:\n');
  console.error(`      PORT=8081 npm run lan\n`);
  console.error('  Оставлять как есть нельзя: игроки получат новый клиент со старым');
  console.error('  сервером, и матч по сети не соберётся.\n');
  process.exit(1);
}

server.on('error', onListenError);
wss.on('error', onListenError);

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function broadcast(room, msg, except) {
  for (const peer of rooms.get(room) ?? []) {
    if (peer !== except) send(peer, msg);
  }
}

const teamQuiz = createTeamQuiz({ broadcast, send, getPeers: (room) => rooms.get(room) ?? [] });
setInterval(() => teamQuiz.tick(), 1000).unref?.();

// -------------------------------------------------------------- jeopardy ---

const jeopardyStore = createJeopardyStore(DATA_DIR);

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Тело запроса слишком большое.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleJeopardyApi(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await jeopardyStore.load();
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify({ error: 'Не удалось прочитать данные квиза.' }));
    }
    return;
  }
  if (req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      await jeopardyStore.save(body);
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const status = err instanceof JeopardyValidationError ? 400 : 500;
      res.writeHead(status, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify({ error: err.message || 'Internal server error.' }));
    }
    return;
  }
  res.writeHead(405).end('method not allowed');
}

// ---------------------------------------------------------------- rooms ----

let nextPeerId = 1;

wss.on('connection', (ws) => {
  ws.peerId = `p${nextPeerId++}`;
  ws.room = null;

  send(ws, { type: 'welcome', id: ws.peerId, features: ['teamquiz'] });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

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

      case 'teamquiz': {
        teamQuiz.handle(ws, msg);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (rooms.get(room)?.size === 0) {
      rooms.delete(room);
      teamQuiz.cleanup(room);
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
  console.log('  КОМАНДНЫЙ КВИЗ — сервер локальной сети');
  console.log('  ---------------------------------------');
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('  ВНИМАНИЕ: папки dist нет. Соберите игру: npm run build');
    console.log('');
  }
  console.log(`  На этом компьютере:  http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`  В локальной сети:    http://${address}:${PORT}`);
  }
  if (!addresses.length) {
    console.log('  Сетевых адресов не найдено — проверьте подключение к Wi-Fi.');
  }
  console.log('');
  console.log('  Остановить: Ctrl+C');
  console.log('');
});
