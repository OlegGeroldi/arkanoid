import { normalizeLevel, type LevelData } from './level';
import { accountLevelFromXp } from './progression';
import { SUPERS, type SuperId } from './supers';

const PROFILE_KEY = 'neonoid.profile.v1';
const LEVELS_KEY = 'neonoid.levels.v1';

export interface Profile {
  name: string;
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
}

export const LIVES_CHOICES = [1, 3, 5, 9] as const;
export const SPEED_CHOICES = [1, 2, 3] as const;

const defaultProfile = (): Profile => ({
  name: 'Игрок',
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
});

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

export function loadProfile(): Profile {
  const p = { ...defaultProfile(), ...read<Partial<Profile>>(PROFILE_KEY, {}) };
  if (!(p.favouriteSuper in SUPERS)) p.favouriteSuper = 'barrage';
  if (!(p.p2Super in SUPERS)) p.p2Super = 'meteor';
  if (!Array.isArray(p.versusWins) || p.versusWins.length !== 2) p.versusWins = [0, 0];
  p.campaignReached = Math.max(1, Math.floor(p.campaignReached ?? 1));
  p.sfxVolume = clamp01(p.sfxVolume, 0.7);
  p.musicVolume = clamp01(p.musicVolume, 0.45);
  p.musicOn = p.musicOn !== false;
  p.lives = LIVES_CHOICES.includes(p.lives as (typeof LIVES_CHOICES)[number]) ? p.lives! : 3;
  p.gameSpeed = SPEED_CHOICES.includes(p.gameSpeed as (typeof SPEED_CHOICES)[number]) ? p.gameSpeed! : 1;
  return p as Profile;
}

export function saveProfile(p: Profile): void {
  write(PROFILE_KEY, p);
}

export const accountLevel = (p: Profile) => accountLevelFromXp(p.totalXp);

export function isSuperUnlocked(p: Profile, id: SuperId): boolean {
  return accountLevel(p).level >= SUPERS[id].unlockLevel;
}

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

export const newLevelId = (): string => `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
