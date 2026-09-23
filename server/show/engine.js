import { randomBytes } from 'node:crypto';
import { BOT, COLORS, DUR, MAX_PLAYERS } from './constants.js';
import { buildSchedule } from './schedule.js';
import { scoreArena } from './scoring.js';

/** The show's referee and director: phases, timers, roster, schedule, score.
 *  It never touches sockets; index.js drains `outbox` onto them. Internally
 *  `out('tv', …)` targets the TV screens; drain() resolves it to their ids. */
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

  function beginArena() {
    roundIdx += 1;
    const r = schedule[roundIdx];
    clearOrder = [];
    for (const p of inMatch()) { p.result = null; p.lastPoints = 0; }
    phase = 'arena';
    deadline = now() + ((r.boss ? DUR.bossArena : DUR.arena) + DUR.grace) * 1000;
    event('roundStart');
    pushState();
  }

  function applyResult(p, result) {
    if (p.result) return;
    const r = schedule[roundIdx];
    const roundSeconds = r.boss ? DUR.bossArena : DUR.arena;
    const clean = {
      cleared: Boolean(result?.cleared),
      died: Boolean(result?.died),
      timeLeft: Math.min(roundSeconds, Math.max(0, Number(result?.timeLeft) || 0)),
      bricks: Math.max(0, Math.floor(Number(result?.bricks) || 0)),
      livesLost: Math.max(0, Math.floor(Number(result?.livesLost) || 0)),
    };
    p.result = clean;
    let place = null;
    if (clean.cleared) { place = clearOrder.length; clearOrder.push(p.id); }
    const { points, coins } = scoreArena(clean, place);
    p.score += points; p.coins += coins; p.lastPoints = points;
    event(clean.cleared ? 'cleared' : clean.died ? 'died' : 'timeout', { playerId: p.id, place: place ?? undefined, points });
    if (inMatch().every((q) => q.result)) endRound();
    else pushState();
  }

  function endRound() {
    phase = 'roundEnd';
    deadline = now() + DUR.roundEnd * 1000;
    event('roundEnd');
    pushState();
  }

  async function endMatch() {
    phase = 'over';
    deadline = null;
    const ranked = inMatch().sort((a, b) => b.score - a.score);
    event('matchOver', { playerId: ranked[0]?.id });
    pushState();
    for (const p of ranked) {
      if (p.isBot) continue;
      try {
        await accounts.recordMatch(p.id, { won: p === ranked[0], score: p.score });
      } catch (err) {
        console.error(`Failed to save match stats for player ${p.id}: ${err.message}`);
      }
    }
  }

  function advancePhase() {
    if (phase === 'intro') beginArena();
    else if (phase === 'arena') {
      for (const p of inMatch()) if (!p.result) applyResult(p, { cleared: false, bricks: 0 });
    } else if (phase === 'roundEnd') {
      if (roundIdx + 1 < schedule.length) beginArena();
      else void endMatch();
    }
  }

  function handleMatch(peerId, peer, msg) {
    const fromBotHost = msg.for === BOT.id && peerId === botHost();
    const who = fromBotHost ? players.get(BOT.id) : peer.accountId ? players.get(peer.accountId) : null;
    switch (msg.k) {
      case 'result':
        if (phase === 'arena' && who?.inMatch && (msg.for === undefined || fromBotHost)) applyResult(who, msg.result);
        break;
      case 'snapshot':
        if (phase === 'arena' && who?.inMatch && (msg.for === undefined || fromBotHost)) {
          out('tv', { k: 'snapshot', playerId: who.id, snap: msg.snap });
        }
        break;
      case 'restart':
        if (phase !== 'over') break;
        phase = 'lobby'; deadline = null; roundIdx = -1; schedule = [];
        players.delete(BOT.id);
        for (const p of players.values()) { p.ready = false; p.inMatch = false; p.result = null; }
        pushState();
        break;
    }
  }

  function tick() {
    if (phase === 'lobby' && countdownEnd !== null && now() >= countdownEnd) startMatch();
    tickMatch(); // Task 6
  }

  function tickMatch() {
    let guard = 0;
    while (deadline !== null && now() >= deadline && guard++ < 50) advancePhase();
  }

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
    /** Pending messages. `to` is '*' (everyone), a peer id, or — for TV-only
     *  traffic — an array of the TV peer ids connected right now. */
    drain() {
      const o = outbox;
      outbox = [];
      const tvs = tvPeers();
      return o.map((e) => (e.to === 'tv' ? { to: tvs, msg: e.msg } : e));
    },
  };
}
