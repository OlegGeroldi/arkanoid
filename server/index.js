import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const DATA_DIR = join(ROOT, 'server', 'data');
const HALL_FILE = join(DATA_DIR, 'hall.json');
const PORT = Number(process.env.PORT ?? 8080);
const MAX_HALL = 100;

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

// ----------------------------------------------------------- hall of fame --

/** The leaderboard survives restarts: it is the one piece of state worth
 *  keeping, and a small JSON file is enough for a game on a home network. */
let hall = [];

async function loadHall() {
  try {
    hall = JSON.parse(await readFile(HALL_FILE, 'utf8'));
    if (!Array.isArray(hall)) hall = [];
  } catch {
    hall = [];
  }
}

let saveQueued = false;
async function saveHall() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(async () => {
    saveQueued = false;
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(HALL_FILE, JSON.stringify(hall, null, 2));
    } catch (err) {
      console.warn('[neonoid] не удалось сохранить доску почёта:', err.message);
    }
  }, 500);
}

function mergeHallEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.score !== 'number') return false;
  const i = hall.findIndex((e) => e.id === entry.id);
  // The same run reporting again only counts when it improved.
  if (i >= 0 && hall[i].score >= entry.score) return false;
  if (i >= 0) hall[i] = entry;
  else hall.push(entry);
  hall.sort((a, b) => b.score - a.score);
  hall = hall.slice(0, MAX_HALL);
  void saveHall();
  return true;
}

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
  if (req.url === '/api/hall') {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify(hall));
    return;
  }
  void serveStatic(req, res);
});

// -------------------------------------------------------------- websockets --

const wss = new WebSocketServer({ server });
/** roomName -> Set<ws> */
const rooms = new Map();

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function broadcast(room, msg, except) {
  for (const peer of rooms.get(room) ?? []) {
    if (peer !== except) send(peer, msg);
  }
}

function peerList(room) {
  return [...(rooms.get(room) ?? [])].map((ws) => ({
    id: ws.peerId,
    name: ws.playerName,
    progress: ws.progress ?? null,
  }));
}

function announcePeers(room) {
  broadcast(room, { type: 'peers', peers: peerList(room) });
}

let nextPeerId = 1;

wss.on('connection', (ws) => {
  ws.peerId = `p${nextPeerId++}`;
  ws.playerName = 'Гость';
  ws.room = null;

  send(ws, { type: 'welcome', id: ws.peerId, hall });

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
        if (ws.room) {
          rooms.get(ws.room)?.delete(ws);
          announcePeers(ws.room);
        }
        ws.room = room;
        ws.playerName = String(msg.name ?? 'Гость').slice(0, 24);
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        send(ws, { type: 'joined', room, peers: peerList(room) });
        announcePeers(room);
        break;
      }

      case 'progress': {
        // Spectating: a light snapshot, forwarded as-is to the room.
        ws.progress = msg.progress ?? null;
        if (ws.room) {
          broadcast(ws.room, { type: 'progress', id: ws.peerId, name: ws.playerName, progress: ws.progress }, ws);
        }
        break;
      }

      case 'hall': {
        if (mergeHallEntry(msg.entry)) {
          for (const client of wss.clients) send(client, { type: 'hall', hall });
        }
        break;
      }

      case 'relay': {
        // Anything the game modes want to pass along (attacks, ready flags).
        if (ws.room) broadcast(ws.room, { type: 'relay', id: ws.peerId, payload: msg.payload }, ws);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.room) {
      rooms.get(ws.room)?.delete(ws);
      if (rooms.get(ws.room)?.size === 0) rooms.delete(ws.room);
      else announcePeers(ws.room);
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

await loadHall();

server.listen(PORT, () => {
  const addresses = localAddresses();
  console.log('');
  console.log('  NEONOID — сервер локальной сети');
  console.log('  ------------------------------');
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
  console.log(`  Записей в доске почёта: ${hall.length}`);
  console.log('  Остановить: Ctrl+C');
  console.log('');
});
