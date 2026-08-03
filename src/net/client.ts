import type { HallEntry } from '../core/hall';

/** A light snapshot of what another player is doing, for spectating. */
export interface PeerProgress {
  level: number;
  score: number;
  lives: number;
  xpLevel: number;
  mode: string;
  /** 0..1 of the current level's bricks removed. */
  cleared: number;
}

export interface Peer {
  id: string;
  name: string;
  progress: PeerProgress | null;
}

export type NetStatus = 'offline' | 'connecting' | 'online';

type Listener = () => void;
type RelayListener = (payload: unknown, from: string) => void;

/** Talks to the LAN server when the game is served from one.
 *
 *  Everything here is optional by design: opened from a file or GitHub Pages the
 *  game simply stays offline, and every feature that uses the network keeps its
 *  local behaviour. */
export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private relayListeners = new Set<RelayListener>();
  private retry = 0;
  private retryTimer: number | null = null;

  status: NetStatus = 'offline';
  selfId = '';
  room = '';
  name = '';
  peers: Peer[] = [];
  serverHall: HallEntry[] = [];
  /** Set when the page was not served by the room server. */
  unavailable = false;

  /** ws:// address derived from where the page came from. */
  get url(): string {
    const loc = window.location;
    if (loc.protocol === 'file:') return '';
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}`;
  }

  get shareUrl(): string {
    return window.location.origin;
  }

  connect(name: string, room = 'lobby'): void {
    this.name = name;
    this.room = room;
    if (!this.url) {
      this.unavailable = true;
      this.emit();
      return;
    }
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) {
      this.send({ type: 'join', name, room });
      return;
    }
    this.open();
  }

  private open(): void {
    this.status = 'connecting';
    this.emit();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.status = 'online';
      this.unavailable = false;
      this.retry = 0;
      this.send({ type: 'join', name: this.name, room: this.room });
      this.emit();
    });

    ws.addEventListener('message', (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'welcome':
          this.selfId = String(msg.id ?? '');
          if (Array.isArray(msg.hall)) this.serverHall = msg.hall as HallEntry[];
          break;
        case 'joined':
        case 'peers':
          if (Array.isArray(msg.peers)) this.peers = msg.peers as Peer[];
          break;
        case 'progress': {
          const id = String(msg.id ?? '');
          const peer = this.peers.find((p) => p.id === id);
          const progress = (msg.progress ?? null) as PeerProgress | null;
          if (peer) peer.progress = progress;
          else this.peers.push({ id, name: String(msg.name ?? '—'), progress });
          break;
        }
        case 'hall':
          if (Array.isArray(msg.hall)) this.serverHall = msg.hall as HallEntry[];
          break;
        case 'relay':
          // Game modes talk to each other through this channel.
          for (const fn of this.relayListeners) fn(msg.payload, String(msg.id ?? ''));
          break;
        default:
          break;
      }
      this.emit();
    });

    ws.addEventListener('close', () => this.fail());
    ws.addEventListener('error', () => ws.close());
  }

  /** Backs off and retries: a laptop that sleeps mid-game should reconnect on
   *  its own rather than needing a restart. */
  private fail(): void {
    this.ws = null;
    this.peers = [];
    this.status = 'offline';
    this.emit();

    if (this.retryTimer !== null) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.name) this.open();
    }, delay);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Publishes what this player is doing, for the spectator list. */
  reportProgress(progress: PeerProgress | null): void {
    this.send({ type: 'progress', progress });
  }

  submitHall(entry: HallEntry): void {
    this.send({ type: 'hall', entry });
  }

  relay(payload: unknown): void {
    this.send({ type: 'relay', payload });
  }

  disconnect(): void {
    this.name = '';
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.status = 'offline';
    this.peers = [];
    this.emit();
  }

  /** Subscribes to messages other clients send with relay(). */
  onRelay(fn: RelayListener): () => void {
    this.relayListeners.add(fn);
    return () => this.relayListeners.delete(fn);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const net = new NetClient();
