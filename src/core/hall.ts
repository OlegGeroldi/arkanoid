/** One entry in the shared hall of fame. */
export interface HallEntry {
  /** Stable id so the same run updates instead of duplicating. */
  id: string;
  player: string;
  score: number;
  level: number;
  xp: number;
  /** Seconds spent on the level this score was set on, if it was a clear. */
  time: number;
  mode: string;
  at: number;
  /** Which copy of the game reported it. */
  source: string;
}

const HALL_KEY = 'neonoid.hall.v1';
const CHANNEL = 'neonoid-hall';
const MAX_ENTRIES = 50;

/** Every running copy gets an id, so entries can be told apart even when two
 *  windows share a profile name. */
const SOURCE_ID = `w-${Math.random().toString(36).slice(2, 8)}`;

type Listener = (entries: HallEntry[]) => void;

/** Leaderboard shared by every copy of the game running on this machine.
 *
 *  Storage is the source of truth and BroadcastChannel is the nudge: a second
 *  window learns about a new score immediately, and any window that was closed
 *  during the update still sees it on next read. The same merge logic is what a
 *  future LAN server would drive — only the transport would change. */
export class Hall {
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.addEventListener('message', (e) => {
        const entry = e.data as HallEntry | undefined;
        if (entry && typeof entry.score === 'number') {
          this.merge([entry], false);
        }
      });
    } catch {
      /* no BroadcastChannel (older browser): storage events still sync */
    }

    window.addEventListener('storage', (e) => {
      if (e.key === HALL_KEY) this.emit();
    });
  }

  get sourceId(): string {
    return SOURCE_ID;
  }

  list(): HallEntry[] {
    try {
      const raw = localStorage.getItem(HALL_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HallEntry[];
      return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.score === 'number') : [];
    } catch {
      return [];
    }
  }

  /** Adds or updates an entry and tells the other windows about it. */
  submit(entry: Omit<HallEntry, 'at' | 'source'>): void {
    const full: HallEntry = { ...entry, at: Date.now(), source: SOURCE_ID };
    this.merge([full], true);
  }

  private merge(incoming: HallEntry[], broadcast: boolean): void {
    const byId = new Map(this.list().map((e) => [e.id, e]));
    for (const entry of incoming) {
      const existing = byId.get(entry.id);
      // Keep the better run when the same id comes back with a lower score.
      if (!existing || entry.score >= existing.score) byId.set(entry.id, entry);
    }

    const merged = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
    try {
      localStorage.setItem(HALL_KEY, JSON.stringify(merged));
    } catch {
      /* storage full or unavailable — the in-memory list still updates */
    }

    if (broadcast && this.channel) {
      for (const entry of incoming) this.channel.postMessage(entry);
    }
    this.emit();
  }

  clear(): void {
    try {
      localStorage.removeItem(HALL_KEY);
    } catch {
      /* nothing to do */
    }
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const entries = this.list();
    for (const fn of this.listeners) fn(entries);
  }
}

export const hall = new Hall();
