import { randomBytes } from 'node:crypto';
import { BOT, COLORS, DUR, MAX_PLAYERS } from './constants.js';
import { buildSchedule } from './schedule.js';
import { scoreArena } from './scoring.js';

/** The show's referee and director: phases, timers, roster, schedule, score.
 *  It never touches sockets; index.js drains `outbox` onto them. */
export function createShowEngine({ now, accounts, seed = () => (Math.random() * 2 ** 32) >>> 0 }) {
  /** peerId -> { role, accountId|null } */
  const peers = new Map();
  /** token -> accountId */
  const tokens = new Map();
  /** accountId|'bot' -> player record */
  const players = new Map();
  let outbox = [];

  let phase = 'lobby';
  let schedule = [];
  let roundIdx = -1;
  let deadline = null;
  let countdownEnd = null;
  let clearOrder = [];

  const out = (to, msg) => outbox.push({ to, msg });
  const event = (kind, extra = {}) => out('*', { k: 'event', ev: { kind, at: now(), ...extra } });

  const tvPeers = () => [...peers].filter(([, p]) => p.role === 'tv').map(([id]) => id);
  const playerPeer = (accountId) => [...peers].find(([, p]) => p.accountId === accountId)?.[0] ?? null;
  const inMatch = () => [...players.values()].filter((p) => p.inMatch);

  function botHost() {
    const tv = tvPeers()[0];
    if (tv) return tv;
    const humans = inMatch().filter((p) => !p.isBot && playerPeer(p.id));
    return humans.length ? playerPeer(humans[0].id) : null;
  }

  function publicPlayer(p) {
    return {
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, isBot: p.isBot,
      connected: p.isBot || playerPeer(p.id) !== null,
      ready: p.ready, inMatch: p.inMatch, score: p.score, coins: p.coins,
      result: p.result, lastPoints: p.lastPoints,
    };
  }

  function state() {
    const r = schedule[roundIdx];
    return {
      phase,
      now: now(),
      players: [...players.values()].map(publicPlayer),
      round: r ? { ...r, seconds: r.boss ? DUR.bossArena : DUR.arena } : null,
      rounds: schedule.length,
      deadline,
      countdownEnd,
      botHost: botHost(),
      tvCount: tvPeers().length,
    };
  }

  const pushState = () => out('*', { k: 'state', show: state() });

  function freeColor(pool = [...players.values()]) {
    const used = new Set(pool.map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  }

  function addPlayer(acc, isBot = false, colorPool = undefined) {
    const p = {
      id: acc.id, name: acc.name, avatar: acc.avatar, color: freeColor(colorPool), isBot,
      ready: isBot, inMatch: false, score: 0, coins: 0, result: null, lastPoints: 0,
    };
    players.set(p.id, p);
    return p;
  }

  function bind(peerId, acc) {
    // A second device logging into the same account takes it over.
    for (const [pid, p] of peers) if (p.accountId === acc.id && pid !== peerId) p.accountId = null;
    peers.get(peerId).accountId = acc.id;
    if (!players.has(acc.id)) {
      if (players.size >= MAX_PLAYERS) {
        peers.get(peerId).accountId = null;
        out(peerId, { k: 'auth', ok: false, error: 'All 10 seats are taken.' });
        return;
      }
      addPlayer(acc);
      event('joined', { playerId: acc.id });
    }
    const token = randomBytes(12).toString('hex');
    tokens.set(token, acc.id);
    out(peerId, { k: 'auth', ok: true, player: publicPlayer(players.get(acc.id)), token });
    pushState();
  }

  function startMatch() {
    const connected = [...players.values()].filter((p) => !p.isBot && playerPeer(p.id));
    if (!connected.some((p) => p.ready)) {
      // Everyone who was ready un-readied or disconnected before the countdown fired.
      countdownEnd = null;
      return;
    }
    countdownEnd = null;
    for (const p of players.values()) {
      p.inMatch = p.ready && (p.isBot || playerPeer(p.id) !== null);
      p.score = 0; p.coins = 0; p.result = null; p.lastPoints = 0;
    }
    if (inMatch().length === 1 && !players.has(BOT.id)) {
      const b = addPlayer(BOT, true, inMatch());
      b.inMatch = true;
    }
    schedule = buildSchedule(seed());
    roundIdx = -1;
    phase = 'intro';
    deadline = now() + DUR.intro * 1000;
    event('matchStart');
    pushState();
  }

  function maybeStart() {
    const connected = [...players.values()].filter((p) => !p.isBot && playerPeer(p.id));
    if (!connected.some((p) => p.ready)) { countdownEnd = null; return; }
    if (connected.every((p) => p.ready)) startMatch();
    else if (countdownEnd === null) countdownEnd = now() + DUR.countdown * 1000;
  }

  async function handle(peerId, msg) {
    const peer = peers.get(peerId);
    if (!peer || !msg || typeof msg.k !== 'string') return;
    switch (msg.k) {
      case 'hello':
        peer.role = msg.role === 'tv' ? 'tv' : 'player';
        out(peerId, { k: 'state', show: state() });
        if (peer.role === 'tv') pushState();
        break;
      case 'accounts':
        out(peerId, { k: 'accounts', list: accounts.list() });
        break;
      case 'register':
        try {
          const acc = await accounts.register(msg);
          bind(peerId, acc);
        } catch (err) {
          out(peerId, { k: 'auth', ok: false, error: err.message });
        }
        break;
      case 'login': {
        const acc = accounts.verify(msg.id, msg.pin);
        if (!acc) out(peerId, { k: 'auth', ok: false, error: 'Wrong PIN.' });
        else bind(peerId, acc);
        break;
      }
      case 'resume': {
        const id = tokens.get(msg.token);
        const acc = id && accounts.list().find((a) => a.id === id);
        if (!acc) out(peerId, { k: 'auth', ok: false, error: 'Session expired — please sign in again.' });
        else bind(peerId, acc);
        break;
      }
      case 'ready': {
        const p = peer.accountId && players.get(peer.accountId);
        if (!p || phase !== 'lobby') break;
        p.ready = Boolean(msg.ready);
        event('ready', { playerId: p.id });
        maybeStart();
        pushState();
        break;
      }
      default:
        handleMatch(peerId, peer, msg); // Task 6
    }
  }

  function handleMatch() {}

  function tick() {
    if (phase === 'lobby' && countdownEnd !== null && now() >= countdownEnd) startMatch();
    tickMatch(); // Task 6
  }

  function tickMatch() {}

  return {
    connect(peerId) { peers.set(peerId, { role: 'player', accountId: null }); },
    disconnect(peerId) {
      const accId = peers.get(peerId)?.accountId;
      peers.delete(peerId);
      if (accId) event('left', { playerId: accId });
      if (phase === 'lobby') maybeStart();
      pushState();
    },
    handle,
    tick,
    state,
    drain() { const o = outbox; outbox = []; return o; },
  };
}
