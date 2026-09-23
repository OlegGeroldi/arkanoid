import type { PlayerPublic, ShowEvent } from '../../net/showProtocol';

/** One human sentence per event, for the TV's running feed. */
export function tickerLine(ev: ShowEvent, players: PlayerPublic[]): string {
  const p = players.find((x) => x.id === ev.playerId);
  const who = p ? `${p.avatar} ${p.name}` : 'Someone';
  switch (ev.kind) {
    case 'joined': return `${who} is in the studio!`;
    case 'left': return `${who} disconnected`;
    case 'ready': return p?.ready ? `${who} is ready` : `${who} changed their mind`;
    case 'matchStart': return '🎬 The show begins!';
    case 'roundStart': return '▶ New round — everyone to the arena!';
    case 'cleared': return ev.place === 0 ? `🏁 ${who} cleared the level FIRST! +${ev.points}` : `✅ ${who} cleared the level (+${ev.points})`;
    case 'died': return `💥 ${who} lost every life (+${ev.points ?? 0})`;
    case 'timeout': return `⏱ ${who} ran out of time (+${ev.points ?? 0})`;
    case 'roundEnd': return '📊 Round over';
    case 'matchOver': return `🏆 The winner is ${who}!`;
  }
}
