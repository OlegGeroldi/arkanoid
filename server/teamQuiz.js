/** Referee for the team-quiz mode — same split as `handleRace` in
 *  `server/index.js`: this module owns identity and sequencing (which teams
 *  and members exist, the pilot rotation, the match seed, the round
 *  number/phase/deadline, which jeopardy cards are used) and nothing about
 *  the numbers a round produces. Every connected screen keeps its own copy of
 *  `TeamRacer[]` (`src/core/teamRace.ts`) and replays the events this module
 *  broadcasts — `roll`, `jeopardyAwarded`, `purchase` — through the same pure
 *  functions, so track position, lives, credits and score end up identical
 *  everywhere without this server ever computing or storing them.
 *
 *  `TEAM_COLORS` below is a presentation-only duplicate of the palette in
 *  `src/core/teamRace.ts` — safe to drift (it only picks a hex color), kept
 *  here so this file has zero dependency on the TypeScript build. */

const TEAM_COLORS = ['#4de2ff', '#ff5fa2', '#3ddc84', '#ffd24d', '#b06bff', '#ff7a3d'];

/** Presentation-only duplicate of `core/teamRace.ts`'s `ALLIANCE_MAX` — up to
 *  this many racers can share an alliance slot at once. */
const ALLIANCE_MAX = 3;

/** A little over the longest round clock (`TEAM_BOSS_ROUND_SECONDS` = 150s in
 *  `core/teamRace.ts`), so a straggler's own level timer always runs out
 *  first and this is only a backstop for a dropped connection. */
const ROUND_TIMEOUT_MS = 220_000;

function emptyResult() {
  return { cleared: false, died: true, timeLeft: 0, timeLimit: 0, livesLost: 0, bestCombo: 0, bricks: 0, boss: false };
}

const BROADCAST_VIEWS = new Set(['scoreboard', 'question', 'single', 'dual']);

export function createTeamQuiz({ broadcast, send, getPeers }) {
  /** room -> match */
  const matches = new Map();

  function matchOf(room) {
    let match = matches.get(room);
    if (!match) {
      match = {
        teams: [],
        nextTeamSeq: 1,
        nextMemberSeq: 1,
        started: false,
        seed: 0,
        distance: 50,
        round: 0,
        phase: 'lobby',
        pilots: {},
        resolved: new Set(),
        deadline: 0,
        revealedCards: new Set(),
        usedCards: new Set(),
        // Director state for the projector/TV screen.
        broadcast: { view: 'scoreboard', focusTeamId: null },
        currentQuestion: null,
        // This round's free-text answers, teamId -> text. Cleared every round.
        answers: new Map(),
        // Questions teams wrote for the host, oldest first. Not round-scoped —
        // survives a `resetMatch` so nobody's submission is lost by mistake.
        nextQuestionSeq: 1,
        questionInbox: [],
      };
      matches.set(room, match);
    }
    return match;
  }

  function publicTeam(team) {
    return {
      id: team.id,
      name: team.name,
      color: team.color,
      members: team.members,
      pilotOrder: team.pilotOrder,
      pilotCursor: team.pilotCursor,
    };
  }

  function roundView(match) {
    return {
      round: match.round,
      distance: match.distance,
      phase: match.phase,
      pilots: { ...match.pilots },
      deadline: match.deadline,
    };
  }

  function sendRosterTo(ws, match) {
    send(ws, { type: 'teamquiz', msg: { k: 'roster', teams: match.teams.map(publicTeam) } });
  }

  function sendRoundTo(ws, match) {
    send(ws, { type: 'teamquiz', msg: { k: 'round', view: roundView(match) } });
  }

  function broadcastRoster(room, match) {
    broadcast(room, { type: 'teamquiz', msg: { k: 'roster', teams: match.teams.map(publicTeam) } });
  }

  function broadcastRound(room, match) {
    broadcast(room, { type: 'teamquiz', msg: { k: 'round', view: roundView(match) } });
  }

  function fail(ws, message) {
    send(ws, { type: 'teamquiz', msg: { k: 'error', message } });
  }

  /** Admin connections only — used for a team's submitted question, which is
   *  meant for the host's eyes until picked, not a broadcast. */
  function sendToAdmins(room, msg) {
    for (const peer of getPeers(room)) {
      if (peer.tqRole === 'admin') send(peer, msg);
    }
  }

  function broadcastQuestion(room, match) {
    broadcast(room, { type: 'teamquiz', msg: { k: 'currentQuestion', question: match.currentQuestion } });
  }

  /** Advances every team's pilot rotation by one and opens the round's clock.
   *  A team with nobody registered simply sits the round out (`pilots[id]`
   *  stays null); the admin UI is expected to require at least one member per
   *  team before letting the match start. */
  function startRound(match) {
    match.round += 1;
    match.phase = 'playing';
    match.pilots = {};
    match.resolved = new Set();
    match.answers = new Map();
    for (const team of match.teams) {
      if (team.pilotOrder.length) {
        team.pilotCursor = (team.pilotCursor + 1) % team.pilotOrder.length;
        match.pilots[team.id] = team.pilotOrder[team.pilotCursor];
      } else {
        match.pilots[team.id] = null;
      }
    }
    match.deadline = Date.now() + ROUND_TIMEOUT_MS;
  }

  function resolveTeam(room, match, teamId, result) {
    if (match.resolved.has(teamId)) return;
    match.resolved.add(teamId);
    const order = match.resolved.size;
    const die = 1 + Math.floor(Math.random() * 6);
    broadcast(room, {
      type: 'teamquiz',
      msg: { k: 'roll', teamId, round: match.round, order, die, result },
    });
    if (match.resolved.size >= match.teams.length) {
      match.phase = 'resolved';
      match.deadline = 0;
      broadcastRound(room, match);
    }
  }

  function handle(ws, msg) {
    const room = ws.room;
    if (!room) return;
    const match = matchOf(room);
    const m = msg.msg ?? {};

    switch (m.k) {
      case 'hello': {
        ws.tqRole = m.role;
        ws.tqTeamId = m.teamId || null;
        sendRosterTo(ws, match);
        // Pre-start, `match.round`/`match.phase` are just this module's own
        // "nothing has happened yet" bookkeeping — not a real round. Sending
        // it would make every screen think a round is already under way.
        if (match.started) {
          send(ws, { type: 'teamquiz', msg: { k: 'started', seed: match.seed, distance: match.distance } });
          sendRoundTo(ws, match);
          // A late join/reconnect otherwise never learns which cards are
          // already revealed/used — the grid would show everything as fresh.
          // (Credits already paid for a used card are *not* replayed here —
          // that would need the same kind of turn log the solo race keeps
          // for its `resume`; a known gap, not this fix's job.)
          send(ws, {
            type: 'teamquiz',
            msg: { k: 'jeopardyState', revealed: [...match.revealedCards], used: [...match.usedCards] },
          });
          // Same idea for alliances — a lightweight `alliance` event, not
          // roster identity, so a late join has to be caught up explicitly.
          for (const team of match.teams) {
            if (team.allianceId != null) {
              send(ws, { type: 'teamquiz', msg: { k: 'alliance', racerId: team.id, allianceId: team.allianceId } });
            }
          }
        }
        send(ws, { type: 'teamquiz', msg: { k: 'broadcastView', state: match.broadcast } });
        send(ws, { type: 'teamquiz', msg: { k: 'currentQuestion', question: match.currentQuestion } });
        if (m.role === 'admin') {
          for (const question of match.questionInbox) {
            send(ws, { type: 'teamquiz', msg: { k: 'questionSubmitted', question } });
          }
        }
        break;
      }

      case 'admin:addPlayer': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        const teamId = `t${match.nextTeamSeq++}`;
        const memberId = `m${match.nextMemberSeq++}`;
        const name = String(m.name || `Игрок ${match.teams.length + 1}`).slice(0, 24);
        match.teams.push({
          id: teamId,
          name,
          color: TEAM_COLORS[match.teams.length % TEAM_COLORS.length],
          members: [{ id: memberId, name, ai: false }],
          pilotOrder: [memberId],
          pilotCursor: -1,
          allianceId: null,
        });
        broadcastRoster(room, match);
        break;
      }

      case 'admin:addTeam': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        const id = `t${match.nextTeamSeq++}`;
        match.teams.push({
          id,
          name: String(m.name || `Команда ${match.teams.length + 1}`).slice(0, 40),
          color: TEAM_COLORS[match.teams.length % TEAM_COLORS.length],
          members: [],
          pilotOrder: [],
          pilotCursor: -1,
          allianceId: null,
        });
        broadcastRoster(room, match);
        break;
      }

      case 'admin:removeTeam': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        match.teams = match.teams.filter((t) => t.id !== m.teamId);
        broadcastRoster(room, match);
        break;
      }

      case 'admin:addMember': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        const team = match.teams.find((t) => t.id === m.teamId);
        if (!team) return fail(ws, 'Неизвестная команда.');
        const id = `m${match.nextMemberSeq++}`;
        team.members.push({ id, name: String(m.name || 'Игрок').slice(0, 24), ai: !!m.ai });
        // Registration order is the default pilot rotation.
        team.pilotOrder.push(id);
        broadcastRoster(room, match);
        break;
      }

      case 'admin:removeMember': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        const team = match.teams.find((t) => t.id === m.teamId);
        if (!team) return;
        team.members = team.members.filter((p) => p.id !== m.memberId);
        team.pilotOrder = team.pilotOrder.filter((id) => id !== m.memberId);
        team.pilotCursor = -1;
        broadcastRoster(room, match);
        break;
      }

      case 'admin:resetMatch': {
        // Un-starts the match without losing the roster: teams and members
        // stay exactly as registered, only the run itself (round, pilots,
        // seed, board progress) goes back to blank. Every client clears its
        // own replayed `TeamRacer[]` on the `reset` broadcast and rebuilds it
        // fresh from the roster this also re-sends.
        match.started = false;
        match.round = 0;
        match.phase = 'lobby';
        match.pilots = {};
        match.resolved = new Set();
        match.deadline = 0;
        match.revealedCards = new Set();
        match.usedCards = new Set();
        match.broadcast = { view: 'scoreboard', focusTeamId: null };
        match.currentQuestion = null;
        match.answers = new Map();
        // Every client already wipes its own replayed alliances on `reset`
        // (a fresh `TeamRacer` per roster entry) — clear the server's own
        // copy too, or a later reconnect's catch-up would hand out
        // alliances nobody else still remembers.
        for (const team of match.teams) team.allianceId = null;
        broadcast(room, { type: 'teamquiz', msg: { k: 'reset' } });
        broadcastRoster(room, match);
        broadcast(room, { type: 'teamquiz', msg: { k: 'broadcastView', state: match.broadcast } });
        broadcastQuestion(room, match);
        break;
      }

      case 'admin:setPilotOrder': {
        if (match.started) return fail(ws, 'Матч уже идёт — сначала сбросьте его на шаге «Матч».');
        const team = match.teams.find((t) => t.id === m.teamId);
        if (!team) return;
        const known = new Set(team.members.map((p) => p.id));
        const order = Array.isArray(m.order) ? m.order.filter((id) => known.has(id)) : [];
        if (order.length !== team.members.length) return fail(ws, 'Порядок пилотов должен включать всех игроков команды.');
        team.pilotOrder = order;
        team.pilotCursor = -1;
        broadcastRoster(room, match);
        break;
      }

      case 'admin:startMatch': {
        if (match.started) return;
        if (match.teams.length < 2) return fail(ws, 'Нужно минимум две команды.');
        if (match.teams.some((t) => t.members.length === 0)) return fail(ws, 'В каждой команде должен быть хотя бы один игрок.');
        match.started = true;
        match.seed = (Math.random() * 0xffffffff) >>> 0;
        match.distance = Number.isFinite(m.distance) ? Math.min(200, Math.max(10, Math.round(m.distance))) : 50;
        match.round = 0;
        match.revealedCards = new Set();
        match.usedCards = new Set();
        startRound(match);
        broadcastRoster(room, match);
        broadcast(room, { type: 'teamquiz', msg: { k: 'started', seed: match.seed, distance: match.distance } });
        broadcastRound(room, match);
        break;
      }

      case 'admin:nextRound': {
        if (!match.started || match.phase !== 'resolved') return;
        startRound(match);
        broadcastRound(room, match);
        break;
      }

      case 'admin:revealCard': {
        if (!match.started) return;
        if (match.usedCards.has(m.cardId)) return fail(ws, 'Эта карточка уже разыграна.');
        match.revealedCards.add(m.cardId);
        broadcast(room, { type: 'teamquiz', msg: { k: 'cardRevealed', cardId: m.cardId } });
        match.currentQuestion = { source: 'jeopardy', cardId: m.cardId };
        broadcastQuestion(room, match);
        break;
      }

      case 'admin:setBroadcastView': {
        if (!BROADCAST_VIEWS.has(m.view)) return fail(ws, 'Неизвестный вид трансляции.');
        const focusTeamId = m.focusTeamId && match.teams.some((t) => t.id === m.focusTeamId) ? m.focusTeamId : null;
        match.broadcast = { view: m.view, focusTeamId };
        broadcast(room, { type: 'teamquiz', msg: { k: 'broadcastView', state: match.broadcast } });
        break;
      }

      case 'admin:revealAnswers': {
        broadcast(room, { type: 'teamquiz', msg: { k: 'answersRevealed', answers: Object.fromEntries(match.answers) } });
        break;
      }

      case 'admin:pickCustomQuestion': {
        const idx = match.questionInbox.findIndex((q) => q.id === m.id);
        if (idx < 0) return fail(ws, 'Этот вопрос уже показан или не найден.');
        const [question] = match.questionInbox.splice(idx, 1);
        match.currentQuestion = { source: 'custom', id: question.id, teamId: question.teamId, text: question.text };
        broadcast(room, { type: 'teamquiz', msg: { k: 'customQuestionShown', question } });
        broadcastQuestion(room, match);
        break;
      }

      case 'team:submitAnswer': {
        if (!match.started || match.phase !== 'playing' || !ws.tqTeamId) return;
        const text = String(m.text ?? '').trim().slice(0, 300);
        if (!text) return;
        match.answers.set(ws.tqTeamId, text);
        broadcast(room, { type: 'teamquiz', msg: { k: 'answerSubmitted', teamId: ws.tqTeamId } });
        break;
      }

      case 'team:submitQuestion': {
        if (!ws.tqTeamId) return;
        const text = String(m.text ?? '').trim().slice(0, 300);
        if (!text) return;
        const question = { id: `q${match.nextQuestionSeq++}`, teamId: ws.tqTeamId, text };
        match.questionInbox.push(question);
        sendToAdmins(room, { type: 'teamquiz', msg: { k: 'questionSubmitted', question } });
        break;
      }

      case 'admin:awardCard': {
        if (!match.started) return;
        const team = match.teams.find((t) => t.id === m.teamId);
        if (!team) return fail(ws, 'Неизвестная команда.');
        if (match.usedCards.has(m.cardId)) return fail(ws, 'Эта карточка уже разыграна.');
        match.usedCards.add(m.cardId);
        const points = Number.isFinite(m.points) ? Math.max(0, Math.round(m.points)) : 0;
        broadcast(room, { type: 'teamquiz', msg: { k: 'jeopardyAwarded', cardId: m.cardId, teamId: m.teamId, points } });
        break;
      }

      case 'admin:applyBoost': {
        if (!match.started) return;
        const team = match.teams.find((t) => t.id === m.teamId);
        if (!team) return fail(ws, 'Неизвестная команда.');
        if (match.usedCards.has(m.cardId)) return fail(ws, 'Эта карточка уже разыграна.');
        match.usedCards.add(m.cardId);
        // The effect is opaque here — the host already resolved it from the
        // jeopardy content it has loaded, this just relays it verbatim.
        broadcast(room, { type: 'teamquiz', msg: { k: 'boostApplied', cardId: m.cardId, teamId: m.teamId, effect: m.effect } });
        break;
      }

      case 'team:bankCard': {
        if (!match.started || !ws.tqTeamId) return;
        if (match.usedCards.has(m.cardId)) return fail(ws, 'Эта карточка уже разыграна.');
        match.usedCards.add(m.cardId);
        // `boostCardId` is opaque here too, same as `admin:applyBoost`'s
        // `effect` — the picking team already resolved it from the jeopardy
        // content it has loaded, this just relays it verbatim.
        broadcast(room, {
          type: 'teamquiz',
          msg: { k: 'cardBanked', cardId: m.cardId, teamId: ws.tqTeamId, boostCardId: m.boostCardId },
        });
        break;
      }

      case 'pilot:result': {
        if (!match.started || match.phase !== 'playing') return;
        const teamId = ws.tqTeamId;
        if (!teamId || !match.teams.some((t) => t.id === teamId)) return;
        resolveTeam(room, match, teamId, m.result ?? emptyResult());
        break;
      }

      case 'pilot:over': {
        if (!match.started) return;
        const teamId = ws.tqTeamId;
        if (!teamId) return;
        match.started = false;
        broadcast(room, { type: 'teamquiz', msg: { k: 'over', teamId } });
        break;
      }

      case 'pilot:snapshot': {
        if (!match.started || !ws.tqTeamId) return;
        broadcast(
          room,
          { type: 'teamquiz', msg: { k: 'snapshot', teamId: ws.tqTeamId, snap: m.snap } },
          ws,
        );
        break;
      }

      case 'team:purchase': {
        if (!match.started || !ws.tqTeamId) return;
        broadcast(room, {
          type: 'teamquiz',
          msg: { k: 'purchase', teamId: ws.tqTeamId, itemId: m.itemId, targetTeamId: m.targetTeamId },
        });
        break;
      }

      case 'player:joinAlliance': {
        if (!match.started || !ws.tqTeamId) return;
        const me = match.teams.find((t) => t.id === ws.tqTeamId);
        const target = match.teams.find((t) => t.id === m.targetId);
        if (!me || !target || me === target || me.allianceId != null) return;
        let allianceId = target.allianceId;
        if (allianceId == null) {
          const used = new Set(match.teams.map((t) => t.allianceId).filter((id) => id != null));
          allianceId = [0, 1, 2].find((i) => !used.has(i));
          if (allianceId === undefined) return;
          target.allianceId = allianceId;
          broadcast(room, { type: 'teamquiz', msg: { k: 'alliance', racerId: target.id, allianceId } });
        } else {
          const size = match.teams.filter((t) => t.allianceId === allianceId).length;
          if (size >= ALLIANCE_MAX) return;
        }
        me.allianceId = allianceId;
        broadcast(room, { type: 'teamquiz', msg: { k: 'alliance', racerId: me.id, allianceId } });
        break;
      }

      case 'player:leaveAlliance': {
        if (!match.started || !ws.tqTeamId) return;
        const me = match.teams.find((t) => t.id === ws.tqTeamId);
        if (!me || me.allianceId == null) return;
        const allianceId = me.allianceId;
        me.allianceId = null;
        broadcast(room, { type: 'teamquiz', msg: { k: 'alliance', racerId: me.id, allianceId: null } });
        // A union left at exactly one member means nobody: dissolve it too.
        const mates = match.teams.filter((t) => t.allianceId === allianceId);
        if (mates.length === 1) {
          mates[0].allianceId = null;
          broadcast(room, { type: 'teamquiz', msg: { k: 'alliance', racerId: mates[0].id, allianceId: null } });
        }
        break;
      }

      default:
        break;
    }
  }

  /** A round nobody finishes must not hang the match: whoever hasn't reported
   *  by the deadline is scored as a plain loss and the round closes. */
  function tick() {
    const now = Date.now();
    for (const [room, match] of matches) {
      if (!match.started || match.phase !== 'playing' || !match.deadline || now < match.deadline) continue;
      for (const team of match.teams) {
        resolveTeam(room, match, team.id, emptyResult());
      }
    }
  }

  function cleanup(room) {
    matches.delete(room);
  }

  return { handle, cleanup, tick };
}
