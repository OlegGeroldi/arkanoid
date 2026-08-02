import { normalizeLevel, type LevelData } from './level';
import { accountLevelFromXp, baseStats, type RunStats } from './progression';
import { SUPERS, type SuperId } from './supers';

const LEGACY_PROFILE_KEY = 'neonoid.profile.v1';
const LEVELS_KEY = 'neonoid.levels.v1';
const STORE_KEY = 'neonoid.store.v2';

export const MAX_PROFILES = 15;
export const LIVES_CHOICES = [1, 3, 5, 9] as const;
export const SPEED_CHOICES = [1, 2, 3] as const;

/** A campaign run frozen between levels. Written automatically after every
 *  cleared level, when no ball is in flight and the state is unambiguous. */
export interface RunSave {
  levelIndex: number;
  lives: number;
  score: number;
  xpTotal: number;
  xpLevel: number;
  xpEarned: number;
  superId: SuperId;
  stats: RunStats;
  /** Perk id -> stacks taken. */
  perks: [string, number][];
  speed: number;
  savedAt: number;
}

export interface Profile {
  id: string;
  name: string;
  /** Admin profiles get everything unlocked plus cheats and player management. */
  admin: boolean;
  totalXp: number;
  bestScore: number;
  runs: number;
  campaignCleared: number;
  /** Highest campaign level reached, 1-based. Level select unlocks up to here. */
  campaignReached: number;
  versusWins: [number, number];
  favouriteSuper: SuperId;
  p2Super: SuperId;
  sfxVolume: number;
  musicVolume: number;
  musicOn: boolean;
  /** Starting lives for a run. */
  lives: number;
  /** Simulation speed multiplier: 1x, 2x or 3x. */
  gameSpeed: number;
  /** The one autosaved campaign run, or null when there is nothing to continue. */
  save: RunSave | null;
}

interface Store {
  version: 2;
  players: Profile[];
  activeId: string;
  /** Admin edits to campaign levels, keyed by 0-based level index. Generated
   *  levels come from a seed, so an edit has to be stored as an override. */
  campaignOverrides: Record<string, LevelData>;
}

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

export function makeProfile(name: string, admin = false): Profile {
  return {
    id: newId('p'),
    name: name.trim().slice(0, 24) || 'Игрок',
    admin,
    totalXp: 0,
    bestScore: 0,
    runs: 0,
    campaignCleared: 0,
    campaignReached: 1,
    versusWins: [0, 0],
    favouriteSuper: 'barrage',
    p2Super: 'meteor',
    sfxVolume: 0.7,
    musicVolume: 0.45,
    musicOn: true,
    lives: 3,
    gameSpeed: 1,
    save: null,
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — the game still runs, it just forgets */
  }
}

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

function sanitizeSave(raw: unknown): RunSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<RunSave>;
  if (typeof s.levelIndex !== 'number' || !isFinite(s.levelIndex)) return null;
  return {
    levelIndex: Math.max(0, Math.floor(s.levelIndex)),
    lives: Math.max(1, Math.floor(s.lives ?? 3)),
    score: Math.max(0, Math.floor(s.score ?? 0)),
    xpTotal: Math.max(0, s.xpTotal ?? 0),
    xpLevel: Math.max(1, Math.floor(s.xpLevel ?? 1)),
    xpEarned: Math.max(0, s.xpEarned ?? 0),
    superId: s.superId && s.superId in SUPERS ? s.superId : 'barrage',
    stats: { ...baseStats(), ...(s.stats ?? {}) },
    perks: Array.isArray(s.perks) ? s.perks.filter((p) => Array.isArray(p) && p.length === 2) : [],
    speed: SPEED_CHOICES.includes(s.speed as (typeof SPEED_CHOICES)[number]) ? s.speed! : 1,
    savedAt: s.savedAt ?? Date.now(),
  };
}

function sanitizeProfile(raw: Partial<Profile>, fallbackName: string): Profile {
  const p = { ...makeProfile(fallbackName), ...raw };
  if (!p.id) p.id = newId('p');
  p.name = String(p.name ?? fallbackName).slice(0, 24) || fallbackName;
  p.admin = p.admin === true;
  if (!(p.favouriteSuper in SUPERS)) p.favouriteSuper = 'barrage';
  if (!(p.p2Super in SUPERS)) p.p2Super = 'meteor';
  if (!Array.isArray(p.versusWins) || p.versusWins.length !== 2) p.versusWins = [0, 0];
  p.totalXp = Math.max(0, p.totalXp ?? 0);
  p.campaignReached = Math.max(1, Math.floor(p.campaignReached ?? 1));
  p.sfxVolume = clamp01(p.sfxVolume, 0.7);
  p.musicVolume = clamp01(p.musicVolume, 0.45);
  p.musicOn = p.musicOn !== false;
  p.lives = LIVES_CHOICES.includes(p.lives as (typeof LIVES_CHOICES)[number]) ? p.lives : 3;
  p.gameSpeed = SPEED_CHOICES.includes(p.gameSpeed as (typeof SPEED_CHOICES)[number]) ? p.gameSpeed : 1;
  p.save = sanitizeSave(p.save);
  return p;
}

/** Reads the store, migrating a single-profile v1 save if that is what is there.
 *  The first profile ever created is the admin one. */
export function loadStore(): Store {
  const raw = read<Partial<Store> | null>(STORE_KEY, null);

  if (raw && Array.isArray(raw.players) && raw.players.length) {
    const players = raw.players.map((p, i) => sanitizeProfile(p, `Игрок ${i + 1}`)).slice(0, MAX_PROFILES);
    const activeId = players.some((p) => p.id === raw.activeId) ? raw.activeId! : players[0].id;
    const overrides: Record<string, LevelData> = {};
    for (const [key, value] of Object.entries(raw.campaignOverrides ?? {})) {
      const level = normalizeLevel(value, `campaign-${key}`);
      if (level) overrides[key] = level;
    }
    return { version: 2, players, activeId, campaignOverrides: overrides };
  }

  const legacy = read<Partial<Profile> | null>(LEGACY_PROFILE_KEY, null);
  const first = sanitizeProfile({ ...(legacy ?? {}), admin: true }, legacy?.name ?? 'Админ');
  const store: Store = { version: 2, players: [first], activeId: first.id, campaignOverrides: {} };
  saveStore(store);
  return store;
}

export function saveStore(store: Store): void {
  write(STORE_KEY, store);
}

export function activeProfile(store: Store): Profile {
  return store.players.find((p) => p.id === store.activeId) ?? store.players[0];
}

export function addProfile(store: Store, name: string): Profile | null {
  if (store.players.length >= MAX_PROFILES) return null;
  const profile = makeProfile(name, store.players.length === 0);
  store.players.push(profile);
  store.activeId = profile.id;
  saveStore(store);
  return profile;
}

export function removeProfile(store: Store, id: string): void {
  // Never leave the store without a profile to load.
  if (store.players.length <= 1) return;
  store.players = store.players.filter((p) => p.id !== id);
  if (!store.players.some((p) => p.id === store.activeId)) store.activeId = store.players[0].id;
  saveStore(store);
}

export const accountLevel = (p: Profile) => accountLevelFromXp(p.totalXp);

export function isSuperUnlocked(p: Profile, id: SuperId): boolean {
  return p.admin || accountLevel(p).level >= SUPERS[id].unlockLevel;
}

// ------------------------------------------------------ campaign overrides --

export function campaignOverride(store: Store, index: number): LevelData | null {
  return store.campaignOverrides[String(index)] ?? null;
}

export function setCampaignOverride(store: Store, index: number, level: LevelData | null): void {
  if (level) store.campaignOverrides[String(index)] = level;
  else delete store.campaignOverrides[String(index)];
  saveStore(store);
}

export type { Store };

// ------------------------------------------------------------- user levels --

export function loadUserLevels(): LevelData[] {
  const raw = read<unknown[]>(LEVELS_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: LevelData[] = [];
  raw.forEach((item, i) => {
    const level = normalizeLevel(item, `user-${i}`);
    if (level) out.push(level);
  });
  return out;
}

export function saveUserLevels(levels: LevelData[]): void {
  write(LEVELS_KEY, levels);
}

export function upsertUserLevel(level: LevelData): LevelData[] {
  const levels = loadUserLevels();
  const i = levels.findIndex((l) => l.id === level.id);
  if (i >= 0) levels[i] = level;
  else levels.push(level);
  saveUserLevels(levels);
  return levels;
}

export function deleteUserLevel(id: string): LevelData[] {
  const levels = loadUserLevels().filter((l) => l.id !== id);
  saveUserLevels(levels);
  return levels;
}

export const newLevelId = (): string => newId('user');
