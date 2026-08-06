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

/** A busy port must read as an instruction, not as a stack trace.
 *
 *  Both the http server and the WebSocketServer have to be covered: `ws`
 *  forwards the http error to itself, and it registers that listener when it is
 *  constructed — so a handler added later, on the http server alone, never gets
 *  the chance to run. */
function onListenError(err) {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\n  Порт ${PORT} уже занят — сервер NEONOID где-то уже запущен.`);
  console.error('  Остановите тот запуск (Ctrl+C в его окне) или закройте процесс:\n');
  console.error(`      lsof -ti tcp:${PORT} | xargs kill\n`);
  console.error('  Можно и просто занять другой порт:\n');
  console.error(`      PORT=8081 npm run lan\n`);
  console.error('  Оставлять как есть нельзя: игроки получат новый клиент со старым');
  console.error('  сервером, и гонка по сети не соберётся — стол будет пустым.\n');
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

// ------------------------------------------------------------------ race ---

/** The race referee, one per room.
 *
 *  It deliberately knows nothing about arkanoid. It owns the roster, the seed,
 *  whose turn it is, the die and the clock — the four things clients must not
 *  decide for themselves — and lets every rule run on the clients, which agree
 *  because they share the seed and number their random streams.
 *
 *  `reversed` is the single rule fact it accepts from a client, because turn
 *  order is its business and the reverse cell is what changes it. */
const races = new Map();

const RACE_TURN_TIMEOUT_MS = 180_000;

function raceOf(room) {
  let race = races.get(room);
  if (!race) {
    // `log` is what lets a reloaded browser catch up: every turn is a die, a
    // level result and a reverse flag, and replaying that list through the same
    // deterministic rules rebuilds the whole race. The server still stores no
    // game state of its own.
    race = { started: false, seed: 0, distance: 50, dir: 1, turn: 0, index: 0, seats: [], deadline: 0, log: [], pending: null };
    races.set(room, race);
  }
  return race;
}

function raceSeats(race) {
  return race.seats.map((s, i) => ({ ...s, seat: i }));
}

function announceLobby(room) {
  const race = raceOf(room);
  if (race.started) return;
  // The host is whoever took the first seat, not whoever opened the page
  // first: a spectator who happened to connect early should not be holding the
  // start button while the players wait.
  broadcast(room, {
    type: 'race',
    msg: { k: 'lobby', seats: raceSeats(race), hostId: race.seats[0]?.owner ?? '', distance: race.distance },
  });
}

/** Hands the turn to the next seat and restarts the clock. */
function advanceTurn(room, race, step = 1) {
  const n = race.seats.length;
  if (!n) return;
  // step -1 is the rewind cell: the seat before this one plays again.
  race.turn = (race.turn + race.dir * step + n) % n;
  race.index += 1;
  race.deadline = Date.now() + RACE_TURN_TIMEOUT_MS;
  broadcast(room, { type: 'race', msg: { k: 'turn', seat: race.turn, index: race.index } });
}

/** A client that stops sending anything must not hang the table: its turn is
 *  burnt and play moves on without it. */
setInterval(() => {
  const now = Date.now();
  for (const [room, race] of races) {
    if (!race.started || !race.deadline || now < race.deadline) continue;
    const seat = race.turn;
    race.log.push({ index: race.index, seat, die: 0, result: null, reversed: false });
    race.pending = null;
    broadcast(room, { type: 'race', msg: { k: 'timeout', seat } });
    advanceTurn(room, race);
  }
}, 1000).unref?.();

function handleRace(ws, msg) {
  const room = ws.room;
  if (!room) return;
  const race = raceOf(room);
  const m = msg.msg ?? {};

  switch (m.k) {
    case 'claim': {
      if (race.started) return;
      const wanted = Array.isArray(m.seats) ? m.seats.slice(0, 6) : [];
      race.seats = race.seats.filter((s) => s.owner !== ws.peerId);
      for (const s of wanted) {
        if (race.seats.length >= 6) break;
        race.seats.push({
          name: String(s?.name ?? 'Игрок').slice(0, 24),
          team: Number.isInteger(s?.team) ? s.team : null,
          owner: ws.peerId,
        });
      }
      announceLobby(room);
      break;
    }

    case 'leave': {
      if (race.started) return;
      race.seats = race.seats.filter((s) => s.owner !== ws.peerId);
      announceLobby(room);
      break;
    }

    case 'start': {
      if (race.started || race.seats.length < 2) return;
      // Only somebody actually sitting at the table may start it.
      if (!race.seats.some((s) => s.owner === ws.peerId)) return;
      // The roster is frozen here, as agreed: latecomers watch.
      race.started = true;
      race.seed = (Math.random() * 0xffffffff) >>> 0;
      race.distance = [20, 50, 100].includes(m.distance) ? m.distance : 50;
      race.dir = 1;
      race.turn = 0;
      race.index = 0;
      race.deadline = Date.now() + RACE_TURN_TIMEOUT_MS;
      broadcast(room, {
        type: 'race',
        msg: { k: 'started', seed: race.seed, distance: race.distance, seats: raceSeats(race) },
      });
      broadcast(room, { type: 'race', msg: { k: 'turn', seat: race.turn, index: race.index } });
      break;
    }

    case 'result': {
      // Only the seat whose turn it is may end a turn, and the die is ours.
      const seat = race.seats[race.turn];
      if (!race.started || !seat || seat.owner !== ws.peerId) return;
      const die = 1 + Math.floor(Math.random() * 6);
      race.pending = { index: race.index, seat: race.turn, die, result: m.result ?? null };
      broadcast(room, {
        type: 'race',
        msg: { k: 'roll', seat: race.turn, index: race.index, die, result: m.result ?? null },
      });
      break;
    }

    case 'turnEnd': {
      const seat = race.seats[race.turn];
      if (!race.started || !seat || seat.owner !== ws.peerId) return;
      if (race.pending) {
        race.log.push({ ...race.pending, reversed: !!m.reversed });
        race.pending = null;
      }
      if (m.reversed) race.dir = -race.dir;
      advanceTurn(room, race, m.rewind ? -1 : 1);
      break;
    }

    case 'resume': {
      if (!race.started) return;
      send(ws, {
        type: 'race',
        msg: {
          k: 'resume',
          seed: race.seed,
          distance: race.distance,
          seats: raceSeats(race),
          log: race.log,
          turn: race.turn,
          index: race.index,
        },
      });
      break;
    }

    case 'card': {
      if (!race.started) return;
      const from = race.seats[m.from];
      if (!from || from.owner !== ws.peerId) return;
      broadcast(room, { type: 'race', msg: { k: 'card', from: m.from, card: m.card } });
      break;
    }

    case 'snapshot': {
      const seat = race.seats[race.turn];
      if (!race.started || !seat || seat.owner !== ws.peerId) return;
      // A live turn is proof of life, so the clock is pushed back here.
      race.deadline = Date.now() + RACE_TURN_TIMEOUT_MS;
      broadcast(room, { type: 'race', msg: { k: 'snapshot', seat: race.turn, snap: m.snap } }, ws);
      break;
    }

    case 'over': {
      if (!race.started) return;
      broadcast(room, { type: 'race', msg: { k: 'over', seat: race.turn } });
      races.delete(room);
      break;
    }

    default:
      break;
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

  // The feature list is how a client spots a server older than itself: an
  // outdated one simply will not mention the race, and the lobby can say so
  // instead of sitting there with an empty table.
  send(ws, { type: 'welcome', id: ws.peerId, hall, features: ['race'] });

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

      case 'race': {
        handleRace(ws, msg);
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

    const race = races.get(room);
    if (race && !race.started) {
      // Lobby: a seat nobody owns is a seat nobody plays.
      race.seats = race.seats.filter((s) => s.owner !== ws.peerId);
    } else if (race && race.started && race.seats[race.turn]?.owner === ws.peerId) {
      // Mid-race the seats stay — the player may come back — but the turn they
      // were in the middle of does not wait for them.
      race.log.push({ index: race.index, seat: race.turn, die: 0, result: null, reversed: false });
      race.pending = null;
      broadcast(room, { type: 'race', msg: { k: 'timeout', seat: race.turn } });
      advanceTurn(room, race);
    }

    if (rooms.get(room)?.size === 0) {
      rooms.delete(room);
      races.delete(room);
    } else {
      announcePeers(room);
      announceLobby(room);
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
